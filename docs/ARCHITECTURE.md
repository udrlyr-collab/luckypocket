# MARKET DOMINION 아키텍처

## 서비스

- `apps/web`: Next.js App Router. 브라우저는 서버 API 결과만 표시하며 자산을 계산하지 않는다.
- `apps/api`: NestJS REST와 인증된 Socket.IO gateway. 입력 검증, RBAC, rate limit, 감사 로그를 담당한다.
- `apps/market-engine`: BullMQ 주문 소비자. 종목별 PostgreSQL advisory lock과 가격·시간 우선으로 주문을 체결한다.
- `apps/worker`: 시장조성, 위험·청산, 기업 실적·배당, M&A, IPO, 상장심사, 전략, valuation cycle을 실행한다.
- `packages/database`: PostgreSQL/Drizzle 단일 스키마, 마이그레이션, seed, 정합성 검사.
- `packages/domain`: bigint 기반 순수 도메인 계산과 전략 DSL·백테스트.
- `packages/market-data`: Mock 및 Stooq/FRED 외부 어댑터, 장애 시 Mock fallback.

## 주문 흐름

1. API가 JWT, 입력, 멱등키, 거래정지, 잔액 또는 보유량을 검증한다.
2. 같은 DB 트랜잭션에서 현금 또는 주식을 예약하고 주문을 저장한다.
3. BullMQ가 주문 ID와 종목 ID만 전달한다. PostgreSQL이 영구 원장이다.
4. market-engine이 종목 advisory lock을 획득하고 가격·시간 우선으로 반대 주문을 찾는다.
5. 현금, 보유량, 원가, 실현손익, 수수료·세금, 거래소 금고, 체결, 캔들, outbox를 한 트랜잭션에서 갱신한다.
6. outbox relay가 Redis Pub/Sub로 이벤트를 내보내고 gateway가 해당 종목 room에만 전송한다.
7. 재연결한 브라우저는 REST snapshot을 다시 읽는다. WebSocket 메시지는 영구 상태의 근거가 아니다.

## 유한 자산 원칙

- 시장조성자는 사용자 계정, 현금, 보유 주식, 설정, 별도 원장을 가진다.
- 파생상품 청산소와 거래소 금고는 명시적인 시스템 계정이다.
- 공매도는 종목별 대차 풀 수량을 예약한다.
- 공개매수, IPO, 배당은 실제 예약과 현금·주식 이전을 수행한다.
- 재시작 때 예약현금, 예약주식, 대차수량을 재계산한다. 불일치 시 보안 이벤트를 남기고 거래 엔진 시작을 중단한다.

## valuation과 ETF 순환 방지

- 각 valuation cycle은 사용자 총자산과 ETF 기초 적격자산을 별도로 저장한다.
- 적격자산은 현금과 일반주식·일반주식 파생 포지션만 포함한다.
- 사용자 ETF, ETF 레버리지, ETF 파생자산은 기초 평가에서 제외한다.
- ETF 기준가는 현재 cycle이 아닌 직전 완료 cycle의 사용자 snapshot만 사용한다.
- `cycle_id`와 `source_cycle_id`가 같으면 도메인과 DB 제약에서 거부한다.

## 운영

- Docker Compose: PostgreSQL, Redis, API, market-engine, worker, web, Caddy.
- Caddy가 HTTPS와 reverse proxy를 담당한다. 기존 3개 사이트는 host network의 기존 localhost upstream으로 보존한다.
- PostgreSQL, Redis, Caddy 데이터는 named volume에 저장한다.
- 로그는 JSON이며 Docker rotation은 10MB × 5파일이다.
- 공개 health: `/health`, `/health/db`, `/health/redis`, `/health/market-engine`.
- 관리자 상태 API는 서비스 heartbeat, 열린 주문, 최근 체결, 실패 job, WebSocket 연결 수를 표시한다.
