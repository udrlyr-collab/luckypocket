import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { formatMoney } from "../src/utils/format.js";
import { RISK_STAGES } from "../server/services/gameMath.js";
import {
  getAdjustedMultiplier,
  HIGH_BET_MIN_RTP,
  MIN_RTP,
  THRESHOLD,
} from "../server/services/riskPayoutService.js";
import {
  BLUE_CHIP_DAILY_MAX_GAIN,
  BLUE_CHIP_DAILY_MAX_LOSS,
  BLUE_CHIP_TICK_MAX_GAIN,
  BLUE_CHIP_TICK_MAX_LOSS,
  calculateBlueChipDailyLimits,
  enforceStockMarketLimit,
  getMarketCapPolicyState,
  minimumSharesForTradableMarketCap,
  requiredCompanyAcquisitionBalance,
  shouldDelistOwnerEtf,
  STOCK_TICK_INTERVAL_SECONDS,
  STOCK_MARKET_POLICY,
  STOCK_GENERATION_TIERS,
  IPO_GENERATION_TIERS,
} from "../server/services/stockService.js";
import { calculateUserTotalEvaluatedAsset } from "../server/services/portfolioValuationService.js";
import {
  applyLuckTicketPayout,
  getDailyLuckTicketStatus,
  prepareLuckTicket,
  RTP_POLICY,
} from "../server/services/economyRtpService.js";
import {
  assertCanApplyBankruptcy,
  assertCanTransferAfterBankruptcy,
  getBankruptcyStatus,
} from "../server/services/bankruptcyService.js";

test("money is displayed with Korean large-number units", () => {
  assert.equal(formatMoney(140_100_000_000), "1,401억원");
  assert.equal(formatMoney(140_123_450_000), "1,401억 2,345만원");
  assert.match(formatMoney(1.63e242), /무량대수원$/);
  assert.ok(formatMoney(1.63e242).length < 40);
});

test("high risk-button bets taper below 100% RTP without decreasing payouts", () => {
  const stage = RISK_STAGES[4];
  const bets = [THRESHOLD, THRESHOLD * 10, THRESHOLD * 100];
  const payouts = bets.map((betAmount) => {
    const multiplier = getAdjustedMultiplier({
      betAmount,
      baseMultiplier: stage.multiplier,
      cumulativeProbability: stage.cumulativeChance,
    });
    const rtp = stage.cumulativeChance * multiplier;
    assert.ok(rtp >= HIGH_BET_MIN_RTP);
    assert.ok(rtp < 1);
    return Math.floor(betAmount * multiplier);
  });
  assert.ok(payouts[1] > payouts[0]);
  assert.ok(payouts[2] > payouts[1]);
  assert.equal(MIN_RTP, HIGH_BET_MIN_RTP);
});

test("daily recovery and luck ticket policies use the configured caps", () => {
  assert.equal(RTP_POLICY.dailyLossback.minimumNetLoss, 1_000_000);
  assert.equal(RTP_POLICY.dailyLossback.rate, 0.05);
  assert.equal(RTP_POLICY.dailyLossback.maximumAmount, 200_000);
  assert.equal(RTP_POLICY.dailyLuckTickets.count, 3);
  assert.equal(RTP_POLICY.dailyLuckTickets.maxBetAmount, 100_000);
  assert.equal(RTP_POLICY.dailyLuckTickets.rtpBoost, 0.03);

  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE asset_events (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
  const status = getDailyLuckTicketStatus(database, 1);
  assert.equal(status.remaining, 3);
  const ticket = prepareLuckTicket(database, {
    userId: 1,
    bet: 100_000,
    useLuckTicket: true,
  });
  const boosted = applyLuckTicketPayout(1_000_000, ticket);
  assert.equal(boosted.payout, 1_030_000);
  assert.equal(boosted.luckTicket.payoutBoostAmount, 30_000);
  assert.throws(() =>
    prepareLuckTicket(database, {
      userId: 1,
      bet: 100_001,
      useLuckTicket: true,
    }),
  );
  database.close();
});

test("stock policy caps ordinary and IPO tick volatility", () => {
  assert.equal(STOCK_MARKET_POLICY.maxActiveStocks, 16);
  assert.equal(STOCK_MARKET_POLICY.targetActiveTradableStockCount, 16);
  assert.equal(STOCK_MARKET_POLICY.companyAcquisitionBalanceMultiplier, 5);
  assert.equal(STOCK_MARKET_POLICY.minimumMarketCap, 5_000_000_000);
  assert.equal(STOCK_MARKET_POLICY.marketCapWarningThreshold, 6_000_000_000);
  assert.equal(STOCK_MARKET_POLICY.finalCrashMarketCap, 1_000_000_000);
  assert.equal(STOCK_MARKET_POLICY.cautionRequiredTicks, 3);
  assert.equal(STOCK_MARKET_POLICY.recoveryRequiredTicks, 6);
  assert.equal(STOCK_MARKET_POLICY.delistReviewMaxTicks, 180);
  assert.ok(STOCK_MARKET_POLICY.regularMaxTickVolatility <= 0.015);
  assert.equal(STOCK_MARKET_POLICY.bluechipMaxTickVolatility, BLUE_CHIP_TICK_MAX_GAIN);
  assert.ok(STOCK_MARKET_POLICY.bluechipMaxTickVolatility < 0.00002);
  assert.ok(STOCK_MARKET_POLICY.ipoMaxVolatility <= 0.025);
  assert.equal(STOCK_MARKET_POLICY.ownerEtfDelistPriceRatio, 0.15);
});

test("stock generation tiers use the low market-cap game scale", () => {
  assert.deepEqual(
    STOCK_GENERATION_TIERS.map((tier) => [tier.key, tier.min, tier.max, tier.weight]),
    [
      ["micro", 6_200_000_000, 9_500_000_000, 38],
      ["small", 9_500_000_000, 18_000_000_000, 30],
      ["small_mid", 18_000_000_000, 50_000_000_000, 18],
      ["mid", 50_000_000_000, 150_000_000_000, 9],
      ["large", 150_000_000_000, 500_000_000_000, 4],
      ["mega", 500_000_000_000, 2_000_000_000_000, 1],
    ],
  );
  assert.deepEqual(
    IPO_GENERATION_TIERS.map((tier) => [tier.key, tier.min, tier.max, tier.weight]),
    [
      ["ipo_micro", 6_000_000_000, 8_500_000_000, 48],
      ["ipo_small", 8_500_000_000, 16_000_000_000, 32],
      ["ipo_small_mid", 16_000_000_000, 35_000_000_000, 14],
      ["ipo_mid", 35_000_000_000, 90_000_000_000, 5],
      ["ipo_large_rare", 90_000_000_000, 300_000_000_000, 1],
    ],
  );
});

test("blue chip tick limits are derived from 24-hour daily caps", () => {
  const ticksPerDay = (24 * 60 * 60) / STOCK_TICK_INTERVAL_SECONDS;
  assert.equal(STOCK_TICK_INTERVAL_SECONDS, 10);
  assert.equal(ticksPerDay, 8640);
  assert.equal(BLUE_CHIP_DAILY_MAX_GAIN, 0.15);
  assert.equal(BLUE_CHIP_DAILY_MAX_LOSS, -0.13);
  assert.equal(
    BLUE_CHIP_TICK_MAX_GAIN,
    Math.pow(1 + BLUE_CHIP_DAILY_MAX_GAIN, 1 / ticksPerDay) - 1,
  );
  assert.equal(
    BLUE_CHIP_TICK_MAX_LOSS,
    Math.pow(1 + BLUE_CHIP_DAILY_MAX_LOSS, 1 / ticksPerDay) - 1,
  );
  assert.ok(BLUE_CHIP_TICK_MAX_GAIN > 0);
  assert.ok(BLUE_CHIP_TICK_MAX_GAIN < 0.00002);
  assert.ok(BLUE_CHIP_TICK_MAX_LOSS < 0);
  assert.ok(BLUE_CHIP_TICK_MAX_LOSS > -0.00002);

  const limits = calculateBlueChipDailyLimits(473_445);
  assert.equal(limits.openPrice, 473_445);
  assert.equal(limits.highLimitPrice, Math.floor(473_445 * 1.15));
  assert.equal(limits.lowLimitPrice, Math.floor(473_445 * 0.87));
});

test("company acquisition required balance is five times the acquisition cost", () => {
  assert.equal(requiredCompanyAcquisitionBalance(100_000_000), 500_000_000);
  assert.equal(requiredCompanyAcquisitionBalance(1), 5);
  assert.equal(requiredCompanyAcquisitionBalance(-1), Number.POSITIVE_INFINITY);
});

test("market capitalization policy uses final-crash, review, caution, and normal bands", () => {
  assert.equal(getMarketCapPolicyState(999_999_999), "final_crash");
  assert.equal(getMarketCapPolicyState(1_000_000_000), "delist_review");
  assert.equal(getMarketCapPolicyState(4_999_999_999), "delist_review");
  assert.equal(getMarketCapPolicyState(5_000_000_000), "caution");
  assert.equal(getMarketCapPolicyState(5_999_999_999), "caution");
  assert.equal(getMarketCapPolicyState(6_000_000_000), "normal");

  const shares = minimumSharesForTradableMarketCap(1_234);
  assert.ok(shares * 1_234 >= STOCK_MARKET_POLICY.marketCapWarningThreshold);
});

test("owner ETF delists at an 85% or greater decline from its acquisition price", () => {
  assert.equal(shouldDelistOwnerEtf(1000, 151), false);
  assert.equal(shouldDelistOwnerEtf(1000, 150), true);
  assert.equal(shouldDelistOwnerEtf(1000, 149), true);
  assert.equal(shouldDelistOwnerEtf(0, 0), false);
});

test("buying stock does not change evaluated total assets at the same price", () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, balance REAL NOT NULL);
    CREATE TABLE stocks (
      id INTEGER PRIMARY KEY,
      current_price REAL NOT NULL,
      status TEXT NOT NULL,
      is_etf INTEGER NOT NULL DEFAULT 0,
      owner_user_id INTEGER
    );
    CREATE TABLE stock_holdings (
      user_id INTEGER NOT NULL,
      stock_id INTEGER NOT NULL,
      quantity REAL NOT NULL
    );
    CREATE TABLE stock_positions (
      user_id INTEGER NOT NULL,
      stock_id INTEGER NOT NULL,
      side TEXT NOT NULL DEFAULT 'long',
      status TEXT NOT NULL,
      margin_amount REAL NOT NULL,
      quantity REAL NOT NULL,
      entry_price REAL NOT NULL
    );
    INSERT INTO users (id, balance) VALUES (1, 1000000);
    INSERT INTO stocks (id, current_price, status) VALUES (1, 1000, 'listed');
  `);

  assert.equal(calculateUserTotalEvaluatedAsset(database, 1).totalEvaluatedAsset, 1_000_000);
  database.prepare("UPDATE users SET balance = 100000 WHERE id = 1").run();
  database
    .prepare("INSERT INTO stock_holdings (user_id, stock_id, quantity) VALUES (1, 1, 900)")
    .run();
  assert.equal(calculateUserTotalEvaluatedAsset(database, 1).totalEvaluatedAsset, 1_000_000);
  database.close();
});

test("short positions gain value when the stock price falls", () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, balance REAL NOT NULL);
    CREATE TABLE stocks (
      id INTEGER PRIMARY KEY,
      current_price REAL NOT NULL,
      status TEXT NOT NULL,
      is_etf INTEGER NOT NULL DEFAULT 0,
      owner_user_id INTEGER
    );
    CREATE TABLE stock_holdings (
      user_id INTEGER NOT NULL,
      stock_id INTEGER NOT NULL,
      quantity REAL NOT NULL
    );
    CREATE TABLE stock_positions (
      user_id INTEGER NOT NULL,
      stock_id INTEGER NOT NULL,
      side TEXT NOT NULL,
      status TEXT NOT NULL,
      margin_amount REAL NOT NULL,
      quantity REAL NOT NULL,
      entry_price REAL NOT NULL
    );
    INSERT INTO users (id, balance) VALUES (1, 100000);
    INSERT INTO stocks (id, current_price, status) VALUES (1, 800, 'listed');
    INSERT INTO stock_positions
      (user_id, stock_id, side, status, margin_amount, quantity, entry_price)
      VALUES (1, 1, 'short', 'open', 100000, 100, 1000);
  `);

  const valuation = calculateUserTotalEvaluatedAsset(database, 1);
  assert.equal(valuation.unrealizedPnl, 20_000);
  assert.equal(valuation.positionValue, 120_000);
  assert.equal(valuation.totalEvaluatedAsset, 220_000);
  database.close();
});

test("recent outgoing transfers are counted against bankruptcy eligibility", () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      balance REAL NOT NULL,
      last_bankruptcy_at TEXT,
      bankruptcy_prompt_dismissed_at TEXT
    );
    CREATE TABLE transfer_logs (
      sender_user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE stocks (
      id INTEGER PRIMARY KEY,
      current_price REAL NOT NULL,
      status TEXT NOT NULL,
      is_etf INTEGER NOT NULL DEFAULT 0,
      owner_user_id INTEGER
    );
    CREATE TABLE stock_holdings (
      user_id INTEGER NOT NULL,
      stock_id INTEGER NOT NULL,
      quantity REAL NOT NULL
    );
    CREATE TABLE stock_positions (
      user_id INTEGER NOT NULL,
      stock_id INTEGER NOT NULL,
      side TEXT NOT NULL DEFAULT 'long',
      status TEXT NOT NULL,
      margin_amount REAL NOT NULL,
      quantity REAL NOT NULL,
      entry_price REAL NOT NULL
    );
    CREATE TABLE abuse_logs (
      user_id INTEGER,
      action_type TEXT,
      reason TEXT,
      metadata_json TEXT
    );
    INSERT INTO users (id, balance) VALUES (1, 0);
    INSERT INTO transfer_logs (sender_user_id, amount) VALUES (1, 1000000);
  `);
  const user = database.prepare("SELECT * FROM users WHERE id = 1").get();
  const status = getBankruptcyStatus(database, user);

  assert.equal(status.eligible, false);
  assert.equal(status.reason, "recent_transfer");
  assert.equal(status.effectiveBankruptcyAsset, 1_000_000);
  assert.throws(() => assertCanApplyBankruptcy(database, user), /최근 송금한 금액/);
  database.close();
});

test("transfers are blocked for 24 hours after bankruptcy", () => {
  assert.throws(
    () =>
      assertCanTransferAfterBankruptcy({
        last_bankruptcy_at: new Date().toISOString(),
      }),
    /24시간 동안은 송금할 수 없어요/,
  );
});

test("stock market limit retires only unowned and unheld excess stocks", () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE stocks (
      id INTEGER PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      delist_risk_status TEXT NOT NULL DEFAULT 'normal',
      current_price REAL NOT NULL,
      previous_price REAL NOT NULL,
      market_cap REAL NOT NULL,
      is_bluechip INTEGER NOT NULL DEFAULT 0,
      is_etf INTEGER NOT NULL DEFAULT 0,
      owner_user_id INTEGER,
      delisted_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE stock_holdings (
      user_id INTEGER NOT NULL,
      stock_id INTEGER NOT NULL,
      quantity REAL NOT NULL
    );
    CREATE TABLE stock_positions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      stock_id INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE stock_events (
      stock_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL
    );
  `);
  const insert = database.prepare(`
    INSERT INTO stocks
      (id, symbol, name, status, current_price, previous_price, market_cap)
    VALUES (?, ?, ?, 'listed', 1000, 1000, ?)
  `);
  for (let id = 1; id <= 20; id += 1) {
    insert.run(id, `S${id}`, `종목${id}`, 21 - id);
  }
  database
    .prepare("INSERT INTO stock_holdings (user_id, stock_id, quantity) VALUES (1, 10, 1)")
    .run();

  const result = enforceStockMarketLimit(database);
  const activeCount = database
    .prepare("SELECT COUNT(*) AS count FROM stocks WHERE status != 'delisted'")
    .get().count;
  const heldStock = database.prepare("SELECT status FROM stocks WHERE id = 10").get();

  assert.equal(result.activeCount, 16);
  assert.equal(activeCount, 16);
  assert.equal(heldStock.status, "listed");
  assert.equal(result.retiredIds.length, 4);
  database.close();
});
