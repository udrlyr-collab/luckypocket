# 행운주머니

“숫자로 키우는 나만의 행운주머니”를 주제로 한 숫자 게임 서비스입니다. 현금 충전, 출금, 외부 결제, 실제 금전 거래 기능은 없습니다.

## 기술 구성

- React 19, Tailwind CSS 4, daisyUI 5 `cupcake` 테마
- Node.js + Express
- SQLite (`better-sqlite3`, WAL 모드)
- JWT 인증과 bcrypt 비밀번호 해시
- 서버 `crypto` 기반 난수
- 서버 트랜잭션 기반 게임 결과·자산·업적 처리

## 주요 기능

- 위험버튼, 1부터 10까지 카드, 4×4 폭탄 피하기, 3자리 슬롯, 다트
- 쉼표가 적용되는 공통 배팅 입력과 금액·비율 빠른 설정
- 현재 자산 기준 리더보드와 정렬 탭
- 날짜·주·월 기준 수익률, 수익, 손실 리더보드
- 게임·업적·지원금 통합 기록
- 고유 닉네임과 500,000원 닉네임 변경
- 닉네임 기반 무수수료 송금
- 서버 검증형 행운코드와 계정별·전체 사용 제한 또는 운영자 지정 무제한 사용
- 35개 업적과 자동 보상
- 하루·일주일·한달 자산 변화 SVG 그래프
- 게임별 횟수, 승패, 배팅금, 획득·손실 금액, 순수익 통계
- 하루 최대 3회의 100,000원 지원금
- 데스크톱·모바일 공통 960px 페이지 컨테이너

## 로컬 실행

Node.js 22.12 이상이 필요합니다.

```bash
npm install
copy .env.example .env
npm run db:init
npm run dev
```

macOS/Linux에서는 `copy` 대신 `cp .env.example .env`를 사용하세요.

- 프론트엔드: `http://localhost:5173`
- API: `http://127.0.0.1:3001`
- DB는 서버 시작 시 자동 마이그레이션됩니다.

## 환경변수

| 이름 | 설명 | 로컬 기본값 |
|---|---|---|
| `PORT` | Express 포트 | `3001` |
| `DATABASE_URL` | SQLite 파일 경로 | `./data/lucky-pocket.db` |
| `JWT_SECRET` | JWT 서명 키 | 운영 환경에서 32자 이상 필수 |
| `CLIENT_URL` | 허용할 프론트엔드 origin | `http://localhost:5173` |
| `TRUST_PROXY` | Nginx 뒤에서 실행할 때 `1` | `0` |
| `BONUS_CODE_SEEDS` | 운영자가 등록할 행운코드 JSON 배열 | `[]` |

운영 환경에서는 행운코드가 자동 생성되지 않습니다. `BONUS_CODE_SEEDS` 또는 DB 관리 작업으로만 활성 코드를 등록합니다. 운영자가 `is_unlimited=1`로 등록한 코드는 전체·계정별 사용 횟수 제한을 적용하지 않습니다. 개발 환경에서는 계정당 한 번 사용할 수 있는 `TESTSEED`가 생성됩니다.

## 명령어

```bash
npm run dev       # Vite와 Express 동시 실행
npm run build     # 프로덕션 프론트엔드 빌드
npm start         # Express가 dist 정적 파일까지 제공
npm test          # 확률·배당·게임 분포 검증
npm audit         # 의존성 보안 감사
```

## 주요 API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/me`
- `POST /api/me/revive`
- `GET /api/games/active`
- `POST /api/games/risk-button/start|press|cashout`
- `POST /api/games/card-draw/play`
- `POST /api/games/bomb-dodge/start|pick|cashout`
- `POST /api/games/slot/play`
- `POST /api/games/dart/play`
- `GET /api/logs`
- `GET /api/leaderboard?sort=balance|profit|achievements|games`
- `GET /api/leaderboard?date=YYYY-MM-DD&period=day|week|month&type=currentBalance|profitRate|earned|lost`
- `GET /api/profile/summary`
- `GET /api/profile/asset-history?range=day|week|month`
- `GET /api/profile/game-stats`
- `PATCH /api/profile/nickname`
- `POST /api/transfer`
- `POST /api/bonus-code/redeem`

## 데이터

- `users`: 계정과 현재·최고 자산
- `game_logs`: 완료된 게임 결과
- `game_sessions`: 위험버튼·폭탄 피하기 진행 상태
- `user_achievements`: 업적 획득과 보상
- `asset_events`: 게임, 업적, 지원금에 따른 자산 변화
- `revival_claims`: 일일 지원금 수령 기록
- `transfer_logs`: 보내는 사람과 받는 사람의 송금 원장
- `bonus_codes`: 활성 상태, 보상, 만료일, 무제한 여부, 전체·계정별 사용 제한
- `bonus_code_redemptions`: 행운코드 사용 이력

기존 DB는 삭제하지 않습니다. 서버 시작 시 필요한 테이블과 인덱스를 추가하고 기존 게임 기록을 `asset_events`로 보완합니다.

## 운영

- URL: `https://gamble.wondering.kr`
- IPv4: `13.124.197.230`
- SSH 사용자: `ubuntu`

민감하거나 로컬 환경에 종속적인 값은 저장소에 넣지 않습니다.

- `DOMAIN_PLACEHOLDER`
- `IPV4_PLACEHOLDER`
- `SSH_USER_PLACEHOLDER`
- `SSH_KEY_PATH_PLACEHOLDER`

운영 데이터와 환경변수는 릴리스 디렉터리 외부의 공유 경로에 보존됩니다.

```text
/var/www/lucky-pocket/
├── current -> releases/<배포시각>
├── releases/
└── shared/
    ├── .env
    └── lucky-pocket.db
```

- 상태 확인: `sudo systemctl status lucky-pocket`
- 로그 확인: `sudo journalctl -u lucky-pocket -f`

## 처리 원칙

- 프론트엔드는 인증 토큰만 `localStorage`에 저장합니다.
- 배팅 한도, 현재 자산, 난수, 배당, 지급액은 서버에서 검증·계산합니다.
- 폭탄 위치, 슬롯 숫자, 다트 좌표는 서버에서 생성합니다.
- 게임 로그, 자산 이벤트, 업적 보상은 같은 SQLite 트랜잭션에서 처리합니다.
- 모든 배당은 순수익이 아닌 총 지급액 기준입니다.
