// lib/quote-engine.js
// 푸드트럭하우스 견적 엔진.
// ★ 모든 금액은 이 파일에서만 계산한다. AI는 절대 가격을 직접 만들지 않는다.
// ★ 견적 규칙이 바뀌면 여기 한 곳만 고친다.

const BASE_HOURS = 3;              // 기본 제공 시간
const OVERTIME_PER_HOUR = 30000;   // 초과 시간당
const MIN_FOOD_VALUE = 600000;     // 최소 음식값 (출장비·기타 제외, 메뉴 합계 기준)

// 지역별 기준 출장비 (협의 가능) — TODO: 기존 index.html의 실제 표로 교체할 것
const TRAVEL_FEE = {
  "서울": 50000,
  "경기": 50000,
  "인천": 50000,
  "기본": 50000,
};

// 기타비용
const EXTRA_FEE = {
  "발전기": 50000,
  "출력물": 20000,
  "섹터이동": 50000,
  "실내부스": 150000,
};

// 3단계 분기 기준
const FIXED_MAX = 1200000;   // 미만 → 확정가
const RANGE_MAX = 1500000;   // 이하 → 범위 / 초과 → 담당자 연결

/**
 * @param {Object} p
 * @param {Array<{name?:string, unitPrice:number, servings:number}>} p.items  메뉴 항목들
 * @param {string} p.region       지역명 (TRAVEL_FEE 키)
 * @param {number} [p.serviceHours=3]  운영 시간
 * @param {string[]} [p.extras=[]]     기타비용 항목 (EXTRA_FEE 키)
 */
function calculateQuote({ items = [], region = "기본", serviceHours = 3, extras = [] }) {
  const foodValue = items.reduce((s, it) => s + (it.unitPrice * it.servings), 0);

  // 최소 음식값 미달 → 견적 대신 유선 상담 안내 (단, 리드는 살린다)
  if (foodValue < MIN_FOOD_VALUE) {
    return {
      status: "below_minimum",
      foodValue,
      minimum: MIN_FOOD_VALUE,
      message: "정확한 상담을 위해 담당자가 곧 연락드릴 예정입니다.",
    };
  }

  const travel = TRAVEL_FEE[region] ?? TRAVEL_FEE["기본"];
  const overtime = Math.max(0, serviceHours - BASE_HOURS) * OVERTIME_PER_HOUR;
  const extraTotal = extras.reduce((s, k) => s + (EXTRA_FEE[k] || 0), 0);
  const subtotal = foodValue + travel + overtime + extraTotal;

  let mode;
  if (subtotal < FIXED_MAX) mode = "fixed";        // 확정가
  else if (subtotal <= RANGE_MAX) mode = "range";  // 범위 제시
  else mode = "handoff";                           // 담당자 연결

  const result = {
    status: "ok",
    mode,
    breakdown: { foodValue, travel, overtime, extraTotal },
    subtotal,                    // 공급가 (VAT 별도)
    note: "표시 금액은 부가세(VAT) 별도입니다.",
  };

  if (mode === "range") {
    // 공급가는 오르는 경우가 드물어 -10% ~ 0% 범위로 제시
    result.rangeLow = Math.round(subtotal * 0.9);
    result.rangeHigh = subtotal;
  }
  if (mode === "handoff") {
    result.message = "규모가 있는 행사라 더 정확한 상담을 위해 담당자가 곧 연락드릴 예정입니다.";
  }
  return result;
}

module.exports = { calculateQuote };
// ESM으로 쓰는 경우: export { calculateQuote };
