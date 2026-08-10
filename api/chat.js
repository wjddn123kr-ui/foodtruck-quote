// api/chat.js
// 백엔드 프록시: 프론트에서 대화 내역을 받아 Claude API에 넘기고,
// AI가 견적 도구를 부르면 quote-engine으로 계산해 다시 넘긴 뒤, 최종 답변만 프론트로 돌려준다.
// ★ ANTHROPIC_API_KEY 는 Vercel 환경변수. 프론트엔드에 절대 노출하지 않는다.

const { calculateQuote } = require('../lib/quote-engine.js');
const { SYSTEM_KNOWLEDGE } = require('../lib/knowledge.js');
const { sendLeadAlert } = require('../lib/lead-notify.js');
const { logLead } = require('../lib/sheet-log.js');

const MODEL = 'claude-sonnet-4-6'; // 상담용. 비용을 더 줄이려면 claude-haiku-4-5-20251001

// AI에게 알려줄 도구 정의
const tools = [
  {
    name: 'calculate_quote',
    description: '고객 정보(메뉴·인분수·지역 등)가 충분히 모였을 때만 호출한다. 정확한 견적을 계산해 반환한다. 이 도구 없이 절대 금액을 말하지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: '주문 메뉴 항목들',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              unitPrice: { type: 'number', description: '메뉴 단가(원)' },
              servings: { type: 'number', description: '인분 수' },
            },
            required: ['unitPrice', 'servings'],
          },
        },
        region: { type: 'string', description: '행사 지역' },
        serviceHours: { type: 'number', description: '운영 시간(기본 3)' },
        extras: { type: 'array', items: { type: 'string' }, description: '추가 옵션' },
      },
      required: ['items', 'region'],
    },
  },
  {
    name: 'submit_lead',
    description: '고객이 상담을 원하거나 연락처를 남겼을 때 호출한다. 담당자에게 상담 리드를 문자로 전달한다. 반드시 성함(회사명)과 연락처를 받은 뒤에만 호출한다.',
    input_schema: {
      type: 'object',
      properties: {
        contactName: { type: 'string', description: '담당자명 또는 회사명' },
        phone: { type: 'string', description: '연락처(전화번호)' },
        region: { type: 'string', description: '행사 지역(있으면)' },
        menu: { type: 'string', description: '문의 메뉴·인분 요약(있으면)' },
        quote: { type: 'string', description: '안내한 견적 금액 요약(있으면)' },
        datetime: { type: 'string', description: '행사 날짜·시간(있으면)' },
        note: { type: 'string', description: '기타 문의·특이사항(있으면)' },
      },
      required: ['contactName', 'phone'],
    },
  },
];

// 상담 리드를 담당자에게 문자로 발송
async function handleLead(input) {
  const p = input || {};
  const lines = [
    '[푸드트럭하우스 챗봇 상담 신청]',
    `담당자/회사: ${p.contactName || '-'}`,
    `연락처: ${p.phone || '-'}`,
  ];
  if (p.region) lines.push(`지역: ${p.region}`);
  if (p.menu) lines.push(`메뉴/인분: ${p.menu}`);
  if (p.quote) lines.push(`견적: ${p.quote}`);
  if (p.datetime) lines.push(`일정: ${p.datetime}`);
  if (p.note) lines.push(`문의: ${p.note}`);

  const res = await sendLeadAlert(lines.join('\n'));

  // 구글시트에도 영구 기록(문자를 놓쳐도 리드를 잃지 않기 위함). 실패해도 무시.
  await logLead({
    source: '대화형챗봇',
    contactName: p.contactName || '',
    phone: p.phone || '',
    region: p.region || '',
    menu: p.menu || '',
    quote: p.quote || '',
    datetime: p.datetime || '',
    note: p.note || '',
  });

  // AI에게는 항상 접수됨을 알려 고객에게 안심 안내하도록 한다(발송 실패해도 대화상 리드는 남음).
  return res.ok
    ? { status: 'submitted', message: '담당자에게 상담 신청이 전달되었습니다.' }
    : { status: 'received', message: '상담 신청이 접수되었습니다. (담당자 확인 예정)' };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages 배열이 필요합니다.' });
    }

    const convo = [...messages];

    // 도구 호출이 나오면 실행하고 다시 물어보는 루프 (최대 3회)
    for (let i = 0; i < 3; i++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          // 프롬프트 캐싱: 고정 지식(system)에 캐시 지점을 두면 tools+system이 함께 캐시된다.
          // 반복 요청 시 이 부분은 재계산하지 않고 캐시에서 읽어 비용·속도를 크게 줄인다(답변 품질은 동일).
          system: [
            { type: 'text', text: SYSTEM_KNOWLEDGE, cache_control: { type: 'ephemeral' } },
          ],
          tools,
          messages: convo,
        }),
      });

      const data = await r.json();
      if (data.error) {
        return res.status(500).json({ error: data.error.message || 'API 오류' });
      }

      if (data.stop_reason === 'tool_use') {
        const toolUses = data.content.filter((b) => b.type === 'tool_use');
        convo.push({ role: 'assistant', content: data.content });

        const results = await Promise.all(toolUses.map(async (tu) => {
          let out;
          if (tu.name === 'calculate_quote') {
            out = calculateQuote(tu.input);
          } else if (tu.name === 'submit_lead') {
            out = await handleLead(tu.input);
          } else {
            out = { error: 'unknown tool' };
          }
          return {
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(out),
          };
        }));

        convo.push({ role: 'user', content: results });
        continue; // 결과를 넣고 한 번 더 AI에게 물어본다
      }

      // 도구 없이 바로 답한 경우 → 최종 답변 반환
      const reply = data.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return res.status(200).json({ reply });
    }

    return res.status(200).json({ reply: '죄송해요, 잠시 후 다시 시도해 주세요.' });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
};
