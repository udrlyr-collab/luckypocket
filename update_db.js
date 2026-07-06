import { db } from "./server/db.js";

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  
  // Insert default market open status
  db.exec(`
    INSERT OR IGNORE INTO system_config (key, value) VALUES ('market_open', 'true');
  `);

  // Add is_trading_suspended to stocks if it doesn't exist
  const tableInfo = db.pragma("table_info(stocks)");
  const hasSuspendCol = tableInfo.some(col => col.name === 'is_trading_suspended');
  
  if (!hasSuspendCol) {
    db.exec(`
      ALTER TABLE stocks ADD COLUMN is_trading_suspended INTEGER NOT NULL DEFAULT 0;
    `);
    console.log("Added is_trading_suspended column to stocks table.");
  } else {
    console.log("is_trading_suspended column already exists.");
  }
  
  console.log("DB update successful.");
} catch (err) {
  console.error("DB update error:", err);
}
