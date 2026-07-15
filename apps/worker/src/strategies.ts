import { randomUUID } from "node:crypto";
import { evaluateGroup, type BacktestSafety, type StrategyAction, type StrategyCandle, type StrategyDefinition, type StrategyPositionState } from "@market-dominion/domain";
import type { Pool, PoolClient } from "pg";

type QueueLike = { add(name: string, data: { orderId: string; stockId: string }, options?: Record<string, unknown>): Promise<unknown> };
type SafetyJson = {
  initialCash: string; feeBps: number; slippageBps: number; maxOrderAmount: string; maxHoldingBps: number;
  dailyMaxLossBps: number; cooldownBars: number; stopLossBps?: number; takeProfitBps?: number;
};
type ActiveStrategy = {
  id: string; user_id: string; stock_id: string; interval: string; status: "PAPER" | "LIVE_VIRTUAL";
  definition: StrategyDefinition; safety: SafetyJson; paper_cash: string; paper_quantity: string; paper_cost_basis: string;
  last_evaluated_candle_at: Date | null; last_trade_at: Date | null; daily_equity_date: string | null; daily_start_equity: string | null;
};
type CandleRow = { opened_at: Date; open: string; high: string; low: string; close: string; volume: string; imbalance_bps: number; market_strength: number; sector_strength: number };

export async function runStrategyCycle(pool: Pool, queue: QueueLike): Promise<{ evaluated: number; submitted: number; queued: number }> {
  const active = await pool.query<{ id: string }>("SELECT id FROM strategies WHERE status IN ('PAPER','LIVE_VIRTUAL') ORDER BY id");
  let submitted = 0; let queued = 0;
  for (const strategy of active.rows) {
    const result = await evaluateStrategy(pool, strategy.id);
    if (result?.traded) submitted += 1;
  }
  const pending = await pool.query<{ order_id: string; stock_id: string }>(
    `SELECT DISTINCT se.order_id, o.stock_id FROM strategy_executions se JOIN orders o ON o.id=se.order_id
     WHERE se.status='submitted' AND o.status IN ('pending','open','partially_filled')`,
  );
  for (const order of pending.rows) {
    await queue.add("match", { orderId: order.order_id, stockId: order.stock_id }, {
      jobId: order.order_id, attempts: 10, backoff: { type: "exponential", delay: 250 }, removeOnComplete: true, removeOnFail: 10_000,
    });
    queued += 1;
  }
  return { evaluated: active.rows.length, submitted, queued };
}

export async function evaluateStrategy(pool: Pool, strategyId: string): Promise<{ orderId?: string; stockId: string; traded: boolean } | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`strategy:${strategyId}`]);
    const result = await client.query<ActiveStrategy>("SELECT * FROM strategies WHERE id = $1 FOR UPDATE", [strategyId]);
    const strategy = result.rows[0];
    if (!strategy || !["PAPER", "LIVE_VIRTUAL"].includes(strategy.status)) { await client.query("COMMIT"); return null; }
    await captureLiquidity(client, strategy.stock_id);
    const candleResult = await client.query<CandleRow>(
      `SELECT ca.opened_at, ca.open, ca.high, ca.low, ca.close, ca.volume,
              COALESCE(ls.imbalance_bps, 0) AS imbalance_bps, COALESCE(ms.strength, 0) AS market_strength, COALESCE(ss.strength, 0) AS sector_strength
       FROM candles ca JOIN stocks st ON st.id = ca.stock_id JOIN companies co ON co.id = st.company_id
       LEFT JOIN LATERAL (SELECT imbalance_bps FROM liquidity_snapshots WHERE stock_id = ca.stock_id AND captured_at <= ca.opened_at ORDER BY captured_at DESC LIMIT 1) ls ON true
       LEFT JOIN LATERAL (SELECT strength FROM market_state_snapshots WHERE sector_id IS NULL AND captured_at <= ca.opened_at ORDER BY captured_at DESC LIMIT 1) ms ON true
       LEFT JOIN LATERAL (SELECT strength FROM market_state_snapshots WHERE sector_id = co.sector_id AND captured_at <= ca.opened_at ORDER BY captured_at DESC LIMIT 1) ss ON true
       WHERE ca.stock_id = $1 AND ca.interval = $2 ORDER BY ca.opened_at DESC LIMIT 502`,
      [strategy.stock_id, strategy.interval],
    );
    const rows = candleResult.rows.reverse();
    if (rows.length < 2) { await client.query("COMMIT"); return null; }
    const executionBar = rows.at(-1)!;
    if (strategy.last_evaluated_candle_at?.getTime() === executionBar.opened_at.getTime()) { await client.query("COMMIT"); return null; }
    const candles = rows.map(toCandle);
    const signalIndex = candles.length - 2;
    const safety = toSafety(strategy.safety);
    const state = strategy.status === "PAPER" ? paperState(strategy) : await liveState(client, strategy.user_id, strategy.stock_id);
    const currentEquity = strategy.status === "PAPER" ? state.cash + state.quantity * BigInt(executionBar.open) : await portfolioEquity(client, strategy.user_id);
    const date = executionBar.opened_at.toISOString().slice(0, 10);
    const dayStart = strategy.daily_equity_date === date && strategy.daily_start_equity !== null ? BigInt(strategy.daily_start_equity) : currentEquity;
    const lossBps = dayStart > 0n ? max(0n, (dayStart - currentEquity) * 10_000n / dayStart) : 0n;
    let action: StrategyAction | null = evaluateGroup(strategy.definition.when, candles, signalIndex, state) ? strategy.definition.then : null;
    let reason = action ? "SIGNAL" : "NO_SIGNAL";
    const signalCandle = candles[signalIndex]!;
    if (state.quantity > 0n && state.costBasis > 0n) {
      const average = state.costBasis / state.quantity;
      if (average > 0n) {
        const returnBps = (signalCandle.close - average) * 10_000n / average;
        if (safety.stopLossBps !== undefined && returnBps <= -BigInt(safety.stopLossBps)) { action = fullSell(); reason = "STOP_LOSS"; }
        if (safety.takeProfitBps !== undefined && returnBps >= BigInt(safety.takeProfitBps)) { action = fullSell(); reason = "TAKE_PROFIT"; }
      }
    }
    const cooldownUntil = strategy.last_trade_at ? strategy.last_trade_at.getTime() + safety.cooldownBars * intervalMs(strategy.interval) : 0;
    if (lossBps >= BigInt(safety.dailyMaxLossBps)) { action = null; reason = "DAILY_LOSS_LIMIT"; }
    else if (executionBar.opened_at.getTime() < cooldownUntil) { action = null; reason = "COOLDOWN"; }

    let execution: { status: "skipped" | "submitted" | "filled"; quantity: bigint; price?: bigint; fee: bigint; orderId?: string; error?: string } = { status: "skipped", quantity: 0n, fee: 0n, error: reason };
    if (action) execution = strategy.status === "PAPER"
      ? await executePaper(client, strategy, action, executionBar.open, safety)
      : await executeLive(client, strategy, action, executionBar.open, safety, state);
    await client.query(
      `INSERT INTO strategy_executions (strategy_id, mode, status, candle_opened_at, order_id, action, signal_snapshot, quantity, execution_price, fee, error_code)
       VALUES ($1,$2::strategy_execution_mode,$3::strategy_execution_status,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11)
       ON CONFLICT (strategy_id, candle_opened_at) DO NOTHING`,
      [strategy.id, strategy.status, execution.status, executionBar.opened_at, execution.orderId ?? null, JSON.stringify(action ?? {}), JSON.stringify({ reason, signalCandleOpenedAt: signalCandle.openedAt.toISOString(), signalClose: signalCandle.close.toString(), dailyLossBps: lossBps.toString() }), execution.quantity.toString(), execution.price?.toString() ?? null, execution.fee.toString(), execution.error ?? null],
    );
    await client.query(
      `UPDATE strategies SET last_evaluated_candle_at = $2, daily_equity_date = $3, daily_start_equity = $4,
         last_trade_at = CASE WHEN $5 THEN $2 ELSE last_trade_at END, updated_at = now() WHERE id = $1`,
      [strategy.id, executionBar.opened_at, date, dayStart.toString(), execution.status !== "skipped"],
    );
    await client.query("COMMIT");
    return { ...(execution.orderId ? { orderId: execution.orderId } : {}), stockId: strategy.stock_id, traded: execution.status !== "skipped" };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

async function executePaper(client: PoolClient, strategy: ActiveStrategy, action: StrategyAction, open: string, safety: BacktestSafety) {
  let cash = BigInt(strategy.paper_cash); let quantity = BigInt(strategy.paper_quantity); let cost = BigInt(strategy.paper_cost_basis);
  const rawPrice = BigInt(open);
  if (action.type === "buy") {
    const total = cash + quantity * rawPrice;
    const capacity = max(0n, total * BigInt(safety.maxHoldingBps) / 10_000n - quantity * rawPrice);
    const desired = min(min(cash * BigInt(action.valueBps) / 10_000n, safety.maxOrderAmount), capacity);
    const price = rawPrice * (10_000n + safety.slippageBps) / 10_000n;
    const bought = price > 0n ? desired * 10_000n / (price * (10_000n + safety.feeBps)) : 0n;
    if (bought <= 0n) return skipped("ORDER_SIZE_ZERO");
    const gross = price * bought; const fee = gross * safety.feeBps / 10_000n;
    cash -= gross + fee; quantity += bought; cost += gross + fee;
    await updatePaper(client, strategy.id, cash, quantity, cost);
    return { status: "filled" as const, quantity: bought, price, fee };
  }
  const sold = min(quantity, quantity * BigInt(action.valueBps) / 10_000n);
  if (sold <= 0n) return skipped("NO_POSITION");
  const price = max(1n, rawPrice * (10_000n - safety.slippageBps) / 10_000n); const gross = price * sold; const fee = gross * safety.feeBps / 10_000n;
  const allocated = cost * sold / quantity; cash += gross - fee; quantity -= sold; cost -= allocated;
  await updatePaper(client, strategy.id, cash, quantity, cost);
  return { status: "filled" as const, quantity: sold, price, fee };
}

async function executeLive(client: PoolClient, strategy: ActiveStrategy, action: StrategyAction, referencePrice: string, safety: BacktestSafety, state: StrategyPositionState) {
  if (action.type === "buy") {
    const total = state.cash + state.quantity * BigInt(referencePrice);
    const capacity = max(0n, total * BigInt(safety.maxHoldingBps) / 10_000n - state.quantity * BigInt(referencePrice));
    const desired = min(min(state.cash * BigInt(action.valueBps) / 10_000n, safety.maxOrderAmount), capacity);
    const asks = await client.query<{ limit_price: string; remaining: string }>(
      `SELECT limit_price, quantity - filled_quantity AS remaining FROM orders WHERE stock_id = $1 AND user_id <> $2 AND side = 'sell' AND type = 'limit' AND status IN ('pending','open','partially_filled') ORDER BY limit_price, sequence LIMIT 10000`,
      [strategy.stock_id, strategy.user_id],
    );
    const setting = await client.query<{ value: { value?: number } }>("SELECT value FROM system_settings WHERE key='spot_fee_bps'");
    const feeBps = BigInt(setting.rows[0]?.value?.value ?? 0);
    let budget = desired; let reserve = 0n; let quantity = 0n;
    for (const ask of asks.rows) { const price = BigInt(ask.limit_price); const take = min(BigInt(ask.remaining), budget * 10_000n / (price * (10_000n + feeBps))); if (take <= 0n) break; const cost = price * take * (10_000n + feeBps) / 10_000n; quantity += take; reserve += cost; budget -= cost; }
    if (quantity <= 0n) return skipped("NO_ASK_LIQUIDITY");
    const reserved = await client.query("UPDATE users SET reserved_cash = reserved_cash + $2, updated_at = now() WHERE id = $1 AND is_active AND cash - reserved_cash >= $2 RETURNING id", [strategy.user_id, reserve.toString()]);
    if (reserved.rowCount !== 1) return skipped("AVAILABLE_CASH_INSUFFICIENT");
    return insertLiveOrder(client, strategy, "buy", quantity, reserve);
  }
  const available = state.quantity;
  const quantity = min(available, available * BigInt(action.valueBps) / 10_000n);
  if (quantity <= 0n) return skipped("NO_POSITION");
  const reserved = await client.query(
    `UPDATE holdings SET reserved_quantity = reserved_quantity + $3, updated_at = now() WHERE user_id = $1 AND stock_id = $2 AND quantity - reserved_quantity >= $3 RETURNING id`,
    [strategy.user_id, strategy.stock_id, quantity.toString()],
  );
  if (reserved.rowCount !== 1) return skipped("AVAILABLE_POSITION_INSUFFICIENT");
  return insertLiveOrder(client, strategy, "sell", quantity, 0n);
}

async function insertLiveOrder(client: PoolClient, strategy: ActiveStrategy, side: "buy" | "sell", quantity: bigint, reserve: bigint) {
  const order = await client.query<{ id: string }>(
    `INSERT INTO orders (user_id, stock_id, idempotency_key, side, type, purpose, time_in_force, status, quantity, reserved_amount)
     VALUES ($1,$2,$3,$4,'market','spot','IOC','pending',$5,$6) RETURNING id`,
    [strategy.user_id, strategy.stock_id, randomUUID(), side, quantity.toString(), reserve.toString()],
  );
  const orderId = order.rows[0]!.id;
  await client.query("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata) VALUES ($1,'strategy.order_submit','order',$2,jsonb_build_object('strategyId',$3::text))", [strategy.user_id, orderId, strategy.id]);
  return { status: "submitted" as const, quantity, fee: 0n, orderId };
}

async function captureLiquidity(client: PoolClient, stockId: string) {
  await client.query(
    `WITH book AS (
       SELECT max(limit_price) FILTER (WHERE side='buy') AS best_bid, min(limit_price) FILTER (WHERE side='sell') AS best_ask,
              COALESCE(sum(quantity-filled_quantity) FILTER (WHERE side='buy'),0) AS bid_depth,
              COALESCE(sum(quantity-filled_quantity) FILTER (WHERE side='sell'),0) AS ask_depth
       FROM orders WHERE stock_id=$1 AND type='limit' AND status IN ('pending','open','partially_filled')
     ) INSERT INTO liquidity_snapshots (stock_id,best_bid,best_ask,bid_depth,ask_depth,imbalance_bps,spread_bps)
       SELECT $1,best_bid,best_ask,bid_depth,ask_depth,
              CASE WHEN bid_depth+ask_depth=0 THEN 0 ELSE ((bid_depth-ask_depth)*10000/(bid_depth+ask_depth))::int END,
              CASE WHEN best_bid IS NULL OR best_ask IS NULL OR best_bid=0 THEN NULL ELSE ((best_ask-best_bid)*10000/best_bid)::int END FROM book`, [stockId],
  );
}
async function liveState(client: PoolClient, userId: string, stockId: string): Promise<StrategyPositionState> {
  const result = await client.query<{ cash: string; reserved_cash: string; quantity: string; reserved_quantity: string; cost_basis: string }>(
    `SELECT u.cash,u.reserved_cash,COALESCE(h.quantity,0) AS quantity,COALESCE(h.reserved_quantity,0) AS reserved_quantity,COALESCE(h.cost_basis,0) AS cost_basis FROM users u LEFT JOIN holdings h ON h.user_id=u.id AND h.stock_id=$2 WHERE u.id=$1`, [userId, stockId],
  );
  const row = result.rows[0]; if (!row) throw new Error("STRATEGY_USER_MISSING");
  return { cash: BigInt(row.cash) - BigInt(row.reserved_cash), quantity: BigInt(row.quantity) - BigInt(row.reserved_quantity), costBasis: BigInt(row.cost_basis) };
}
async function portfolioEquity(client: PoolClient, userId: string): Promise<bigint> {
  const result = await client.query<{ equity: string }>(`SELECT u.cash + COALESCE(sum(h.quantity*s.current_price),0) AS equity FROM users u LEFT JOIN holdings h ON h.user_id=u.id LEFT JOIN stocks s ON s.id=h.stock_id WHERE u.id=$1 GROUP BY u.id`, [userId]);
  return BigInt(result.rows[0]?.equity ?? "0");
}
async function updatePaper(client: PoolClient, id: string, cash: bigint, quantity: bigint, cost: bigint) { await client.query("UPDATE strategies SET paper_cash=$2,paper_quantity=$3,paper_cost_basis=$4 WHERE id=$1", [id, cash.toString(), quantity.toString(), cost.toString()]); }
function paperState(strategy: ActiveStrategy): StrategyPositionState { return { cash: BigInt(strategy.paper_cash), quantity: BigInt(strategy.paper_quantity), costBasis: BigInt(strategy.paper_cost_basis) }; }
function toCandle(row: CandleRow): StrategyCandle { return { openedAt: row.opened_at, open: BigInt(row.open), high: BigInt(row.high), low: BigInt(row.low), close: BigInt(row.close), volume: BigInt(row.volume), orderbookImbalanceBps: BigInt(row.imbalance_bps), marketRegimeStrength: BigInt(row.market_strength), sectorStrength: BigInt(row.sector_strength) }; }
function toSafety(value: SafetyJson): BacktestSafety { return { initialCash: BigInt(value.initialCash), feeBps: BigInt(value.feeBps), slippageBps: BigInt(value.slippageBps), maxOrderAmount: BigInt(value.maxOrderAmount), maxHoldingBps: value.maxHoldingBps, dailyMaxLossBps: value.dailyMaxLossBps, cooldownBars: value.cooldownBars, ...(value.stopLossBps === undefined ? {} : { stopLossBps: value.stopLossBps }), ...(value.takeProfitBps === undefined ? {} : { takeProfitBps: value.takeProfitBps }) }; }
function fullSell(): StrategyAction { return { type: "sell", sizing: "percent_position", valueBps: 10_000 }; }
function skipped(error: string) { return { status: "skipped" as const, quantity: 0n, fee: 0n, error }; }
function intervalMs(interval: string): number { return ({ "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "1d": 86_400_000 } as Record<string, number>)[interval] ?? 60_000; }
function min(a: bigint, b: bigint) { return a < b ? a : b; }
function max(a: bigint, b: bigint) { return a > b ? a : b; }
