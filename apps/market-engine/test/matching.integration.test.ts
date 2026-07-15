import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer, type Server } from "node:net";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { createServer as createPgServer } from "pglite-server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchOrder } from "../src/matching.js";
import { submitLeverageCloseOrder } from "@market-dominion/database";

const clearinghouseId = "00000000-0000-4000-8000-000000000020";

describe("persistent matching settlement", () => {
  let embedded: PGlite;
  let server: Server;
  let pool: Pool;

  beforeAll(async () => {
    process.env.POSITIVE_PNL_TAX_BPS = "0";
    embedded = new PGlite();
    await embedded.waitReady;
    const sql = await loadMigrations();
    await embedded.exec(sql);
    server = createPgServer(embedded) as unknown as Server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("PGlite test server address unavailable");
    pool = new Pool({ host: "127.0.0.1", port: address.port, user: "postgres", database: "postgres", max: 1 });
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await embedded?.close();
  });

  test("atomically settles cash, reservations, holdings, trade, candle and outbox", async () => {
    const ids = await seedOrderPair(pool);

    const result = await matchOrder(pool, ids.buyOrderId, ids.stockId);

    expect(result).toEqual({ orderId: ids.buyOrderId, trades: 1, status: "filled" });
    const users = await pool.query<{ id: string; cash: string; reserved_cash: string }>("SELECT id, cash, reserved_cash FROM users WHERE id IN ($1, $2) ORDER BY id", [ids.buyerId, ids.sellerId]);
    expect(users.rows).toEqual([
      { id: ids.buyerId, cash: "640", reserved_cash: "0" },
      { id: ids.sellerId, cash: "1360", reserved_cash: "0" },
    ]);
    const holdings = await pool.query<{ user_id: string; quantity: string; reserved_quantity: string; cost_basis: string; realized_pnl: string }>(
      "SELECT user_id, quantity, reserved_quantity, cost_basis, realized_pnl FROM holdings ORDER BY user_id",
    );
    expect(holdings.rows).toEqual([
      { user_id: ids.buyerId, quantity: "4", reserved_quantity: "0", cost_basis: "360", realized_pnl: "0" },
      { user_id: ids.sellerId, quantity: "6", reserved_quantity: "0", cost_basis: "480", realized_pnl: "40" },
    ]);
    expect((await pool.query("SELECT 1 FROM trades")).rowCount).toBe(1);
    expect((await pool.query("SELECT close, volume FROM candles")).rows).toEqual([{ close: "90", volume: "4" }]);
    expect((await pool.query("SELECT event_type, payload->>'price' AS price FROM outbox_events")).rows).toEqual([{ event_type: "trade.executed", price: "90" }]);
  });

  test("rejects incoming self trade and releases only its reservation", async () => {
    const buyerId = "00000000-0000-4000-8000-000000000001";
    const stockId = "00000000-0000-4000-8000-000000000005";
    await pool.query("UPDATE users SET reserved_cash = 100 WHERE id = $1", [buyerId]);
    await pool.query("UPDATE holdings SET reserved_quantity = 1 WHERE user_id = $1 AND stock_id = $2", [buyerId, stockId]);
    const sell = await pool.query<{ id: string }>(
      "INSERT INTO orders (user_id, stock_id, idempotency_key, side, type, status, limit_price, quantity) VALUES ($1, $2, gen_random_uuid(), 'sell', 'limit', 'open', 90, 1) RETURNING id",
      [buyerId, stockId],
    );
    const buy = await pool.query<{ id: string }>(
      "INSERT INTO orders (user_id, stock_id, idempotency_key, side, type, status, limit_price, quantity, reserved_amount) VALUES ($1, $2, gen_random_uuid(), 'buy', 'limit', 'pending', 100, 1, 100) RETURNING id",
      [buyerId, stockId],
    );
    if (!sell.rows[0] || !buy.rows[0]) throw new Error("Self-trade seed failed");

    const result = await matchOrder(pool, buy.rows[0].id, stockId);

    expect(result).toEqual({ orderId: buy.rows[0].id, trades: 0, status: "rejected" });
    expect((await pool.query("SELECT status, rejected_reason FROM orders WHERE id = $1", [buy.rows[0].id])).rows[0]).toEqual({ status: "rejected", rejected_reason: "SELF_TRADE_PREVENTION" });
    expect((await pool.query("SELECT status FROM orders WHERE id = $1", [sell.rows[0].id])).rows[0]).toEqual({ status: "open" });
    expect((await pool.query("SELECT reserved_cash FROM users WHERE id = $1", [buyerId])).rows[0]).toEqual({ reserved_cash: "0" });
    expect((await pool.query("SELECT reserved_quantity FROM holdings WHERE user_id = $1 AND stock_id = $2", [buyerId, stockId])).rows[0]).toEqual({ reserved_quantity: "1" });
  });

  test("market order walks current book and cancels unfilled remainder", async () => {
    const ids = await seedMarketOrder(pool);

    const result = await matchOrder(pool, ids.buyOrderId, ids.stockId);

    expect(result).toEqual({ orderId: ids.buyOrderId, trades: 1, status: "cancelled" });
    expect((await pool.query("SELECT status, filled_quantity, reserved_amount FROM orders WHERE id = $1", [ids.buyOrderId])).rows[0]).toEqual({ status: "cancelled", filled_quantity: "2", reserved_amount: "0" });
    expect((await pool.query("SELECT cash, reserved_cash FROM users WHERE id = $1", [ids.buyerId])).rows[0]).toEqual({ cash: "820", reserved_cash: "0" });
  });

  test("stop-limit stays pending before trigger then activates and fills", async () => {
    const ids = await seedStopOrder(pool);

    expect(await matchOrder(pool, ids.buyOrderId, ids.stockId)).toEqual({ orderId: ids.buyOrderId, trades: 0, status: "pending" });
    await pool.query("UPDATE stocks SET current_price = 110 WHERE id = $1", [ids.stockId]);
    const result = await matchOrder(pool, ids.buyOrderId, ids.stockId);

    expect(result).toEqual({ orderId: ids.buyOrderId, trades: 1, status: "filled" });
    expect((await pool.query("SELECT type, status, filled_quantity FROM orders WHERE id = $1", [ids.buyOrderId])).rows[0]).toEqual({ type: "limit", status: "filled", filled_quantity: "1" });
    expect((await pool.query("SELECT cash, reserved_cash FROM users WHERE id = $1", [ids.buyerId])).rows[0]).toEqual({ cash: "900", reserved_cash: "0" });
  });

  test("forced long liquidation submits a real sell order and settles actual fill", async () => {
    const ids = await seedLongLiquidation(pool);
    await pool.query("INSERT INTO system_settings(key,value) VALUES('spot_fee_bps',jsonb_build_object('value',100))");
    const close = await submitLeverageCloseOrder(pool, ids.positionId, "liquidation");

    const result = await matchOrder(pool, close.orderId, close.stockId);

    expect(result).toEqual({ orderId: close.orderId, trades: 1, status: "filled" });
    expect((await pool.query("SELECT status FROM leverage_positions WHERE id = $1", [ids.positionId])).rows[0]).toEqual({ status: "liquidated" });
    expect((await pool.query("SELECT cash FROM users WHERE id = $1", [ids.userId])).rows[0]).toEqual({ cash: "200" });
    expect((await pool.query("SELECT COALESCE(quantity, 0)::bigint AS quantity FROM holdings WHERE user_id = $1 AND stock_id = $2", [clearinghouseId, ids.stockId])).rows[0]).toEqual({ quantity: "0" });
    expect((await pool.query("SELECT buyer_fee,seller_fee,seller_tax FROM trades WHERE sell_order_id=$1", [close.orderId])).rows[0]).toEqual({ buyer_fee: "0", seller_fee: "0", seller_tax: "0" });
    await pool.query("DELETE FROM system_settings WHERE key='spot_fee_bps'");
  });

  test("short close buys through asks, returns borrow and pays actual-price PnL", async () => {
    const ids = await seedShortClose(pool);
    const close = await submitLeverageCloseOrder(pool, ids.positionId, "manual");

    const result = await matchOrder(pool, close.orderId, close.stockId);

    expect(result).toEqual({ orderId: close.orderId, trades: 1, status: "filled" });
    expect((await pool.query("SELECT status FROM leverage_positions WHERE id = $1", [ids.positionId])).rows[0]).toEqual({ status: "closed" });
    expect((await pool.query("SELECT cash FROM users WHERE id = $1", [ids.userId])).rows[0]).toEqual({ cash: "60" });
    expect((await pool.query("SELECT borrowed_quantity FROM borrow_pools WHERE stock_id = $1", [ids.stockId])).rows[0]).toEqual({ borrowed_quantity: "0" });
  });

  test("settles configured fees and positive-PnL tax into the finite exchange treasury",async()=>{
    const buyer="00000000-0000-4000-8000-000000000030",seller="00000000-0000-4000-8000-000000000031",treasury="00000000-0000-4000-8000-000000000032",stock="00000000-0000-4000-8000-000000000033";
    process.env.POSITIVE_PNL_TAX_BPS="1000";
    await pool.query("INSERT INTO system_settings(key,value) VALUES('spot_fee_bps',jsonb_build_object('value',100))");
    await pool.query("INSERT INTO users(id,email,username,nickname,password_hash,cash,reserved_cash) VALUES($1,'fee-buyer@example.com','fee_buyer','수수료매수','hash',1010,1010),($2,'fee-seller@example.com','fee_seller','수수료매도','hash',0,0),($3,'treasury@system.invalid','treasury_test','거래소금고','!',0,0)",[buyer,seller,treasury]);
    await pool.query("INSERT INTO system_accounts(key,user_id,description) VALUES('exchange_treasury',$1,'test')",[treasury]);
    await pool.query("INSERT INTO stocks(id,company_id,symbol,total_shares,free_float_shares,current_price,previous_close,reference_price) VALUES($1,'00000000-0000-4000-8000-000000000004','FEE',100,100,100,100,100)",[stock]);
    await pool.query("INSERT INTO holdings(user_id,stock_id,quantity,reserved_quantity,cost_basis) VALUES($1,$2,10,10,500)",[seller,stock]);
    const ask=await pool.query<{id:string}>("INSERT INTO orders(user_id,stock_id,idempotency_key,side,type,status,limit_price,quantity) VALUES($1,$2,gen_random_uuid(),'sell','limit','open',100,10) RETURNING id",[seller,stock]);
    const bid=await pool.query<{id:string}>("INSERT INTO orders(user_id,stock_id,idempotency_key,side,type,status,quantity,reserved_amount) VALUES($1,$2,gen_random_uuid(),'buy','market','pending',10,1010) RETURNING id",[buyer,stock]);
    expect(ask.rows[0]).toBeDefined();
    await matchOrder(pool,bid.rows[0]!.id,stock);
    expect((await pool.query("SELECT cash FROM users WHERE id=$1",[buyer])).rows[0]).toEqual({cash:"0"});
    expect((await pool.query("SELECT cash FROM users WHERE id=$1",[seller])).rows[0]).toEqual({cash:"941"});
    expect((await pool.query("SELECT cash FROM users WHERE id=$1",[treasury])).rows[0]).toEqual({cash:"69"});
    expect((await pool.query("SELECT buyer_fee,seller_fee,seller_tax FROM trades WHERE buyer_user_id=$1",[buyer])).rows[0]).toEqual({buyer_fee:"10",seller_fee:"10",seller_tax:"49"});
  });
});

async function seedOrderPair(pool: Pool) {
  const buyerId = "00000000-0000-4000-8000-000000000001";
  const sellerId = "00000000-0000-4000-8000-000000000002";
  const sectorId = "00000000-0000-4000-8000-000000000003";
  const companyId = "00000000-0000-4000-8000-000000000004";
  const stockId = "00000000-0000-4000-8000-000000000005";
  await pool.query("INSERT INTO sectors (id, slug, name) VALUES ($1, 'test', '테스트')", [sectorId]);
  await pool.query("INSERT INTO companies (id, sector_id, name, status) VALUES ($1, $2, '테스트 기업', 'listed')", [companyId, sectorId]);
  await pool.query(
    "INSERT INTO stocks (id, company_id, symbol, total_shares, free_float_shares, current_price, previous_close, reference_price) VALUES ($1, $2, 'TST', 100, 100, 80, 80, 80)",
    [stockId, companyId],
  );
  await pool.query("INSERT INTO users (id, email, username, nickname, password_hash, cash, is_system) VALUES ($1, 'clearinghouse@system.invalid', 'test_clearinghouse', '테스트 청산소', '!', 100000, true)", [clearinghouseId]);
  await pool.query("INSERT INTO system_accounts (key, user_id, description) VALUES ('derivatives_clearinghouse', $1, 'test')", [clearinghouseId]);
  await pool.query(
    `INSERT INTO users (id, email, username, nickname, password_hash, cash, reserved_cash)
     VALUES ($1, 'buyer@example.com', 'buyer', '구매자', 'hash', 1000, 400),
            ($2, 'seller@example.com', 'seller', '판매자', 'hash', 1000, 0)`,
    [buyerId, sellerId],
  );
  await pool.query("INSERT INTO holdings (user_id, stock_id, quantity, reserved_quantity, cost_basis) VALUES ($1, $2, 10, 4, 800)", [sellerId, stockId]);
  const sell = await pool.query<{ id: string }>(
    "INSERT INTO orders (user_id, stock_id, idempotency_key, side, type, status, limit_price, quantity) VALUES ($1, $2, gen_random_uuid(), 'sell', 'limit', 'open', 90, 4) RETURNING id",
    [sellerId, stockId],
  );
  const buy = await pool.query<{ id: string }>(
    "INSERT INTO orders (user_id, stock_id, idempotency_key, side, type, status, limit_price, quantity, reserved_amount) VALUES ($1, $2, gen_random_uuid(), 'buy', 'limit', 'pending', 100, 4, 400) RETURNING id",
    [buyerId, stockId],
  );
  if (!sell.rows[0] || !buy.rows[0]) throw new Error("Order seed failed");
  return { buyerId, sellerId, stockId, sellOrderId: sell.rows[0].id, buyOrderId: buy.rows[0].id };
}

async function seedLongLiquidation(pool: Pool) {
  const userId = "00000000-0000-4000-8000-000000000021";
  const bidderId = "00000000-0000-4000-8000-000000000022";
  const stockId = "00000000-0000-4000-8000-000000000008";
  const positionId = "00000000-0000-4000-8000-000000000023";
  const companyId = "00000000-0000-4000-8000-000000000004";
  await pool.query("INSERT INTO stocks (id, company_id, symbol, total_shares, free_float_shares, current_price, previous_close, reference_price) VALUES ($1, $2, 'LQD', 100, 100, 80, 100, 100)", [stockId, companyId]);
  await pool.query(
    `INSERT INTO users (id, email, username, nickname, password_hash, cash, reserved_cash)
     VALUES ($1, 'liquidated@example.com', 'liquidated_user', '청산대상', 'hash', 0, 0),
            ($2, 'liq-bidder@example.com', 'liq_bidder', '청산매수자', 'hash', 1000, 400)`,
    [userId, bidderId],
  );
  await pool.query("INSERT INTO orders (user_id, stock_id, idempotency_key, side, type, status, limit_price, quantity, reserved_amount) VALUES ($1, $2, gen_random_uuid(), 'buy', 'limit', 'open', 100, 4, 400)", [bidderId, stockId]);
  await pool.query(
    `INSERT INTO leverage_positions (id, user_id, stock_id, side, leverage, quantity, margin, position_size, entry_price, liquidation_price)
     VALUES ($1, $2, $3, 'long', 2, 4, 200, 400, 100, 52)`,
    [positionId, userId, stockId],
  );
  return { userId, bidderId, stockId, positionId };
}

async function seedShortClose(pool: Pool) {
  const userId = "00000000-0000-4000-8000-000000000024";
  const sellerId = "00000000-0000-4000-8000-000000000025";
  const stockId = "00000000-0000-4000-8000-000000000009";
  const positionId = "00000000-0000-4000-8000-000000000026";
  const companyId = "00000000-0000-4000-8000-000000000004";
  await pool.query("INSERT INTO stocks (id, company_id, symbol, total_shares, free_float_shares, current_price, previous_close, reference_price) VALUES ($1, $2, 'SQC', 100, 100, 120, 100, 100)", [stockId, companyId]);
  await pool.query(
    `INSERT INTO users (id, email, username, nickname, password_hash, cash)
     VALUES ($1, 'short-user@example.com', 'short_user', '공매도사용자', 'hash', 0),
            ($2, 'cover-seller@example.com', 'cover_seller', '커버매도자', 'hash', 0)`,
    [userId, sellerId],
  );
  await pool.query("INSERT INTO holdings (user_id, stock_id, quantity, reserved_quantity, cost_basis) VALUES ($1, $2, 2, 2, 200)", [sellerId, stockId]);
  await pool.query("INSERT INTO orders (user_id, stock_id, idempotency_key, side, type, status, limit_price, quantity) VALUES ($1, $2, gen_random_uuid(), 'sell', 'limit', 'open', 120, 2)", [sellerId, stockId]);
  await pool.query("INSERT INTO borrow_pools (stock_id, borrowable_quantity, borrowed_quantity) VALUES ($1, 20, 2)", [stockId]);
  await pool.query(
    `INSERT INTO leverage_positions (id, user_id, stock_id, side, leverage, quantity, margin, position_size, entry_price, liquidation_price, last_borrow_fee_at)
     VALUES ($1, $2, $3, 'short', 2, 2, 100, 200, 100, 147, now())`,
    [positionId, userId, stockId],
  );
  return { userId, sellerId, stockId, positionId };
}

async function seedMarketOrder(pool: Pool) {
  const buyerId = "00000000-0000-4000-8000-000000000010";
  const sellerId = "00000000-0000-4000-8000-000000000011";
  const stockId = "00000000-0000-4000-8000-000000000006";
  const companyId = "00000000-0000-4000-8000-000000000004";
  await pool.query("INSERT INTO stocks (id, company_id, symbol, total_shares, free_float_shares, current_price, previous_close, reference_price) VALUES ($1, $2, 'MKT', 100, 100, 80, 80, 80)", [stockId, companyId]);
  await pool.query(
    `INSERT INTO users (id, email, username, nickname, password_hash, cash, reserved_cash)
     VALUES ($1, 'market-buyer@example.com', 'market_buyer', '시장매수', 'hash', 1000, 180),
            ($2, 'market-seller@example.com', 'market_seller', '시장매도', 'hash', 0, 0)`,
    [buyerId, sellerId],
  );
  await pool.query("INSERT INTO holdings (user_id, stock_id, quantity, reserved_quantity, cost_basis) VALUES ($1, $2, 2, 2, 100)", [sellerId, stockId]);
  await pool.query("INSERT INTO orders (user_id, stock_id, idempotency_key, side, type, status, limit_price, quantity) VALUES ($1, $2, gen_random_uuid(), 'sell', 'limit', 'open', 90, 2)", [sellerId, stockId]);
  const buy = await pool.query<{ id: string }>(
    "INSERT INTO orders (user_id, stock_id, idempotency_key, side, type, time_in_force, status, quantity, reserved_amount) VALUES ($1, $2, gen_random_uuid(), 'buy', 'market', 'IOC', 'pending', 5, 180) RETURNING id",
    [buyerId, stockId],
  );
  if (!buy.rows[0]) throw new Error("Market order seed failed");
  return { buyerId, sellerId, stockId, buyOrderId: buy.rows[0].id };
}

async function seedStopOrder(pool: Pool) {
  const buyerId = "00000000-0000-4000-8000-000000000012";
  const sellerId = "00000000-0000-4000-8000-000000000013";
  const stockId = "00000000-0000-4000-8000-000000000007";
  const companyId = "00000000-0000-4000-8000-000000000004";
  await pool.query("INSERT INTO stocks (id, company_id, symbol, total_shares, free_float_shares, current_price, previous_close, reference_price, tick_size) VALUES ($1, $2, 'STP', 100, 100, 100, 100, 100, 10)", [stockId, companyId]);
  await pool.query(
    `INSERT INTO users (id, email, username, nickname, password_hash, cash, reserved_cash)
     VALUES ($1, 'stop-buyer@example.com', 'stop_buyer', '스톱매수', 'hash', 1000, 120),
            ($2, 'stop-seller@example.com', 'stop_seller', '스톱매도', 'hash', 0, 0)`,
    [buyerId, sellerId],
  );
  await pool.query("INSERT INTO holdings (user_id, stock_id, quantity, reserved_quantity, cost_basis) VALUES ($1, $2, 1, 1, 80)", [sellerId, stockId]);
  await pool.query("INSERT INTO orders (user_id, stock_id, idempotency_key, side, type, status, limit_price, quantity) VALUES ($1, $2, gen_random_uuid(), 'sell', 'limit', 'open', 100, 1)", [sellerId, stockId]);
  const buy = await pool.query<{ id: string }>(
    "INSERT INTO orders (user_id, stock_id, idempotency_key, side, type, time_in_force, status, limit_price, stop_price, quantity, reserved_amount) VALUES ($1, $2, gen_random_uuid(), 'buy', 'stop', 'GTC', 'pending', 120, 110, 1, 120) RETURNING id",
    [buyerId, stockId],
  );
  if (!buy.rows[0]) throw new Error("Stop order seed failed");
  return { buyerId, sellerId, stockId, buyOrderId: buy.rows[0].id };
}

async function loadMigrations(): Promise<string> {
  const directory = fileURLToPath(new URL("../../../packages/database/drizzle/", import.meta.url));
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  return (await Promise.all(files.map((name) => readFile(join(directory, name), "utf8")))).join("\n").replaceAll("--> statement-breakpoint", "");
}
