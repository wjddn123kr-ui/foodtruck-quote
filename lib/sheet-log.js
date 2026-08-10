// lib/sheet-log.js
// 리드(상담·견적 신청)를 구글시트(Google Apps Script 웹앱)에 한 줄로 저장한다.
// 문자 알림과 별개로 '영구 기록'을 남겨, 문자를 놓쳐도 리드를 잃지 않기 위함.
//
// 동작 조건: 환경변수 SHEET_WEBHOOK_URL (Apps Script 웹앱 배포 URL).
//   - 미설정이면 조용히 건너뛴다(기존 흐름 영향 없음).
//   - 저장 실패해도 예외를 던지지 않는다(문자 발송 등 본 흐름을 절대 방해하지 않음).
//
// 전달 형식(구글시트 컬럼과 매칭):
//   { source, contactName, phone, region, menu, quote, datetime, note }

async function logLead(row) {
  const url = process.env.SHEET_WEBHOOK_URL;
  if (!url) return { ok: false, skipped: true }; // 미설정 → 건너뜀

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row || {}),
      // Apps Script 웹앱은 302 리다이렉트로 응답할 수 있어 기본 follow(=자동 추적)로 둔다.
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

module.exports = { logLead };
