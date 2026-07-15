import { calculateUserTotalEvaluatedAsset } from "./portfolioValuationService.js";

function makeCycleId(prefix = "asset") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function invalidateUserAssetSnapshot(database, userId) {
  return database.prepare(`
    UPDATE user_asset_snapshots
    SET is_valid = 0,
        invalidated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE user_id = ? AND is_valid = 1
  `).run(userId).changes;
}

export function getLatestUserAssetSnapshot(database, userId, { validOnly = true } = {}) {
  return database.prepare(`
    SELECT *
    FROM user_asset_snapshots
    WHERE user_id = ? ${validOnly ? "AND is_valid = 1" : ""}
    ORDER BY id DESC
    LIMIT 1
  `).get(userId) || null;
}

export function createUserAssetSnapshot(database, userId, {
  valuationCycleId = makeCycleId(),
  valuation = null,
} = {}) {
  const calculated = valuation || calculateUserTotalEvaluatedAsset(database, userId);
  database.prepare(`
    UPDATE user_asset_snapshots
    SET is_valid = 0,
        invalidated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE user_id = ? AND is_valid = 1
  `).run(userId);
  const result = database.prepare(`
    INSERT INTO user_asset_snapshots
      (user_id, valuation_cycle_id, cash_balance, gross_stock_market_value,
       estimated_stock_sell_fees, estimated_stock_taxes, stock_net_liquidation_value,
       leverage_gross_settlement_value, estimated_leverage_close_fees,
       estimated_leverage_taxes, leverage_net_settlement_value,
       other_eligible_asset_value, total_evaluated_asset, valuation_complete,
       valuation_errors_json, holdings_json, positions_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    valuationCycleId,
    calculated.cashBalance,
    calculated.grossStockMarketValue,
    calculated.estimatedStockSellFees,
    calculated.estimatedStockTaxes,
    calculated.stockNetLiquidationValue,
    calculated.leverageGrossSettlementValue,
    calculated.estimatedLeverageCloseFees,
    calculated.estimatedLeverageTaxes,
    calculated.leverageNetSettlementValue,
    calculated.otherEligibleAssetValue || 0,
    calculated.totalEvaluatedAsset,
    calculated.valuationComplete === false ? 0 : 1,
    JSON.stringify(calculated.valuationErrors || []),
    JSON.stringify(calculated.holdings || []),
    JSON.stringify(calculated.positions || []),
  );
  return database.prepare("SELECT * FROM user_asset_snapshots WHERE id = ?")
    .get(result.lastInsertRowid);
}

export function rebuildUserAssetSnapshots(database, {
  userIds = null,
  valuationCycleId = makeCycleId("asset-rebuild"),
  apply = true,
} = {}) {
  const users = Array.isArray(userIds) && userIds.length > 0
    ? database.prepare(`SELECT id FROM users WHERE id IN (${userIds.map(() => "?").join(",")}) ORDER BY id`).all(...userIds)
    : database.prepare("SELECT id FROM users ORDER BY id").all();
  const previews = users.map(({ id }) => ({
    userId: id,
    valuation: calculateUserTotalEvaluatedAsset(database, id),
  }));
  if (apply) {
    database.transaction(() => {
      for (const preview of previews) {
        createUserAssetSnapshot(database, preview.userId, {
          valuationCycleId,
          valuation: preview.valuation,
        });
      }
    })();
  }
  return {
    valuationCycleId,
    apply,
    userCount: previews.length,
    incompleteCount: previews.filter((row) => row.valuation.valuationComplete === false).length,
    users: previews,
  };
}

