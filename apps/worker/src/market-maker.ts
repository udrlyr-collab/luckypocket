import type { Pool, PoolClient } from "pg";
import { MARKET_MAKER_DEPTH_MULTIPLIER, MARKET_MAKER_REFRESH_MS, clampPriceToDailyBand, meanReversionSignal, type ListingRiskState, type StabilityTier, type TrendRegime } from "@market-dominion/domain";

type MakerRow = {
  id: string;
  user_id: string;
  stock_id: string;
  cash_balance: string;
  inventory: string;
  target_inventory: string;
  max_inventory: string;
  base_spread_bps: number;
  order_depth: number;
  risk_aversion_bps: number;
  current_price: string;
  reference_price: string;
  tick_size: string;
  sector_strength: number;
  regime_strength: number;
  event_demand_bps: number;
  event_liquidity_bps: number;
  event_volatility_bps: number;
  stability_tier: StabilityTier;
  trend_regime: TrendRegime;
  trend_strength_bps: number;
  fundamental_fair_value: string;
  daily_anchor_price: string;
  listing_status: ListingRiskState;
  is_trading_halted: boolean;
  circuit_breaker_until: Date | null;
};

export async function refreshDueMarketMakers(pool: Pool, limit: number): Promise<Array<{ orderId: string; stockId: string }>> {
  const due = await pool.query<{ id: string }>(
    `SELECT id FROM market_makers
     WHERE is_active = true
       AND (last_refreshed_at IS NULL OR last_refreshed_at + refresh_interval_ms * interval '1 millisecond' <= now())
     ORDER BY last_refreshed_at ASC NULLS FIRST
     LIMIT $1`,
    [limit],
  );
  const orders: Array<{ orderId: string; stockId: string }> = [];
  for (const maker of due.rows) orders.push(...await refreshMarketMaker(pool, maker.id));
  return orders;
}

export async function pruneExpiredMarketMakerQuotes(pool: Pool, limit = 20_000): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100_000) throw new Error("MARKET_MAKER_PRUNE_LIMIT_INVALID");
  const result = await pool.query(
    `WITH doomed AS (
       SELECT o.ctid
       FROM orders o JOIN market_makers mm ON mm.user_id = o.user_id
       WHERE o.status = 'cancelled' AND o.filled_quantity = 0 AND o.updated_at < now() - interval '5 minutes'
       ORDER BY o.updated_at
       LIMIT $1
     )
     DELETE FROM orders o USING doomed d WHERE o.ctid = d.ctid`,
    [limit],
  );
  return result.rowCount ?? 0;
}

export async function refreshMarketMaker(pool: Pool, makerId: string): Promise<Array<{ orderId: string; stockId: string }>> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<MakerRow>(
      `SELECT mm.*, s.current_price, s.reference_price, s.tick_size,s.stability_tier,s.trend_regime,
              s.trend_strength_bps,s.fundamental_fair_value,s.daily_anchor_price,s.listing_status,
              s.is_trading_halted,s.circuit_breaker_until,
              COALESCE(ss.strength, 0)::int AS sector_strength,
              COALESCE(mr.strength, 0)::int AS regime_strength,
              COALESCE(ev.demand_bps, 0)::int AS event_demand_bps,
              COALESCE(ev.liquidity_bps, 0)::int AS event_liquidity_bps,
              COALESCE(ev.volatility_bps, 0)::int AS event_volatility_bps
       FROM market_makers mm JOIN stocks s ON s.id = mm.stock_id
       JOIN companies c ON c.id = s.company_id
       LEFT JOIN sector_states ss ON ss.sector_id = c.sector_id
       LEFT JOIN market_regimes mr ON mr.ended_at IS NULL
       LEFT JOIN LATERAL (
         SELECT LEAST(600,GREATEST(-600,sum(category_demand))) AS demand_bps,
                LEAST(400,GREATEST(-400,sum(category_liquidity))) AS liquidity_bps,
                LEAST(400,GREATEST(-400,sum(category_volatility))) AS volatility_bps
         FROM (SELECT event_type,
                 LEAST(250,GREATEST(-250,sum(demand_impact_bps))) category_demand,
                 LEAST(200,GREATEST(-200,sum(liquidity_impact_bps))) category_liquidity,
                 LEAST(200,GREATEST(-200,sum(volatility_impact_bps))) category_volatility
               FROM corporate_events ce WHERE ce.company_id = c.id AND ce.starts_at <= now() AND (ce.ends_at IS NULL OR ce.ends_at > now())
               GROUP BY event_type) capped_events
       ) ev ON true
       WHERE mm.id = $1 AND mm.is_active = true
       FOR UPDATE OF mm, s`,
      [makerId],
    );
    const maker = result.rows[0];
    if (!maker) {
      await client.query("COMMIT");
      return [];
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [maker.stock_id]);
    await cancelExistingQuotes(client, maker);
    if (maker.is_trading_halted || (maker.circuit_breaker_until && new Date(maker.circuit_breaker_until).getTime() > Date.now())) {
      await client.query("UPDATE market_makers SET last_refreshed_at=now(),refresh_interval_ms=$2,updated_at=now() WHERE id=$1", [maker.id, MARKET_MAKER_REFRESH_MS[maker.stability_tier]]);
      await client.query("COMMIT");
      return [];
    }

    const user = await client.query<{ cash: string; reserved_cash: string }>("SELECT cash, reserved_cash FROM users WHERE id = $1 FOR UPDATE", [maker.user_id]);
    const holding = await client.query<{ quantity: string; reserved_quantity: string }>(
      "SELECT quantity, reserved_quantity FROM holdings WHERE user_id = $1 AND stock_id = $2 FOR UPDATE",
      [maker.user_id, maker.stock_id],
    );
    const makerUser = required(user.rows[0], "Market-maker user missing");
    const cash = BigInt(makerUser.cash);
    const availableCash = cash - BigInt(makerUser.reserved_cash);
    const feeBps = await spotFeeBps(client);
    const inventory = BigInt(holding.rows[0]?.quantity ?? "0");
    const targetInventory = BigInt(maker.target_inventory);
    const maxInventory = BigInt(maker.max_inventory);
    const currentPrice = BigInt(maker.current_price);
    const fairValue = BigInt(maker.fundamental_fair_value);
    const tickSize = BigInt(maker.tick_size);
    const externalDemandBps = clamp(BigInt(maker.event_demand_bps + maker.sector_strength * 10 + maker.regime_strength * 10 + maker.trend_strength_bps), -800n, 800n);
    const deviationBps = clamp((currentPrice - fairValue) * 10_000n / fairValue - externalDemandBps, -3_000n, 3_000n);
    const inventorySkewBps = clamp((inventory - targetInventory) * BigInt(maker.risk_aversion_bps) / maxInventory, -2_000n, 2_000n);
    const reversionBps = BigInt(Math.round(meanReversionSignal(currentPrice, fairValue) * 1_000));
    const proposedCenter = max(tickSize, currentPrice * (10_000n + externalDemandBps + reversionBps - inventorySkewBps) / 10_000n);
    const center = clampPriceToDailyBand({ proposedPrice: proposedCenter, anchorPrice: BigInt(maker.daily_anchor_price), tier: maker.stability_tier, state: maker.listing_status });
    const depthBps = BigInt(Math.round(MARKET_MAKER_DEPTH_MULTIPLIER[maker.stability_tier] * 10_000));
    const baseQuantity = max(2n, maxInventory * depthBps / BigInt(maker.order_depth * 20) / 10_000n);
    const lowerBound = ceilTick(clampPriceToDailyBand({ proposedPrice: 1n, anchorPrice: BigInt(maker.daily_anchor_price), tier: maker.stability_tier, state: maker.listing_status }), tickSize);
    const upperBound = floorTick(clampPriceToDailyBand({ proposedPrice: 9_223_372_036_854_775_807n, anchorPrice: BigInt(maker.daily_anchor_price), tier: maker.stability_tier, state: maker.listing_status }), tickSize);
    const buyCapacity = max(0n, maxInventory - inventory);
    let sellCapacity = inventory;
    let remainingCash = availableCash;
    let remainingBuyCapacity = buyCapacity;
    const newOrders: Array<{ orderId: string; stockId: string }> = [];

    for (let level = 0; level < maker.order_depth; level += 1) {
      const adjustedSpread = Math.max(10, maker.base_spread_bps + maker.event_volatility_bps - maker.event_liquidity_bps);
      const distanceBps = BigInt(adjustedSpread) + BigInt(level * Math.max(10, Math.floor(adjustedSpread / 2)));
      const bidPrice = clamp(floorTick(max(tickSize, center * (10_000n - distanceBps) / 10_000n), tickSize), lowerBound, upperBound);
      const askPrice = clamp(ceilTick(max(tickSize, center * (10_000n + distanceBps) / 10_000n), tickSize), lowerBound, upperBound);
      const buyWeight = clamp(10_000n - deviationBps, 1_000n, 19_000n);
      const sellWeight = clamp(10_000n + deviationBps, 1_000n, 19_000n);
      let bidQuantity = min(max(1n, baseQuantity * buyWeight / 10_000n), remainingBuyCapacity);
      bidQuantity = min(bidQuantity, remainingCash * 10_000n / (bidPrice * (10_000n + feeBps)));
      const askQuantity = min(max(1n, baseQuantity * sellWeight / 10_000n), sellCapacity);

      if (bidQuantity > 0n) {
        const reserve = bidPrice * bidQuantity * (10_000n + feeBps) / 10_000n;
        const orderId = await insertQuote(client, maker, "buy", bidPrice, bidQuantity, reserve);
        newOrders.push({ orderId, stockId: maker.stock_id });
        remainingCash -= reserve;
        remainingBuyCapacity -= bidQuantity;
      }
      if (askQuantity > 0n) {
        const orderId = await insertQuote(client, maker, "sell", askPrice, askQuantity, 0n);
        newOrders.push({ orderId, stockId: maker.stock_id });
        sellCapacity -= askQuantity;
      }
    }

    const totalBuyReserve = availableCash - remainingCash;
    const totalSellReserve = inventory - sellCapacity;
    await client.query("UPDATE users SET reserved_cash = reserved_cash + $2, updated_at = now() WHERE id = $1", [maker.user_id, totalBuyReserve.toString()]);
    await client.query("UPDATE holdings SET reserved_quantity = reserved_quantity + $3, updated_at = now() WHERE user_id = $1 AND stock_id = $2", [maker.user_id, maker.stock_id, totalSellReserve.toString()]);
    await client.query(
      `UPDATE market_makers SET cash_balance = $2, inventory = $3, refresh_interval_ms=$4,last_refreshed_at = now(), updated_at = now() WHERE id = $1`,
      [maker.id, cash.toString(), inventory.toString(), MARKET_MAKER_REFRESH_MS[maker.stability_tier]],
    );
    await client.query(
      `INSERT INTO market_maker_ledger
         (market_maker_id, event_type, cash_after, inventory_after, metadata)
       VALUES ($1, 'quote_refresh', $2, $3, jsonb_build_object('orders', $4::int, 'buyReserve', $5::text, 'sellReserve', $6::text, 'deviationBps', $7::text))`,
      [maker.id, cash.toString(), inventory.toString(), newOrders.length, totalBuyReserve.toString(), totalSellReserve.toString(), deviationBps.toString()],
    );
    await client.query("COMMIT");
    return newOrders;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cancelExistingQuotes(client: PoolClient, maker: MakerRow): Promise<void> {
  const orders = await client.query<{ side: "buy" | "sell"; remaining: string; reserved_amount: string }>(
    `SELECT side, quantity - filled_quantity AS remaining, reserved_amount
     FROM orders
     WHERE user_id = $1 AND stock_id = $2 AND status IN ('pending', 'open', 'partially_filled')
     FOR UPDATE`,
    [maker.user_id, maker.stock_id],
  );
  let cashRelease = 0n;
  let inventoryRelease = 0n;
  for (const order of orders.rows) {
    if (order.side === "buy") cashRelease += BigInt(order.reserved_amount);
    else inventoryRelease += BigInt(order.remaining);
  }
  if (cashRelease > 0n) await client.query("UPDATE users SET reserved_cash = reserved_cash - $2, updated_at = now() WHERE id = $1", [maker.user_id, cashRelease.toString()]);
  if (inventoryRelease > 0n) await client.query("UPDATE holdings SET reserved_quantity = reserved_quantity - $3, updated_at = now() WHERE user_id = $1 AND stock_id = $2", [maker.user_id, maker.stock_id, inventoryRelease.toString()]);
  await client.query(
    "UPDATE orders SET status = 'cancelled', reserved_amount = 0, updated_at = now() WHERE user_id = $1 AND stock_id = $2 AND status IN ('pending', 'open', 'partially_filled')",
    [maker.user_id, maker.stock_id],
  );
}

async function insertQuote(client: PoolClient, maker: MakerRow, side: "buy" | "sell", price: bigint, quantity: bigint, reserve: bigint): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO orders
       (user_id, stock_id, idempotency_key, side, type, time_in_force, status, limit_price, quantity, reserved_amount)
     VALUES ($1, $2, gen_random_uuid(), $3, 'limit', 'GTC', 'open', $4, $5, $6)
     RETURNING id`,
    [maker.user_id, maker.stock_id, side, price.toString(), quantity.toString(), reserve.toString()],
  );
  return required(result.rows[0], "Market-maker quote insert failed").id;
}

function floorTick(value: bigint, tick: bigint): bigint { return value / tick * tick; }
function ceilTick(value: bigint, tick: bigint): bigint { return (value + tick - 1n) / tick * tick; }
function min(left: bigint, right: bigint): bigint { return left < right ? left : right; }
function max(left: bigint, right: bigint): bigint { return left > right ? left : right; }
function clamp(value: bigint, low: bigint, high: bigint): bigint { return max(low, min(value, high)); }
function required<T>(value: T | undefined, message: string): T { if (value === undefined) throw new Error(message); return value; }

async function spotFeeBps(client: PoolClient): Promise<bigint> {
  const result = await client.query<{ value: { value?: number } }>("SELECT value FROM system_settings WHERE key='spot_fee_bps'");
  const value = BigInt(result.rows[0]?.value?.value ?? 0);
  if (value < 0n || value > 1_000n) throw new Error("SPOT_FEE_RATE_INVALID");
  return value;
}
