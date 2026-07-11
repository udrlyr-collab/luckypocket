import { db } from "../server/db.js";
console.log(db.prepare("PRAGMA foreign_key_list(stock_events)").all());
console.log(db.prepare("PRAGMA foreign_key_list(admin_logs)").all());
