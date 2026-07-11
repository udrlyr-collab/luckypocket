import { db } from "../server/db.js";
console.log("stock_events cols:", db.prepare("PRAGMA table_info(stock_events)").all().map(c => c.name));
console.log("admin_logs cols:", db.prepare("PRAGMA table_info(admin_logs)").all().map(c => c.name));
