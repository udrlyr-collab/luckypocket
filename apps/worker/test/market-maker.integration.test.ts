import { readdir, readFile } from "node:fs/promises";
import type { Server } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { createServer as createPgServer } from "pglite-server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pruneExpiredMarketMakerQuotes, refreshMarketMaker } from "../src/market-maker.js";
import { accrueShortBorrowFees, evaluateShortSqueezes, submitLiquidationOrders } from "../src/risk.js";
import { refreshMarketState } from "../src/market-state.js";
import { evaluateStrategy, runStrategyCycle } from "../src/strategies.js";
import { runValuationCycle } from "../src/valuation.js";
import { runIpoCycle } from "../src/ipo.js";
import { runListingReviewCycle } from "../src/listing.js";
import { payDueDividends, publishDueReports } from "../src/corporate.js";

describe("finite market maker", () => {
  let embedded: PGlite;
  let server: Server;
  let pool: Pool;
  const makerId = "30000000-0000-4000-8000-000000000001";
  const userId = "30000000-0000-4000-8000-000000000002";
  const stockId = "30000000-0000-4000-8000-000000000003";

  beforeAll(async () => {
    embedded = new PGlite();
    await embedded.waitReady;
    await embedded.exec(await loadMigrations());
    server = createPgServer(embedded) as unknown as Server;
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("PGlite server unavailable");
    pool = new Pool({ host: "127.0.0.1", port: address.port, user: "postgres", database: "postgres", max: 1 });
    await seed(pool, { makerId, userId, stockId });
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await embedded?.close();
  });

  test("refreshes finite bid/ask depth without reservation leakage", async () => {
    await pool.query("INSERT INTO system_settings(key,value) VALUES('spot_fee_bps',jsonb_build_object('value',100))");
    const first = await refreshMarketMaker(pool, makerId);
    expect(first).toHaveLength(4);
    const firstState = (await pool.query("SELECT reserved_cash FROM users WHERE id = $1", [userId])).rows[0];
    const quotedReserve = (await pool.query("SELECT sum(reserved_amount)::bigint AS total FROM orders WHERE user_id=$1 AND side='buy' AND status='open'", [userId])).rows[0];
    expect(firstState).toEqual({ reserved_cash: quotedReserve.total });
    const firstHolding = (await pool.query("SELECT reserved_quantity FROM holdings WHERE user_id = $1 AND stock_id = $2", [userId, stockId])).rows[0];
    expect(BigInt(firstHolding.reserved_quantity)).toBeGreaterThan(0n);

    await pool.query("UPDATE market_makers SET last_refreshed_at = NULL WHERE id = $1", [makerId]);
    const second = await refreshMarketMaker(pool, makerId);
    expect(second).toHaveLength(4);
    expect((await pool.query("SELECT reserved_cash FROM users WHERE id = $1", [userId])).rows[0]).toEqual(firstState);
    expect((await pool.query("SELECT reserved_quantity FROM holdings WHERE user_id = $1 AND stock_id = $2", [userId, stockId])).rows[0]).toEqual(firstHolding);
    expect((await pool.query("SELECT count(*)::int AS count FROM orders WHERE status = 'open'")).rows[0]).toEqual({ count: 4 });
    expect((await pool.query("SELECT count(*)::int AS count FROM orders WHERE status = 'cancelled'")).rows[0]).toEqual({ count: 4 });
    await pool.query("UPDATE orders SET updated_at=now()-interval '10 minutes' WHERE status='cancelled'");
    expect(await pruneExpiredMarketMakerQuotes(pool)).toBe(4);
    expect((await pool.query("SELECT count(*)::int AS count FROM orders WHERE status = 'cancelled'")).rows[0]).toEqual({ count: 0 });
    await pool.query("DELETE FROM system_settings WHERE key='spot_fee_bps'");
  });

  test("overpriced stock creates more ask than bid quantity", async () => {
    await pool.query("UPDATE stocks SET current_price = 150 WHERE id = $1", [stockId]);
    await pool.query("UPDATE market_makers SET last_refreshed_at = NULL WHERE id = $1", [makerId]);
    await refreshMarketMaker(pool, makerId);
    const totals = await pool.query<{ side: "buy" | "sell"; quantity: string }>(
      "SELECT side, sum(quantity)::bigint AS quantity FROM orders WHERE status = 'open' GROUP BY side ORDER BY side",
    );
    const buy = BigInt(totals.rows.find((row) => row.side === "buy")?.quantity ?? 0);
    const sell = BigInt(totals.rows.find((row) => row.side === "sell")?.quantity ?? 0);
    expect(sell).toBeGreaterThan(buy);
  });

  test("accrues utilization-based borrow fee by elapsed time", async () => {
    const positionId = "30000000-0000-4000-8000-000000000006";
    const shortUserId = "30000000-0000-4000-8000-000000000007";
    await pool.query("INSERT INTO users (id, email, username, nickname, password_hash, cash) VALUES ($1, 'fee-short@example.com', 'fee_short', '대차료테스트', 'hash', 0)", [shortUserId]);
    await pool.query("INSERT INTO borrow_pools (stock_id, borrowable_quantity, borrowed_quantity, base_borrow_fee_bps, max_borrow_fee_bps) VALUES ($1, 100, 50, 100, 5000)", [stockId]);
    await pool.query(
      `INSERT INTO leverage_positions
         (id, user_id, stock_id, side, leverage, quantity, margin, position_size, entry_price, liquidation_price, last_borrow_fee_at)
       VALUES ($1, $2, $3, 'short', 2, 10, 2000, 10000, 100, 147, '2025-01-01T00:00:00Z')`,
      [positionId, shortUserId, stockId],
    );

    const result = await accrueShortBorrowFees(pool, new Date("2026-01-01T00:00:00Z"));

    expect(result).toEqual({ positions: 1, totalFee: 1325n });
    expect((await pool.query("SELECT accrued_borrow_fee FROM leverage_positions WHERE id = $1", [positionId])).rows[0]).toEqual({ accrued_borrow_fee: "1325" });
  });

  test("submits liquidation as actual market order", async () => {
    const riskStockId = "30000000-0000-4000-8000-000000000008";
    const riskUserId = "30000000-0000-4000-8000-000000000009";
    const bidderId = "30000000-0000-4000-8000-000000000010";
    const positionId = "30000000-0000-4000-8000-000000000011";
    const companyId = "30000000-0000-4000-8000-000000000005";
    await pool.query("INSERT INTO stocks (id, company_id, symbol, total_shares, free_float_shares, current_price, previous_close, reference_price) VALUES ($1, $2, 'RSK', 100, 100, 50, 100, 100)", [riskStockId, companyId]);
    await pool.query(
      `INSERT INTO users (id, email, username, nickname, password_hash, cash, reserved_cash)
       VALUES ($1, 'risk@example.com', 'risk_user', '위험사용자', 'hash', 0, 0),
              ($2, 'risk-bidder@example.com', 'risk_bidder', '위험매수자', 'hash', 1000, 500)`,
      [riskUserId, bidderId],
    );
    await pool.query("INSERT INTO orders (user_id, stock_id, idempotency_key, side, type, status, limit_price, quantity, reserved_amount) VALUES ($1, $2, gen_random_uuid(), 'buy', 'limit', 'open', 50, 10, 500)", [bidderId, riskStockId]);
    await pool.query(
      "INSERT INTO leverage_positions (id, user_id, stock_id, side, leverage, quantity, margin, position_size, entry_price, liquidation_price) VALUES ($1, $2, $3, 'long', 5, 10, 100, 1000, 100, 81)",
      [positionId, riskUserId, riskStockId],
    );

    const orders = await submitLiquidationOrders(pool);

    expect(orders).toHaveLength(1);
    expect((await pool.query("SELECT purpose, side, type FROM orders WHERE id = $1", [orders[0]?.orderId])).rows[0]).toEqual({ purpose: "liquidation", side: "sell", type: "market" });
    expect((await pool.query("SELECT status FROM leverage_positions WHERE id = $1", [positionId])).rows[0]).toEqual({ status: "closing" });
  });

  test("starts and ends squeeze only from combined market evidence", async () => {
    const ids = await seedSqueezeEvidence(pool);
    const started = await evaluateShortSqueezes(pool, new Date("2026-07-13T00:00:00Z"));
    expect(started).toEqual({ started: 1, ended: 0 });
    expect((await pool.query("SELECT status FROM short_squeeze_events WHERE stock_id = $1", [ids.stockId])).rows[0]).toEqual({ status: "active" });

    const ended = await evaluateShortSqueezes(pool, new Date("2026-07-13T00:16:00Z"));
    expect(ended).toEqual({ started: 0, ended: 1 });
    expect((await pool.query("SELECT status FROM short_squeeze_events WHERE stock_id = $1", [ids.stockId])).rows[0]).toEqual({ status: "ended" });
  });

  test("derives market regime and sector strength from actual prices", async () => {
    await pool.query("UPDATE stocks SET previous_close = 100, current_price = 110");
    const bull = await refreshMarketState(pool);
    expect(bull.regime).toBe("strong_bull");
    expect(bull.changed).toBe(true);
    expect((await pool.query("SELECT count(*)::int AS count FROM sector_states")).rows[0]?.count).toBeGreaterThan(0);

    await pool.query("UPDATE stocks SET current_price = 80");
    const fear = await refreshMarketState(pool);
    expect(fear.regime).toBe("fear");
    expect(fear.changed).toBe(true);
  });

  test("executes PAPER strategy on next candle open in a separate ledger", async () => {
    const strategyId = "30000000-0000-4000-8000-000000000030";
    await seedStrategyCandles(pool, stockId);
    await pool.query(
      `INSERT INTO strategies (id,user_id,stock_id,name,interval,status,definition,safety,paper_initial_cash,paper_cash)
       VALUES ($1,$2,$3,'paper','1m','PAPER',$4::jsonb,$5::jsonb,1000,1000)`,
      [strategyId, userId, stockId, JSON.stringify(alwaysBuyDefinition()), JSON.stringify(strategySafety())],
    );

    const result = await evaluateStrategy(pool, strategyId);

    expect(result?.traded).toBe(true);
    expect((await pool.query("SELECT paper_cash,paper_quantity FROM strategies WHERE id=$1", [strategyId])).rows[0]).toEqual({ paper_cash: "0", paper_quantity: "10" });
    expect((await pool.query("SELECT mode,status,execution_price FROM strategy_executions WHERE strategy_id=$1", [strategyId])).rows[0]).toEqual({ mode: "PAPER", status: "filled", execution_price: "100" });
    expect((await pool.query("SELECT cash FROM users WHERE id=$1", [userId])).rows[0]).toEqual({ cash: "10000" });
  });

  test("submits LIVE_VIRTUAL through the normal market order and recovery queue path", async () => {
    const strategyId = "30000000-0000-4000-8000-000000000031";
    const liveUserId = "30000000-0000-4000-8000-000000000032";
    await pool.query("INSERT INTO users (id,email,username,nickname,password_hash,cash) VALUES ($1,'strategy@example.com','strategy_live','strategy','hash',1000)", [liveUserId]);
    await pool.query(
      `INSERT INTO strategies (id,user_id,stock_id,name,interval,status,definition,safety,live_confirmed_at)
       VALUES ($1,$2,$3,'live','1m','LIVE_VIRTUAL',$4::jsonb,$5::jsonb,now())`,
      [strategyId, liveUserId, stockId, JSON.stringify(alwaysBuyDefinition()), JSON.stringify(strategySafety())],
    );

    const result = await evaluateStrategy(pool, strategyId);
    expect(result?.orderId).toBeDefined();
    expect((await pool.query("SELECT side,type,purpose,time_in_force,status FROM orders WHERE id=$1", [result?.orderId])).rows[0]).toEqual({ side: "buy", type: "market", purpose: "spot", time_in_force: "IOC", status: "pending" });
    const queued: unknown[] = [];
    const cycle = await runStrategyCycle(pool, { add: async (_name, data) => { queued.push(data); } });
    expect(cycle.queued).toBeGreaterThanOrEqual(1);
    expect(queued).toContainEqual({ orderId: result?.orderId, stockId });
  });

  test("ETF valuation uses prior completed snapshot and excludes ETF holdings from its underlying", async () => {
    const etfStockId = "30000000-0000-4000-8000-000000000033";
    const trackedUserId = "30000000-0000-4000-8000-000000000034";
    const companyId = "30000000-0000-4000-8000-000000000005";
    await pool.query("INSERT INTO users (id,email,username,nickname,password_hash,cash) VALUES ($1,'tracked@example.com','tracked_user','tracked','hash',10000)", [trackedUserId]);
    await pool.query("INSERT INTO holdings (user_id,stock_id,quantity,cost_basis) VALUES ($1,$2,10,800)", [trackedUserId, stockId]);
    const prior = await pool.query<{ id: string }>("INSERT INTO valuation_cycles (status,completed_at) VALUES ('completed',now()-interval '1 minute') RETURNING id");
    await pool.query("INSERT INTO user_valuation_snapshots (cycle_id,user_id,cash,eligible_asset_value,total_asset_value) VALUES ($1,$2,10000,20000,20000)", [prior.rows[0]!.id, trackedUserId]);
    await pool.query("INSERT INTO stocks (id,company_id,symbol,total_shares,free_float_shares,current_price,previous_close,reference_price,asset_type) VALUES ($1,$2,'UETF',100,100,500,500,500,'user_etf')", [etfStockId, companyId]);
    await pool.query("INSERT INTO holdings (user_id,stock_id,quantity,cost_basis) VALUES ($1,$2,2,1000)", [trackedUserId, etfStockId]);
    await pool.query("INSERT INTO etf_products (stock_id,tracked_user_id,base_eligible_asset_value,base_price) VALUES ($1,$2,10000,100)", [etfStockId, trackedUserId]);

    const cycle = await runValuationCycle(pool);

    expect(cycle.sourceCycleId).toBe(prior.rows[0]!.id);
    expect((await pool.query("SELECT source_cycle_id,source_eligible_asset_value,calculated_price FROM etf_valuations WHERE cycle_id=$1", [cycle.cycleId])).rows[0]).toEqual({ source_cycle_id: prior.rows[0]!.id, source_eligible_asset_value: "20000", calculated_price: "200" });
    const snapshot = (await pool.query("SELECT eligible_asset_value,total_asset_value FROM user_valuation_snapshots WHERE cycle_id=$1 AND user_id=$2", [cycle.cycleId, trackedUserId])).rows[0];
    expect(BigInt(snapshot.total_asset_value) - BigInt(snapshot.eligible_asset_value)).toBe(1_000n);
    expect((await pool.query("SELECT current_price,reference_price FROM stocks WHERE id=$1", [etfStockId])).rows[0]).toEqual({ current_price: "500", reference_price: "200" });
  });

  test("allocates finite IPO shares then opens order-book price discovery", async () => {
    const companyId = "30000000-0000-4000-8000-000000000040";
    const campaignId = "30000000-0000-4000-8000-000000000041";
    const firstUser = "30000000-0000-4000-8000-000000000042";
    const secondUser = "30000000-0000-4000-8000-000000000043";
    const sectorId = "30000000-0000-4000-8000-000000000004";
    await pool.query("INSERT INTO companies(id,sector_id,name,status) VALUES($1,$2,'공모 기업','private')", [companyId, sectorId]);
    await pool.query("INSERT INTO users(id,email,username,nickname,password_hash,cash,reserved_cash) VALUES($1,'ipo1@example.com','ipo_one','ipo1','hash',1000,800),($2,'ipo2@example.com','ipo_two','ipo2','hash',1000,800)", [firstUser, secondUser]);
    await pool.query(`INSERT INTO ipo_campaigns(id,company_id,symbol,description,offer_price,total_shares,offered_shares,subscription_starts_at,subscription_ends_at,listing_at,created_by_user_id) VALUES($1,$2,'IPOW','worker IPO',10,1000,100,'2026-07-13T00:00:00Z','2026-07-13T01:00:00Z','2026-07-13T02:00:00Z',$3)`, [campaignId, companyId, userId]);
    expect(await runIpoCycle(pool, new Date("2026-07-13T00:00:00Z"))).toMatchObject({ opened: 1 });
    await pool.query("INSERT INTO ipo_subscriptions(campaign_id,user_id,requested_quantity,reserved_amount) VALUES($1,$2,80,800),($1,$3,80,800)", [campaignId, firstUser, secondUser]);

    expect(await runIpoCycle(pool, new Date("2026-07-13T01:00:00Z"))).toMatchObject({ allocated: 1 });
    const allocations = await pool.query("SELECT allocated_quantity FROM ipo_subscriptions WHERE campaign_id=$1 ORDER BY user_id", [campaignId]);
    expect(allocations.rows).toEqual([{ allocated_quantity: "50" }, { allocated_quantity: "50" }]);
    expect((await pool.query("SELECT is_trading_halted,listing_status FROM stocks WHERE symbol='IPOW'")).rows[0]).toEqual({ is_trading_halted: true, listing_status: "halted" });
    expect(await runIpoCycle(pool, new Date("2026-07-13T02:00:00Z"))).toMatchObject({ listed: 1 });
    expect((await pool.query("SELECT is_trading_halted,listing_status FROM stocks WHERE symbol='IPOW'")).rows[0]).toEqual({ is_trading_halted: false, listing_status: "normal" });
  });

  test("shows recovery deadlines and delists only after two failed review periods", async () => {
    const companyId="30000000-0000-4000-8000-000000000050",reviewStockId="30000000-0000-4000-8000-000000000051",sectorId="30000000-0000-4000-8000-000000000004";
    await pool.query("INSERT INTO companies(id,sector_id,name,status) VALUES($1,$2,'부실 심사 기업','listed')",[companyId,sectorId]);
    await pool.query("INSERT INTO stocks(id,company_id,symbol,total_shares,free_float_shares,current_price,previous_close,reference_price) VALUES($1,$2,'FAIL',100,100,10,10,10)",[reviewStockId,companyId]);
    await pool.query("INSERT INTO financial_reports(company_id,period_key,revenue,operating_profit,net_profit,cash,debt,book_value,published_at) VALUES($1,'Q1',10,-10,-10,0,100,10,'2026-01-01'),($1,'Q2',10,-10,-10,0,100,10,'2026-04-01')",[companyId]);
    expect(await runListingReviewCycle(pool,new Date("2026-07-01T00:00:00Z"))).toMatchObject({review:1});
    expect((await pool.query("SELECT listing_status,is_trading_halted FROM stocks WHERE id=$1",[reviewStockId])).rows[0]).toEqual({listing_status:"distress_review",is_trading_halted:false});
    await runListingReviewCycle(pool,new Date("2026-07-09T00:00:00Z"));
    expect((await pool.query("SELECT listing_status,is_trading_halted FROM stocks WHERE id=$1",[reviewStockId])).rows[0]).toEqual({listing_status:"delisting_review",is_trading_halted:true});
    expect(await runListingReviewCycle(pool,new Date("2026-07-17T00:00:00Z"))).toMatchObject({delisted:1});
    expect((await pool.query("SELECT listing_status,listing_status_reason FROM stocks WHERE id=$1",[reviewStockId])).rows[0].listing_status).toBe("delisted");
  });

  test("pays dividends from finite company cash using record-date holdings",async()=>{
    const companyId="30000000-0000-4000-8000-000000000005",recipientId="30000000-0000-4000-8000-000000000060";
    await pool.query("INSERT INTO users(id,email,username,nickname,password_hash,cash) VALUES($1,'dividend@example.com','dividend_user','배당주주','hash',0)",[recipientId]);
    await pool.query("INSERT INTO holdings(user_id,stock_id,quantity,cost_basis) VALUES($1,$2,10,1000)",[recipientId,stockId]);
    await pool.query("UPDATE companies SET cash=100000,debt=0,revenue=100000,operating_profit=50000,net_profit=40000,book_value=100000,dividend_rate_bps=10000 WHERE id=$1",[companyId]);
    const now=new Date("2026-08-01T00:00:00Z");
    await publishDueReports(pool,now,0,0);
    const entitlement=(await pool.query("SELECT amount,distribution_id FROM dividend_entitlements WHERE user_id=$1",[recipientId])).rows[0];
    expect(entitlement).toBeDefined();
    const companyCash=BigInt((await pool.query("SELECT cash FROM companies WHERE id=$1",[companyId])).rows[0].cash);
    expect(await payDueDividends(pool,now)).toMatchObject({paid:1});
    expect((await pool.query("SELECT cash FROM users WHERE id=$1",[recipientId])).rows[0]).toEqual({cash:entitlement.amount});
    const total=BigInt((await pool.query("SELECT total_amount FROM dividend_distributions WHERE id=$1",[entitlement.distribution_id])).rows[0].total_amount);
    expect(BigInt((await pool.query("SELECT cash FROM companies WHERE id=$1",[companyId])).rows[0].cash)).toBe(companyCash-total);
  });
});

async function seedStrategyCandles(pool: Pool, stockId: string) {
  await pool.query(
    `INSERT INTO candles (stock_id,interval,opened_at,open,high,low,close,volume)
     VALUES ($1,'1m','2026-07-13T01:00:00Z',90,100,90,100,10),($1,'1m','2026-07-13T01:01:00Z',100,100,100,100,10)
     ON CONFLICT DO NOTHING`, [stockId],
  );
}
function alwaysBuyDefinition() { return { version: 1, when: { mode: "all", conditions: [{ left: { kind: "indicator", indicator: "current_price" }, operator: "gt", right: { kind: "constant", value: "0" } }] }, then: { type: "buy", sizing: "percent_available_cash", valueBps: 10_000 } }; }
function strategySafety() { return { initialCash: "1000", feeBps: 0, slippageBps: 0, maxOrderAmount: "1000", maxHoldingBps: 10_000, dailyMaxLossBps: 10_000, cooldownBars: 0 }; }

async function seed(pool: Pool, ids: { makerId: string; userId: string; stockId: string }): Promise<void> {
  const sectorId = "30000000-0000-4000-8000-000000000004";
  const companyId = "30000000-0000-4000-8000-000000000005";
  await pool.query("INSERT INTO sectors (id, slug, name) VALUES ($1, 'mm', '시장조성')", [sectorId]);
  await pool.query("INSERT INTO companies (id, sector_id, name, status) VALUES ($1, $2, '시장조성 기업', 'listed')", [companyId, sectorId]);
  await pool.query("INSERT INTO stocks (id, company_id, symbol, total_shares, free_float_shares, current_price, previous_close, reference_price, tick_size) VALUES ($1, $2, 'MMK', 1000, 1000, 100, 100, 100, 10)", [ids.stockId, companyId]);
  await pool.query("INSERT INTO users (id, email, username, nickname, password_hash, cash, is_system) VALUES ($1, 'mm@system.invalid', 'mm_test', '시장조성자', '!', 10000, true)", [ids.userId]);
  await pool.query("INSERT INTO holdings (user_id, stock_id, quantity, cost_basis) VALUES ($1, $2, 100, 10000)", [ids.userId, ids.stockId]);
  await pool.query(
    `INSERT INTO market_makers
       (id, user_id, stock_id, cash_balance, inventory, target_inventory, max_inventory, base_spread_bps, order_depth, refresh_interval_ms, risk_aversion_bps)
     VALUES ($1, $2, $3, 10000, 100, 100, 200, 100, 2, 10000, 100)`,
    [ids.makerId, ids.userId, ids.stockId],
  );
  const clearinghouseId = "30000000-0000-4000-8000-000000000012";
  await pool.query("INSERT INTO users (id, email, username, nickname, password_hash, cash, is_system) VALUES ($1, 'worker-clearing@system.invalid', 'worker_clearing', '워커청산소', '!', 100000, true)", [clearinghouseId]);
  await pool.query("INSERT INTO system_accounts (key, user_id, description) VALUES ('derivatives_clearinghouse', $1, 'test')", [clearinghouseId]);
}

async function seedSqueezeEvidence(pool: Pool) {
  const stockId = "30000000-0000-4000-8000-000000000013";
  const buyerId = "30000000-0000-4000-8000-000000000014";
  const sellerId = "30000000-0000-4000-8000-000000000015";
  const shortUserId = "30000000-0000-4000-8000-000000000016";
  const positionId = "30000000-0000-4000-8000-000000000017";
  const companyId = "30000000-0000-4000-8000-000000000005";
  await pool.query("INSERT INTO stocks (id, company_id, symbol, total_shares, free_float_shares, current_price, previous_close, reference_price) VALUES ($1, $2, 'SQZ', 1000, 1000, 110, 100, 100)", [stockId, companyId]);
  await pool.query(
    `INSERT INTO users (id, email, username, nickname, password_hash, cash, reserved_cash)
     VALUES ($1, 'sqz-buyer@example.com', 'sqz_buyer', '스퀴즈매수', 'hash', 10000, 0),
            ($2, 'sqz-seller@example.com', 'sqz_seller', '스퀴즈매도', 'hash', 10000, 0),
            ($3, 'sqz-short@example.com', 'sqz_short', '스퀴즈숏', 'hash', 0, 0)`,
    [buyerId, sellerId, shortUserId],
  );
  await pool.query("INSERT INTO borrow_pools (stock_id, borrowable_quantity, borrowed_quantity) VALUES ($1, 100, 80)", [stockId]);
  await pool.query("INSERT INTO holdings (user_id, stock_id, quantity, reserved_quantity, cost_basis) VALUES ($1, $2, 25, 5, 2500)", [sellerId, stockId]);
  const buyOrder = await pool.query<{ id: string }>("INSERT INTO orders (user_id, stock_id, idempotency_key, side, type, status, limit_price, quantity) VALUES ($1, $2, gen_random_uuid(), 'buy', 'limit', 'filled', 110, 20) RETURNING id", [buyerId, stockId]);
  const sellOrder = await pool.query<{ id: string }>("INSERT INTO orders (user_id, stock_id, idempotency_key, side, type, status, limit_price, quantity) VALUES ($1, $2, gen_random_uuid(), 'sell', 'limit', 'filled', 110, 20) RETURNING id", [sellerId, stockId]);
  await pool.query("INSERT INTO orders (user_id, stock_id, idempotency_key, side, type, status, limit_price, quantity) VALUES ($1, $2, gen_random_uuid(), 'sell', 'limit', 'open', 115, 5)", [sellerId, stockId]);
  if (!buyOrder.rows[0] || !sellOrder.rows[0]) throw new Error("Squeeze orders missing");
  await pool.query(
    `INSERT INTO trades (stock_id, buy_order_id, sell_order_id, buyer_user_id, seller_user_id, taker_side, price, quantity, created_at)
     VALUES ($1, $2, $3, $4, $5, 'buy', 110, 20, '2026-07-12T23:59:00Z')`,
    [stockId, buyOrder.rows[0].id, sellOrder.rows[0].id, buyerId, sellerId],
  );
  await pool.query(
    "INSERT INTO leverage_positions (id, user_id, stock_id, side, leverage, quantity, margin, position_size, entry_price, liquidation_price, status, closed_at) VALUES ($1, $2, $3, 'short', 5, 1, 20, 100, 100, 119, 'liquidated', '2026-07-12T23:59:00Z')",
    [positionId, shortUserId, stockId],
  );
  await pool.query("INSERT INTO leverage_events (position_id, event_type, price, quantity, created_at) VALUES ($1, 'liquidation', 110, 1, '2026-07-12T23:59:00Z')", [positionId]);
  return { stockId };
}

async function loadMigrations(): Promise<string> {
  const directory = fileURLToPath(new URL("../../../packages/database/drizzle/", import.meta.url));
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  return (await Promise.all(files.map((name) => readFile(join(directory, name), "utf8")))).join("\n").replaceAll("--> statement-breakpoint", "");
}
