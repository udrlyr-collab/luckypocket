# 1. 전체 디자인 방향
행운주머니는 귀엽고 깔끔한 숫자 성장 게임이다.

**디자인 키워드**:
* 귀여움, 깔끔함, 부드러움, 둥근 카드, 밝은 배경, 읽기 쉬운 숫자, 과하지 않은 장식, 통일된 여백, 모바일에서도 보기 편한 구조

**사용 테마**:
* Tailwind CSS
* daisyUI cupcake theme

**금지**:
* 화면마다 카드 모양이 다름
* 버튼 높이가 제각각
* 섹션 여백이 들쭉날쭉
* 너무 많은 색상 사용
* 너무 강한 빨강/파랑 남발
* 큰 숫자를 줄바꿈 없이 밀어넣어 레이아웃 깨짐
* “틱 ++” 같은 어색한 표현
* 페이지마다 컨테이너 폭이 달라 화면이 흔들림

---

# 2. 공통 레이아웃 규칙
모든 페이지는 같은 `PageContainer`를 사용한다.

```jsx
export function PageContainer({ children }) {
  return (
    <main className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {children}
    </main>
  );
}
```

* 모든 주요 페이지는 `PageContainer` 안에 들어간다.
* 페이지마다 `max-w`를 임의로 다르게 쓰지 않는다. (기본 `max-w-6xl`)
* 좁은 폼 페이지는 내부 카드만 `max-w-md` 또는 `max-w-lg`로 제한한다.
* body와 root에는 `overflow-x-hidden` 적용
* 스크롤바 때문에 화면 폭이 흔들리지 않게 `scrollbar-gutter: stable` 적용

```css
html {
  scrollbar-gutter: stable;
}

html,
body,
#root {
  width: 100%;
  min-height: 100%;
  overflow-x: hidden;
}
```

---

# 3. 카드 디자인 규칙
모든 주요 정보는 공통 카드 스타일을 사용한다.

* **기본 카드**:
  ```jsx
  <div className="rounded-3xl border border-base-300 bg-base-100 shadow-sm p-5 sm:p-6">...</div>
  ```
* **강조 카드**:
  ```jsx
  <div className="rounded-3xl border border-primary/20 bg-primary/5 shadow-sm p-5 sm:p-6">...</div>
  ```
* **위험/주의 카드**:
  ```jsx
  <div className="rounded-3xl border border-warning/30 bg-warning/10 shadow-sm p-5 sm:p-6">...</div>
  ```
* **오류/손실 카드**:
  ```jsx
  <div className="rounded-3xl border border-error/30 bg-error/10 shadow-sm p-5 sm:p-6">...</div>
  ```

**규칙**:
* 카드 radius는 기본 `rounded-3xl`
* 카드 padding은 기본 `p-5 sm:p-6`
* 그림자는 강하지 않게 `shadow-sm`
* 카드끼리 높이가 너무 달라 보이면 grid에서 `h-full` 사용
* 카드 내부 제목/본문/버튼 간격은 일관되게 유지

---

# 4. 색상 규칙
색상은 daisyUI semantic color를 사용한다.

* `primary`: 핵심 액션, 강조
* `secondary`: 보조 강조
* `accent`: 귀여운 포인트
* `success`: 상승, 수익, 성공
* `warning`: 주의, 거래주의, 공모주
* `error`: 손실, 급락, 상장폐지 위험
* `neutral`: 비활성, 종료, 상장폐지
* `base-100`, `base-200`, `base-300`: 배경과 카드

**금지**: 임의 hex 색상 남발, 페이지마다 다른 색상 사용.

**상승/하락 규칙**:
```jsx
const valueClass = value > 0 ? "text-success" : value < 0 ? "text-error" : "text-base-content/60";
```

---

# 5. 텍스트 규칙
* **제목**: `<h1 className="text-2xl sm:text-3xl font-black tracking-tight">`
* **섹션 제목**: `<h2 className="text-lg sm:text-xl font-bold">`
* **설명**: `<p className="text-sm text-base-content/60 leading-relaxed">`
* **숫자**: `<p className="text-2xl sm:text-3xl font-black tabular-nums">`

**규칙**:
* 숫자에는 `tabular-nums` 사용
* 긴 숫자는 줄바꿈되거나 카드 밖으로 나가면 안 됨 (한국식 단위 축약 활용)
* 설명 문장은 너무 길게 쓰지 않음

---

# 6. 숫자 표시 규칙
* **일반 금액**: `1,000,000원`
* **큰 금액**: `126억`, `3,400억`, `1조 2,000억`
* **등락**: 
  * `전 tick 대비 +1,552원 · +4.4%`
  * `전 tick 대비 -820원 · -2.1%`
  * 반드시 양수는 `+`, 음수는 `-`, 금액과 퍼센트를 함께 표시
* **금지**: `틱 ++1,552원`, `틱 --820원`

---

# 7. 버튼 규칙
* **기본 버튼**: `<button className="btn btn-primary min-h-12 rounded-2xl">`
* **보조 버튼**: `<button className="btn btn-outline min-h-12 rounded-2xl">`
* **위험 버튼**: `<button className="btn btn-error min-h-12 rounded-2xl">`

**규칙**:
* 최소 높이 `min-h-12`, radius `rounded-2xl`
* 같은 그룹의 버튼은 높이와 너비가 비슷해야 함
* 모바일에서 너무 작아지지 않게 주의
* 빠른 금액 버튼은 `whitespace-nowrap` 적용

---

# 8. 입력창 규칙
* `<input className="input input-bordered w-full min-h-12 rounded-2xl" />`
* 높이 `min-h-12`, 버튼과 세로 정렬 맞춤
* 에러 영역 확보: `<div className="min-h-6 text-sm text-error">{errorMessage}</div>`

---

# 9. Badge 규칙
* 공모주: `badge-warning`
* 신규 상장: `badge-secondary`
* 우량주: `badge-primary`
* 거래주의: `badge-warning`
* 상장폐지 심사: `badge-error`
* 회생 중: `badge-success`
* 인수됨: `badge-secondary`
* 인수자 ETF: `badge-primary`
* 상장폐지: `badge-neutral`

---

# 10. 모달 규칙
* modal-box는 `rounded-3xl`
* 확인 버튼은 우측 하단 (`min-h-12 rounded-2xl`)
* 위험한 작업은 Enter 자동 확인 금지 또는 명확한 focus 필요

---

# 11. 주식 페이지 규칙
* **순서**: 시장 요약 -> 포트폴리오 -> 공모주/신규 -> 종목 목록 -> 상폐 -> 시장뉴스
* **종목 카드 표시**: 종목명, 심볼, badge, 현재가, 등락, 시가총액, 규모, 갱신 타이머

---

# 12. 주식 상세 페이지 규칙
* **순서**: 종목 헤더 -> 가격 요약 -> 차트 -> 거래 패널 -> 내 보유 정보 -> 대주주 TOP 5 -> 레버리지 TOP 5 -> 뉴스
* 대주주/레버리지 TOP 5는 카드형 리스트 사용 (수익은 success, 손실은 error)

---

# 13. 홈 화면 규칙
* **순서**: 환영 문구 -> 자산 -> 오늘 손익 -> 게임 목록 -> 행운소식 -> 서버 요약
* **금지**: 너무 많은 정보 노출로 레이아웃이 복잡해지는 것

---

# 14. 랭킹 페이지 규칙
* 설명 배너 최소화, 탭 변경 시 화면 튀지 않게 유지

---

# 15. 내 정보 페이지 규칙
* 핵심 요약 정보 상단 배치
* **관리자 기능**: admin 계정 전용 하단 배치, 위험 기능은 warning/error 톤

---

# 16. 탄광/파산 UI 규칙
* "재도전 지원" 섹션으로 통일, 귀엽고 부드러운 톤 유지

---

# 17. 시즌 안내 다이얼로그 규칙
* 축하 느낌 유지 (`rounded-3xl`), 1등 강조

---

# 18. 여백 규칙
* 페이지 상단: `mb-6`
* 섹션 간격: `space-y-6`
* 카드 내부 간격: `gap-3` 또는 `gap-4`
* 그리드 간격: `gap-6`

---

# 19. 반응형 규칙
* **모바일**: 1열, 숫자 줄바꿈 허용
* **태블릿**: 2열
* **데스크톱**: 최대 `max-w-6xl` 유지

---

# 20. 공통 컴포넌트 목록
* `PageContainer`, `SectionHeader`, `BaseCard`, `StatCard`, `StatusBadge`, `MoneyText`, `ChangeText`, `ConfirmModal`, `EmptyState`, `LoadingCard`
