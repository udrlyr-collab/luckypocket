import {
  DAY_MS,
  TARGET_DAILY_VOLATILITY,
  calculateStabilityMarketCap,
  chooseTrendRegime,
  circuitBreakerTriggered,
  currentMarketCap,
  effectiveDistressScore,
  evaluateTierTransition,
  trendDurationMs,
  updateTimeWeightedEma,
  type DistressComponents,
  type StabilityTier,
} from "@market-dominion/domain";
import type { Pool } from "pg";

type StabilityRow = {
  id: string; current_price: string; total_shares: string; initial_market_cap: string;
  market_cap_ema_24h: string; market_cap_ema_7d: string; stability_tier: StabilityTier;
  stability_tier_candidate: StabilityTier | null; stability_tier_candidate_since: Date | null;
  last_stability_update_at: Date; is_blue_chip: boolean; created_at: Date;
  listing_status: "normal" | "warning" | "distress_review" | "delisting_review" | "halted" | "delisted";
  daily_anchor_price: string; daily_anchor_at: Date; trend_ends_at: Date;
  revenue: string; operating_profit: string; net_profit: string; cash: string; debt: string; book_value: string;
  event_risk_bps: number; price_5m: string | null; price_30m: string | null;
  circuit_breaker_until: Date | null;
};

export async function runStabilityCycle(pool: Pool, now = new Date(), random = Math.random): Promise<{ updated: number; halted: number; released: number }> {
  const rows = await pool.query<StabilityRow>(
    `SELECT s.id,s.current_price,s.total_shares,s.initial_market_cap,s.market_cap_ema_24h,s.market_cap_ema_7d,
            s.stability_tier,s.stability_tier_candidate,s.stability_tier_candidate_since,s.last_stability_update_at,
            s.is_blue_chip,s.created_at,s.listing_status,s.daily_anchor_price,s.daily_anchor_at,s.trend_ends_at,
            s.circuit_breaker_until,c.revenue,c.operating_profit,c.net_profit,c.cash,c.debt,c.book_value,
            COALESCE((SELECT sum(GREATEST(0,-ce.fair_value_impact_bps)) FROM corporate_events ce
                      WHERE ce.company_id=c.id AND ce.starts_at<=$1 AND (ce.ends_at IS NULL OR ce.ends_at>$1)),0)::int event_risk_bps,
            (SELECT close FROM candles WHERE stock_id=s.id AND interval='1m' AND opened_at<=date_trunc('minute',$1)-interval '5 minutes' ORDER BY opened_at DESC LIMIT 1) price_5m,
            (SELECT close FROM candles WHERE stock_id=s.id AND interval='1m' AND opened_at<=date_trunc('minute',$1)-interval '30 minutes' ORDER BY opened_at DESC LIMIT 1) price_30m
     FROM stocks s JOIN companies c ON c.id=s.company_id
     WHERE s.asset_type='common' AND s.listing_status<>'delisted'`,
    [now],
  );
  let updated = 0, halted = 0, released = 0;
  for (const row of rows.rows) {
    const price = BigInt(row.current_price), shares = BigInt(row.total_shares);
    const cap = currentMarketCap(price, shares);
    const elapsed = Math.max(0, now.getTime() - new Date(row.last_stability_update_at).getTime());
    const ema24 = updateTimeWeightedEma(BigInt(row.market_cap_ema_24h), cap, elapsed, DAY_MS);
    const ema7d = updateTimeWeightedEma(BigInt(row.market_cap_ema_7d), cap, elapsed, 7 * DAY_MS);
    const stabilityCap = calculateStabilityMarketCap({ ema24h: ema24, ema7d, initialMarketCap: BigInt(row.initial_market_cap), listedAgeMs: now.getTime() - new Date(row.created_at).getTime() });
    const components = distressComponents(row, price);
    const preliminaryDistress = Object.values(components).reduce((sum, value) => sum + value, 0) >= 180;
    const transition = evaluateTierTransition({ currentTier: row.stability_tier, stabilityMarketCap: stabilityCap, blueChip: row.is_blue_chip, candidateTier: row.stability_tier_candidate, candidateSince: row.stability_tier_candidate_since, now, distressed: preliminaryDistress });
    const distressScore = effectiveDistressScore(components, transition.tier);
    const anchorExpired = now.getTime() - new Date(row.daily_anchor_at).getTime() >= DAY_MS;
    const anchor = anchorExpired ? price : BigInt(row.daily_anchor_price);
    const dailyChangeBps = Number((price - anchor) * 10_000n / anchor);
    const fairValue = fundamentalFairValue(row, shares, price);
    const change5m = change(price, row.price_5m);
    const change30m = change(price, row.price_30m);
    const breaker = circuitBreakerTriggered({ tier: transition.tier, change5m, change30m });
    const wasHalted = row.circuit_breaker_until !== null;
    const release = wasHalted && new Date(row.circuit_breaker_until!).getTime() <= now.getTime();
    const newHalt = breaker && !wasHalted;
    const haltUntil = newHalt ? new Date(now.getTime() + 30_000 + Math.floor(random() * 90_001)) : release ? null : row.circuit_breaker_until;
    const trendExpired = new Date(row.trend_ends_at).getTime() <= now.getTime();
    const trend = trendExpired ? chooseTrendRegime(transition.tier, random()) : null;
    await pool.query(
      `UPDATE stocks SET market_cap_ema_24h=$2,market_cap_ema_7d=$3,stability_market_cap=$4,
         stability_tier=$5,stability_tier_entered_at=CASE WHEN stability_tier<>$5 THEN $1 ELSE stability_tier_entered_at END,
         stability_tier_candidate=$6,stability_tier_candidate_since=$7,last_stability_update_at=$1,
         fundamental_fair_value=$8,fair_value_updated_at=$1,daily_anchor_price=$9,
         daily_anchor_at=CASE WHEN $10 THEN $1 ELSE daily_anchor_at END,daily_change_bps=$11,
         target_daily_volatility_bps=$12,distress_score=$13,distress_components=$14::jsonb,
         trend_regime=COALESCE($15,trend_regime),trend_started_at=CASE WHEN $15 IS NULL THEN trend_started_at ELSE $1 END,
         trend_ends_at=CASE WHEN $15 IS NULL THEN trend_ends_at ELSE $16 END,trend_stability_tier=$5,
         trend_strength_bps=CASE WHEN $15='BULL' THEN 35 WHEN $15='BEAR' THEN -35 WHEN $15='SIDEWAYS' THEN 0 ELSE trend_strength_bps END,
         circuit_breaker_until=$17,circuit_breaker_reason=CASE WHEN $18 THEN 'rapid_large_cap_decline' WHEN $19 THEN NULL ELSE circuit_breaker_reason END,
         circuit_breaker_count=circuit_breaker_count+CASE WHEN $18 THEN 1 ELSE 0 END,
         post_halt_cooling_until=CASE WHEN $19 THEN $1+interval '5 minutes' ELSE post_halt_cooling_until END,
         is_trading_halted=CASE WHEN $18 THEN true WHEN $19 AND listing_status NOT IN ('halted','delisting_review') THEN false ELSE is_trading_halted END,
         updated_at=now() WHERE id=$20`,
      [now, ema24.toString(), ema7d.toString(), stabilityCap.toString(), transition.tier, transition.candidateTier, transition.candidateSince,
       fairValue.toString(), anchor.toString(), anchorExpired, dailyChangeBps, Math.round(TARGET_DAILY_VOLATILITY[transition.tier] * 10_000), distressScore,
       JSON.stringify(components), trend, trend ? new Date(now.getTime() + trendDurationMs(random())) : null, haltUntil, newHalt, release, row.id],
    );
    if (newHalt) {
      halted += 1;
      await pool.query(`INSERT INTO price_guard_events(stock_id,event_type,reference_price,observed_price,protected_price,change_5m_bps,change_30m_bps,metadata)
                        VALUES($1,'circuit_breaker',$2,$3,$3,$4,$5,jsonb_build_object('tier',$6::text,'until',$7::text))`,
        [row.id, (row.price_5m ?? row.price_30m ?? row.current_price), row.current_price, Math.round(change5m * 10_000), Math.round(change30m * 10_000), transition.tier, haltUntil!.toISOString()]);
    }
    if (release) { released += 1; await pool.query("UPDATE market_makers SET last_refreshed_at=NULL WHERE stock_id=$1", [row.id]); }
    updated += 1;
  }
  return { updated, halted, released };
}

function change(current: bigint, previous: string | null): number { return previous && BigInt(previous) > 0n ? Number(current - BigInt(previous)) / Number(BigInt(previous)) : 0; }

function distressComponents(row: StabilityRow, price: bigint): DistressComponents {
  const revenue = BigInt(row.revenue), operating = BigInt(row.operating_profit), net = BigInt(row.net_profit);
  const cash = BigInt(row.cash), debt = BigInt(row.debt), book = BigInt(row.book_value);
  return {
    operatingLoss: operating < 0n || net < 0n ? Math.min(100, Number((-min(operating, net) * 100n) / max(1n, revenue))) : 0,
    debt: debt > book ? Math.min(100, Number((debt - book) * 100n / max(1n, book))) : 0,
    cashRunway: cash <= 0n ? 100 : debt > cash * 4n ? 70 : debt > cash * 2n ? 35 : 0,
    governance: 0, regulatory: 0, event: Math.min(100, Math.floor(row.event_risk_bps / 10)),
    prolongedDrawdown: price * 2n < BigInt(row.daily_anchor_price) ? 80 : 0,
  };
}

function fundamentalFairValue(row: StabilityRow, shares: bigint, fallback: bigint): bigint {
  const bookPerShare = max(0n, BigInt(row.book_value)) / shares;
  const earningsPerShare = max(0n, BigInt(row.net_profit)) / shares;
  const cashLessDebt = max(0n, BigInt(row.cash) - BigInt(row.debt)) / shares;
  const estimate = bookPerShare + earningsPerShare * 8n + cashLessDebt / 2n;
  const eventPenaltyBps = BigInt(Math.min(2_500, Math.max(0, row.event_risk_bps)));
  return max(1n, (estimate > 0n ? estimate : fallback) * (10_000n - eventPenaltyBps) / 10_000n);
}
function min(a: bigint, b: bigint): bigint { return a < b ? a : b; }
function max(a: bigint, b: bigint): bigint { return a > b ? a : b; }
