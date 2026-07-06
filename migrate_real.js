import Database from 'better-sqlite3';
import { config } from './server/config.js';

console.log('Running migration to convert INTEGER columns to REAL...');
const db = new Database(config.databasePath);

db.pragma('writable_schema = ON');
const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all();

let updated = 0;
for (const t of tables) {
  if (!t.sql) continue;
  
  const replacements = [
    'balance', 'initial_balance', 'highest_balance', 'total_profit', 'total_bet', 'total_win', 'total_loss',
    'bet_amount', 'payout', 'profit', 'balance_before', 'balance_after', 'reward', 'reward_amount',
    'amount', 'sender_balance_before', 'sender_balance_after', 'receiver_balance_before', 'receiver_balance_after',
    'raw_reward', 'actual_reward',
    'current_price', 'previous_price', 'initial_price', 'total_shares', 'market_cap',
    'etf_base_price', 'etf_base_top_balance', 'etf_last_tracked_balance',
    'price', 'quantity', 'margin_amount', 'position_size', 'entry_price', 'liquidation_price',
    'unrealized_pnl', 'realized_pnl', 'change_amount', 'average_price'
  ];
  
  let newSql = t.sql;
  for (const col of replacements) {
    const re = new RegExp(`\\b${col}\\s+INTEGER\\b`, 'g');
    newSql = newSql.replace(re, `${col} REAL`);
  }
  
  if (newSql !== t.sql) {
    console.log(`Updating schema for table: ${t.name}`);
    db.prepare("UPDATE sqlite_master SET sql = ? WHERE name = ?").run(newSql, t.name);
    updated++;
  }
}

db.pragma('writable_schema = OFF');
console.log(`Migration completed. ${updated} tables updated.`);
