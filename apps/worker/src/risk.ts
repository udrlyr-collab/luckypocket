import { submitLeverageCloseOrder, type LeverageCloseOrder } from "@market-dominion/database";
import { accruedBorrowFee, dynamicBorrowFeeBps, estimateLeveragedPosition, type PositionSide } from "@market-dominion/domain";
import type { Pool } from "pg";

type RiskPosition = {
  id: string;
  side: PositionSide;
  quantity: string;
  margin: string;
  position_size: string;
  entry_price: string;
  current_price: string;
  maintenance_margin_bps: number;
  accrued_borrow_fee: string;
};

export async function runRiskCycle(pool: Pool, now = new Date()) {
  const borrowAccrual = await accrueShortBorrowFees(pool, now);
  const liquidationOrders = await submitLiquidationOrders(pool);
  const squeezes = await evaluateShortSqueezes(pool, now);
  return { borrowAccrual, liquidationOrders, squeezes };
}

export async function accrueShortBorrowFees(pool: Pool, now = new Date()): Promise<{ positions: number; totalFee: bigint }> {
  const result = await pool.query<{
    id: string; position_size: string; current_price: string; quantity: string; last_borrow_fee_at: Date;
    borrowable_quantity: string; borrowed_quantity: string; base_borrow_fee_bps: number; max_borrow_fee_bps: number;
  }>(
    `SELECT p.id, p.position_size, p.quantity, p.last_borrow_fee_at, s.current_price,
            bp.borrowable_quantity, bp.borrowed_quantity, bp.base_borrow_fee_bps, bp.max_borrow_fee_bps
     FROM leverage_positions p JOIN borrow_pools bp ON bp.stock_id = p.stock_id JOIN stocks s ON s.id = p.stock_id
     WHERE p.status = 'open' AND p.side = 'short' AND p.last_borrow_fee_at IS NOT NULL`,
  );
  let positions = 0;
  let totalFee = 0n;
  for (const position of result.rows) {
    const elapsed = BigInt(Math.max(0, now.getTime() - position.last_borrow_fee_at.getTime()));
    const feeBps = dynamicBorrowFeeBps({
      borrowableQuantity: BigInt(position.borrowable_quantity),
      borrowedQuantity: BigInt(position.borrowed_quantity),
      baseFeeBps: BigInt(position.base_borrow_fee_bps),
      maxFeeBps: BigInt(position.max_borrow_fee_bps),
    });
    const fee = accruedBorrowFee({ positionSize: BigInt(position.position_size), annualFeeBps: feeBps, elapsedMilliseconds: elapsed });
    if (fee <= 0n) continue;
    const updated = await pool.query(
      `UPDATE leverage_positions SET accrued_borrow_fee = accrued_borrow_fee + $2, last_borrow_fee_at = $3, updated_at = now()
       WHERE id = $1 AND status = 'open' RETURNING id`,
      [position.id, fee.toString(), now],
    );
    if (updated.rowCount !== 1) continue;
    await pool.query(
      `INSERT INTO leverage_events (position_id, event_type, price, quantity, fee, metadata)
       VALUES ($1, 'borrow_fee_accrual', $2, $3, $4, jsonb_build_object('annualFeeBps', $5::text, 'elapsedMilliseconds', $6::text))`,
      [position.id, position.current_price, position.quantity, fee.toString(), feeBps.toString(), elapsed.toString()],
    );
    positions += 1;
    totalFee += fee;
  }
  return { positions, totalFee };
}

export async function submitLiquidationOrders(pool: Pool): Promise<LeverageCloseOrder[]> {
  const result = await pool.query<RiskPosition>(
    `SELECT p.id, p.side, p.quantity, p.margin, p.position_size, p.entry_price, p.maintenance_margin_bps,
            p.accrued_borrow_fee, s.current_price
     FROM leverage_positions p JOIN stocks s ON s.id = p.stock_id
     WHERE p.status = 'open'`,
  );
  const orders: LeverageCloseOrder[] = [];
  for (const position of result.rows) {
    const estimate = estimateLeveragedPosition({
      side: position.side,
      quantity: BigInt(position.quantity),
      margin: BigInt(position.margin),
      entryPrice: BigInt(position.entry_price),
      currentPrice: BigInt(position.current_price),
      maintenanceMarginBps: BigInt(position.maintenance_margin_bps),
      closeFeeBps: envBps("LEVERAGE_CLOSE_FEE_BPS", 10n),
      accruedBorrowFee: BigInt(position.accrued_borrow_fee),
    });
    if (!estimate.shouldLiquidate) continue;
    try {
      orders.push(await submitLeverageCloseOrder(pool, position.id, "liquidation"));
    } catch (error) {
      if (error instanceof Error && (error.message === "NO_COVER_LIQUIDITY" || error.message === "CLEARINGHOUSE_CAPITAL_INSUFFICIENT")) continue;
      throw error;
    }
  }
  return orders;
}

export async function evaluateShortSqueezes(pool: Pool, now = new Date()): Promise<{ started: number; ended: number }> {
  const metrics = await pool.query<{
    stock_id: string; utilization_bps: number; price_change_bps: number; buy_volume: string; sell_volume: string;
    ask_depth: string; borrowed_quantity: string; liquidation_count: number; active_id: string | null; started_at: Date | null;
  }>(
    `SELECT s.id AS stock_id,
            CASE WHEN bp.borrowable_quantity = 0 THEN 0 ELSE (bp.borrowed_quantity * 10000 / bp.borrowable_quantity)::int END AS utilization_bps,
            ((s.current_price - s.previous_close) * 10000 / s.previous_close)::int AS price_change_bps,
            COALESCE((SELECT sum(t.quantity) FROM trades t WHERE t.stock_id = s.id AND t.taker_side = 'buy' AND t.created_at >= $1::timestamptz - interval '5 minutes'), 0)::bigint AS buy_volume,
            COALESCE((SELECT sum(t.quantity) FROM trades t WHERE t.stock_id = s.id AND t.taker_side = 'sell' AND t.created_at >= $1::timestamptz - interval '5 minutes'), 0)::bigint AS sell_volume,
            COALESCE((SELECT sum(o.quantity - o.filled_quantity) FROM orders o WHERE o.stock_id = s.id AND o.side = 'sell' AND o.type = 'limit' AND o.status IN ('pending','open','partially_filled') AND o.limit_price <= s.current_price * 105 / 100), 0)::bigint AS ask_depth,
            bp.borrowed_quantity,
            COALESCE((SELECT count(*) FROM leverage_events le JOIN leverage_positions lp ON lp.id = le.position_id WHERE lp.stock_id = s.id AND le.event_type = 'liquidation' AND le.created_at >= $1::timestamptz - interval '5 minutes'), 0)::int AS liquidation_count,
            sq.id AS active_id, sq.started_at
     FROM stocks s JOIN borrow_pools bp ON bp.stock_id = s.id
     LEFT JOIN short_squeeze_events sq ON sq.stock_id = s.id AND sq.status = 'active'`,
    [now],
  );
  let started = 0;
  let ended = 0;
  for (const row of metrics.rows) {
    const buyVolume = BigInt(row.buy_volume);
    const sellVolume = BigInt(row.sell_volume);
    const askDepth = BigInt(row.ask_depth);
    const borrowed = BigInt(row.borrowed_quantity);
    const qualifies = row.utilization_bps >= 7_000 && row.price_change_bps >= 500 && buyVolume > sellVolume && buyVolume > 0n && askDepth * 10n < borrowed && row.liquidation_count > 0;
    if (qualifies && !row.active_id) {
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO short_squeeze_events
           (stock_id, utilization_bps, price_change_bps, buy_volume, sell_volume, ask_depth, liquidation_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [row.stock_id, row.utilization_bps, row.price_change_bps, row.buy_volume, row.sell_volume, row.ask_depth, row.liquidation_count],
      );
      const event = inserted.rows[0];
      if (event) await pool.query("INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('stock', $1, 'short_squeeze.started', jsonb_build_object('stockId', $1::text, 'squeezeId', $2::text))", [row.stock_id, event.id]);
      started += 1;
    } else if (row.active_id && (!qualifies || (row.started_at && now.getTime() - row.started_at.getTime() >= 15 * 60 * 1_000))) {
      await pool.query("UPDATE short_squeeze_events SET status = 'ended', ended_at = $2 WHERE id = $1", [row.active_id, now]);
      await pool.query("INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('stock', $1, 'short_squeeze.ended', jsonb_build_object('stockId', $1::text, 'squeezeId', $2::text))", [row.stock_id, row.active_id]);
      ended += 1;
    }
  }
  return { started, ended };
}

function envBps(name: string, fallback: bigint): bigint {
  const value = process.env[name] === undefined ? fallback : BigInt(process.env[name]!);
  if (value < 0n || value > 10_000n) throw new Error(`${name}_INVALID`);
  return value;
}
