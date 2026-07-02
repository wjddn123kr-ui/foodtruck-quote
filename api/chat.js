// api/chat.js
// 백엔드 프록시: 프론트에서 대화 내역을 받아 Claude API에 넘기고,
// AI가 견적 도구를 부르면 quote-engine으로 계산해 다시 넘긴 뒤, 최종 답변만 프론트로 돌려준다.
// ★ ANTHROPIC_API_KEY 는 Vercel 환경변수. 프론트엔드에 절대 노출하지 않는다.

const { calculateQuote } = require('../lib/quote-engine.js');
const { SYSTEM_KNOWLEDGE } = require('../lib/knowledge.js');

const MODEL = 'claude-sonnet-4-6'; // 상담용. 비용을 더 줄이려면 claude-haiku-4-5-20251001

// AI에게 알려줄 도구 정의
const tools = [{
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
}];

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
          system: SYSTEM_KNOWLEDGE,
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

        const results = toolUses.map((tu) => {
          let out;
          if (tu.name === 'calculate_quote') {
            out = calculateQuote(tu.input);
          } else {
            out = { error: 'unknown tool' };
          }
          return {
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(out),
          };
        });

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
