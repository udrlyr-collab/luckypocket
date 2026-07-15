# MARKET DOMINION 최종 보고서

검증 기준일: 2026-07-13 (Asia/Seoul)

운영 URL: https://market.wondering.kr

## 1. 아키텍처

브라우저는 Caddy를 통해 Next.js web과 NestJS API에 접근한다. API는 PostgreSQL과 Redis를 사용한다. market-engine은 종목별 advisory lock 아래 주문·체결·가격 형성을 처리하고, worker는 BullMQ 기반 시장·기업·전략 작업을 수행한다. transactional outbox와 Redis Pub/Sub을 거쳐 Socket.IO가 실시간 상태를 전달한다.

## 2. 앱과 패키지

- 앱: `apps/web`, `apps/api`, `apps/market-engine`, `apps/worker`
- 패키지: `packages/config`, `database`, `domain`, `market-data`, `shared`, `ui`
- 배포 앱 4개는 같은 불변 이미지 digest를 사용한다.

## 3. 화면

구현 경로는 `/`, `/market`, `/stocks`, `/stocks/[symbol]`, `/portfolio`, `/orders`, `/leverage`, `/strategies`, `/strategies/[id]`, `/companies`, `/companies/[id]/manage`, `/mna`, `/mna/[id]`, `/ipos`, `/news`, `/leaderboard`, `/profile`, `/settings`, `/admin`, `/auth/login`, `/auth/register`이다. 브라우저와 390×844 viewport에서 핵심 사용자·관리자 흐름을 확인했다.

## 4. DB와 migration

Drizzle 기반 PostgreSQL 단일 스키마다. migration은 `0000`부터 `0019`까지 순차 적용된다. 운영 DB 확인값은 public tables 46개, sectors 20개, stocks 120개, admin 1명이다. quote 정리용 migration과 index도 포함한다.

## 5. 주문 매칭

가격 우선, 같은 가격에서는 생성 시간 우선이다. market·limit·stop, GTC·IOC, 부분 체결, 잔량, 취소, 현금·주식 예약, 멱등 키를 처리한다. 종목 단위 PostgreSQL advisory lock과 transaction으로 동시 체결을 직렬화한다.

## 6. 충격과 슬리피지

시장 주문은 실제 주문장 깊이를 소비한다. 표시 유동성이 부족하면 impact/slippage 규칙이 추가 비용을 반영한다. 체결 가격과 수수료는 동일 transaction에서 포트폴리오와 원장에 반영된다.

## 7. 시장조성자

시장조성자는 무한 유동성이 아니라 계정별 유한 현금과 재고를 갖는다. 주문장 양쪽에 quote를 공급하고 재고·현금 한도를 지킨다. 오래된 취소 quote를 주기적으로 정리해 주문 테이블 팽창을 제한한다. 최종 점검 시 6분보다 오래된 취소 MM 주문은 6건으로, 과거 수백만 건 누적 문제는 제거됐다.

## 8. 레버리지·공매도·청산

LONG과 SHORT, 증거금, 배율, 동적 차입료, 유지증거금, 일반 종료와 강제청산을 구현했다. 종료와 청산은 실제 시장 주문 경로를 사용한다. 최근 거래·공매도·유동성 조건으로 squeeze를 평가한다.

## 9. 기업과 M&A

기업 실적, 재무 보고, 배당, 기업 이벤트, 주요 주주, 유통주식, 자사주, 지배력 상태를 제공한다. M&A는 20% 개시 조건, 공개매수, 현금·주식 대가, 합병, 경영권 이전을 처리한다. 현금·주식·control 흐름은 통합 테스트로 검증했다.

## 10. 전략 DSL

버전이 있는 제한형 JSON DSL을 사용한다. 조건군, 지표 비교, 주문 행동과 sizing을 검증한다. backtest는 다음 bar 체결로 look-ahead를 막는다. PAPER는 분리 원장, LIVE_VIRTUAL은 일반 주문 경로를 사용한다. 시각 조건 빌더와 전체 JSON 편집기를 함께 제공한다.

## 11. ETF 순환 방지

ETF 구성 자산을 평가할 때 ETF 계열의 기초 자산 제외 규칙, 완료된 이전 valuation cycle만 참조하는 규칙, cycle ID 추적을 적용해 직접·간접 순환 참조를 방지한다.

## 12. 보안

비밀번호는 bcrypt로 저장한다. access JWT와 refresh token rotation, refresh 재사용 탐지·폐기, RBAC, 요청 rate limit, Helmet 계열 보안 헤더, 입력 검증, 관리자 감사 로그와 의심 거래 기록을 적용했다. 운영 비밀 파일 권한은 `600`이며 보고서에 비밀값을 기록하지 않았다.

## 13. OS와 자원

운영 서버는 Ubuntu 24.04.4 LTS x86_64다. 확인 자원은 RAM 911 MiB, swap 2.0 GiB, root disk 38 GiB다. 마지막 확인 당시 root 사용량은 약 27 GiB, 여유 약 12 GiB였다.

## 14. SSH 계정

배포 SSH 계정은 `ubuntu`다. 키 기반 접속을 사용하며 private key 내용은 출력하지 않았다.

## 15. 배포 경로

`/home/ubuntu/market-dominion`

## 16. Docker 상태

Docker 29.6.1, Docker Compose 5.3.1을 확인했다. postgres, redis, api, market-engine, worker, web은 healthy, caddy는 running이다. api·market-engine·worker·web digest는 모두 `sha256:a2544c2c665b7a7367886823ce2a09017b5a5c4f158b84c7ac8a55b6d342cf73`이다.

## 17. DNS

`market.wondering.kr`은 `13.124.197.230`을 가리키는 것을 확인했다.

## 18. 인증서

인증서 subject와 SAN은 `market.wondering.kr`, 발급자는 Let's Encrypt YE2다. 유효기간은 2026-07-12 21:47:42 UTC부터 2026-10-10 21:47:41 UTC까지다.

## 19. URL과 health

운영 URL은 https://market.wondering.kr 이다. `/health`, `/health/db`, `/health/redis`, `/health/market-engine`, `/api/health`가 모두 HTTP 200을 반환했다. 기존 `gamble.wondering.kr`, `letters.wondering.kr`, `wondering.kr`도 배포 smoke에서 HTTP 200을 유지했다.

## 20. 테스트

- `pnpm lint`: 통과
- `pnpm typecheck`: 통과
- `pnpm test`: 통과, 중복 없는 테스트 총 100개(legacy 47, domain 18, market-data 2, API 14, engine 7, worker 12)
- `pnpm test:integration`: 통과, API 14 + engine 7 + worker 12 = 33개
- `pnpm build`: 통과, Next.js 20 routes
- production HTTP E2E: 등록, 조회, 시장가 매수 체결, 포트폴리오, 지정가 매도, 레버리지 개설·종료, 전략 생성, 기업 조회, 관리자 종목 생성·정리 통과
- WebSocket: 외부 WSS 인증 연결, 강제 transport 종료, 자동 재연결 통과
- 재시작 복구: 앱 4개 재시작 후 health 및 기존 거래 수 보존 통과
- 브라우저: 공개 화면, 사용자 종목·전략, 관리자 상태, 모바일 viewport 확인; 최종 확인 세션 console error 0

## 21. 백업과 복구

`deploy/backup.sh`는 PostgreSQL custom-format dump를 만들고 14일 초과 파일을 정리한다. 최종 확인된 백업은 `backups/market-dominion-20260713T001911Z.dump`다. 앱 재시작 뒤 DB 거래 수 보존을 확인했다. 전체 DB restore 절차는 `docs/OPERATIONS.md`에 기록했다.

## 22. 재배포

로컬에서 `deploy/windows-deploy.ps1`로 비밀 파일을 제외한 archive를 전송한다. 서버에서 `deploy/deploy.sh`가 backup, rollback image 보존, dependency 시작, migration, 앱 빌드·기동, 내부 health, Caddy 강제 재생성, HTTPS와 기존 도메인 smoke를 실행한다.

## 23. 롤백

`deploy/rollback.sh`는 보존된 `market-dominion-app:rollback` 이미지를 `latest`로 복원하고 앱 4개를 강제 재생성한 뒤 API와 web health를 검사한다. 이전 앱 이미지가 없을 때는 기존 nginx proxy 복구 경로를 사용한다.

## 24. 남은 제한

- 서버 RAM이 911 MiB라 서버 내 Docker 빌드는 swap을 사용하며 느릴 수 있다. 한 차례 빌드 압박 중 engine·worker가 재시작됐고, 빌드 완료 뒤 전체 서비스 healthy를 다시 확인했다. 안정적인 반복 배포를 위해 향후 외부 이미지 빌드 또는 RAM 증설이 필요하다.
- 외부 Stooq/FRED 데이터 수집은 best-effort이며 실패 시 Mock 공급자로 대체된다. 외부 공급자 가용성은 이 시스템이 보장할 수 없다.
- 시각 전략 빌더는 단일 조건 중심 form builder다. 중첩 조건은 전체 JSON 편집기로 지원하며 자유 배치 node canvas는 아니다.
- production E2E가 만든 사용자와 감사 기록은 추적 가능성을 위해 남아 있다. E2E 관리자 종목 fixture는 삭제했다.
- Figma/FigJam 연동 도구는 이번 실행 환경에서 사용할 수 없어 저장소의 디자인 문서와 실제 브라우저 렌더 검증으로 대체했다.

## 운영자 접근

관리자 자격 증명은 서버에서만 다음 명령으로 확인한다. 출력값을 채팅이나 로그에 복사하지 않는다.

```sh
sudo cat /home/ubuntu/market-dominion/ADMIN_CREDENTIALS
```
