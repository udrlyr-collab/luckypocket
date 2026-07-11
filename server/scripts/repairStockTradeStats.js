import { db } from "../db.js";
import { repairAllStockStats } from "../services/stockTradeStatsService.js";

const admin = db.prepare("SELECT id FROM users WHERE username = 'admin' LIMIT 1").get();
const results = repairAllStockStats(db, { adminUserId: admin?.id ?? null });
console.log(JSON.stringify({ repairedUsers: results.length }, null, 2));
