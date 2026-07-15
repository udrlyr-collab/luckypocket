# MARKET DOMINION 디자인

## 방향

전문 트레이딩 터미널의 정보 밀도와 기업경영 타이쿤의 구조를 결합한다. 장식보다 현재가, 수익률, 호가 깊이, 위험, 기업 현금흐름의 계층을 우선한다.

## 토큰

- 배경 `#07100e`
- 패널 `#0d1916`, 보조 패널 `#101f1b`
- 경계 `#263a34`
- 본문 `#edf5f1`, 보조 `#91a79e`
- 강조 `#52d49e`, 경고 `#f0bd63`
- 한국식 기본: 상승 빨강 `#ef646d`, 하락 파랑 `#4f8ee8`
- 숫자는 tabular/monospace를 우선한다.

## 레이아웃과 접근성

- 최대 너비 1440px, 12열 grid.
- 900px 이하에서는 패널과 폼을 한 열로 전환한다.
- 상단 navigation은 작은 화면에서 가로 스크롤한다.
- 모든 폼은 label, native input/select, 명확한 제출 버튼을 사용한다.
- 텍스트와 색상을 함께 사용해 상태를 전달한다.
- loading, empty, error 상태는 점선 또는 오류 경계의 독립 상태 패널로 표시한다.
- 사용자 설정에서 한국식/글로벌식 상승·하락 색상과 locale을 저장한다.

## 페이지

필수 경로 `/`, `/market`, `/stocks`, `/stocks/[symbol]`, `/portfolio`, `/orders`, `/leverage`, `/strategies`, `/strategies/[id]`, `/companies`, `/companies/[id]/manage`, `/mna`, `/mna/[id]`, `/news`, `/leaderboard`, `/profile`, `/settings`, `/admin`, `/auth/login`, `/auth/register`를 제공한다. IPO는 `/ipos`에서 별도 제공한다.
