export const STOCK_STAT_TYPES = Object.freeze({
  spotTradeCount: "spot_trade_count",
  leverageOpenCount: "leverage_open_count",
  leverageCloseCount: "leverage_close_count",
  leverageLiquidationCount: "leverage_liquidation_count",
  leverageRoundTripCount: "leverage_round_trip_count",
});

export function incrementUserStockStat(database, {
  userId,
  stat,
  sourceType,
  sourceId,
}) {
  if (!Object.values(STOCK_STAT_TYPES).includes(stat)) {
    throw new Error("지원하지 않는 주식 통계 유형입니다.");
  }
  if (!userId || !sourceType || sourceId === undefined || sourceId === null) return false;
  const result = database.prepare(`
    INSERT OR IGNORE INTO user_stock_stat_events
      (user_id, stat_type, source_type, source_id, amount)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, stat, sourceType, String(sourceId), 1);
  return result.changes === 1;
}

export function getUserStockStats(database, userId) {
  const rows = database.prepare(`
    SELECT stat_type, COALESCE(SUM(amount), 0) AS total
    FROM user_stock_stat_events
    WHERE user_id = ?
    GROUP BY stat_type
  `).all(userId);
  const totals = new Map(rows.map((row) => [row.stat_type, Number(row.total || 0)]));
  const spotTradeCount = totals.get(STOCK_STAT_TYPES.spotTradeCount) || 0;
  const leverageOpenCount = totals.get(STOCK_STAT_TYPES.leverageOpenCount) || 0;
  const leverageCloseCount = totals.get(STOCK_STAT_TYPES.leverageCloseCount) || 0;
  const leverageLiquidationCount = totals.get(STOCK_STAT_TYPES.leverageLiquidationCount) || 0;
  const leverageRoundTripCount = totals.get(STOCK_STAT_TYPES.leverageRoundTripCount) || 0;
  return {
    spotTradeCount,
    leverageOpenCount,
    leverageCloseCount,
    leverageLiquidationCount,
    leverageRoundTripCount,
    totalStockTradeActions: spotTradeCount + leverageOpenCount + leverageCloseCount,
  };
}

export function repairUserStockStats(database, userId) {
  database.prepare("DELETE FROM user_stock_stat_events WHERE user_id = ?").run(userId);
  const add = (stat, sourceType, sourceId) => incrementUserStockStat(database, {
    userId,
    stat,
    sourceType,
    sourceId,
  });

  const spotTrades = database.prepare(`
    SELECT id FROM stock_trades
    WHERE user_id = ? AND trade_type IN ('buy', 'sell', 'ipo_subscribe')
  `).all(userId);
  for (const row of spotTrades) add(STOCK_STAT_TYPES.spotTradeCount, "stock_trade", row.id);

  const openTrades = database.prepare(`
    SELECT id FROM stock_trades
    WHERE user_id = ? AND trade_type IN ('open_long', 'open_short')
  `).all(userId);
  for (const trade of openTrades) {
    add(STOCK_STAT_TYPES.leverageOpenCount, "leverage_trade_open", trade.id);
  }

  const positions = database.prepare("SELECT id, status, detail_json FROM stock_positions WHERE user_id = ?").all(userId);
  for (const position of positions) {
    if (["closed", "liquidated"].includes(position.status)) {
      add(STOCK_STAT_TYPES.leverageRoundTripCount, "leverage_round_trip", position.id);
    }
    if (position.status === "liquidated") {
      add(STOCK_STAT_TYPES.leverageLiquidationCount, "leverage_liquidation", position.id);
      continue;
    }
    if (position.status === "closed") {
      let detail = {};
      try { detail = JSON.parse(position.detail_json || "{}"); } catch { detail = {}; }
      if (!detail.forceCloseReason) {
        add(STOCK_STAT_TYPES.leverageCloseCount, "leverage_position_close", position.id);
      }
    }
  }

  return getUserStockStats(database, userId);
}

export function repairAllStockStats(database, { adminUserId = null } = {}) {
  return database.transaction(() => {
    const users = database.prepare("SELECT id FROM users ORDER BY id ASC").all();
    const results = users.map((user) => ({ userId: user.id, ...repairUserStockStats(database, user.id) }));
    if (adminUserId) {
      database.prepare(`
        INSERT INTO admin_logs (admin_user_id, target_user_id, action_type, before_value, after_value, reason)
        VALUES (?, ?, 'repair_stock_trade_stats', NULL, ?, '원본 거래/포지션 로그 기준 통계 재계산')
      `).run(adminUserId, adminUserId, JSON.stringify({ repairedUsers: results.length }));
    }
    return results;
  })();
}
