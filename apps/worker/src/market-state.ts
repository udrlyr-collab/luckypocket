import type { Pool } from "pg";

type Regime = "strong_bull" | "bull" | "sideways" | "bear" | "fear" | "recovery";

export async function refreshMarketState(pool: Pool): Promise<{ regime: Regime; changed: boolean; strength: number }> {
  const market = await pool.query<{ average_return_bps: number; breadth_bps: number }>(
    `SELECT COALESCE(avg((current_price - previous_close) * 10000 / previous_close), 0)::int AS average_return_bps,
            COALESCE(sum(CASE WHEN current_price > previous_close THEN 1 ELSE 0 END) * 10000 / NULLIF(count(*), 0), 0)::int AS breadth_bps
     FROM stocks WHERE is_trading_halted = false`,
  );
  const metrics = market.rows[0] ?? { average_return_bps: 0, breadth_bps: 0 };
  const active = await pool.query<{ id: string; regime: Regime }>("SELECT id, regime FROM market_regimes WHERE ended_at IS NULL LIMIT 1");
  const regime = classify(metrics.average_return_bps, metrics.breadth_bps, active.rows[0]?.regime);
  const strength = clamp(Math.trunc(metrics.average_return_bps / 50), -100, 100);
  let changed = false;
  if (!active.rows[0] || active.rows[0].regime !== regime) {
    if (active.rows[0]) await pool.query("UPDATE market_regimes SET ended_at = now() WHERE id = $1", [active.rows[0].id]);
    const inserted = await pool.query<{ id: string }>(
      "INSERT INTO market_regimes (regime, strength, breadth_bps, average_return_bps) VALUES ($1::market_regime_type, $2, $3, $4) RETURNING id",
      [regime, strength, metrics.breadth_bps, metrics.average_return_bps],
    );
    await pool.query(
      "INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('market', $1, 'market.regime_changed', jsonb_build_object('regimeId', $1::text, 'regime', $2::text, 'strength', $3::int))",
      [inserted.rows[0]?.id, regime, strength],
    );
    changed = true;
  } else {
    await pool.query("UPDATE market_regimes SET strength = $2, breadth_bps = $3, average_return_bps = $4 WHERE id = $1", [active.rows[0].id, strength, metrics.breadth_bps, metrics.average_return_bps]);
  }
  await pool.query(
    `INSERT INTO sector_states (sector_id, strength, average_return_bps, updated_at)
     SELECT c.sector_id,
            GREATEST(-100, LEAST(100, (avg((s.current_price - s.previous_close) * 10000 / s.previous_close) / 50)::int)),
            avg((s.current_price - s.previous_close) * 10000 / s.previous_close)::int,
            now()
     FROM stocks s JOIN companies c ON c.id = s.company_id GROUP BY c.sector_id
     ON CONFLICT (sector_id) DO UPDATE SET strength = EXCLUDED.strength, average_return_bps = EXCLUDED.average_return_bps, updated_at = now()`,
  );
  await pool.query(
    `INSERT INTO market_state_snapshots (sector_id, strength, average_return_bps, breadth_bps)
     VALUES (NULL, $1, $2, $3)`,
    [strength, metrics.average_return_bps, metrics.breadth_bps],
  );
  await pool.query(
    `INSERT INTO market_state_snapshots (sector_id, strength, average_return_bps)
     SELECT sector_id, strength, average_return_bps FROM sector_states`,
  );
  return { regime, changed, strength };
}

function classify(averageReturnBps: number, breadthBps: number, prior?: Regime): Regime {
  if ((prior === "fear" || prior === "bear") && averageReturnBps > 0 && breadthBps >= 5_500) return "recovery";
  if (averageReturnBps >= 500 && breadthBps >= 7_000) return "strong_bull";
  if (averageReturnBps >= 100 && breadthBps >= 5_500) return "bull";
  if (averageReturnBps <= -500 && breadthBps <= 3_000) return "fear";
  if (averageReturnBps <= -100 && breadthBps <= 4_500) return "bear";
  return "sideways";
}
function clamp(value: number, low: number, high: number): number { return Math.max(low, Math.min(value, high)); }
