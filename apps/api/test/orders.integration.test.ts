import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Server } from "node:net";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { createServer as createPgServer } from "pglite-server";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { DatabaseService } from "../src/database.service.js";
import { OrderService, type OrderQueue } from "../src/orders.js";
import { MarketService } from "../src/markets.js";
import { PortfolioService } from "../src/portfolio.js";
import { LeverageService } from "../src/leverage.js";
import { CompanyService } from "../src/companies.js";
import { MnaService } from "../src/mna.js";
import { StrategyService } from "../src/strategies.js";
import { AdminService } from "../src/admin.js";
import { AuthService } from "../src/auth.js";
import bcrypt from "bcryptjs";
import { IpoService } from "../src/ipo.js";
import { resolveMnaCampaign } from "@market-dominion/database";

const userId = "10000000-0000-4000-8000-000000000001";
const stockId = "10000000-0000-4000-8000-000000000005";

describe("OrderService persistence", () => {
  let embedded: PGlite;
  let server: Server;
  let database: DatabaseService;
  const queued: Array<{ orderId: string; stockId: string }> = [];
  const queue = { enqueue: async (orderId: string, stockId: string) => { queued.push({ orderId, stockId }); } } as OrderQueue;
  beforeAll(async () => {
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
    process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${address.port}/postgres`;
    database = new DatabaseService();
    await seed(database);
  }, 30_000);

  afterAll(async () => {
    await database?.onModuleDestroy();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await embedded?.close();
  });

  test("same idempotency key creates one buy order and reserves cash once", async () => {
    const service = new OrderService(database, queue);
    const input = { symbol: "API", idempotencyKey: "20000000-0000-4000-8000-000000000001", side: "buy", type: "limit", limitPrice: "100", quantity: "2" };

    const first = await service.submit(userId, input);
    const second = await service.submit(userId, input);

    expect(second.id).toBe(first.id);
    expect((await database.pool.query("SELECT count(*)::int AS count FROM orders")).rows[0]).toEqual({ count: 1 });
    expect((await database.pool.query("SELECT cash, reserved_cash FROM users WHERE id = $1", [userId])).rows[0]).toEqual({ cash: "1000", reserved_cash: "200" });
    expect(queued.map((item) => item.orderId)).toEqual([first.id, first.id]);
  });

  test("cancel returns buy cash reservation exactly once", async () => {
    const service = new OrderService(database, queue);
    const order = (await database.pool.query<{ id: string }>("SELECT id FROM orders WHERE user_id = $1", [userId])).rows[0];
    if (!order) throw new Error("Buy order missing");

    const cancelled = await service.cancel(userId, order.id);

    expect(cancelled.status).toBe("cancelled");
    expect((await database.pool.query("SELECT reserved_cash FROM users WHERE id = $1", [userId])).rows[0]).toEqual({ reserved_cash: "0" });
  });

  test("sell submit and cancel reserve then return holdings", async () => {
    const service = new OrderService(database, queue);
    const submitted = await service.submit(userId, {
      symbol: "API",
      idempotencyKey: "20000000-0000-4000-8000-000000000002",
      side: "sell",
      type: "limit",
      limitPrice: "110",
      quantity: "4",
    });
    expect((await database.pool.query("SELECT quantity, reserved_quantity FROM holdings WHERE user_id = $1 AND stock_id = $2", [userId, stockId])).rows[0]).toEqual({ quantity: "10", reserved_quantity: "4" });

    await service.cancel(userId, submitted.id);

    expect((await database.pool.query("SELECT quantity, reserved_quantity FROM holdings WHERE user_id = $1 AND stock_id = $2", [userId, stockId])).rows[0]).toEqual({ quantity: "10", reserved_quantity: "0" });
  });

  test("market buy reserves only currently visible ask liquidity and uses IOC", async () => {
    const makerId = "10000000-0000-4000-8000-000000000006";
    await database.pool.query("INSERT INTO users (id, email, username, nickname, password_hash, cash) VALUES ($1, 'maker@example.com', 'maker', '메이커', 'hash', 0)", [makerId]);
    await database.pool.query("INSERT INTO holdings (user_id, stock_id, quantity, cost_basis) VALUES ($1, $2, 3, 300)", [makerId, stockId]);
    const service = new OrderService(database, queue);
    await service.submit(makerId, {
      symbol: "API",
      idempotencyKey: "20000000-0000-4000-8000-000000000003",
      side: "sell",
      type: "limit",
      limitPrice: "120",
      quantity: "3",
    });

    const market = await service.submit(userId, {
      symbol: "API",
      idempotencyKey: "20000000-0000-4000-8000-000000000004",
      side: "buy",
      type: "market",
      quantity: "5",
    });

    expect(market.timeInForce).toBe("IOC");
    expect((await database.pool.query("SELECT reserved_amount FROM orders WHERE id = $1", [market.id])).rows[0]).toEqual({ reserved_amount: "360" });
    expect((await database.pool.query("SELECT reserved_cash FROM users WHERE id = $1", [userId])).rows[0]).toEqual({ reserved_cash: "360" });
  });

  test("aggregates visible order book and multi-minute candles", async () => {
    const markets = new MarketService(database);
    const book = await markets.orderBook("API", 20);
    expect(book.asks).toEqual([{ price: "120", quantity: "3", orderCount: 1 }]);
    expect(book.bids).toEqual([]);

    await database.pool.query(
      `INSERT INTO candles (stock_id, interval, opened_at, open, high, low, close, volume)
       VALUES ($1, '1m', '2026-07-12T10:00:00Z', 100, 110, 90, 105, 4),
              ($1, '1m', '2026-07-12T10:01:00Z', 105, 120, 95, 115, 6)`,
      [stockId],
    );
    const candles = await markets.candles("API", "5m", 10);
    expect(candles.items).toHaveLength(1);
    expect(candles.items[0]).toMatchObject({ open: "100", high: "120", low: "90", close: "115", volume: "10" });
  });

  test("portfolio valuation walks external bid depth instead of quantity times current price", async () => {
    const bidderId = "10000000-0000-4000-8000-000000000007";
    await database.pool.query("INSERT INTO users (id, email, username, nickname, password_hash, cash, reserved_cash) VALUES ($1, 'bidder@example.com', 'bidder', '입찰자', 'hash', 1000, 670)", [bidderId]);
    await database.pool.query(
      `INSERT INTO orders (user_id, stock_id, idempotency_key, side, type, status, limit_price, quantity, reserved_amount)
       VALUES ($1, $2, gen_random_uuid(), 'buy', 'limit', 'open', 100, 4, 400),
              ($1, $2, gen_random_uuid(), 'buy', 'limit', 'open', 90, 3, 270)`,
      [bidderId, stockId],
    );

    const portfolio = await new PortfolioService(database).get(userId);

    expect(portfolio.holdings[0]?.liquidation).toMatchObject({ filledQuantity: "7", unfilledQuantity: "3", grossProceeds: "670", estimatedTax: "2", netProceeds: "668" });
    expect(portfolio.spotNetLiquidationValue).toBe("668");
    expect(portfolio.totalEvaluatedAsset).toBe("1668");
  });

  test("merges same leverage bucket and settles margin on close", async () => {
    const leverage = new LeverageService(database, queue);
    const first = await leverage.open(userId, { symbol: "API", side: "long", leverage: 2, margin: "100" });
    const merged = await leverage.open(userId, { symbol: "API", side: "long", leverage: 2, margin: "100" });
    expect(merged.id).toBe(first.id);
    expect(merged.quantity).toBe("4");
    expect(merged.margin).toBe("200");

    const closing = await leverage.close(userId, merged.id);
    expect(closing.status).toBe("closing");
    expect((await database.pool.query("SELECT status, close_order_id FROM leverage_positions WHERE id = $1", [merged.id])).rows[0]).toMatchObject({ status: "closing", close_order_id: closing.orderId });
    expect((await database.pool.query("SELECT purpose, side, type FROM orders WHERE id = $1", [closing.orderId])).rows[0]).toEqual({ purpose: "leverage_close", side: "sell", type: "market" });
  });

  test("short position borrows and returns finite pool quantity", async () => {
    const leverage = new LeverageService(database, queue);
    const position = await leverage.open(userId, { symbol: "API", side: "short", leverage: 2, margin: "100" });
    expect((await database.pool.query("SELECT borrowed_quantity FROM borrow_pools WHERE stock_id = $1", [stockId])).rows[0]).toEqual({ borrowed_quantity: "2" });

    const closing = await leverage.close(userId, position.id);

    expect(closing.status).toBe("closing");
    expect((await database.pool.query("SELECT borrowed_quantity FROM borrow_pools WHERE stock_id = $1", [stockId])).rows[0]).toEqual({ borrowed_quantity: "2" });
    expect((await database.pool.query("SELECT purpose, side, type FROM orders WHERE id = $1", [closing.orderId])).rows[0]).toEqual({ purpose: "leverage_close", side: "buy", type: "market" });
  });

  test("management action changes fundamentals and fair value but not current price", async () => {
    const company = await database.pool.query<{ id: string }>("SELECT company_id AS id FROM stocks WHERE id = $1", [stockId]);
    const companyId = company.rows[0]?.id;
    if (!companyId) throw new Error("Company missing");
    await database.pool.query("UPDATE companies SET cash = 1000, revenue = 1000, net_profit = 50, book_value = 500, controlled_by_user_id = $2 WHERE id = $1", [companyId, userId]);
    const service = new CompanyService(database);
    const input = { idempotencyKey: "20000000-0000-4000-8000-000000000010", actionType: "invest_rd", amount: "100" };

    const first = await service.execute(userId, companyId, input);
    const repeated = await service.execute(userId, companyId, input);

    expect(first.currentPriceUnchanged).toBe("100");
    expect(first.state.cash).toBe("900");
    expect(Number(first.state.technologyScore)).toBeGreaterThan(50);
    expect(repeated).toEqual(first);
    expect((await database.pool.query("SELECT current_price, reference_price FROM stocks WHERE id = $1", [stockId])).rows[0]).toMatchObject({ current_price: "100" });
    expect((await database.pool.query("SELECT count(*)::int AS count FROM management_actions WHERE company_id = $1", [companyId])).rows[0]).toEqual({ count: 1 });
  });

  test("hostile M&A reserves assets, pays cash, transfers shares and control", async () => {
    const defenderId = "10000000-0000-4000-8000-000000000020";
    const tendererId = "10000000-0000-4000-8000-000000000021";
    const companyId = (await database.pool.query<{ id: string }>("SELECT company_id AS id FROM stocks WHERE id = $1", [stockId])).rows[0]?.id;
    if (!companyId) throw new Error("Company missing");
    await database.pool.query("UPDATE users SET cash = 10000 WHERE id = $1", [userId]);
    await database.pool.query("UPDATE holdings SET quantity = 25, cost_basis = 2500 WHERE user_id = $1 AND stock_id = $2", [userId, stockId]);
    await database.pool.query(
      `INSERT INTO users (id, email, username, nickname, password_hash, cash)
       VALUES ($1, 'defender@example.com', 'defender', '방어자', 'hash', 5000),
              ($2, 'tenderer@example.com', 'tenderer', '공개매도자', 'hash', 0)`,
      [defenderId, tendererId],
    );
    await database.pool.query("INSERT INTO holdings (user_id, stock_id, quantity, cost_basis) VALUES ($1, $3, 20, 2000), ($2, $3, 30, 3000)", [defenderId, tendererId, stockId]);
    await database.pool.query("UPDATE companies SET controlled_by_user_id = $2, controlled_at = now() WHERE id = $1", [companyId, defenderId]);
    const service = new MnaService(database, new PortfolioService(database));
    const campaign = await service.create(userId, {
      companyId,
      idempotencyKey: "20000000-0000-4000-8000-000000000020",
      offerPrice: "110",
      committedCash: "4000",
      tenderDurationMinutes: 10,
      proxyDurationMinutes: 10,
    });
    await service.tender(tendererId, campaign.id, { quantity: "30" });
    await service.action(defenderId, campaign.id, {
      idempotencyKey: "20000000-0000-4000-8000-000000000021",
      side: "defender",
      actionType: "poison_pill",
    });

    const result = await resolveMnaCampaign(database.pool, campaign.id);

    expect(result.success).toBe(true);
    expect((await database.pool.query("SELECT controlled_by_user_id FROM companies WHERE id = $1", [companyId])).rows[0]).toEqual({ controlled_by_user_id: userId });
    expect((await database.pool.query("SELECT quantity FROM holdings WHERE user_id = $1 AND stock_id = $2", [userId, stockId])).rows[0]).toEqual({ quantity: "55" });
    expect((await database.pool.query("SELECT cash FROM users WHERE id = $1", [tendererId])).rows[0]).toEqual({ cash: "3300" });
    expect((await database.pool.query("SELECT cash, reserved_cash FROM users WHERE id = $1", [userId])).rows[0]).toEqual({ cash: "6700", reserved_cash: "360" });
  });

  test("strategy requires backtest, paper stage, and explicit live confirmation", async () => {
    const service = new StrategyService(database);
    const strategy = await service.create(userId, {
      name: "다음 봉 체결 전략",
      stockId,
      interval: "1m",
      definition: {
        version: 1,
        when: { mode: "all", conditions: [{ left: { kind: "indicator", indicator: "current_price" }, operator: "gt", right: { kind: "constant", value: "0" } }] },
        then: { type: "buy", sizing: "percent_available_cash", valueBps: 10_000 },
      },
      safety: {
        initialCash: "1000", feeBps: 0, slippageBps: 0, maxOrderAmount: "1000", maxHoldingBps: 10_000,
        dailyMaxLossBps: 10_000, cooldownBars: 0,
      },
    });

    await expect(service.transition(userId, strategy.id, { status: "PAPER" })).rejects.toThrow("백테스트");
    const run = await service.backtest(userId, strategy.id, {});
    expect(run.candle_count).toBe(2);
    expect(run.result.equityCurve).toHaveLength(2);
    expect((await service.transition(userId, strategy.id, { status: "PAPER" })).status).toBe("PAPER");
    await expect(service.transition(userId, strategy.id, { status: "LIVE_VIRTUAL" })).rejects.toThrow("명시적으로 확인");
    expect((await service.transition(userId, strategy.id, { status: "LIVE_VIRTUAL", confirmLiveVirtual: true })).status).toBe("LIVE_VIRTUAL");
  });

  test("records login attempts and revokes a refresh family on reuse", async () => {
    const authUserId = "10000000-0000-4000-8000-000000000030";
    const hash = await bcrypt.hash("correct-password-123", 12);
    await database.pool.query("INSERT INTO users (id,email,username,nickname,password_hash,cash) VALUES ($1,'auth@example.com','auth_user','auth',$2,1000)", [authUserId, hash]);
    process.env.JWT_SECRET = "integration-test-secret-at-least-32-characters";
    const auth = new AuthService(database);

    await expect(auth.login({ email: "auth@example.com", password: "wrong-password-123" }, { ipAddress: "127.0.0.1" })).rejects.toThrow();
    const login = await auth.login({ email: "auth@example.com", password: "correct-password-123" }, { ipAddress: "127.0.0.1" });
    await auth.rotate({ refreshToken: login.refreshToken });
    await expect(auth.rotate({ refreshToken: login.refreshToken })).rejects.toThrow("재사용");

    expect((await database.pool.query("SELECT count(*)::int count FROM login_events WHERE user_id=$1", [authUserId])).rows[0]).toEqual({ count: 2 });
    expect((await database.pool.query("SELECT severity FROM security_events WHERE user_id=$1 AND event_type='refresh_token_reuse'", [authUserId])).rows[0]).toEqual({ severity: "critical" });
    expect((await database.pool.query("SELECT count(*)::int count FROM refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL", [authUserId])).rows[0]).toEqual({ count: 0 });
  });

  test("admin asset and stock changes are transactional and audited", async () => {
    const adminId = "10000000-0000-4000-8000-000000000031";
    await database.pool.query("INSERT INTO users (id,email,username,nickname,password_hash,role,cash) VALUES ($1,'admin@example.com','admin_user','admin','hash','admin',1000)", [adminId]);
    const service = new AdminService(database);
    const before = BigInt((await database.pool.query("SELECT cash FROM users WHERE id=$1", [userId])).rows[0].cash);
    const adjusted = await service.adjustAsset(adminId, userId, { delta: "100", reason: "통합 테스트 조정" });
    const companyId = (await database.pool.query("SELECT company_id FROM stocks WHERE id=$1", [stockId])).rows[0].company_id;
    const created = await service.createStock(adminId, { companyId, symbol: "ADM", totalShares: "1000", freeFloatShares: "800", currentPrice: "50", tickSize: "1" });
    await service.halt(adminId, created.id, { halted: true, reason: "통합 테스트 거래정지" });

    expect(BigInt(adjusted.cash)).toBe(before + 100n);
    expect((await database.pool.query("SELECT is_trading_halted FROM stocks WHERE id=$1", [created.id])).rows[0]).toEqual({ is_trading_halted: true });
    expect((await database.pool.query("SELECT count(*)::int count FROM audit_logs WHERE actor_user_id=$1 AND action LIKE 'admin.%'", [adminId])).rows[0]).toEqual({ count: 3 });
  });

  test("IPO subscription reserves finite user cash", async () => {
    const adminId = "10000000-0000-4000-8000-000000000031";
    const companyId = "10000000-0000-4000-8000-000000000032";
    const sectorId = "10000000-0000-4000-8000-000000000003";
    await database.pool.query("INSERT INTO companies(id,sector_id,name,status) VALUES($1,$2,'IPO 기업','private')", [companyId, sectorId]);
    const service = new IpoService(database);
    const campaign = await service.create(adminId, { companyId, symbol: "IPOX", description: "통합 테스트 공모 기업 설명입니다.", offerPrice: "10", totalShares: "1000", offeredShares: "500", subscriptionStartsAt: "2026-07-13T00:00:00.000Z", subscriptionEndsAt: "2026-07-14T00:00:00.000Z", listingAt: "2026-07-15T00:00:00.000Z" });
    await database.pool.query("UPDATE ipo_campaigns SET status='subscription',subscription_starts_at=now()-interval '1 minute',subscription_ends_at=now()+interval '1 hour' WHERE id=$1", [campaign.id]);
    const before = BigInt((await database.pool.query("SELECT reserved_cash FROM users WHERE id=$1", [userId])).rows[0].reserved_cash);

    const subscription = await service.subscribe(userId, { campaignId: campaign.id, quantity: "5" });

    expect(subscription.reserved_amount).toBe("50");
    expect(BigInt((await database.pool.query("SELECT reserved_cash FROM users WHERE id=$1", [userId])).rows[0].reserved_cash)).toBe(before + 50n);
  });
});

async function seed(database: DatabaseService): Promise<void> {
  const sectorId = "10000000-0000-4000-8000-000000000003";
  const companyId = "10000000-0000-4000-8000-000000000004";
  await database.pool.query("INSERT INTO sectors (id, slug, name) VALUES ($1, 'api', 'API')", [sectorId]);
  await database.pool.query("INSERT INTO companies (id, sector_id, name, status) VALUES ($1, $2, 'API 기업', 'listed')", [companyId, sectorId]);
  await database.pool.query(
    "INSERT INTO stocks (id, company_id, symbol, total_shares, free_float_shares, current_price, previous_close, reference_price, tick_size) VALUES ($1, $2, 'API', 100, 100, 100, 100, 100, 10)",
    [stockId, companyId],
  );
  await database.pool.query(
    "INSERT INTO users (id, email, username, nickname, password_hash, cash) VALUES ($1, 'api@example.com', 'api_user', 'API 사용자', 'hash', 1000)",
    [userId],
  );
  await database.pool.query("INSERT INTO holdings (user_id, stock_id, quantity, cost_basis) VALUES ($1, $2, 10, 900)", [userId, stockId]);
  await database.pool.query("INSERT INTO borrow_pools (stock_id, borrowable_quantity) VALUES ($1, 20)", [stockId]);
  const clearinghouseId = "10000000-0000-4000-8000-000000000008";
  await database.pool.query("INSERT INTO users (id, email, username, nickname, password_hash, cash, is_system) VALUES ($1, 'clearing@system.invalid', 'clearinghouse', '청산소', '!', 100000, true)", [clearinghouseId]);
  await database.pool.query("INSERT INTO system_accounts (key, user_id, description) VALUES ('derivatives_clearinghouse', $1, 'test')", [clearinghouseId]);
}

async function loadMigrations(): Promise<string> {
  const directory = fileURLToPath(new URL("../../../packages/database/drizzle/", import.meta.url));
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  return (await Promise.all(files.map((name) => readFile(join(directory, name), "utf8")))).join("\n").replaceAll("--> statement-breakpoint", "");
}
