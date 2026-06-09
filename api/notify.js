const crypto = require('crypto');

function readRaw(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
    req.on('error', () => resolve(''));
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST only' }); return; }

  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  const from = (process.env.SOLAPI_SENDER || '').replace(/\D/g, '');
  const to = (process.env.ALERT_TO || '').replace(/\D/g, '');
  const pfId = process.env.KAKAO_PFID || '';

  if (!apiKey || !apiSecret || !from || !to) {
    res.status(500).json({ ok: false, error: '환경변수가 비어 있습니다. SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_SENDER, ALERT_TO 를 확인하세요.' });
    return;
  }

  let data = req.body;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = null; } }
  if (!data || typeof data !== 'object') {
    const raw = await readRaw(req);
    try { data = JSON.parse(raw || '{}'); } catch (e) { data = {}; }
  }
  const text = (data.message || '새 견적 신청이 접수되었습니다.').toString().slice(0, 1000);

  const message = { to, from, text };
  if (pfId) {
    message.kakaoOptions = { pfId: pfId, disableSms: false };
  } else {
    message.type = 'LMS';
    message.subject = '푸드트럭 견적 신청';
  }

  const date = new Date().toISOString();
  const salt = crypto.randomBytes(32).toString('hex');
  const signature = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');
  const authorization = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;

  try {
    const r = await fetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const result = await r.json().catch(() => ({}));
    if (!r.ok) {
      const reason = (result && (result.errorMessage || result.message)) || ('HTTP ' + r.status);
      res.status(502).json({ ok: false, reason });
      return;
    }
    const code = result && (result.statusCode || (result.groupInfo && result.groupInfo.status));
    if (code && !String(code).startsWith('2')) {
      res.status(502).json({ ok: false, reason: (result.statusMessage || ('상태코드 ' + code)) });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ ok: false, reason: String((e && e.message) || e) });
  }
};
