import type { Pool, PoolClient } from "pg";
import { calculateSpotSettlement, clampPriceToDailyBand, type ListingRiskState, type StabilityTier } from "@market-dominion/domain";

type OrderRow = {
  id: string;
  user_id: string;
  stock_id: string;
  side: "buy" | "sell";
  status: "pending" | "open" | "partially_filled" | "filled" | "cancelled" | "rejected";
  type: "market" | "limit" | "stop";
  purpose: "spot" | "leverage_close" | "liquidation";
  position_id: string | null;
  time_in_force: "GTC" | "IOC";
  limit_price: string | null;
  stop_price: string | null;
  quantity: string;
  filled_quantity: string;
  reserved_amount: string;
  sequence: string;
};

type PriceGuard = { lower: bigint; upper: bigint };

export type MatchResult = { orderId: string; trades: number; status: string };

export async function matchOrder(pool: Pool, orderId: string, stockId: string): Promise<MatchResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [stockId]);
    const incomingResult = await client.query<OrderRow>(
      "SELECT * FROM orders WHERE id = $1 AND stock_id = $2 FOR UPDATE",
      [orderId, stockId],
    );
    const incoming = incomingResult.rows[0];
    if (!incoming || !isOpen(incoming.status)) {
      await client.query("COMMIT");
      return { orderId, trades: 0, status: incoming?.status ?? "missing" };
    }
    const guard = await loadPriceGuard(client, stockId);
    if (guard.halted) {
      await rejectAndRelease(client, incoming, "TRADING_HALTED");
      incoming.status = "rejected";
      if (incoming.purpose !== "spot") await finalizeLeverageClose(client, incoming);
      await client.query("COMMIT");
      return { orderId, trades: 0, status: incoming.status };
    }
    if (incoming.type === "stop") {
      const activated = await activateStop(client, incoming);
      if (!activated) {
        await client.query("COMMIT");
        return { orderId, trades: 0, status: "pending" };
      }
    }
    if (incoming.status === "pending") incoming.status = "open";
    let tradeCount = 0;

    while (remaining(incoming) > 0n) {
      const maker = await findMaker(client, incoming, guard);
      if (!maker) break;
      if (maker.user_id === incoming.user_id) {
        await rejectAndRelease(client, incoming, "SELF_TRADE_PREVENTION");
        incoming.status = "rejected";
        if (incoming.purpose !== "spot") await finalizeLeverageClose(client, incoming);
        await client.query("COMMIT");
        return { orderId, trades: tradeCount, status: incoming.status };
      }

      let quantity = min(remaining(incoming), remaining(maker));
      const price = BigInt(required(maker.limit_price, "Maker limit price missing"));
      const buyOrder = incoming.side === "buy" ? incoming : maker;
      const sellOrder = incoming.side === "sell" ? incoming : maker;
      if (buyOrder.type === "market") {
        const feeBps = buyOrder.purpose === "spot" && sellOrder.purpose === "spot" ? (await settlementRates(client)).feeBps : 0n;
        const reserve = BigInt(buyOrder.reserved_amount);
        const affordable = ((reserve + 1n) * 10_000n - 1n) / (price * (10_000n + feeBps));
        quantity = min(quantity, affordable);
        if (quantity <= 0n) break;
      }
      await settleTrade(client, buyOrder, sellOrder, price, quantity, incoming.side);
      applyFill(incoming, quantity);
      applyFill(maker, quantity);
      tradeCount += 1;
    }

    if (incoming.status !== "rejected" && remaining(incoming) > 0n && (incoming.type === "market" || incoming.time_in_force === "IOC")) {
      await cancelAndRelease(client, incoming);
      incoming.status = "cancelled";
    } else if (incoming.status !== "rejected") {
      incoming.status = statusAfterFill(incoming);
      await client.query("UPDATE orders SET status = $2, filled_quantity = $3, updated_at = now() WHERE id = $1", [
        incoming.id,
        incoming.status,
        incoming.filled_quantity,
      ]);
    }
    if (incoming.purpose !== "spot" && !isOpen(incoming.status)) await finalizeLeverageClose(client, incoming);
    await client.query("COMMIT");
    return { orderId, trades: tradeCount, status: incoming.status };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function finalizeLeverageClose(client: PoolClient, order: OrderRow): Promise<void> {
  const positionId = required(order.position_id, "LEVERAGE_CLOSE_POSITION_MISSING");
  const positionResult = await client.query<{
    id: string; user_id: string; stock_id: string; side: "long" | "short"; status: string; leverage: number;
    quantity: string; margin: string; position_size: string; entry_price: string; maintenance_margin_bps: number; accrued_borrow_fee: string;
  }>("SELECT * FROM leverage_positions WHERE id = $1 FOR UPDATE", [positionId]);
  const position = required(positionResult.rows[0], "LEVERAGE_POSITION_MISSING");
  const trades = await client.query<{ filled: string | null; gross: string | null }>(
    `SELECT sum(quantity)::bigint AS filled, sum(price * quantity)::bigint AS gross
     FROM trades WHERE ${position.side === "long" ? "sell_order_id" : "buy_order_id"} = $1`,
    [order.id],
  );
  const filled = BigInt(trades.rows[0]?.filled ?? "0");
  const gross = BigInt(trades.rows[0]?.gross ?? "0");
  const originalQuantity = BigInt(position.quantity);
  const unfilled = originalQuantity - filled;
  await cleanupClearinghouseInventory(client, order.user_id, position, filled, unfilled);

  if (filled <= 0n) {
    await client.query("UPDATE leverage_positions SET status = 'open', close_order_id = NULL, close_reason = NULL, updated_at = now() WHERE id = $1", [position.id]);
    return;
  }
  const marginAllocated = BigInt(position.margin) * filled / originalQuantity;
  const sizeAllocated = BigInt(position.position_size) * filled / originalQuantity;
  const borrowFeeAllocated = BigInt(position.accrued_borrow_fee) * filled / originalQuantity;
  const closeFee = gross * envBps("LEVERAGE_CLOSE_FEE_BPS", 10n) / 10_000n;
  const entryNotional = BigInt(position.entry_price) * filled;
  const pnl = position.side === "long" ? gross - entryNotional : entryNotional - gross;
  const payout = max(0n, marginAllocated + pnl - closeFee - borrowFeeAllocated);
  if (payout > 0n) {
    const paid = await client.query(
      "UPDATE users SET cash = cash - $2, updated_at = now() WHERE id = $1 AND cash - reserved_cash >= $2 RETURNING id",
      [order.user_id, payout.toString()],
    );
    if (paid.rowCount !== 1) throw new Error("CLEARINGHOUSE_PAYOUT_INVARIANT_VIOLATION");
    await client.query("UPDATE users SET cash = cash + $2, updated_at = now() WHERE id = $1", [position.user_id, payout.toString()]);
  }
  if (position.side === "short") {
    await client.query(
      "UPDATE borrow_pools SET borrowed_quantity = borrowed_quantity - $2, updated_at = now() WHERE stock_id = $1 AND borrowed_quantity >= $2",
      [position.stock_id, filled.toString()],
    );
  }
  const averagePrice = gross / filled;
  const eventType = order.purpose === "liquidation" ? "liquidation" : "close";
  await client.query(
    `INSERT INTO leverage_events (position_id, event_type, price, quantity, cash_delta, fee, realized_pnl, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, jsonb_build_object('orderId', $8::text, 'gross', $9::text))`,
    [position.id, eventType, averagePrice.toString(), filled.toString(), payout.toString(), closeFee.toString(), pnl.toString(), order.id, gross.toString()],
  );
  if (unfilled === 0n) {
    await client.query(
      "UPDATE leverage_positions SET status = $2::position_status, closed_at = now(), updated_at = now() WHERE id = $1",
      [position.id, order.purpose === "liquidation" ? "liquidated" : "closed"],
    );
  } else {
    await client.query(
      `UPDATE leverage_positions SET status = 'open', quantity = $2, margin = margin - $3, position_size = position_size - $4,
         accrued_borrow_fee = accrued_borrow_fee - $5, close_order_id = NULL, close_reason = NULL, updated_at = now()
       WHERE id = $1`,
      [position.id, unfilled.toString(), marginAllocated.toString(), sizeAllocated.toString(), borrowFeeAllocated.toString()],
    );
  }
  await client.query(
    `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
     VALUES ('position', $1, 'position.close_settled', jsonb_build_object(
       'positionId', $1::text, 'orderId', $2::text, 'filledQuantity', $3::text, 'unfilledQuantity', $4::text,
       'averagePrice', $5::text, 'payout', $6::text, 'reason', $7::text
     ))`,
    [position.id, order.id, filled.toString(), unfilled.toString(), averagePrice.toString(), payout.toString(), eventType],
  );
}

async function cleanupClearinghouseInventory(
  client: PoolClient,
  clearinghouseId: string,
  position: { stock_id: string; side: "long" | "short"; entry_price: string },
  filled: bigint,
  unfilled: bigint,
): Promise<void> {
  const removeQuantity = position.side === "long" ? unfilled : filled;
  if (removeQuantity <= 0n) return;
  const holdingResult = await client.query<{ quantity: string; cost_basis: string }>(
    "SELECT quantity, cost_basis FROM holdings WHERE user_id = $1 AND stock_id = $2 FOR UPDATE",
    [clearinghouseId, position.stock_id],
  );
  const holding = required(holdingResult.rows[0], "CLEARINGHOUSE_HOLDING_MISSING");
  const quantityBefore = BigInt(holding.quantity);
  if (quantityBefore < removeQuantity) throw new Error("CLEARINGHOUSE_HOLDING_INVARIANT_VIOLATION");
  const costRemoval = BigInt(holding.cost_basis) * removeQuantity / quantityBefore;
  await client.query(
    "UPDATE holdings SET quantity = quantity - $3, cost_basis = cost_basis - $4, updated_at = now() WHERE user_id = $1 AND stock_id = $2",
    [clearinghouseId, position.stock_id, removeQuantity.toString(), costRemoval.toString()],
  );
}

async function findMaker(client: PoolClient, incoming: OrderRow, guard: PriceGuard): Promise<OrderRow | undefined> {
  const priceCondition = incoming.type === "market"
    ? "AND $3::bigint IS NULL"
    : incoming.side === "buy" ? "AND limit_price <= $3" : "AND limit_price >= $3";
  const direction = incoming.side === "buy" ? "ASC" : "DESC";
  const result = await client.query<OrderRow>(
    `SELECT * FROM orders
     WHERE stock_id = $1
       AND side = $2
       AND type = 'limit'
       AND status IN ('open', 'partially_filled', 'pending')
       ${priceCondition}
       AND limit_price BETWEEN $5 AND $6
       AND id <> $4
     ORDER BY limit_price ${direction}, sequence ASC
     FOR UPDATE
     LIMIT 1`,
    [incoming.stock_id, incoming.side === "buy" ? "sell" : "buy", incoming.limit_price, incoming.id, guard.lower.toString(), guard.upper.toString()],
  );
  return result.rows[0];
}

async function loadPriceGuard(client: PoolClient, stockId: string): Promise<PriceGuard & { halted: boolean }> {
  const result = await client.query<{
    asset_type: string; is_trading_halted: boolean; circuit_breaker_until: Date | null;
    daily_anchor_price: string; stability_tier: StabilityTier; listing_status: ListingRiskState;
  }>(`SELECT asset_type,is_trading_halted,circuit_breaker_until,daily_anchor_price,stability_tier,listing_status
      FROM stocks WHERE id=$1 FOR UPDATE`, [stockId]);
  const stock = required(result.rows[0], "Stock missing");
  const halted = stock.is_trading_halted || (stock.circuit_breaker_until !== null && new Date(stock.circuit_breaker_until).getTime() > Date.now());
  if (stock.asset_type !== "common") return { lower: 1n, upper: 9_223_372_036_854_775_807n, halted };
  const anchor = BigInt(stock.daily_anchor_price);
  return {
    lower: clampPriceToDailyBand({ proposedPrice: 1n, anchorPrice: anchor, tier: stock.stability_tier, state: stock.listing_status }),
    upper: clampPriceToDailyBand({ proposedPrice: 9_223_372_036_854_775_807n, anchorPrice: anchor, tier: stock.stability_tier, state: stock.listing_status }),
    halted,
  };
}

async function activateStop(client: PoolClient, order: OrderRow): Promise<boolean> {
  const stock = await client.query<{ current_price: string }>("SELECT current_price FROM stocks WHERE id = $1 FOR SHARE", [order.stock_id]);
  const currentPrice = BigInt(required(stock.rows[0], "Stock missing").current_price);
  const stopPrice = BigInt(required(order.stop_price, "Stop price missing"));
  const triggered = order.side === "buy" ? currentPrice >= stopPrice : currentPrice <= stopPrice;
  if (!triggered) return false;
  order.type = order.limit_price === null ? "market" : "limit";
  order.status = "open";
  await client.query("UPDATE orders SET type = $2, status = 'open', updated_at = now() WHERE id = $1", [order.id, order.type]);
  await client.query(
    "INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('order', $1, 'order.stop_triggered', jsonb_build_object('orderId', $1::text, 'stockId', $2::text))",
    [order.id, order.stock_id],
  );
  return true;
}

async function settleTrade(client: PoolClient, buyOrder: OrderRow, sellOrder: OrderRow, price: bigint, quantity: bigint, takerSide: "buy" | "sell"): Promise<void> {
  const buyLimit = buyOrder.limit_price === null ? price : BigInt(buyOrder.limit_price);
  const sellerHoldingResult = await client.query<{ quantity: string; cost_basis: string }>(
    "SELECT quantity, cost_basis FROM holdings WHERE user_id = $1 AND stock_id = $2 FOR UPDATE",
    [sellOrder.user_id, sellOrder.stock_id],
  );
  const sellerHolding = sellerHoldingResult.rows[0];
  if (!sellerHolding || BigInt(sellerHolding.quantity) < quantity) throw new Error("SELLER_HOLDING_INVARIANT_VIOLATION");
  const rates = buyOrder.purpose === "spot" && sellOrder.purpose === "spot"
    ? await settlementRates(client)
    : { feeBps: 0n, taxBps: 0n };
  const settlement = calculateSpotSettlement({
    executionPrice: price,
    buyLimitPrice: buyLimit,
    fillQuantity: quantity,
    sellerQuantityBefore: BigInt(sellerHolding.quantity),
    sellerCostBasisBefore: BigInt(sellerHolding.cost_basis),
    buyerFeeBps: rates.feeBps,
    sellerFeeBps: rates.feeBps,
    positivePnlTaxBps: rates.taxBps,
  });
  const { tradeValue, buyerDebit, sellerCredit, buyerFee, sellerFee, sellerTax, buyerReserveRelease: reserveRelease, sellerAllocatedCost: allocatedCost, sellerRealizedPnl } = settlement;

  const buyer = await client.query(
    `UPDATE users
     SET cash = cash - $2, reserved_cash = reserved_cash - $3, updated_at = now()
     WHERE id = $1 AND cash >= $2 AND reserved_cash >= $3
     RETURNING id`,
    [buyOrder.user_id, buyerDebit.toString(), reserveRelease.toString()],
  );
  if (buyer.rowCount !== 1) throw new Error("BUYER_RESERVATION_INVARIANT_VIOLATION");
  const seller = await client.query(
    `UPDATE holdings
     SET quantity = quantity - $3,
         reserved_quantity = reserved_quantity - $3,
         cost_basis = cost_basis - $4,
         realized_pnl = realized_pnl + $5,
         updated_at = now()
     WHERE user_id = $1 AND stock_id = $2 AND reserved_quantity >= $3
     RETURNING id`,
    [sellOrder.user_id, sellOrder.stock_id, quantity.toString(), allocatedCost.toString(), sellerRealizedPnl.toString()],
  );
  if (seller.rowCount !== 1) throw new Error("SELLER_RESERVATION_INVARIANT_VIOLATION");

  await client.query("UPDATE users SET cash = cash + $2, updated_at = now() WHERE id = $1", [sellOrder.user_id, sellerCredit.toString()]);
  await client.query(
    `INSERT INTO holdings (user_id, stock_id, quantity, cost_basis)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, stock_id) DO UPDATE
     SET quantity = holdings.quantity + EXCLUDED.quantity,
         cost_basis = holdings.cost_basis + EXCLUDED.cost_basis,
         updated_at = now()`,
    [buyOrder.user_id, buyOrder.stock_id, quantity.toString(), buyerDebit.toString()],
  );

  const buyFilled = BigInt(buyOrder.filled_quantity) + quantity;
  const sellFilled = BigInt(sellOrder.filled_quantity) + quantity;
  await client.query(
    `UPDATE orders
     SET filled_quantity = $2,
         reserved_amount = reserved_amount - $3,
         status = CASE WHEN $2 = quantity THEN 'filled'::order_status ELSE 'partially_filled'::order_status END,
         updated_at = now()
     WHERE id = $1`,
    [buyOrder.id, buyFilled.toString(), reserveRelease.toString()],
  );
  buyOrder.reserved_amount = (BigInt(buyOrder.reserved_amount) - reserveRelease).toString();
  await client.query(
    `UPDATE orders
     SET filled_quantity = $2,
         status = CASE WHEN $2 = quantity THEN 'filled'::order_status ELSE 'partially_filled'::order_status END,
         updated_at = now()
     WHERE id = $1`,
    [sellOrder.id, sellFilled.toString()],
  );
  const tradeResult = await client.query<{ id: string; sequence: string }>(
    `INSERT INTO trades (stock_id, buy_order_id, sell_order_id, buyer_user_id, seller_user_id, taker_side, price, quantity, buyer_fee, seller_fee, seller_tax)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, sequence`,
    [buyOrder.stock_id, buyOrder.id, sellOrder.id, buyOrder.user_id, sellOrder.user_id, takerSide, price.toString(), quantity.toString(), buyerFee.toString(), sellerFee.toString(), sellerTax.toString()],
  );
  const trade = required(tradeResult.rows[0], "Trade insert returned no row");
  const treasuryTake = buyerFee + sellerFee + sellerTax;
  if (treasuryTake > 0n) {
    const treasury = await client.query("UPDATE users SET cash=cash+$1,updated_at=now() WHERE id=(SELECT user_id FROM system_accounts WHERE key='exchange_treasury') RETURNING id", [treasuryTake.toString()]);
    if (treasury.rowCount !== 1) throw new Error("EXCHANGE_TREASURY_MISSING");
  }
  await syncMarketMaker(client, buyOrder.user_id, buyOrder.stock_id, -buyerDebit, quantity, trade.id);
  await syncMarketMaker(client, sellOrder.user_id, sellOrder.stock_id, sellerCredit, -quantity, trade.id);
  await client.query("UPDATE stocks SET current_price = $2, updated_at = now() WHERE id = $1", [buyOrder.stock_id, price.toString()]);
  await client.query(
    `INSERT INTO candles (stock_id, interval, opened_at, open, high, low, close, volume)
     VALUES ($1, '1m', date_trunc('minute', now()), $2, $2, $2, $2, $3)
     ON CONFLICT (stock_id, interval, opened_at) DO UPDATE
     SET high = GREATEST(candles.high, EXCLUDED.high),
         low = LEAST(candles.low, EXCLUDED.low),
         close = EXCLUDED.close,
         volume = candles.volume + EXCLUDED.volume`,
    [buyOrder.stock_id, price.toString(), quantity.toString()],
  );
  await client.query(
    `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
     VALUES ('stock', $1, 'trade.executed', jsonb_build_object(
       'tradeId', $2::text,
       'sequence', $3::text,
       'stockId', $1::text,
       'buyOrderId', $4::text,
       'sellOrderId', $5::text,
       'price', $6::text,
       'quantity', $7::text
     ))`,
    [buyOrder.stock_id, trade.id, trade.sequence, buyOrder.id, sellOrder.id, price.toString(), quantity.toString()],
  );
}

async function syncMarketMaker(
  client: PoolClient,
  userId: string,
  stockId: string,
  cashDelta: bigint,
  inventoryDelta: bigint,
  tradeId: string,
): Promise<void> {
  const updated = await client.query<{ id: string; cash_balance: string; inventory: string }>(
    `UPDATE market_makers mm
     SET cash_balance = u.cash,
         inventory = COALESCE(h.quantity, 0),
         updated_at = now()
     FROM users u
     LEFT JOIN holdings h ON h.user_id = u.id AND h.stock_id = $2
     WHERE mm.user_id = $1 AND mm.stock_id = $2 AND u.id = mm.user_id
     RETURNING mm.id, mm.cash_balance, mm.inventory`,
    [userId, stockId],
  );
  const maker = updated.rows[0];
  if (!maker) return;
  await client.query(
    `INSERT INTO market_maker_ledger
       (market_maker_id, event_type, cash_delta, inventory_delta, cash_after, inventory_after, reference_id)
     VALUES ($1, 'trade', $2, $3, $4, $5, $6)`,
    [maker.id, cashDelta.toString(), inventoryDelta.toString(), maker.cash_balance, maker.inventory, tradeId],
  );
}

async function rejectAndRelease(client: PoolClient, order: OrderRow, reason: string): Promise<void> {
  const remainingQuantity = remaining(order);
  if (order.side === "buy") {
    await client.query("UPDATE users SET reserved_cash = reserved_cash - $2, updated_at = now() WHERE id = $1", [order.user_id, order.reserved_amount]);
  } else {
    await client.query(
      "UPDATE holdings SET reserved_quantity = reserved_quantity - $3, updated_at = now() WHERE user_id = $1 AND stock_id = $2",
      [order.user_id, order.stock_id, remainingQuantity.toString()],
    );
  }
  await client.query(
    "UPDATE orders SET status = 'rejected', rejected_reason = $2, reserved_amount = 0, updated_at = now() WHERE id = $1",
    [order.id, reason],
  );
}

async function cancelAndRelease(client: PoolClient, order: OrderRow): Promise<void> {
  const remainingQuantity = remaining(order);
  if (order.side === "buy") {
    await client.query("UPDATE users SET reserved_cash = reserved_cash - $2, updated_at = now() WHERE id = $1", [order.user_id, order.reserved_amount]);
  } else {
    await client.query(
      "UPDATE holdings SET reserved_quantity = reserved_quantity - $3, updated_at = now() WHERE user_id = $1 AND stock_id = $2",
      [order.user_id, order.stock_id, remainingQuantity.toString()],
    );
  }
  order.reserved_amount = "0";
  await client.query("UPDATE orders SET status = 'cancelled', reserved_amount = 0, updated_at = now() WHERE id = $1", [order.id]);
}

function remaining(order: OrderRow): bigint {
  return BigInt(order.quantity) - BigInt(order.filled_quantity);
}

function applyFill(order: OrderRow, quantity: bigint): void {
  order.filled_quantity = (BigInt(order.filled_quantity) + quantity).toString();
  order.status = statusAfterFill(order);
}

function statusAfterFill(order: OrderRow): OrderRow["status"] {
  if (BigInt(order.filled_quantity) === 0n) return "open";
  return remaining(order) === 0n ? "filled" : "partially_filled";
}

function isOpen(status: OrderRow["status"]): boolean {
  return status === "pending" || status === "open" || status === "partially_filled";
}

function min(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function max(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

async function settlementRates(client: PoolClient): Promise<{ feeBps: bigint; taxBps: bigint }> {
  const result = await client.query<{ value: { value?: number } }>("SELECT value FROM system_settings WHERE key='spot_fee_bps'");
  const configured = result.rows[0]?.value?.value;
  const feeBps = configured === undefined ? 0n : BigInt(configured);
  const taxBps = BigInt(process.env.POSITIVE_PNL_TAX_BPS ?? "500");
  if (feeBps < 0n || feeBps > 1_000n || taxBps < 0n || taxBps > 10_000n) throw new Error("SPOT_SETTLEMENT_RATE_INVALID");
  return { feeBps, taxBps };
}

function envBps(name: string, fallback: bigint): bigint {
  const value = process.env[name] === undefined ? fallback : BigInt(process.env[name]!);
  if (value < 0n || value > 10_000n) throw new Error(`${name}_INVALID`);
  return value;
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}
