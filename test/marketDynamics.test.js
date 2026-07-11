import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  TREND_DRIFT_PER_TICK,
  TREND_REGIME_PROBABILITIES,
  ensureStockTrendRegime,
  marketCapTrendTier,
} from "../server/services/marketDynamicsService.js";
import { calculateOwnerEtfTrackingAsset } from "../server/services/portfolioValuationService.js";

test("large-cap trend policy raises bull selection probability without raising tick drift limits", () => {
  assert.ok(TREND_REGIME_PROBABILITIES.large.bull > TREND_REGIME_PROBABILITIES.small.bull);
  assert.ok(TREND_REGIME_PROBABILITIES.giant.bull > TREND_REGIME_PROBABILITIES.micro.bull);
  assert.ok(TREND_DRIFT_PER_TICK.bull.max <= 0.00005);
  assert.ok(TREND_DRIFT_PER_TICK.bear.min >= -0.00005);
  assert.equal(marketCapTrendTier(4_000_000_000), "danger_micro");
  assert.equal(marketCapTrendTier(3_000_000_000_000), "mega");
});

test("trend regime remains fixed before its scheduled end while EMA updates", () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE stocks (
      id INTEGER PRIMARY KEY,
      status TEXT,
      is_etf INTEGER DEFAULT 0,
      delist_risk_status TEXT,
      admin_price_target_active INTEGER DEFAULT 0,
      blue_chip_ramp_active INTEGER DEFAULT 0,
      market_cap INTEGER,
      market_cap_ema_24h INTEGER,
      trend_regime TEXT,
      trend_regime_started_at TEXT,
      trend_regime_ends_at TEXT,
      trend_market_cap_basis INTEGER,
      trend_drift_per_tick REAL,
      trend_volatility REAL,
      market_cap_tier_started_at TEXT,
      volatility REAL,
      updated_at TEXT,
      created_at TEXT
    );
    INSERT INTO stocks (id, status, market_cap, volatility)
    VALUES (1, 'listed', 600000000000, 0.02);
  `);
  const now = Date.UTC(2026, 6, 12, 0, 0, 0);
  const first = ensureStockTrendRegime(database, database.prepare("SELECT * FROM stocks WHERE id = 1").get(), now);
  const second = ensureStockTrendRegime(database, database.prepare("SELECT * FROM stocks WHERE id = 1").get(), now + 10_000);
  assert.equal(second.regime, first.regime);
  assert.equal(second.driftPerTick, first.driftPerTick);
  assert.ok(second.marketCapEma24h > 0);
  database.close();
});

test("owner ETF tracking asset excludes every owner-asset ETF holding", () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, balance INTEGER NOT NULL);
    CREATE TABLE stocks (
      id INTEGER PRIMARY KEY,
      current_price INTEGER NOT NULL,
      status TEXT NOT NULL,
      is_etf INTEGER NOT NULL DEFAULT 0,
      owner_user_id INTEGER,
      delist_risk_status TEXT,
      market_cap INTEGER,
      is_bluechip INTEGER DEFAULT 0
    );
    CREATE TABLE stock_holdings (
      user_id INTEGER NOT NULL,
      stock_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      average_price REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE stock_positions (
      user_id INTEGER NOT NULL,
      stock_id INTEGER NOT NULL,
      side TEXT NOT NULL,
      status TEXT NOT NULL,
      margin_amount INTEGER NOT NULL,
      quantity REAL NOT NULL,
      entry_price INTEGER NOT NULL,
      liquidation_price INTEGER NOT NULL
    );
    INSERT INTO users (id, balance) VALUES (1, 100);
    INSERT INTO stocks (id, current_price, status, is_etf, owner_user_id) VALUES
      (1, 100, 'listed', 0, NULL),
      (2, 1000, 'acquired', 1, 99);
    INSERT INTO stock_holdings (user_id, stock_id, quantity, average_price) VALUES
      (1, 1, 2, 100),
      (1, 2, 10, 1000);
  `);
  assert.equal(calculateOwnerEtfTrackingAsset(database, 1), 300);
  database.close();
});
