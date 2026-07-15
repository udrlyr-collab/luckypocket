import { db } from "../server/db.js";
import { calculateOwnerEtfTrackingAsset } from "../server/services/portfolioValuationService.js";

const apply = process.argv.includes("--apply");
const etfs = db.prepare(`
  SELECT s.*, u.username, u.nickname
  FROM stocks s
  LEFT JOIN users u ON u.id = s.owner_user_id
  WHERE s.is_etf = 1 AND s.etf_tracking_type = 'owner_asset' AND s.status = 'acquired'
  ORDER BY s.owner_user_id, s.id
`).all();
const ownerCounts = new Map();
for (const etf of etfs) ownerCounts.set(etf.owner_user_id, (ownerCounts.get(etf.owner_user_id) || 0) + 1);
const plans = etfs.map((etf) => {
  const trackingAsset = etf.owner_user_id ? calculateOwnerEtfTrackingAsset(db, etf.owner_user_id, etf.id) : null;
  const desiredSymbol = etf.owner_user_id ? String(etf.owner_user_id) : null;
  const symbolConflict = desiredSymbol
    ? db.prepare("SELECT id, name, symbol FROM stocks WHERE symbol = ? AND id != ?").get(desiredSymbol, etf.id)
    : null;
  return {
    stockId: etf.id,
    ownerUserId: etf.owner_user_id,
    duplicateOwnerEtf: (ownerCounts.get(etf.owner_user_id) || 0) > 1,
    symbolConflict: symbolConflict || null,
    before: {
      name: etf.name,
      symbol: etf.symbol,
      sector: etf.sector,
      basePrice: etf.etf_base_price,
      referencePrice: etf.etf_delist_reference_price,
    },
    after: etf.owner_user_id ? {
      name: `${etf.username}의 회사`,
      symbol: desiredSymbol,
      sector: "OTHER",
      basePrice: Math.max(1, Number(etf.etf_base_price || etf.current_price)),
      referencePrice: Math.max(1, Number(etf.etf_delist_reference_price || etf.etf_base_price || etf.current_price)),
      trackingAsset,
    } : null,
  };
});

const unsafe = plans.filter((plan) => !plan.after || plan.duplicateOwnerEtf || plan.symbolConflict);
if (apply && unsafe.length > 0) {
  throw new Error("소유자 누락, 중복 활성 owner ETF 또는 종목코드 충돌이 있어 자동 보정을 중단했습니다. 각 충돌을 먼저 검토해야 합니다.");
}
if (apply) {
  db.transaction(() => {
    for (const plan of plans) {
      db.prepare(`
        UPDATE stocks
        SET name = ?, symbol = ?, sector = 'OTHER',
            etf_base_price = ?, etf_base_owner_asset = ?,
            etf_last_tracked_owner_asset = ?, etf_delist_reference_price = ?,
            etf_delist_reference_set_at = COALESCE(etf_delist_reference_set_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            etf_delist_trigger_price = MAX(1, CAST(? * 0.15 AS INTEGER)),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(
        plan.after.name,
        plan.after.symbol,
        plan.after.basePrice,
        plan.after.trackingAsset,
        plan.after.trackingAsset,
        plan.after.referencePrice,
        plan.after.referencePrice,
        plan.stockId,
      );
    }
  })();
}
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", plans, unsafeCount: unsafe.length }, null, 2));
if (!apply) console.log("Dry-run only. Re-run with --apply after reviewing every plan.");
