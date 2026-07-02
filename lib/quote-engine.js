// lib/quote-engine.js
// 푸드트럭하우스 견적 엔진 (선택형 견적폼 index.html의 실제 로직과 동일하게 맞춤).
// ★ 최종 금액 계산은 이 파일에서만 한다. 규칙이 바뀌면 여기 한 곳만 고친다.

const BASE_HOURS = 3;              // 서비스 제공 기본 시간
const OVERTIME_PER_HOUR = 30000;   // 초과 시간당
const MIN_FOOD_VALUE = 600000;     // 최소 음식값 (메뉴 합계 기준)
const RANGE_LOW = 1200000;         // 미만 → 확정가
const RANGE_HIGH = 1500000;        // 이하 → 범위 / 초과 → 담당자 연결
const VAT = 0.10;

// 지역별 기준 출장비 (index.html REGION 표와 동일)
const TRAVEL_FEE = {
  "서울·경기남부": 100000,
  "경기북부·외곽": 120000,
  "천안·아산": 120000,
  "충청도권": 150000,
  "강원도권": 200000,
  "전라북도권": 200000,
  "전라남도권": 300000,
  "경상북도권": 200000,
  "경상남도권": 300000,
  "제주·섬지역권": 0,      // 별도 상세 안내 (담당자 연결)
};

// 도시/키워드 → 지역 그룹 매핑 (AI가 도시명만 넘겨도 그룹을 찾아준다)
const REGION_KEYWORDS = {
  "서울·경기남부": ["서울","수원","성남","용인","화성","안양","평택","광명","과천","의왕","군포","안산","오산","시흥","부천","안성","하남","이천","여주","분당","판교"],
  "경기북부·외곽": ["고양","일산","파주","의정부","남양주","구리","양주","동두천","포천","연천","가평","양평","김포","인천"],
  "천안·아산": ["천안","아산"],
  "충청도권": ["충청","청주","대전","세종","충주","제천","공주","논산","서산","당진","보령","홍성","충남","충북"],
  "강원도권": ["강원","춘천","원주","강릉","속초","동해","삼척","태백","정선","평창","홍천","횡성"],
  "전라북도권": ["전북","전주","익산","군산","정읍","남원","김제","완주"],
  "전라남도권": ["전남","광주","목포","여수","순천","나주","광양","무안"],
  "경상북도권": ["경북","대구","포항","경주","구미","안동","김천","영주","경산","칠곡"],
  "경상남도권": ["경남","부산","울산","창원","김해","진주","양산","거제","통영","밀양","마산"],
  "제주·섬지역권": ["제주","서귀포","섬","울릉","독도"],
};

// 기타비용 (index.html과 동일)
const EXTRA_FEE = {
  "발전기": 50000,      // 전기 지원 불가 시 자가발전기 사용료
  "자가발전기": 50000,
  "섹터이동": 50000,
  "모니터": 50000,
  "X배너": 20000,
  "엑스배너": 20000,
  "스티커": 40000,
  "출력물": 20000,
};

// 지역 입력을 그룹명으로 정규화. 못 찾으면 null.
function resolveRegion(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (TRAVEL_FEE[s] != null) return s;                 // 이미 그룹명
  for (const group in REGION_KEYWORDS) {
    if (REGION_KEYWORDS[group].some((kw) => s.includes(kw))) return group;
  }
  return null;
}

function roundThousand(n) { return Math.round(n / 1000) * 1000; }

/**
 * @param {Object} p
 * @param {Array<{name?:string, unitPrice:number, servings:number}>} p.items  메뉴 항목들
 * @param {string} p.region       지역명 또는 도시명 (예: "수원")
 * @param {number} [p.serviceHours=3]  운영 시간 (기본 3)
 * @param {string[]} [p.extras=[]]     기타 옵션 (EXTRA_FEE 키)
 */
function calculateQuote({ items = [], region = "", serviceHours = 3, extras = [] }) {
  const foodValue = items.reduce((s, it) => s + (Number(it.unitPrice) * Number(it.servings)), 0);

  // 1) 최소 음식값 미달 → 유선 상담 (리드는 살린다)
  if (foodValue < MIN_FOOD_VALUE) {
    return {
      status: "below_minimum",
      foodValue,
      minimum: MIN_FOOD_VALUE,
      message: `음식값이 최소 기준(${MIN_FOOD_VALUE.toLocaleString('ko-KR')}원)보다 적어요. 인분·메뉴를 추가하시면 진행되며, 정확한 상담을 위해 담당자가 곧 연락드릴 예정입니다.`,
    };
  }

  // 2) 지역 출장비
  const group = resolveRegion(region);
  const travel = group ? TRAVEL_FEE[group] : 0;
  const regionUnknown = !group;
  const islandRegion = group === "제주·섬지역권";

  // 3) 초과시간 · 기타옵션
  const overtime = Math.max(0, Number(serviceHours || BASE_HOURS) - BASE_HOURS) * OVERTIME_PER_HOUR;
  const extraTotal = (extras || []).reduce((s, k) => s + (EXTRA_FEE[k] || 0), 0);

  const subtotal = foodValue + travel + overtime + extraTotal;  // 공급가 (VAT 별도)
  const vat = Math.round(subtotal * VAT);
  const total = subtotal + vat;

  // 4) 상담 연결이 필요한 사유
  const reasons = [];
  if (islandRegion) reasons.push("제주·섬지역 출장비는 담당자가 별도로 상세히 안내드려요");
  if (regionUnknown) reasons.push("정확한 출장비 반영을 위해 지역(도시)을 확인해야 해요");
  const large = subtotal > RANGE_HIGH;

  // 5) 3단계 분기
  let mode;
  if (large) mode = "handoff";
  else if (subtotal < RANGE_LOW && reasons.length === 0) mode = "fixed";
  else mode = "range";

  const result = {
    status: "ok",
    mode,
    region: group || String(region || "미정"),
    breakdown: { foodValue, travel, overtime, extraTotal },
    subtotal,
    vat,
    total,
    note: "표시 금액은 부가세(VAT) 별도이며, 공급가는 상황에 따라 소폭 조정될 수 있어요.",
  };

  if (reasons.length) result.consultReasons = reasons;

  if (mode === "range") {
    result.rangeLow = roundThousand(subtotal * 0.9);
    result.rangeHigh = roundThousand(subtotal);
    result.message = "대략 금액은 아래 범위이며, 담당자 확인 후 확정됩니다.";
  }
  if (mode === "handoff") {
    result.message = "규모가 있는 행사라 더 정확한 상담을 위해 담당자가 곧 연락드릴 예정입니다.";
  }
  return result;
}

module.exports = { calculateQuote };
// ESM으로 쓰는 경우: export { calculateQuote };
