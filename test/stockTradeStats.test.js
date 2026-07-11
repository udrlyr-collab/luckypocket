import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  getUserStockStats,
  incrementUserStockStat,
  STOCK_STAT_TYPES,
} from "../server/services/stockTradeStatsService.js";

test("stock statistics count one event once regardless of leverage amount", () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE user_stock_stat_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      stat_type TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, stat_type, source_type, source_id)
    );
  `);

  assert.equal(incrementUserStockStat(database, {
    userId: 7,
    stat: STOCK_STAT_TYPES.leverageOpenCount,
    sourceType: "leverage_position_open",
    sourceId: 91,
    amount: 100,
  }), true);
  assert.equal(incrementUserStockStat(database, {
    userId: 7,
    stat: STOCK_STAT_TYPES.leverageOpenCount,
    sourceType: "leverage_position_open",
    sourceId: 91,
  }), false);
  incrementUserStockStat(database, {
    userId: 7,
    stat: STOCK_STAT_TYPES.spotTradeCount,
    sourceType: "stock_trade",
    sourceId: 92,
  });

  assert.deepEqual(getUserStockStats(database, 7), {
    spotTradeCount: 1,
    leverageOpenCount: 1,
    leverageCloseCount: 0,
    leverageLiquidationCount: 0,
    leverageRoundTripCount: 0,
    totalStockTradeActions: 2,
  });
  database.close();
});
