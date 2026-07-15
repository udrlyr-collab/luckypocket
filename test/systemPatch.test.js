import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Database from "better-sqlite3";
import {
  calculateHostileTakeoverStrength,
  COMPANY_SIZE_PROTECTION,
  DISTRESS_MIN_OBSERVATION_HOURS,
  requiredCompanyAcquisitionBalance,
} from "../server/services/stockService.js";
import {
  STABILITY_DAILY_BASE_DRIFT,
  STABILITY_TARGET_DAILY_VOLATILITY,
  STABILITY_TREND_PROBABILITIES,
} from "../server/services/marketDynamicsService.js";
import { buildSeasonRewardPreview } from "../server/services/seasonRewardService.js";
import {
  calculateEtfHourlyInterest,
  ETF_HOURLY_INTEREST_RATE,
  kstHourKey,
} from "../server/services/etfInterestService.js";
import { throwDart } from "../server/services/gameMath.js";

test("hostile M&A uses market-cap eligibility and only target resources for strength", () => {
  assert.equal(requiredCompanyAcquisitionBalance(5_000_000_000), 25_000_000_000);
  assert.equal(calculateHostileTakeoverStrength({
    escrowCash: 5_000,
    holderQuantity: 7,
    sharePrice: 100,
    supportCash: 300,
    delegatedShareQuantity: 2,
    treasuryShares: 4,
    attackerTotalEvaluatedAsset: 999_999_999_999,
    defenderTotalEvaluatedAsset: 999_999_999_999,
  }), 6_600);
});

test("stability tier policy matches the configured long-term distribution", () => {
  assert.deepEqual(STABILITY_TREND_PROBABILITIES.SMALL, { bull: 0.52, sideways: 0.18, bear: 0.30 });
  assert.deepEqual(STABILITY_TREND_PROBABILITIES.BLUE_CHIP, { bull: 0.72, sideways: 0.21, bear: 0.07 });
  assert.equal(STABILITY_DAILY_BASE_DRIFT.BLUE_CHIP, 0.0035);
  assert.equal(STABILITY_TARGET_DAILY_VOLATILITY.SMALL, 0.20);
  assert.equal(COMPANY_SIZE_PROTECTION.BLUE_CHIP, 38);
  assert.equal(DISTRESS_MIN_OBSERVATION_HOURS.GIANT, 48);
});

test("season preview freezes user ranks and maps company ranks 2, 3, and 4", () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE seasons (id INTEGER PRIMARY KEY, season_number INTEGER, status TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, nickname TEXT, balance INTEGER);
    CREATE TABLE stocks (
      id INTEGER PRIMARY KEY, name TEXT, symbol TEXT, current_price INTEGER, status TEXT,
      total_shares INTEGER, market_cap INTEGER, is_etf INTEGER DEFAULT 0,
      owner_user_id INTEGER, is_bluechip INTEGER DEFAULT 0, delist_risk_status TEXT DEFAULT 'normal',
      is_trading_suspended INTEGER DEFAULT 0
    );
    CREATE TABLE stock_holdings (user_id INTEGER, stock_id INTEGER, quantity REAL, average_price REAL);
    CREATE TABLE stock_positions (
      id INTEGER PRIMARY KEY, user_id INTEGER, stock_id INTEGER, side TEXT, status TEXT,
      margin_amount INTEGER, position_size INTEGER, quantity REAL, entry_price INTEGER,
      leverage INTEGER, liquidation_price INTEGER
    );
    INSERT INTO seasons VALUES (1, 9, 'active');
    INSERT INTO users VALUES
      (1, 'winner', '우승자', 3000000),
      (2, 'second', '2위', 2000000),
      (3, 'third', '3위', 1000000);
    INSERT INTO stocks VALUES
      (10, '1위회사', 'A', 1000, 'listed', 10000000, 10000000000, 0, NULL, 0, 'normal', 0),
      (11, '2위회사', 'B', 900, 'listed', 10000000, 9000000000, 0, NULL, 0, 'normal', 0),
      (12, '3위회사', 'C', 800, 'listed', 10000000, 8000000000, 0, NULL, 0, 'normal', 0),
      (13, '4위회사', 'D', 700, 'listed', 10000000, 7000000000, 0, NULL, 0, 'normal', 0);
  `);
  const preview = buildSeasonRewardPreview(database);
  assert.deepEqual(preview.mappings.map((row) => [row.winnerUserId, row.sourceStockId]), [
    [1, 11], [2, 12], [3, 13],
  ]);
  database.close();
});

test("ETF interest is 0.1 percent once per KST hour key calculation", () => {
  assert.equal(ETF_HOURLY_INTEREST_RATE, 0.001);
  assert.equal(calculateEtfHourlyInterest(1_234_567), 1_234);
  assert.equal(kstHourKey(Date.parse("2026-07-14T15:30:00.000Z")), "2026-07-15T00");
});

test("dart server result contains authoritative animation coordinates", () => {
  const dart = throwDart();
  assert.match(dart.roundId, /^dart_[0-9a-f]{32}$/);
  assert.ok(dart.radius >= 0 && dart.radius <= 1);
  assert.ok(dart.sector >= 1 && dart.sector <= 20);
  assert.ok(dart.flightDurationMs >= 650 && dart.flightDurationMs <= 950);
  assert.ok(Number.isFinite(dart.rotationDeg));
});

test("cup shuffle keeps stable DOM identities and uses translate3d curves", () => {
  const source = fs.readFileSync(new URL("../src/games/CupLuckGame.jsx", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(source, /setCupIds\(\[\.\.\.workingCupIds\]\)/);
  assert.match(source, /key=\{cupId\}/);
  assert.match(styles, /@keyframes cupSwapCurve/);
  assert.match(styles, /translate3d/);
});

