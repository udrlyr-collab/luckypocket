import { db } from "../server/db.js";

try {
  const admin = db.prepare("SELECT * FROM users WHERE username = 'admin'").get();
  const stock = db.prepare("SELECT * FROM stocks WHERE id = 1").get();
  
  const targetPrice = 50000;
  const percentPerTick = 10;
  const reason = "test";
  const eventType = "admin_price_target_started";
  const sentiment = "good";
  const finalTitle = "Test";
  const finalContent = "Test";

  const t = db.transaction(() => {
    db.prepare(`
      UPDATE stocks
      SET admin_price_target_active = 1,
          admin_price_target = ?,
          admin_price_target_direction = ?,
          admin_price_target_percent_per_tick = ?,
          admin_price_target_started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          admin_price_target_ended_at = NULL,
          admin_price_target_reason = ?,
          admin_price_target_started_by_user_id = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(targetPrice, "up", percentPerTick, reason, admin.id, stock.id);

    db.prepare(`
      INSERT INTO admin_logs (admin_user_id, target_user_id, action_type, before_value, after_value)
      VALUES (?, ?, 'admin_stock_target_price_started', ?, ?)
    `).run(admin.id, admin.id, String(stock.current_price), JSON.stringify({}));

    db.prepare(`
      INSERT INTO stock_events (
        stock_id, stock_name_snapshot, symbol_snapshot, event_type, sentiment, 
        title, message, price_before, price_after, change_amount, change_rate, 
        target_price, percent_per_tick, created_by_user_id, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
    `).run(
      stock.id, stock.name, stock.symbol, eventType, sentiment,
      finalTitle, finalContent, stock.current_price, stock.current_price,
      targetPrice, percentPerTick, admin.id, JSON.stringify({ reason })
    );
  });
  t();
  console.log("Success!");
} catch (e) {
  console.error("Error:", e);
}
