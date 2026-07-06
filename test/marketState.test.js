import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  assertStockMarketOpen,
  isStockMarketOpen,
  setStockMarketOpen,
} from "../server/services/marketStateService.js";
import { STOCK_NAME_POOL } from "../server/constants/stockNamePool.js";
import { pickRandomStockIdentity } from "../server/services/stockService.js";

test("stock market state closes and reopens through the shared server state", () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  assert.equal(isStockMarketOpen(database), true);
  setStockMarketOpen(database, false);
  assert.equal(isStockMarketOpen(database), false);
  assert.throws(() => assertStockMarketOpen(database), /주식장이 닫혀/);
  setStockMarketOpen(database, true);
  assert.equal(isStockMarketOpen(database), true);
  assert.doesNotThrow(() => assertStockMarketOpen(database));

  database.close();
});

test("new stock identities never reuse symbols from delisted history", () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE stocks (
      name TEXT NOT NULL,
      symbol TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      delisted_at TEXT
    )
  `);
  const insert = database.prepare(
    "INSERT INTO stocks (name, symbol, status, delisted_at) VALUES (?, ?, 'delisted', ?)",
  );
  STOCK_NAME_POOL.forEach((stock, index) => {
    insert.run(stock.name, stock.symbol, new Date(index * 1000).toISOString());
  });

  const existingSymbols = new Set(STOCK_NAME_POOL.map((stock) => stock.symbol));
  const usedSymbols = new Set();
  const first = pickRandomStockIdentity(database, usedSymbols);
  const second = pickRandomStockIdentity(database, usedSymbols);

  assert.equal(existingSymbols.has(first.symbol), false);
  assert.equal(existingSymbols.has(second.symbol), false);
  assert.notEqual(first.symbol, second.symbol);
  assert.equal(usedSymbols.has(first.symbol), true);
  assert.equal(usedSymbols.has(second.symbol), true);
  database.close();
});
