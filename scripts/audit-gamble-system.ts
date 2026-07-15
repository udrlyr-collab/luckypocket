import { db } from "../server/db.js";
import { calculateUserTotalEvaluatedAsset } from "../server/services/portfolioValuationService.js";
import { getEtfInterestMissingSummary } from "../server/services/etfInterestService.js";

const users = db.prepare("SELECT id, username FROM users ORDER BY id").all();
const valuations = users.map((user) => ({
  userId: user.id,
  username: user.username,
  ...calculateUserTotalEvaluatedAsset(db, user.id),
}));
const duplicateOwnerEtfs = db.prepare(`
  SELECT owner_user_id, COUNT(*) AS count, GROUP_CONCAT(id) AS stock_ids
  FROM stocks
  WHERE is_etf = 1 AND etf_tracking_type = 'owner_asset' AND status = 'acquired'
  GROUP BY owner_user_id HAVING COUNT(*) > 1
`).all();
const zeroValuationWithAssets = valuations.filter((row) => {
  if (Number(row.totalEvaluatedAsset) !== 0) return false;
  const holding = db.prepare(`
    SELECT 1 FROM stock_holdings WHERE user_id = ? AND quantity > 0 LIMIT 1
  `).get(row.userId);
  const position = db.prepare(`
    SELECT 1 FROM stock_positions WHERE user_id = ? AND status = 'open' LIMIT 1
  `).get(row.userId);
  return Boolean(holding || position);
}).map((row) => ({ userId: row.userId, username: row.username }));
const ownerEtfIssues = db.prepare(`
  SELECT s.id AS stock_id, s.owner_user_id, s.name, s.symbol, s.sector,
         s.etf_base_owner_asset, s.etf_last_tracked_owner_asset,
         u.username,
         CASE
           WHEN s.owner_user_id IS NULL OR u.id IS NULL THEN 'owner_missing'
           WHEN s.name != (u.username || '의 회사') THEN 'name_mismatch'
           WHEN s.symbol != CAST(u.id AS TEXT) THEN 'symbol_mismatch'
           WHEN UPPER(COALESCE(s.sector, '')) != 'OTHER' THEN 'sector_mismatch'
           WHEN COALESCE(s.etf_base_owner_asset, 0) <= 0
             OR COALESCE(s.etf_last_tracked_owner_asset, 0) <= 0 THEN 'tracking_base_missing'
           ELSE NULL
         END AS issue
  FROM stocks s
  LEFT JOIN users u ON u.id = s.owner_user_id
  WHERE s.is_etf = 1 AND s.etf_tracking_type = 'owner_asset' AND s.status = 'acquired'
    AND (
      s.owner_user_id IS NULL OR u.id IS NULL
      OR s.name != (u.username || '의 회사')
      OR s.symbol != CAST(u.id AS TEXT)
      OR UPPER(COALESCE(s.sector, '')) != 'OTHER'
      OR COALESCE(s.etf_base_owner_asset, 0) <= 0
      OR COALESCE(s.etf_last_tracked_owner_asset, 0) <= 0
    )
  ORDER BY s.id
`).all();
const duplicateOwnerEtfSymbols = db.prepare(`
  SELECT symbol, COUNT(*) AS count, GROUP_CONCAT(id) AS stock_ids
  FROM stocks
  WHERE is_etf = 1 AND etf_tracking_type = 'owner_asset' AND status = 'acquired'
  GROUP BY symbol HAVING COUNT(*) > 1
`).all();
const legacyTakeovers = db.prepare(`
  SELECT COUNT(*) AS count FROM hostile_takeover_events
  WHERE target_market_cap_snapshot IS NULL OR acquisition_cost_snapshot IS NULL
`).get().count;
const unsafeStocks = db.prepare(`
  SELECT COUNT(*) AS count FROM stocks
  WHERE status != 'delisted' AND is_etf = 0
    AND delist_risk_status = 'final_crash'
    AND delist_review_started_at IS NULL
`).get().count;
const highCapDelistReviewStocks = db.prepare(`
  SELECT id, name, symbol, market_cap, delist_risk_status
  FROM stocks
  WHERE status != 'delisted' AND is_etf = 0
    AND market_cap >= 5000000000
    AND delist_risk_status IN ('delist_review', 'final_crash')
  ORDER BY market_cap DESC, id ASC
`).all();
const historicalRankCashBonusRows = db.prepare(`
  SELECT COUNT(*) AS count
  FROM season_results
  WHERE rank <= 3 AND starting_bonus_for_next_season > 1000000
`).get().count;
const cashOnlyLatestSnapshotsWithAssets = db.prepare(`
  SELECT snap.user_id, snap.id AS snapshot_id, snap.cash_balance,
         snap.total_evaluated_asset
  FROM user_asset_snapshots snap
  WHERE snap.id = (
    SELECT MAX(newer.id) FROM user_asset_snapshots newer
    WHERE newer.user_id = snap.user_id
  )
    AND snap.total_evaluated_asset = snap.cash_balance
    AND (
      EXISTS (SELECT 1 FROM stock_holdings h WHERE h.user_id = snap.user_id AND h.quantity > 0)
      OR EXISTS (SELECT 1 FROM stock_positions p WHERE p.user_id = snap.user_id AND p.status = 'open')
    )
  ORDER BY snap.user_id
`).all();
const report = {
  generatedAt: new Date().toISOString(),
  database: "sqlite",
  userCount: users.length,
  incompleteValuationCount: valuations.filter((row) => row.valuationComplete === false).length,
  incompleteValuations: valuations.filter((row) => row.valuationComplete === false).map((row) => ({
    userId: row.userId,
    username: row.username,
    errors: row.valuationErrors,
  })),
  zeroValuationWithAssets,
  duplicateOwnerEtfs,
  duplicateOwnerEtfSymbols,
  ownerEtfIssues,
  hostileTakeoversMissingMarketCapSnapshot: Number(legacyTakeovers || 0),
  finalCrashWithoutReviewCount: Number(unsafeStocks || 0),
  highCapDelistReviewStocks,
  historicalRankCashBonusRows: Number(historicalRankCashBonusRows || 0),
  cashOnlyLatestSnapshotsWithAssets,
  etfInterest: getEtfInterestMissingSummary(db),
  seasonRewardJobs: db.prepare(`
    SELECT id, season_number, status, error_message FROM season_reward_jobs ORDER BY id DESC LIMIT 20
  `).all(),
};

console.log(JSON.stringify(report, null, 2));
if (
  report.incompleteValuationCount > 0 ||
  zeroValuationWithAssets.length > 0 ||
  duplicateOwnerEtfs.length > 0 ||
  duplicateOwnerEtfSymbols.length > 0 ||
  ownerEtfIssues.length > 0 ||
  Number(unsafeStocks) > 0 ||
  highCapDelistReviewStocks.length > 0
) {
  process.exitCode = 2;
}
