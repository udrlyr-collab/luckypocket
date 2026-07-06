import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    nickname TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 1000000 CHECK (balance >= 0),
    initial_balance INTEGER NOT NULL DEFAULT 1000000,
    highest_balance INTEGER NOT NULL DEFAULT 1000000,
    total_profit INTEGER NOT NULL DEFAULT 0,
    total_bet INTEGER NOT NULL DEFAULT 0,
    total_win INTEGER NOT NULL DEFAULT 0,
    total_loss INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS game_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_type TEXT NOT NULL,
    bet_amount INTEGER NOT NULL,
    result TEXT NOT NULL,
    payout INTEGER NOT NULL,
    profit INTEGER NOT NULL,
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    detail_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_game_logs_user_created
    ON game_logs(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS game_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_type TEXT NOT NULL,
    bet_amount INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_session_per_game
    ON game_sessions(user_id, game_type) WHERE status = 'active';

  CREATE TABLE IF NOT EXISTS user_achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_key TEXT NOT NULL,
    reward INTEGER NOT NULL,
    unlocked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(user_id, achievement_key)
  );

  CREATE TABLE IF NOT EXISTS lucky_seven_uses (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    usage_date TEXT NOT NULL,
    usage_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, usage_date)
  );

  CREATE TABLE IF NOT EXISTS revival_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    claim_date TEXT NOT NULL,
    amount INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS asset_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    game_type TEXT,
    amount INTEGER NOT NULL,
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    source_type TEXT,
    source_id TEXT,
    detail_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_asset_events_user_created
    ON asset_events(user_id, created_at ASC);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_events_source
    ON asset_events(source_type, source_id)
    WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS transfer_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    receiver_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    sender_nickname_snapshot TEXT NOT NULL,
    receiver_nickname_snapshot TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount >= 1000),
    sender_balance_before INTEGER NOT NULL,
    sender_balance_after INTEGER NOT NULL,
    receiver_balance_before INTEGER NOT NULL,
    receiver_balance_after INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_transfer_sender_created
    ON transfer_logs(sender_user_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_transfer_receiver_created
    ON transfer_logs(receiver_user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS bonus_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL COLLATE NOCASE UNIQUE,
    reward_amount INTEGER NOT NULL CHECK (reward_amount > 0),
    description TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    is_unlimited INTEGER NOT NULL DEFAULT 0 CHECK (is_unlimited IN (0, 1)),
    max_total_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_total_uses > 0),
    max_uses_per_user INTEGER NOT NULL DEFAULT 1 CHECK (max_uses_per_user > 0),
    used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS bonus_code_redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bonus_code_id INTEGER NOT NULL REFERENCES bonus_codes(id) ON DELETE RESTRICT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reward_amount INTEGER NOT NULL,
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_bonus_redemptions_code_user
    ON bonus_code_redemptions(bonus_code_id, user_id);

  CREATE TABLE IF NOT EXISTS admin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action_type TEXT NOT NULL,
    before_value TEXT,
    after_value TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_admin_logs_target_created
    ON admin_logs(target_user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS server_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    nickname_snapshot TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    amount INTEGER,
    multiplier REAL,
    game_type TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    source_type TEXT,
    source_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_server_notifications_created
    ON server_notifications(created_at DESC);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_server_notifications_source
    ON server_notifications(source_type, source_id)
    WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS mine_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    result_type TEXT NOT NULL,
    label TEXT NOT NULL,
    raw_reward INTEGER NOT NULL,
    actual_reward INTEGER NOT NULL,
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_mine_logs_user_created
    ON mine_logs(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'listed',
    current_price INTEGER NOT NULL,
    previous_price INTEGER NOT NULL,
    initial_price INTEGER NOT NULL,
    total_shares INTEGER NOT NULL,
    market_cap INTEGER NOT NULL,
    volatility REAL NOT NULL,
    trend REAL NOT NULL DEFAULT 0,
    event_type TEXT,
    event_until INTEGER,
    owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    owner_nickname_snapshot TEXT,
    is_etf INTEGER NOT NULL DEFAULT 0 CHECK (is_etf IN (0, 1)),
    etf_tracking_type TEXT,
    etf_base_price INTEGER,
    etf_base_top_balance INTEGER,
    etf_last_tracked_balance INTEGER,
    listed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    delisted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS stock_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
    price INTEGER NOT NULL,
    market_cap INTEGER NOT NULL,
    event_type TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_stock_price_history_stock
    ON stock_price_history(stock_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS stock_holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stock_id INTEGER NOT NULL REFERENCES stocks(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    average_price REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(user_id, stock_id)
  );

  CREATE TABLE IF NOT EXISTS stock_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stock_id INTEGER NOT NULL REFERENCES stocks(id) ON DELETE RESTRICT,
    side TEXT NOT NULL DEFAULT 'long',
    margin_amount INTEGER NOT NULL CHECK (margin_amount > 0),
    leverage INTEGER NOT NULL CHECK (leverage > 1),
    position_size INTEGER NOT NULL,
    quantity REAL NOT NULL,
    entry_price INTEGER NOT NULL,
    liquidation_price INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    unrealized_pnl INTEGER NOT NULL DEFAULT 0,
    realized_pnl INTEGER NOT NULL DEFAULT 0,
    opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    closed_at TEXT,
    liquidated_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_stock_positions_user_status
    ON stock_positions(user_id, status);
  
  CREATE INDEX IF NOT EXISTS idx_stock_positions_stock_status
    ON stock_positions(stock_id, status);

  CREATE TABLE IF NOT EXISTS stock_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stock_id INTEGER NOT NULL REFERENCES stocks(id) ON DELETE RESTRICT,
    trade_type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    quantity REAL NOT NULL,
    price INTEGER NOT NULL,
    leverage INTEGER NOT NULL DEFAULT 1,
    realized_pnl INTEGER NOT NULL DEFAULT 0,
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_stock_trades_user
    ON stock_trades(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS stock_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_stock_events_stock
    ON stock_events(stock_id, created_at DESC);
`);

const bonusCodeColumns = new Set(
  db.prepare("PRAGMA table_info(bonus_codes)").all().map((column) => column.name),
);
if (!bonusCodeColumns.has("is_unlimited")) {
  db.exec(
    "ALTER TABLE bonus_codes ADD COLUMN is_unlimited INTEGER NOT NULL DEFAULT 0 CHECK (is_unlimited IN (0, 1))",
  );
}

const userColumns = new Set(
  db.prepare("PRAGMA table_info(users)").all().map((column) => column.name),
);
if (!userColumns.has("nickname_change_count")) {
  db.exec("ALTER TABLE users ADD COLUMN nickname_change_count INTEGER NOT NULL DEFAULT 0");
  db.exec(`
    UPDATE users
    SET nickname_change_count = (
      SELECT COUNT(*)
      FROM asset_events
      WHERE asset_events.user_id = users.id
        AND asset_events.event_type = 'nickname_change_fee'
    )
    WHERE EXISTS (
      SELECT 1
      FROM asset_events
      WHERE asset_events.user_id = users.id
        AND asset_events.event_type = 'nickname_change_fee'
    )
  `);
}
if (!userColumns.has("bankruptcy_count")) {
  db.exec("ALTER TABLE users ADD COLUMN bankruptcy_count INTEGER NOT NULL DEFAULT 0");
}
if (!userColumns.has("last_bankruptcy_at")) {
  db.exec("ALTER TABLE users ADD COLUMN last_bankruptcy_at TEXT");
}
if (!userColumns.has("bankruptcy_prompt_dismissed_at")) {
  db.exec("ALTER TABLE users ADD COLUMN bankruptcy_prompt_dismissed_at TEXT");
}
if (!userColumns.has("mine_click_count")) {
  db.exec("ALTER TABLE users ADD COLUMN mine_click_count INTEGER NOT NULL DEFAULT 0");
}
if (!userColumns.has("mine_total_earned")) {
  db.exec("ALTER TABLE users ADD COLUMN mine_total_earned INTEGER NOT NULL DEFAULT 0");
}
if (!userColumns.has("last_mined_at")) {
  db.exec("ALTER TABLE users ADD COLUMN last_mined_at TEXT");
}

const serverNotificationColumns = new Set(
  db.prepare("PRAGMA table_info(server_notifications)").all().map((column) => column.name),
);
if (!serverNotificationColumns.has("game_name")) {
  db.exec("ALTER TABLE server_notifications ADD COLUMN game_name TEXT");
}

function normalizedNickname(value) {
  return String(value || "").trim().replace(/\s+/gu, "").toLocaleLowerCase("ko-KR");
}

const migrateDuplicateNicknames = db.transaction(() => {
  const users = db.prepare("SELECT id, nickname FROM users ORDER BY id ASC").all();
  const seen = new Set();
  const update = db.prepare("UPDATE users SET nickname = ? WHERE id = ?");

  for (const user of users) {
    const cleaned = String(user.nickname || "").trim().replace(/\s+/gu, " ");
    let candidate = cleaned || `사용자${user.id}`;
    let normalized = normalizedNickname(candidate);
    if (normalized && !seen.has(normalized)) {
      if (candidate !== user.nickname) update.run(candidate, user.id);
      seen.add(normalized);
      continue;
    }

    let attempt = 0;
    do {
      const suffix = attempt ? `_${user.id}_${attempt}` : `_${user.id}`;
      const available = Math.max(1, 12 - [...suffix].length);
      candidate = `${[...cleaned || "사용자"].slice(0, available).join("")}${suffix}`;
      normalized = normalizedNickname(candidate);
      attempt += 1;
    } while (seen.has(normalized));

    update.run(candidate, user.id);
    seen.add(normalized);
  }
});

migrateDuplicateNicknames();

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname_unique
    ON users(nickname COLLATE NOCASE);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname_normalized
    ON users(
      LOWER(
        REPLACE(
          REPLACE(
            REPLACE(
              REPLACE(TRIM(nickname), ' ', ''),
              char(9), ''
            ),
            char(10), ''
          ),
          char(13), ''
        )
      )
    );
`);

db.exec(`
  INSERT OR IGNORE INTO asset_events
    (user_id, event_type, amount, balance_before, balance_after, source_type, source_id, detail_json, created_at)
  SELECT
    id, 'signup_grant', initial_balance, 0, initial_balance, 'user', CAST(id AS TEXT),
    '{"label":"가입 시작 자산"}', created_at
  FROM users;

  INSERT OR IGNORE INTO asset_events
    (user_id, event_type, game_type, amount, balance_before, balance_after, source_type, source_id, detail_json, created_at)
  SELECT
    user_id,
    CASE WHEN result = 'win' THEN 'game_win' ELSE 'game_loss' END,
    game_type,
    profit,
    balance_before,
    balance_after,
    'game_log',
    CAST(id AS TEXT),
    detail_json,
    created_at
  FROM game_logs;
`);

function seedBonusCodes() {
  const seeds = [];
  if (!config.isProduction) {
    seeds.push({
      code: "TESTSEED",
      rewardAmount: 10000000,
      description: "개발 환경 테스트 코드",
      isUnlimited: false,
      maxTotalUses: 1000000,
      maxUsesPerUser: 1,
      expiresAt: null,
    });
  }
  if (process.env.BONUS_CODE_SEEDS) {
    const configured = JSON.parse(process.env.BONUS_CODE_SEEDS);
    if (!Array.isArray(configured)) {
      throw new Error("BONUS_CODE_SEEDS must be a JSON array.");
    }
    seeds.push(...configured);
  }
  seeds.push({
    code: "SEED0315",
    rewardAmount: 10000000,
    description: "관리자 전용 행운코드",
    isUnlimited: false,
    maxTotalUses: 1000000,
    maxUsesPerUser: 1,
    expiresAt: null,
  });

  const upsert = db.prepare(
    `INSERT INTO bonus_codes
      (code, reward_amount, description, is_active, is_unlimited, max_total_uses, max_uses_per_user, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET
       reward_amount = excluded.reward_amount,
       description = excluded.description,
       is_active = excluded.is_active,
       is_unlimited = excluded.is_unlimited,
       max_total_uses = excluded.max_total_uses,
       max_uses_per_user = excluded.max_uses_per_user,
       expires_at = excluded.expires_at`,
  );
  const applySeeds = db.transaction(() => {
    for (const seed of seeds) {
      const code = String(seed.code || "").trim().toUpperCase();
      const rewardAmount = Number(seed.rewardAmount);
      const maxTotalUses = Number(seed.maxTotalUses ?? 1);
      const maxUsesPerUser = Number(seed.maxUsesPerUser ?? 1);
      if (
        !/^[A-Z0-9_-]{4,40}$/.test(code) ||
        !Number.isSafeInteger(rewardAmount) ||
        rewardAmount <= 0 ||
        !Number.isSafeInteger(maxTotalUses) ||
        maxTotalUses <= 0 ||
        !Number.isSafeInteger(maxUsesPerUser) ||
        maxUsesPerUser <= 0
      ) {
        throw new Error(`Invalid bonus code seed: ${code || "(empty)"}`);
      }
      upsert.run(
        code,
        rewardAmount,
        String(seed.description || ""),
        seed.isActive === false ? 0 : 1,
        seed.isUnlimited === true ? 1 : 0,
        maxTotalUses,
        maxUsesPerUser,
        seed.expiresAt || null,
      );
    }
  });
  applySeeds();
}

seedBonusCodes();

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    balance: user.balance,
    initialBalance: user.initial_balance,
    highestBalance: user.highest_balance,
    totalProfit: user.total_profit,
    totalBet: user.total_bet,
    totalWin: user.total_win,
    totalLoss: user.total_loss,
    nicknameChangeCount: user.nickname_change_count || 0,
    bankruptcyCount: user.bankruptcy_count || 0,
    lastBankruptcyAt: user.last_bankruptcy_at || null,
    isAdmin: user.username === "admin",
    createdAt: user.created_at,
    mineClickCount: user.mine_click_count || 0,
    mineTotalEarned: user.mine_total_earned || 0,
    lastMinedAt: user.last_mined_at || null,
  };
}
