import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.join("c:/Users/홍성민/OneDrive/문서/gamble/data", "database.sqlite"));
console.log("stock_events cols:", db.prepare("PRAGMA table_info(stock_events)").all().map(c => c.name));
console.log("admin_logs cols:", db.prepare("PRAGMA table_info(admin_logs)").all().map(c => c.name));
