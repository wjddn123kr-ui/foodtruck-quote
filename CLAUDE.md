# CLAUDE.md — 푸드트럭하우스 대화형 견적 챗봇

이 저장소(`foodtruck-quote`)에 **대화형 AI 견적 챗봇**을 추가한다.
기존 정적 견적폼(`index.html`)과 알림 함수(`api/notify.js`)는 그대로 두고, 그 위에 챗봇 레이어를 얹는다.

## 이 챗봇이 하는 일 (MVP 범위)
1. **견적 상담** — 고객이 자연어로 말하면 정보를 모아 정확한 견적을 계산한다.
2. **메뉴/FAQ 안내** — 메뉴 구성, 자주 묻는 질문에 답한다.

## 구조 (반드시 이 흐름을 지킨다)
```
고객(자연어) → 채팅 UI → api/chat.js(백엔드·API키 숨김) → Claude API(지식+도구)
                                                              ├─ calculate_quote 도구 → lib/quote-engine.js (정확한 숫자)
                                                              └─ (2차) Supabase 실시간 데이터
응답은 이 경로를 거꾸로 타고 고객에게 돌아온다.
```

## 절대 규칙 (어기면 안 됨)
- **AI는 절대 가격을 직접 만들지 않는다.** 모든 금액은 `calculate_quote` 도구(= `lib/quote-engine.js`)를 통해서만 나온다. 도구를 부르지 않고 숫자를 말하는 건 금지.
- 견적 규칙의 원본은 `lib/quote-engine.js` 하나뿐이다. 규칙이 바뀌면 여기만 고친다.
- `ANTHROPIC_API_KEY`는 Vercel 환경변수로만 다룬다. 프론트엔드(HTML/JS)에 키를 절대 노출하지 않는다.
- 메뉴 문구·말투는 브랜드 톤을 따른다: 신뢰감 있고 담백하게, 과장·소비자우위 표현 금지.

## 파일 구조
```
api/chat.js              # 백엔드 프록시 (Claude API 호출 + 도구 실행 루프)
lib/quote-engine.js      # 견적 계산 엔진 (숫자는 전부 여기서만)
lib/knowledge.js         # 챗봇 지식(메뉴·규칙 요약·FAQ·말투) = 시스템 프롬프트
index.html               # 기존 견적폼 (건드리지 않음)
chatbot.html             # 챗봇 화면 (기존 챗봇 HTML을 여기에 연결)
api/notify.js            # 기존 알림 함수 (건드리지 않음)
```

## 작업 체크리스트 (이 순서대로)
- [ ] **1. 데이터 이관**: 기존 `index.html`에 들어있는 메뉴·단가·지역별 출장비표·기타비용을 `lib/quote-engine.js`의 상수로 옮긴다. 값을 새로 지어내지 말고 기존 폼 그대로 복사한다.
- [ ] **2. 엔진 검증**: `node -e` 로 몇 가지 케이스를 계산해 기존 폼 결과와 숫자가 일치하는지 확인한다.
- [ ] **3. 지식 채우기**: `lib/knowledge.js`의 메뉴 설명·FAQ를 실제 내용으로 채운다.
- [ ] **4. 백엔드**: `api/chat.js`가 도구 루프를 정상 처리하는지 로컬에서 확인한다.
- [ ] **5. UI 연결**: 기존 챗봇 HTML의 전송 함수를 아래 방식으로 `/api/chat`에 연결한다.
- [ ] **6. 배포**: `ANTHROPIC_API_KEY` 환경변수 등록 → GitHub push → Vercel 자동 배포.
- [ ] **7. 알림 연결(선택)**: 견적이 확정되면 기존 `api/notify.js`를 호출해 사장님께 리드를 넘긴다.

## 프론트엔드 → 백엔드 연결 방식
채팅 화면은 대화 전체(`messages` 배열)를 매번 함께 보낸다. AI는 이전 대화를 기억하지 못하므로 히스토리를 항상 같이 넘겨야 한다.

```js
// 사용자가 메시지를 보낼 때
history.push({ role: 'user', content: 사용자입력 });

const res = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: history })
});
const { reply } = await res.json();

history.push({ role: 'assistant', content: reply });
// reply 를 챗봇 말풍선으로 렌더
```

## 환경변수 (Vercel)
- `ANTHROPIC_API_KEY` — Anthropic 콘솔에서 발급
- (기존) `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_SENDER`, `ALERT_TO`, `KAKAO_PFID`

## 검증 습관
- JS 수정 후 항상 `node --check <파일>` 로 문법 검사.
- 엔진 로직 바꾸면 대표적 케이스 3개(최소 미달 / 확정가 / 범위) 재계산해서 확인.
