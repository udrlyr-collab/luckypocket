import type { Pool } from "pg";

export type LeverageCloseReason = "manual" | "liquidation";
export type LeverageCloseOrder = { orderId: string; stockId: string; positionId: string; status: string };

type PositionRow = {
  id: string;
  user_id: string;
  stock_id: string;
  side: "long" | "short";
  status: "open" | "closing" | "closed" | "liquidated";
  quantity: string;
  entry_price: string;
  close_order_id: string | null;
};

export async function submitLeverageCloseOrder(
  pool: Pool,
  positionId: string,
  reason: LeverageCloseReason,
  expectedUserId?: string,
): Promise<LeverageCloseOrder> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<PositionRow>(
      `SELECT * FROM leverage_positions
       WHERE id = $1 AND ($2::uuid IS NULL OR user_id = $2)
       FOR UPDATE`,
      [positionId, expectedUserId ?? null],
    );
    const position = result.rows[0];
    if (!position) throw new Error("POSITION_NOT_FOUND");
    if (position.status === "closing" && position.close_order_id) {
      const existing = await client.query<{ id: string; stock_id: string; status: string }>("SELECT id, stock_id, status FROM orders WHERE id = $1", [position.close_order_id]);
      const order = required(existing.rows[0], "CLOSE_ORDER_MISSING");
      await client.query("COMMIT");
      return { orderId: order.id, stockId: order.stock_id, positionId, status: order.status };
    }
    if (position.status !== "open") throw new Error("POSITION_NOT_OPEN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [position.stock_id]);
    const account = await client.query<{ user_id: string }>("SELECT user_id FROM system_accounts WHERE key = 'derivatives_clearinghouse'", []);
    const clearinghouseId = required(account.rows[0], "CLEARINGHOUSE_ACCOUNT_MISSING").user_id;
    const quantity = BigInt(position.quantity);
    let reserveAmount = 0n;
    const orderSide = position.side === "long" ? "sell" : "buy";

    if (position.side === "long") {
      const costBasis = BigInt(position.entry_price) * quantity;
      await client.query(
        `INSERT INTO holdings (user_id, stock_id, quantity, reserved_quantity, cost_basis)
         VALUES ($1, $2, $3, $3, $4)
         ON CONFLICT (user_id, stock_id) DO UPDATE SET
           quantity = holdings.quantity + EXCLUDED.quantity,
           reserved_quantity = holdings.reserved_quantity + EXCLUDED.reserved_quantity,
           cost_basis = holdings.cost_basis + EXCLUDED.cost_basis,
           updated_at = now()`,
        [clearinghouseId, position.stock_id, quantity.toString(), costBasis.toString()],
      );
    } else {
      reserveAmount = await marketBuyReserve(client, position.stock_id, quantity);
      if (reserveAmount <= 0n) throw new Error("NO_COVER_LIQUIDITY");
      const reserved = await client.query(
        `UPDATE users SET reserved_cash = reserved_cash + $2, updated_at = now()
         WHERE id = $1 AND cash - reserved_cash >= $2 RETURNING id`,
        [clearinghouseId, reserveAmount.toString()],
      );
      if (reserved.rowCount !== 1) throw new Error("CLEARINGHOUSE_CAPITAL_INSUFFICIENT");
    }

    const orderResult = await client.query<{ id: string; status: string }>(
      `INSERT INTO orders
         (user_id, stock_id, idempotency_key, side, type, purpose, position_id, time_in_force, status, quantity, reserved_amount)
       VALUES ($1, $2, gen_random_uuid(), $3, 'market', $4::order_purpose, $5, 'IOC', 'pending', $6, $7)
       RETURNING id, status`,
      [clearinghouseId, position.stock_id, orderSide, reason === "liquidation" ? "liquidation" : "leverage_close", position.id, quantity.toString(), reserveAmount.toString()],
    );
    const order = required(orderResult.rows[0], "CLOSE_ORDER_INSERT_FAILED");
    await client.query(
      "UPDATE leverage_positions SET status = 'closing', close_order_id = $2, close_reason = $3, updated_at = now() WHERE id = $1",
      [position.id, order.id, reason],
    );
    await client.query(
      `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('position', $1, 'position.close_submitted', jsonb_build_object('positionId', $1::text, 'orderId', $2::text, 'reason', $3::text))`,
      [position.id, order.id, reason],
    );
    await client.query("COMMIT");
    return { orderId: order.id, stockId: position.stock_id, positionId, status: order.status };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function marketBuyReserve(client: { query: <T>(text: string, values?: unknown[]) => Promise<{ rows: T[] }> }, stockId: string, requested: bigint): Promise<bigint> {
  const result = await client.query<{ limit_price: string; remaining: string }>(
    `SELECT limit_price, quantity - filled_quantity AS remaining
     FROM orders
     WHERE stock_id = $1 AND side = 'sell' AND type = 'limit' AND status IN ('pending', 'open', 'partially_filled')
     ORDER BY limit_price ASC, sequence ASC LIMIT 10000`,
    [stockId],
  );
  let remaining = requested;
  let reserve = 0n;
  for (const level of result.rows) {
    if (remaining <= 0n) break;
    const available = BigInt(level.remaining);
    const fill = available < remaining ? available : remaining;
    reserve += BigInt(level.limit_price) * fill;
    remaining -= fill;
  }
  return reserve;
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
