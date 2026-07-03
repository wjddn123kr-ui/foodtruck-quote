// lib/lead-notify.js
// 챗봇 상담 리드를 담당자(직원)에게 문자(LMS)로 발송한다.
// 기존 api/notify.js의 솔라피(SOLAPI) 발송 로직과 동일한 방식.
// 필요한 환경변수: SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_SENDER, ALERT_TO

const crypto = require('crypto');

// 솔라피 HMAC-SHA256 서명
function authHeader(apiKey, apiSecret) {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(32).toString('hex');
  const signature = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

async function solapiSend(message, apiKey, apiSecret) {
  const r = await fetch('https://api.solapi.com/messages/v4/send', {
    method: 'POST',
    headers: { Authorization: authHeader(apiKey, apiSecret), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  const result = await r.json().catch(() => ({}));
  return { httpOk: r.ok, status: r.status, result };
}

function isOk(httpOk, result) {
  if (!httpOk) return false;
  const code = result && (result.statusCode || (result.groupInfo && result.groupInfo.status));
  if (code && !String(code).startsWith('2')) return false;
  return true;
}

/**
 * 상담 리드 텍스트를 담당자에게 문자로 발송.
 * @param {string} text  담당자에게 보낼 요약 텍스트
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
async function sendLeadAlert(text) {
  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  const from = (process.env.SOLAPI_SENDER || '').replace(/\D/g, '');
  const to = (process.env.ALERT_TO || '').replace(/\D/g, '');

  if (!apiKey || !apiSecret || !from || !to) {
    return { ok: false, reason: 'env_missing' }; // 환경변수 미설정 (Vercel에 SOLAPI_* 등록 필요)
  }

  const message = {
    to, from,
    text: String(text || '새 상담 리드가 접수되었습니다.').slice(0, 2000),
    type: 'LMS',
    subject: '푸드트럭 챗봇 상담 리드',
  };

  try {
    const r = await solapiSend(message, apiKey, apiSecret);
    if (isOk(r.httpOk, r.result)) return { ok: true };
    const reason = (r.result && (r.result.errorMessage || r.result.message)) || ('HTTP ' + r.status);
    return { ok: false, reason };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
}

module.exports = { sendLeadAlert };
