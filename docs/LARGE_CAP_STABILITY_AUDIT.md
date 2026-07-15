# 대형주 가격 안정성 감사

감사일: 2026-07-13  
범위: PostgreSQL 주문장 기반 MARKET DOMINION, SQLite 레거시 주식 틱, 로컬 `data/lucky-pocket.db` 가격 이력

## 확인된 원인

### 주문장 기반 서비스

- `apps/market-engine/src/matching.ts`는 maker 지정가를 그대로 최종 체결가와 `stocks.current_price`로 기록했다.
- 체결 가능한 가격의 일일 하한·상한이 없었다. 유한한 시장조성 매수호가가 소진되면 임의 저가 매수호가가 다음 체결가가 될 수 있었다.
- `apps/worker/src/market-maker.ts`는 모든 티어에 사실상 같은 호가 깊이·갱신 구조를 사용했다. 기업 이벤트 영향은 활성 이벤트를 제한 없이 합산했다.
- `apps/worker/src/listing.ts`는 재무 심사 실패 후 시가총액 검사 없이 `delisting_review`로 이동했다.

### 레거시 틱 서비스

- `processNormalTick`은 10초마다 -7%~-23% crash 후보를 만들었다.
- `getDynamicTickMoveLimit`는 순간 시가총액으로 티어를 즉시 다시 계산했다. 하락 → 티어 하락 → 허용 변동성 증가가 반복됐다.
- 1조 5,000억원 종목은 기존 분류에서 tick당 최대 -3%가 반복 적용될 수 있었다. 일일 누적 하한은 없었다.
- 5분 -50% 뒤 30~120초 정지만 적용돼 반복 하락을 막지 못했다.
- `distress_review`는 tick마다 38% 확률로 crash 이벤트를 강제했다.
- `final_crash`는 정상 상태 보호 없이 -85%~-95%를 적용할 수 있었다.
- 24시간 EMA는 경과시간과 무관하게 매 tick 5%를 반영했고 7일 EMA·티어 hysteresis가 없었다.

## 로컬 이력 증거

2026-07-13 로컬 SQLite 가격 이력에서 다음을 확인했다.

- `SEED`: 약 12.4시간 사이 시가총액 최대 240,771,585,493,474,530원, 최소 5,970,923,700원.
- `RABIT`: 약 2.3시간 사이 약 3,319억원에서 약 3,500만원으로 하락 후 상장폐지.
- `STARL`: 약 35시간 사이 약 239.685조원에서 약 997.7억원으로 하락.
- `SHINS`: 약 221.64조원에서 약 1,027억원으로 하락.
- `DATAB`: 약 177.5조원에서 약 1,427억원으로 하락.
- 여러 종목에서 같은 초에 서로 다른 가격 이력이 중복 기록됐다.

이 값은 로컬 DB 감사 결과다. 운영 PostgreSQL의 동일 기간 데이터와 같다고 가정하지 않는다.

## 수정

- 현재 시총, 시간가중 24시간 EMA, 시간가중 7일 EMA를 60:40으로 혼합한 안정성 시가총액 추가.
- 신규 상장 7일 동안 초기 시가총액을 최대 50% 추가 반영.
- 티어 하락 24시간, 부실 상태 12시간, 상승 12시간 지연. 경계 ±5% hysteresis 적용.
- BLUE_CHIP/GIANT/MEGA/LARGE/MID/SMALL/DELIST_RISK별 drift·목표 변동성·일일 범위 적용.
- 추세 국면을 tick 방향과 분리하고 30분~3시간 유지.
- 재무 기반 fair value와 제한된 평균회귀를 시장조성 호가 중심에 반영.
- 이벤트 종류별 영향과 전체 영향을 제한. 레거시 전체 음의 modifier도 제한.
- 대형주일수록 시장조성 수량이 깊고 갱신이 빠르게 조정.
- 주문 체결 전 공통주 가격을 일일 범위로 제한. 범위 밖 resting order는 체결 대상에서 제외.
- BLUE_CHIP/GIANT 단기 급락 회로차단기 추가. 30~120초 정지 후 시장조성 호가 재생성.
- 실제 `delisting_review`와 `final_crash`는 일반주 시가총액 50억원 미만에서만 허용.
- 인수자 ETF의 별도 -85% 상장폐지 규칙은 유지.
- 관리자 상세판, 수동 제어, 가격 보호 이력, dry-run 복구 감사 스크립트 추가.

## 전후 하락 한계

| 경로 | 수정 전 | 수정 후 |
|---|---|---|
| 주문장 GIANT 1회 체결 | 양의 임의 maker 가격까지 가능 | 당일 기준가 대비 -12% 하한 |
| 레거시 1조 5,000억원 정상주 | -3% tick이 10초마다 반복 가능, 일일 하한 없음 | GIANT 4σ tick 제한 + 일 -12% 하한 |
| 1조 5,000억원 정상 GIANT 2일 최악 일일 하한 | 사실상 -100%에 접근 가능 | `0.88² = 0.7744`, 최대 -22.56%, 시총 1조 1,616억원 |

수정 후 2일 회귀 테스트는 `packages/domain/test/market-stability.test.ts`에 있다. 정상 GIANT는 50억원 미만, `delisting_review`, `final_crash`에 도달하지 않는다.

## 운영 검사

`pnpm stock:audit-crashes`는 기본 dry-run이다. 24/48시간 급락, GIANT 다중 티어 하락, 50억원 이상 상폐 심사, 7일 초대형 붕괴, 최신 가격 불일치, 동일 초 복수 가격을 보고한다. 가격 보정은 `--apply --admin-id=<uuid>`를 함께 지정해야 하며 전후 값과 후보 가격을 `audit_logs`와 `price_guard_events`에 기록한다.

## 검증·재배포 결과

- migration: `0020_large_cap_stability.sql` 운영 적용 성공. 기존 종목 120개 backfill 완료, 안정성 필드 NULL 0개.
- 운영 백업: 배포 전 `market-dominion-20260713T050429Z.dump` 생성.
- 운영 dry-run: `pnpm stock:audit-crashes` 실행 결과 0건. `--apply` 미사용, 가격·유저 자산 변경 없음.
- 자동 검사: 레거시 47, domain 28, market-engine 7, worker 12, API 14, market-data 2 테스트 통과.
- `pnpm typecheck`, `pnpm lint`, `pnpm build` 통과.
- 배포: 2026-07-13 `market.wondering.kr`에 새 이미지와 migration 배포.
- 외부 확인: market health/DB/Redis/market-engine/웹, gamble, letters, wondering 모두 HTTPS 200.
- 운영 로그: 재배포 후 worker stability/MM, market-engine, API 오류 0건 확인.
