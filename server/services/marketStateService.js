export function isStockMarketOpen(database) {
  const row = database
    .prepare("SELECT value FROM system_config WHERE key = 'market_open'")
    .get();
  return !row || row.value !== "false";
}

export function setStockMarketOpen(database, open) {
  database
    .prepare(
      `INSERT INTO system_config (key, value)
       VALUES ('market_open', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(open ? "true" : "false");
  return open;
}

export function assertStockMarketOpen(database) {
  if (!isStockMarketOpen(database)) {
    const error = new Error("현재 주식장이 닫혀 있어 거래할 수 없습니다.");
    error.status = 400;
    throw error;
  }
}
