import { db } from "../server/db.js";
import { rebuildUserAssetSnapshots } from "../server/services/assetSnapshotService.js";

const apply = process.argv.includes("--apply");
const userIdArgument = process.argv.find((value) => value.startsWith("--user-ids="));
const userIds = userIdArgument
  ? userIdArgument.slice("--user-ids=".length).split(",").map(Number).filter(Number.isSafeInteger)
  : null;
const result = rebuildUserAssetSnapshots(db, { userIds, apply });
console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  valuationCycleId: result.valuationCycleId,
  userCount: result.userCount,
  incompleteCount: result.incompleteCount,
  users: result.users.map((row) => ({
    userId: row.userId,
    totalEvaluatedAsset: row.valuation.totalEvaluatedAsset,
    valuationComplete: row.valuation.valuationComplete,
    valuationErrors: row.valuation.valuationErrors,
  })),
}, null, 2));
if (!apply) console.log("Dry-run only. Re-run with --apply to write snapshots.");

