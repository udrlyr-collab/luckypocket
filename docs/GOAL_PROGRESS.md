# MARKET DOMINION 목표 진행 현황

마지막 갱신: 2026-07-13 (Asia/Seoul)

상태: 완료

## 완료 범위

- [x] pnpm monorepo: Next.js web, NestJS API, market-engine, worker, 공통 패키지
- [x] PostgreSQL/Drizzle 단일 스키마, 순차 migration 0000~0019, seed
- [x] JWT 인증, bcrypt, refresh rotation·재사용 탐지, RBAC, rate limit, 보안 헤더
- [x] 가격·시간 우선 주문장, market/limit/stop, GTC/IOC, 부분 체결, 예약·취소, 멱등성
- [x] transactional outbox, Redis Pub/Sub, BullMQ, Socket.IO 실시간 전송
- [x] 유한 현금·재고 시장조성자, 깊이 기반 충격·슬리피지, quote 정리
- [x] LONG/SHORT 레버리지, 차입료, 종료·강제청산, squeeze
- [x] 시장 국면·섹터, 기업 실적·배당·이벤트, 주주·지배력
- [x] 현금·주식 M&A, 공개매수, 합병, 경영권 이전
- [x] 제한형 전략 DSL, backtest, PAPER, LIVE_VIRTUAL, 안전장치·감사 로그
- [x] ETF 순환 참조 방지, IPO·상장폐지 흐름
- [x] 사용자·관리자 필수 화면과 모바일 반응형 UI
- [x] Docker Compose/Caddy 배포, DNS, HTTPS, backup, rollback
- [x] production HTTP E2E, WebSocket 재연결, 재시작 복구, 브라우저 smoke
- [x] lint, typecheck, unit/integration test, production build
- [x] 운영 절차와 최종 보고서

## 최종 검증

| 항목 | 결과 |
|---|---|
| `pnpm lint` | 통과 |
| `pnpm typecheck` | 통과 |
| `pnpm test` | 통과, 중복 없는 테스트 100개 |
| `pnpm test:integration` | 통과, API 14 + engine 7 + worker 12 = 33개 |
| `pnpm build` | 통과, Next.js 20 routes |
| production E2E | `PRODUCTION_E2E_PASS` |
| WebSocket 연결·재연결 | `WEBSOCKET_CONNECT_RECONNECT_PASS` |
| 재시작 복구 | `RESTART_RECOVERY_PASS` |
| health 5개 | 모두 HTTP 200 |
| 운영 DB | 46 tables, 20 sectors, 120 stocks, admin 1 |
| 앱 이미지 | 4개 모두 `sha256:a2544c2c665b7a7367886823ce2a09017b5a5c4f158b84c7ac8a55b6d342cf73` |

상세 근거와 한계는 `docs/FINAL_REPORT.md`에 기록했다.
