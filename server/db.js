import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";
import { calculateUserTotalEvaluatedAsset } from "./services/portfolioValuationService.js";
import {
  EOK,
  JO,
  enforceStockMarketLimit,
  initializeStockDelistingLifecycle,
} from "./services/stockService.js";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_number INTEGER NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ended_at TEXT,
    ended_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_season
    ON seasons(status)
    WHERE status = 'active';

  CREATE TABLE IF NOT EXISTS season_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    nickname_snapshot TEXT NOT NULL,
    rank INTEGER NOT NULL,
    final_balance INTEGER NOT NULL,
    final_stock_value INTEGER NOT NULL DEFAULT 0,
    final_total_evaluated_asset INTEGER NOT NULL,
    total_profit INTEGER NOT NULL DEFAULT 0,
    total_games INTEGER NOT NULL DEFAULT 0,
    starting_bonus_for_next_season INTEGER NOT NULL DEFAULT 1000000,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(season_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_season_results_season_rank
    ON season_results(season_id, rank ASC);

  CREATE TABLE IF NOT EXISTS user_season_notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL,
    notice_type TEXT NOT NULL,
    seen_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(user_id, season_id, notice_type)
  );

  CREATE INDEX IF NOT EXISTS idx_user_season_notices_user
    ON user_season_notices(user_id, seen_at, created_at DESC);

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
    jackpot_tickets INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS jackpot_rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    draw_at TEXT NOT NULL,
    drawn_at TEXT,
    total_prize_amount INTEGER NOT NULL DEFAULT 0,
    total_extra_entries INTEGER NOT NULL DEFAULT 0,
    total_effective_entries INTEGER NOT NULL DEFAULT 0,
    winner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    winner_nickname_snapshot TEXT,
    winner_entry_count INTEGER,
    winner_prize_amount INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS jackpot_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL REFERENCES jackpot_rounds(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    extra_entry_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(round_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS user_jackpot_notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    round_id INTEGER NOT NULL REFERENCES jackpot_rounds(id) ON DELETE CASCADE,
    notice_type TEXT NOT NULL,
    seen_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS jackpot_contributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL REFERENCES jackpot_rounds(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(source_type, source_id)
  );

  CREATE INDEX IF NOT EXISTS idx_jackpot_contributions_round
    ON jackpot_contributions(round_id, created_at DESC);

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
    season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
    season_number INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_game_logs_user_created
    ON game_logs(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS cup_game_rounds (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
    season_number INTEGER,
    balance_before INTEGER NOT NULL,
    cup_count INTEGER NOT NULL CHECK (cup_count BETWEEN 3 AND 8),
    bet_amount INTEGER NOT NULL CHECK (bet_amount >= 1000),
    winning_cup_index INTEGER NOT NULL,
    selected_cup_index INTEGER,
    multiplier INTEGER NOT NULL,
    won INTEGER,
    gross_payout INTEGER,
    gross_profit INTEGER,
    prize_contribution INTEGER NOT NULL DEFAULT 0,
    final_payout INTEGER,
    status TEXT NOT NULL DEFAULT 'awaiting_pick',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    settled_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_cup_game_rounds_user_created
    ON cup_game_rounds(user_id, created_at DESC);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_cup_game_rounds_one_active
    ON cup_game_rounds(user_id) WHERE status = 'awaiting_pick';

  CREATE TABLE IF NOT EXISTS game_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_type TEXT NOT NULL,
    bet_amount INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
    season_number INTEGER,
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
    season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
    season_number INTEGER,
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
    season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
    season_number INTEGER,
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
    season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
    season_number INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_transfer_sender_created
    ON transfer_logs(sender_user_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_transfer_receiver_created
    ON transfer_logs(receiver_user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS abuse_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action_type TEXT NOT NULL,
    reason TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_abuse_logs_user_created
    ON abuse_logs(user_id, created_at DESC);

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
    season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
    season_number INTEGER,
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
    season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
    season_number INTEGER,
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
    season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
    season_number INTEGER,
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
    is_trading_suspended INTEGER NOT NULL DEFAULT 0 CHECK (is_trading_suspended IN (0, 1)),
    is_market_cap_warning INTEGER NOT NULL DEFAULT 0 CHECK (is_market_cap_warning IN (0, 1)),
    delist_risk_status TEXT NOT NULL DEFAULT 'normal',
    caution_tick_count INTEGER NOT NULL DEFAULT 0,
    recovery_started_at TEXT,
    recovery_tick_count INTEGER NOT NULL DEFAULT 0,
    recovery_required_ticks INTEGER NOT NULL DEFAULT 6,
    delist_review_started_at TEXT,
    delist_review_tick_count INTEGER NOT NULL DEFAULT 0,
    delist_review_max_ticks INTEGER NOT NULL DEFAULT 180,
    final_crash_at TEXT,
    final_crash_reason TEXT,
    is_bluechip INTEGER NOT NULL DEFAULT 0,
    blue_chip_selected_at TEXT,
    blue_chip_selected_by_user_id INTEGER,
    blue_chip_cancelled_at TEXT,
    blue_chip_day_open_price INTEGER,
    blue_chip_day_started_at TEXT,
    blue_chip_daily_high_limit_price INTEGER,
    blue_chip_daily_low_limit_price INTEGER,
    etf_tracking_type TEXT,
    etf_base_price INTEGER,
    etf_base_top_balance INTEGER,
    etf_last_tracked_balance INTEGER,
    etf_acquisition_cost REAL,
    description TEXT,
    sector TEXT,
    listed_at TEXT,
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
    season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
    season_number INTEGER,
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
    season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
    season_number INTEGER,
    opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    closed_at TEXT,
    liquidated_at TEXT,
    close_price INTEGER,
    payout_amount INTEGER,
    detail_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_stock_positions_user_status
    ON stock_positions(user_id, status);
  
  CREATE INDEX IF NOT EXISTS idx_stock_positions_stock_status
    ON stock_positions(stock_id, status);

  CREATE TABLE IF NOT EXISTS stock_watchlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stock_id INTEGER NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(user_id, stock_id)
  );

  CREATE INDEX IF NOT EXISTS idx_stock_watchlists_user
    ON stock_watchlists(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS stock_price_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stock_id INTEGER NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
    target_price INTEGER NOT NULL CHECK (target_price > 0),
    direction TEXT NOT NULL CHECK (direction IN ('above', 'below')),
    triggered_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_stock_price_alerts_active
    ON stock_price_alerts(stock_id, triggered_at);

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
    detail_json TEXT NOT NULL DEFAULT '{}',
    season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
    season_number INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_stock_trades_user
    ON stock_trades(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS user_stock_stat_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stat_type TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 1 CHECK (amount > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(user_id, stat_type, source_type, source_id)
  );

  CREATE INDEX IF NOT EXISTS idx_user_stock_stat_events_user
    ON user_stock_stat_events(user_id, stat_type, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_stock_trades_stock_user_created
    ON stock_trades(stock_id, user_id, created_at DESC);

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

  CREATE TABLE IF NOT EXISTS sector_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sector TEXT NOT NULL,
    sentiment TEXT NOT NULL CHECK (sentiment IN ('good', 'bad', 'volatile')),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    effect_until TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sector_events_active
    ON sector_events(sector, effect_until DESC);

  CREATE TABLE IF NOT EXISTS economy_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    audit_type TEXT NOT NULL,
    summary_json TEXT NOT NULL DEFAULT '{}',
    issues_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS daily_missions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_key TEXT NOT NULL,
    mission_type TEXT NOT NULL,
    title TEXT NOT NULL,
    target_count INTEGER NOT NULL,
    reward_type TEXT NOT NULL,
    reward_amount INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(date_key, mission_type)
  );

  CREATE TABLE IF NOT EXISTS user_daily_mission_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mission_id INTEGER NOT NULL REFERENCES daily_missions(id) ON DELETE CASCADE,
    progress_count INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    claimed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(user_id, mission_id)
  );

  CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS market_regimes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_regime TEXT NOT NULL CHECK (market_regime IN ('strong_bull', 'bull', 'sideways', 'bear', 'panic')),
    strength REAL NOT NULL DEFAULT 1,
    started_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_market_regimes_active
    ON market_regimes(ends_at DESC);

  CREATE TABLE IF NOT EXISTS stock_corporate_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('earnings_beat', 'earnings_inline', 'earnings_miss', 'dividend', 'share_buyback', 'rights_offering', 'short_squeeze')),
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'recorded', 'paid', 'completed', 'cancelled')),
    expected_revenue INTEGER,
    actual_revenue INTEGER,
    expected_profit INTEGER,
    actual_profit INTEGER,
    surprise_rate REAL,
    dividend_rate REAL,
    record_at TEXT,
    pay_at TEXT,
    starts_at TEXT,
    ends_at TEXT,
    applied_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_stock_corporate_events_active
    ON stock_corporate_events(stock_id, status, ends_at);

  CREATE TABLE IF NOT EXISTS stock_dividend_entitlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    corporate_event_id INTEGER NOT NULL REFERENCES stock_corporate_events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stock_id INTEGER NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
    quantity REAL NOT NULL,
    record_price INTEGER NOT NULL,
    payout_amount INTEGER NOT NULL,
    paid_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(corporate_event_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS owner_etf_tracking_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    valuation_cycle_id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tracking_asset INTEGER NOT NULL,
    calculated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(valuation_cycle_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_owner_etf_tracking_snapshots_user
    ON owner_etf_tracking_snapshots(user_id, id DESC);

  CREATE TABLE IF NOT EXISTS daily_user_asset_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date_key TEXT NOT NULL,
    start_total_asset INTEGER NOT NULL,
    end_total_asset INTEGER,
    adjusted_start_asset INTEGER,
    adjusted_end_asset INTEGER,
    absolute_loss INTEGER,
    loss_rate REAL,
    incoming_transfers INTEGER NOT NULL DEFAULT 0,
    outgoing_transfers INTEGER NOT NULL DEFAULT 0,
    admin_adjustments INTEGER NOT NULL DEFAULT 0,
    bankruptcy_adjustments INTEGER NOT NULL DEFAULT 0,
    season_adjustments INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    finalized_at TEXT,
    UNIQUE(user_id, date_key)
  );

  CREATE INDEX IF NOT EXISTS idx_daily_user_asset_snapshots_date
    ON daily_user_asset_snapshots(date_key, loss_rate DESC);

  CREATE TABLE IF NOT EXISTS daily_unlucky_awards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_key TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    loss_rate REAL NOT NULL,
    absolute_loss INTEGER NOT NULL,
    start_total_asset INTEGER NOT NULL,
    end_total_asset INTEGER NOT NULL,
    awarded_luck_tickets INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS hostile_takeover_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
    attacker_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    defender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attack_cash INTEGER NOT NULL,
    defense_cash INTEGER NOT NULL DEFAULT 0,
    attacker_asset_snapshot INTEGER NOT NULL,
    defender_asset_snapshot INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'declared' CHECK (status IN ('declared', 'defended', 'resolved_attack', 'resolved_defense', 'cancelled')),
    declared_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ends_at TEXT NOT NULL,
    resolved_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_hostile_takeover_events_one_active
    ON hostile_takeover_events(stock_id)
    WHERE status IN ('declared', 'defended');

  CREATE TABLE IF NOT EXISTS hostile_takeover_supports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hostile_takeover_event_id INTEGER NOT NULL REFERENCES hostile_takeover_events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    side TEXT NOT NULL CHECK (side IN ('attack', 'defense')),
    cash_amount INTEGER NOT NULL DEFAULT 0 CHECK (cash_amount >= 0),
    delegated_share_quantity INTEGER NOT NULL DEFAULT 0 CHECK (delegated_share_quantity >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(hostile_takeover_event_id, user_id, side)
  );

  CREATE INDEX IF NOT EXISTS idx_hostile_takeover_supports_event
    ON hostile_takeover_supports(hostile_takeover_event_id, side);

  CREATE TABLE IF NOT EXISTS user_asset_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    valuation_cycle_id TEXT NOT NULL,
    cash_balance INTEGER NOT NULL,
    gross_stock_market_value INTEGER NOT NULL,
    estimated_stock_sell_fees INTEGER NOT NULL,
    estimated_stock_taxes INTEGER NOT NULL,
    stock_net_liquidation_value INTEGER NOT NULL,
    leverage_gross_settlement_value INTEGER NOT NULL,
    estimated_leverage_close_fees INTEGER NOT NULL,
    estimated_leverage_taxes INTEGER NOT NULL,
    leverage_net_settlement_value INTEGER NOT NULL,
    other_eligible_asset_value INTEGER NOT NULL DEFAULT 0,
    total_evaluated_asset INTEGER NOT NULL,
    valuation_complete INTEGER NOT NULL DEFAULT 1 CHECK (valuation_complete IN (0, 1)),
    valuation_errors_json TEXT NOT NULL DEFAULT '[]',
    holdings_json TEXT NOT NULL DEFAULT '[]',
    positions_json TEXT NOT NULL DEFAULT '[]',
    is_valid INTEGER NOT NULL DEFAULT 1 CHECK (is_valid IN (0, 1)),
    calculated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    invalidated_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_user_asset_snapshots_latest
    ON user_asset_snapshots(user_id, is_valid, id DESC);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_user_asset_snapshots_cycle_user
    ON user_asset_snapshots(valuation_cycle_id, user_id);

  CREATE TABLE IF NOT EXISTS season_reward_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed', 'running', 'completed', 'failed')),
    user_ranking_json TEXT NOT NULL,
    company_ranking_json TEXT NOT NULL,
    error_message TEXT,
    started_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(season_id)
  );

  CREATE TABLE IF NOT EXISTS season_reward_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES season_reward_jobs(id) ON DELETE CASCADE,
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    winner_rank INTEGER NOT NULL CHECK (winner_rank BETWEEN 1 AND 3),
    winner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_rank INTEGER NOT NULL CHECK (company_rank BETWEEN 2 AND 4),
    source_stock_id INTEGER NOT NULL REFERENCES stocks(id) ON DELETE RESTRICT,
    target_etf_stock_id INTEGER REFERENCES stocks(id) ON DELETE SET NULL,
    action TEXT CHECK (action IN ('convert', 'merge')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    detail_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    completed_at TEXT,
    UNIQUE(season_id, winner_rank),
    UNIQUE(season_id, source_stock_id)
  );

  CREATE TABLE IF NOT EXISTS etf_hourly_interest_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hour_key TEXT NOT NULL,
    pre_interest_total_evaluated_asset INTEGER NOT NULL,
    interest_rate REAL NOT NULL,
    interest_amount INTEGER NOT NULL,
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    eligible_reason_json TEXT NOT NULL DEFAULT '{}',
    valuation_snapshot_id INTEGER REFERENCES user_asset_snapshots(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'skipped_no_snapshot')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(user_id, hour_key)
  );

  CREATE INDEX IF NOT EXISTS idx_etf_hourly_interest_hour
    ON etf_hourly_interest_events(hour_key, status);
`);

function tableColumns(tableName) {
  return new Set(
    db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name),
  );
}

function addColumnIfMissing(tableName, columnName, definition) {
  const columns = tableColumns(tableName);
  if (!columns.has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

db.exec(`
  INSERT INTO seasons (season_number, status)
  SELECT COALESCE((SELECT MAX(season_number) FROM seasons), 0) + 1, 'active'
  WHERE NOT EXISTS (SELECT 1 FROM seasons WHERE status = 'active');
`);

addColumnIfMissing("season_results", "starting_bonus_for_next_season", "INTEGER NOT NULL DEFAULT 1000000");
addColumnIfMissing("hostile_takeover_events", "target_market_cap_snapshot", "INTEGER");
addColumnIfMissing("hostile_takeover_events", "target_price_snapshot", "INTEGER");
addColumnIfMissing("hostile_takeover_events", "target_total_shares_snapshot", "INTEGER");
addColumnIfMissing("hostile_takeover_events", "target_owner_user_id_snapshot", "INTEGER");
addColumnIfMissing("hostile_takeover_events", "attacker_total_evaluated_asset_snapshot", "INTEGER");
addColumnIfMissing("hostile_takeover_events", "attacker_cash_snapshot", "INTEGER");
addColumnIfMissing("hostile_takeover_events", "acquisition_cost_snapshot", "INTEGER");
addColumnIfMissing("hostile_takeover_events", "attack_strength", "INTEGER");
addColumnIfMissing("hostile_takeover_events", "defense_strength", "INTEGER");

for (const tableName of [
  "game_logs",
  "game_sessions",
  "user_achievements",
  "asset_events",
  "transfer_logs",
  "bonus_code_redemptions",
  "server_notifications",
  "mine_logs",
  "stock_holdings",
  "stock_positions",
  "stock_trades",
  "cup_game_rounds",
]) {
  addColumnIfMissing(tableName, "season_id", "INTEGER REFERENCES seasons(id) ON DELETE SET NULL");
  addColumnIfMissing(tableName, "season_number", "INTEGER");
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_${tableName}_season_stamp
    AFTER INSERT ON ${tableName}
    WHEN NEW.season_id IS NULL
    BEGIN
      UPDATE ${tableName}
      SET season_id = (SELECT id FROM seasons WHERE status = 'active' ORDER BY season_number DESC LIMIT 1),
          season_number = (SELECT season_number FROM seasons WHERE status = 'active' ORDER BY season_number DESC LIMIT 1)
      WHERE id = NEW.id;
    END;

    UPDATE ${tableName}
    SET season_id = COALESCE(season_id, (SELECT id FROM seasons WHERE status = 'active' ORDER BY season_number DESC LIMIT 1)),
        season_number = COALESCE(season_number, (SELECT season_number FROM seasons WHERE status = 'active' ORDER BY season_number DESC LIMIT 1))
    WHERE season_id IS NULL OR season_number IS NULL;
  `);
}

addColumnIfMissing("stock_positions", "close_price", "INTEGER");
addColumnIfMissing("stock_positions", "payout_amount", "INTEGER");
addColumnIfMissing("stock_positions", "detail_json", "TEXT NOT NULL DEFAULT '{}'");
addColumnIfMissing("stock_trades", "detail_json", "TEXT NOT NULL DEFAULT '{}'");
addColumnIfMissing("stock_holdings", "total_cost_basis", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("stock_holdings", "total_buy_fees", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("stock_holdings", "realized_profit", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("stock_positions", "total_open_fees", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("stock_positions", "round_trip_counted_at", "TEXT");
addColumnIfMissing("cup_game_rounds", "initial_winning_cup_id", "TEXT");
addColumnIfMissing("cup_game_rounds", "selected_cup_id", "TEXT");
addColumnIfMissing("cup_game_rounds", "shuffle_operations_json", "TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing("cup_game_rounds", "cup_order_json", "TEXT NOT NULL DEFAULT '[]'");

db.exec(`
  CREATE TABLE IF NOT EXISTS user_stock_tax_ledgers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    cumulative_realized_profit INTEGER NOT NULL DEFAULT 0,
    cumulative_realized_loss INTEGER NOT NULL DEFAULT 0,
    cumulative_net_taxable_profit INTEGER NOT NULL DEFAULT 0,
    cumulative_tax_assessed INTEGER NOT NULL DEFAULT 0,
    cumulative_tax_paid INTEGER NOT NULL DEFAULT 0,
    tax_credit_balance INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(user_id, season_id)
  );
  CREATE INDEX IF NOT EXISTS idx_user_stock_tax_ledgers_user_season
    ON user_stock_tax_ledgers(user_id, season_id);
`);

db.exec(`
  UPDATE stock_holdings
  SET total_cost_basis = CASE
        WHEN total_cost_basis IS NULL OR total_cost_basis <= 0
          THEN MAX(0, CAST(ROUND(quantity * average_price) AS INTEGER))
        ELSE total_cost_basis
      END,
      total_buy_fees = COALESCE(total_buy_fees, 0),
      realized_profit = COALESCE(realized_profit, 0);
  UPDATE stock_holdings
  SET average_price = CASE
        WHEN quantity > 0 THEN CAST(total_cost_basis AS REAL) / quantity
        ELSE 0
      END
  WHERE quantity > 0;
`);

// A position bucket is one user + stock + side + leverage. Older releases could
// leave duplicate open rows behind, so merge those rows before enforcing the
// invariant with the partial unique index below.
const duplicatePositionBuckets = db.prepare(`
  SELECT user_id, stock_id, side, leverage, MIN(id) AS keeper_id
  FROM stock_positions
  WHERE status = 'open'
  GROUP BY user_id, stock_id, side, leverage
  HAVING COUNT(*) > 1
`).all();
for (const bucket of duplicatePositionBuckets) {
  const rows = db.prepare(`
    SELECT * FROM stock_positions
    WHERE user_id = ? AND stock_id = ? AND side = ? AND leverage = ? AND status = 'open'
    ORDER BY id ASC
  `).all(bucket.user_id, bucket.stock_id, bucket.side, bucket.leverage);
  const quantity = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const positionSize = rows.reduce((sum, row) => sum + Number(row.position_size || 0), 0);
  const marginAmount = rows.reduce((sum, row) => sum + Number(row.margin_amount || 0), 0);
  const totalOpenFees = rows.reduce((sum, row) => sum + Number(row.total_open_fees || 0), 0);
  const entryPrice = quantity > 0
    ? rows.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.entry_price || 0), 0) / quantity
    : Number(rows[0]?.entry_price || 0);
  const liquidationPrice = bucket.side === "short"
    ? Math.ceil(entryPrice * (1 + 1 / Number(bucket.leverage || 1)))
    : Math.floor(entryPrice * (1 - 1 / Number(bucket.leverage || 1)));
  db.prepare(`
    UPDATE stock_positions
    SET quantity = ?, position_size = ?, margin_amount = ?, entry_price = ?, liquidation_price = ?,
        total_open_fees = ?, detail_json = ?
    WHERE id = ?
  `).run(quantity, positionSize, marginAmount, entryPrice, liquidationPrice, totalOpenFees, JSON.stringify({
    mergedAtStartup: true,
    mergedPositionIds: rows.map((row) => row.id),
  }), bucket.keeper_id);
  if (rows.length > 1) {
    db.prepare(`
      UPDATE stock_positions
      SET status = 'merged', closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id IN (${rows.slice(1).map(() => "?").join(",")})
    `).run(...rows.slice(1).map((row) => row.id));
  }
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_positions_open_bucket
    ON stock_positions(user_id, stock_id, side, leverage)
    WHERE status = 'open';
`);

addColumnIfMissing("season_results", "final_cash_balance", "INTEGER");
addColumnIfMissing("season_results", "final_gross_stock_value", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("season_results", "final_estimated_stock_tax", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("season_results", "final_stock_net_value", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("season_results", "final_leverage_net_value", "INTEGER NOT NULL DEFAULT 0");

const stockColumns = new Set(
  db.prepare("PRAGMA table_info(stocks)").all().map((column) => column.name),
);
addColumnIfMissing("stocks", "listed_at", "TEXT");
if (!stockColumns.has("ipo_subscription_started_at")) {
  db.exec("ALTER TABLE stocks ADD COLUMN ipo_subscription_started_at TEXT");
  db.exec("ALTER TABLE stocks ADD COLUMN ipo_subscription_ends_at TEXT");
  db.exec("ALTER TABLE stocks ADD COLUMN offering_price INTEGER");
  db.exec("ALTER TABLE stocks ADD COLUMN newly_listed_until TEXT");
  db.exec("ALTER TABLE stocks ADD COLUMN delist_phase INTEGER NOT NULL DEFAULT 0");
  db.exec("ALTER TABLE stocks ADD COLUMN delist_phase_total INTEGER NOT NULL DEFAULT 0");
  db.exec("ALTER TABLE stocks ADD COLUMN delist_warning_started_at TEXT");
  db.exec("ALTER TABLE stocks ADD COLUMN etf_base_owner_asset INTEGER");
  db.exec("ALTER TABLE stocks ADD COLUMN etf_last_tracked_owner_asset INTEGER");
}

addColumnIfMissing("stocks", "ipo_opening_event_done", "INTEGER NOT NULL DEFAULT 0 CHECK (ipo_opening_event_done IN (0, 1))");
addColumnIfMissing("stocks", "ipo_opening_event_type", "TEXT");
addColumnIfMissing("stocks", "ipo_opening_change_rate", "REAL");

if (!stockColumns.has("is_bluechip")) {
  db.exec("ALTER TABLE stocks ADD COLUMN is_bluechip INTEGER NOT NULL DEFAULT 0");
}

if (!stockColumns.has("blue_chip_selected_at")) {
  db.exec("ALTER TABLE stocks ADD COLUMN blue_chip_selected_at TEXT");
  db.exec("ALTER TABLE stocks ADD COLUMN blue_chip_selected_by_user_id INTEGER");
  db.exec("ALTER TABLE stocks ADD COLUMN blue_chip_cancelled_at TEXT");
}

if (!stockColumns.has("blue_chip_day_open_price")) {
  db.exec("ALTER TABLE stocks ADD COLUMN blue_chip_day_open_price INTEGER");
}
if (!stockColumns.has("blue_chip_day_started_at")) {
  db.exec("ALTER TABLE stocks ADD COLUMN blue_chip_day_started_at TEXT");
}
if (!stockColumns.has("blue_chip_daily_high_limit_price")) {
  db.exec("ALTER TABLE stocks ADD COLUMN blue_chip_daily_high_limit_price INTEGER");
}
if (!stockColumns.has("blue_chip_daily_low_limit_price")) {
  db.exec("ALTER TABLE stocks ADD COLUMN blue_chip_daily_low_limit_price INTEGER");
}

addColumnIfMissing("stocks", "blue_chip_ramp_active", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("stocks", "blue_chip_target_price", "INTEGER");
addColumnIfMissing("stocks", "blue_chip_ramp_percent_per_tick", "REAL");
addColumnIfMissing("stocks", "blue_chip_ramp_started_at", "TEXT");
addColumnIfMissing("stocks", "blue_chip_ramp_ended_at", "TEXT");
addColumnIfMissing("stocks", "blue_chip_ramp_reason", "TEXT");
addColumnIfMissing("stocks", "blue_chip_ramp_started_by_user_id", "INTEGER");

addColumnIfMissing("stocks", "admin_price_target_active", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("stocks", "admin_price_target", "INTEGER");
addColumnIfMissing("stocks", "admin_price_target_direction", "TEXT");
addColumnIfMissing("stocks", "admin_price_target_percent_per_tick", "REAL");
addColumnIfMissing("stocks", "admin_price_target_started_at", "TEXT");
addColumnIfMissing("stocks", "admin_price_target_ended_at", "TEXT");
addColumnIfMissing("stocks", "admin_price_target_reason", "TEXT");
addColumnIfMissing("stocks", "admin_price_target_started_by_user_id", "INTEGER");
addColumnIfMissing("stocks", "sector", "TEXT");
addColumnIfMissing("stocks", "etf_delist_reference_price", "INTEGER");
addColumnIfMissing("stocks", "etf_delist_reference_set_at", "TEXT");
addColumnIfMissing("stocks", "etf_delist_trigger_price", "INTEGER");
addColumnIfMissing("stocks", "etf_delist_triggered_at", "TEXT");
addColumnIfMissing("stocks", "etf_delist_reason", "TEXT");
addColumnIfMissing("stocks", "trend_regime", "TEXT");
addColumnIfMissing("stocks", "trend_regime_started_at", "TEXT");
addColumnIfMissing("stocks", "trend_regime_ends_at", "TEXT");
addColumnIfMissing("stocks", "trend_market_cap_basis", "INTEGER");
addColumnIfMissing("stocks", "trend_drift_per_tick", "REAL");
addColumnIfMissing("stocks", "trend_volatility", "REAL");
addColumnIfMissing("stocks", "market_cap_ema_24h", "INTEGER");
addColumnIfMissing("stocks", "market_cap_ema_7d", "INTEGER");
addColumnIfMissing("stocks", "initial_market_cap", "INTEGER");
addColumnIfMissing("stocks", "stability_market_cap", "INTEGER");
addColumnIfMissing("stocks", "stability_tier", "TEXT");
addColumnIfMissing("stocks", "stability_tier_candidate", "TEXT");
addColumnIfMissing("stocks", "stability_tier_candidate_since", "TEXT");
addColumnIfMissing("stocks", "stability_tier_entered_at", "TEXT");
addColumnIfMissing("stocks", "last_stability_update_at", "TEXT");
addColumnIfMissing("stocks", "daily_anchor_price", "INTEGER");
addColumnIfMissing("stocks", "daily_anchor_at", "TEXT");
addColumnIfMissing("stocks", "circuit_breaker_count", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("stocks", "circuit_breaker_reason", "TEXT");
addColumnIfMissing("stocks", "market_cap_tier_started_at", "TEXT");
addColumnIfMissing("stocks", "trading_halted_until", "TEXT");
addColumnIfMissing("stocks", "treasury_shares", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("stocks", "distress_risk_score", "REAL NOT NULL DEFAULT 0");
addColumnIfMissing("stocks", "distress_risk_started_at", "TEXT");
addColumnIfMissing("stocks", "distress_observation_started_at", "TEXT");
addColumnIfMissing("stocks", "distress_last_evaluated_at", "TEXT");
addColumnIfMissing("stocks", "season_reward_origin_season_id", "INTEGER");
addColumnIfMissing("stocks", "season_reward_winner_user_id", "INTEGER");
addColumnIfMissing("stocks", "season_reward_source_stock_id", "INTEGER");
addColumnIfMissing("stocks", "merged_into_stock_id", "INTEGER");
addColumnIfMissing("stocks", "merged_at", "TEXT");

db.exec(`
  UPDATE stocks SET
    initial_market_cap = COALESCE(NULLIF(initial_market_cap,0), market_cap),
    market_cap_ema_24h = COALESCE(NULLIF(market_cap_ema_24h,0), market_cap),
    market_cap_ema_7d = COALESCE(NULLIF(market_cap_ema_7d,0), market_cap),
    stability_market_cap = COALESCE(NULLIF(stability_market_cap,0), market_cap),
    stability_tier = COALESCE(stability_tier, CASE
      WHEN is_bluechip=1 THEN 'BLUE_CHIP' WHEN market_cap>=1000000000000 THEN 'GIANT'
      WHEN market_cap>=500000000000 THEN 'MEGA' WHEN market_cap>=150000000000 THEN 'LARGE'
      WHEN market_cap>=50000000000 THEN 'MID' WHEN market_cap>=5000000000 THEN 'SMALL' ELSE 'DELIST_RISK' END),
    stability_tier_entered_at = COALESCE(stability_tier_entered_at,created_at),
    last_stability_update_at = COALESCE(last_stability_update_at,updated_at,created_at),
    daily_anchor_price = COALESCE(NULLIF(daily_anchor_price,0),current_price),
    daily_anchor_at = COALESCE(daily_anchor_at,updated_at,created_at)
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS stock_price_guard_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    reference_price INTEGER NOT NULL,
    observed_price INTEGER NOT NULL,
    protected_price INTEGER NOT NULL,
    change_5m_bps INTEGER,
    change_30m_bps INTEGER,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_stock_price_guard_events_stock ON stock_price_guard_events(stock_id,created_at DESC);
`);

addColumnIfMissing("admin_logs", "target_stock_id", "INTEGER REFERENCES stocks(id) ON DELETE SET NULL");
addColumnIfMissing("admin_logs", "reason", "TEXT");

db.exec(`
  UPDATE stocks
  SET etf_delist_reference_price = COALESCE(etf_delist_reference_price, etf_base_price, current_price),
      etf_delist_reference_set_at = COALESCE(etf_delist_reference_set_at, listed_at, created_at),
      etf_delist_trigger_price = COALESCE(
        etf_delist_trigger_price,
        MAX(1, CAST(COALESCE(etf_delist_reference_price, etf_base_price, current_price) * 0.15 AS INTEGER))
      )
  WHERE is_etf = 1
    AND etf_tracking_type = 'owner_asset'
    AND status = 'acquired'
`);

db.exec(`
  UPDATE stocks
  SET market_cap_ema_24h = COALESCE(market_cap_ema_24h, market_cap),
      trend_market_cap_basis = COALESCE(trend_market_cap_basis, market_cap),
      trend_volatility = COALESCE(trend_volatility, volatility),
      market_cap_tier_started_at = COALESCE(market_cap_tier_started_at, updated_at, created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  WHERE status != 'delisted'
`);

db.exec(`
  UPDATE stocks
  SET listed_at = COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  WHERE (listed_at IS NULL OR listed_at = '')
    AND status IN ('listed', 'newly_listed', 'caution', 'delist_review', 'recovery', 'acquired')
`);

db.exec(`
  UPDATE stocks
  SET sector = CASE
    WHEN name LIKE '%AI%' OR name LIKE '%데이터%' OR name LIKE '%스마트%' OR name LIKE '%로봇%' THEN 'AI'
    WHEN name LIKE '%보안%' OR name LIKE '%자물쇠%' OR name LIKE '%시큐%' THEN '보안'
    WHEN name LIKE '%게임%' OR name LIKE '%플레이%' OR name LIKE '%엔터%' THEN '게임'
    WHEN name LIKE '%식품%' OR name LIKE '%푸드%' OR name LIKE '%우유%' OR name LIKE '%커피%' THEN '식품'
    WHEN name LIKE '%에너지%' OR name LIKE '%전기%' OR name LIKE '%배터리%' THEN '에너지'
    WHEN name LIKE '%광업%' OR name LIKE '%다이아%' OR name LIKE '%금광%' OR name LIKE '%마인%' THEN '광업'
    WHEN name LIKE '%바이오%' OR name LIKE '%헬스%' OR name LIKE '%제약%' THEN '바이오'
    WHEN name LIKE '%미디어%' OR name LIKE '%방송%' OR name LIKE '%스튜디오%' THEN '미디어'
    WHEN name LIKE '%운송%' OR name LIKE '%물류%' OR name LIKE '%항공%' THEN '운송'
    WHEN name LIKE '%금융%' OR name LIKE '%뱅크%' OR name LIKE '%캐피탈%' OR name LIKE '%페이%' THEN '금융'
    ELSE '소비재'
  END
  WHERE sector IS NULL OR sector = ''
`);

db.exec(`
  UPDATE stocks
  SET blue_chip_day_open_price = COALESCE(blue_chip_day_open_price, current_price),
      blue_chip_day_started_at = COALESCE(
        blue_chip_day_started_at,
        blue_chip_selected_at,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ),
      blue_chip_daily_high_limit_price = COALESCE(
        blue_chip_daily_high_limit_price,
        CAST(current_price * 1.15 AS INTEGER)
      ),
      blue_chip_daily_low_limit_price = COALESCE(
        blue_chip_daily_low_limit_price,
        MAX(1, CAST(current_price * 0.87 AS INTEGER))
      )
  WHERE is_bluechip = 1
`);

if (!stockColumns.has("is_trading_suspended")) {
  db.exec(
    "ALTER TABLE stocks ADD COLUMN is_trading_suspended INTEGER NOT NULL DEFAULT 0 CHECK (is_trading_suspended IN (0, 1))",
  );
}
if (!stockColumns.has("is_market_cap_warning")) {
  db.exec(
    "ALTER TABLE stocks ADD COLUMN is_market_cap_warning INTEGER NOT NULL DEFAULT 0 CHECK (is_market_cap_warning IN (0, 1))",
  );
}
if (!stockColumns.has("delist_risk_status")) {
  db.exec("ALTER TABLE stocks ADD COLUMN delist_risk_status TEXT NOT NULL DEFAULT 'normal'");
}
if (!stockColumns.has("caution_tick_count")) {
  db.exec("ALTER TABLE stocks ADD COLUMN caution_tick_count INTEGER NOT NULL DEFAULT 0");
}
if (!stockColumns.has("recovery_started_at")) {
  db.exec("ALTER TABLE stocks ADD COLUMN recovery_started_at TEXT");
}
addColumnIfMissing("stocks", "description", "TEXT");
if (!stockColumns.has("recovery_tick_count")) {
  db.exec("ALTER TABLE stocks ADD COLUMN recovery_tick_count INTEGER NOT NULL DEFAULT 0");
}
if (!stockColumns.has("recovery_required_ticks")) {
  db.exec("ALTER TABLE stocks ADD COLUMN recovery_required_ticks INTEGER NOT NULL DEFAULT 6");
}
if (!stockColumns.has("delist_review_started_at")) {
  db.exec("ALTER TABLE stocks ADD COLUMN delist_review_started_at TEXT");
}
if (!stockColumns.has("delist_review_tick_count")) {
  db.exec("ALTER TABLE stocks ADD COLUMN delist_review_tick_count INTEGER NOT NULL DEFAULT 0");
}
if (!stockColumns.has("delist_review_max_ticks")) {
  db.exec("ALTER TABLE stocks ADD COLUMN delist_review_max_ticks INTEGER NOT NULL DEFAULT 180");
}
if (!stockColumns.has("final_crash_at")) {
  db.exec("ALTER TABLE stocks ADD COLUMN final_crash_at TEXT");
}
if (!stockColumns.has("final_crash_reason")) {
  db.exec("ALTER TABLE stocks ADD COLUMN final_crash_reason TEXT");
}

db.prepare(
  "INSERT OR IGNORE INTO system_config (key, value) VALUES ('market_open', 'true')",
).run();

db.exec(`
  UPDATE stocks
  SET recovery_required_ticks = 6
  WHERE recovery_required_ticks IS NULL OR recovery_required_ticks != 6
`);

const stockEventColumns = new Set(
  db.prepare("PRAGMA table_info(stock_events)").all().map((column) => column.name),
);
if (!stockEventColumns.has("price_before")) {
  db.exec("ALTER TABLE stock_events ADD COLUMN price_before INTEGER");
  db.exec("ALTER TABLE stock_events ADD COLUMN price_after INTEGER");
  db.exec("ALTER TABLE stock_events ADD COLUMN change_amount INTEGER");
  db.exec("ALTER TABLE stock_events ADD COLUMN change_rate REAL");
  db.exec("ALTER TABLE stock_events ADD COLUMN basis TEXT");
}
if (!stockEventColumns.has("sentiment")) {
  db.exec("ALTER TABLE stock_events ADD COLUMN sentiment TEXT");
  db.exec("ALTER TABLE stock_events ADD COLUMN target_price INTEGER");
  db.exec("ALTER TABLE stock_events ADD COLUMN percent_per_tick REAL");
  db.exec("ALTER TABLE stock_events ADD COLUMN created_by_user_id INTEGER");
  db.exec("ALTER TABLE stock_events ADD COLUMN stock_name_snapshot TEXT");
  db.exec("ALTER TABLE stock_events ADD COLUMN symbol_snapshot TEXT");
}

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
if (!userColumns.has("jackpot_tickets")) {
  db.exec("ALTER TABLE users ADD COLUMN jackpot_tickets INTEGER NOT NULL DEFAULT 0");
}
addColumnIfMissing("users", "account_status", "TEXT NOT NULL DEFAULT 'active'");
addColumnIfMissing("users", "is_system_account", "INTEGER NOT NULL DEFAULT 0");

db.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_user_asset_snapshot_users_update
  AFTER UPDATE OF balance ON users
  BEGIN
    UPDATE user_asset_snapshots
    SET is_valid = 0,
        invalidated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE user_id = NEW.id AND is_valid = 1;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_user_asset_snapshot_holdings_insert
  AFTER INSERT ON stock_holdings
  BEGIN
    UPDATE user_asset_snapshots SET is_valid = 0,
      invalidated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE user_id = NEW.user_id AND is_valid = 1;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_user_asset_snapshot_holdings_update
  AFTER UPDATE ON stock_holdings
  BEGIN
    UPDATE user_asset_snapshots SET is_valid = 0,
      invalidated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE user_id IN (OLD.user_id, NEW.user_id) AND is_valid = 1;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_user_asset_snapshot_holdings_delete
  AFTER DELETE ON stock_holdings
  BEGIN
    UPDATE user_asset_snapshots SET is_valid = 0,
      invalidated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE user_id = OLD.user_id AND is_valid = 1;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_user_asset_snapshot_positions_insert
  AFTER INSERT ON stock_positions
  BEGIN
    UPDATE user_asset_snapshots SET is_valid = 0,
      invalidated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE user_id = NEW.user_id AND is_valid = 1;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_user_asset_snapshot_positions_update
  AFTER UPDATE ON stock_positions
  BEGIN
    UPDATE user_asset_snapshots SET is_valid = 0,
      invalidated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE user_id IN (OLD.user_id, NEW.user_id) AND is_valid = 1;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_user_asset_snapshot_positions_delete
  AFTER DELETE ON stock_positions
  BEGIN
    UPDATE user_asset_snapshots SET is_valid = 0,
      invalidated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE user_id = OLD.user_id AND is_valid = 1;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_user_asset_snapshot_stock_price_update
  AFTER UPDATE OF current_price, status ON stocks
  BEGIN
    UPDATE user_asset_snapshots
    SET is_valid = 0,
        invalidated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE is_valid = 1
      AND user_id IN (
        SELECT user_id FROM stock_holdings WHERE stock_id = NEW.id AND quantity > 0
        UNION
        SELECT user_id FROM stock_positions WHERE stock_id = NEW.id AND status = 'open'
      );
  END;
`);

const jackpotEntriesCols = tableColumns("jackpot_entries");
if (jackpotEntriesCols.has("entry_date")) {
  console.log("Migrating jackpot_entries to new round_id schema...");
  db.exec("DROP TABLE jackpot_entries");
  db.exec(`
    CREATE TABLE jackpot_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER NOT NULL REFERENCES jackpot_rounds(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      extra_entry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(round_id, user_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jackpot_entries_round ON jackpot_entries(round_id)`);
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

// Deduplicate existing active stocks
import { STOCK_NAME_POOL } from "./constants/stockNamePool.js";

const migrateDuplicateStocks = db.transaction(() => {
  const activeStocks = db.prepare("SELECT id, name, symbol FROM stocks WHERE status IN ('listed', 'ipo_subscription', 'newly_listed', 'acquired', 'delist_warning', 'final_crash') ORDER BY id ASC").all();
  const allStocks = db.prepare("SELECT id, name, symbol FROM stocks").all();
  const seenNames = new Set();
  const seenSymbols = new Set();
  const usedNames = new Set(allStocks.map((stock) => stock.name));
  const usedSymbols = new Set(allStocks.map((stock) => stock.symbol));
  const update = db.prepare("UPDATE stocks SET name = ?, symbol = ? WHERE id = ?");

  for (const stock of activeStocks) {
    if (seenNames.has(stock.name) || seenSymbols.has(stock.symbol)) {
      const candidates = STOCK_NAME_POOL.filter(item =>
        !usedNames.has(item.name) &&
        !usedSymbols.has(item.symbol)
      );

      let candidate;
      if (candidates.length > 0) {
        candidate = candidates[Math.floor(Math.random() * candidates.length)];
      } else {
        const fallback = STOCK_NAME_POOL[Math.floor(Math.random() * STOCK_NAME_POOL.length)];
        let attempt = 0;
        do {
          const suffix = `${stock.id}-${attempt}`;
          candidate = {
            name: `${fallback.name}-${suffix}`,
            symbol: `${fallback.symbol}-${suffix}`,
          };
          attempt += 1;
        } while (
          usedNames.has(candidate.name) ||
          usedSymbols.has(candidate.symbol)
        );
      }

      update.run(candidate.name, candidate.symbol, stock.id);
      seenNames.add(candidate.name);
      seenSymbols.add(candidate.symbol);
      usedNames.add(candidate.name);
      usedSymbols.add(candidate.symbol);
    } else {
      seenNames.add(stock.name);
      seenSymbols.add(stock.symbol);
    }
  }
});
migrateDuplicateStocks();

// Ensure 3 Blue-chip stocks exist
const initBlueChips = db.transaction(() => {
  const bluechips = [
    { symbol: "SHINS", name: "신성에너지", sector: "에너지" },
    { symbol: "DATAB", name: "데이터주머니", sector: "AI" },
    { symbol: "STARL", name: "별빛에너지", sector: "에너지" }
  ];

  for (const bc of bluechips) {
    const existing = db.prepare("SELECT * FROM stocks WHERE name = ? AND is_bluechip = 1").get(bc.name);
    if (!existing) {
      // If the name exists but is not bluechip, maybe rename the old one or just delete it. We'll rename the old one.
      const old = db.prepare("SELECT * FROM stocks WHERE name = ? AND is_bluechip = 0").get(bc.name);
      if (old) {
        const suffix = Date.now().toString().slice(-4);
        db.prepare("UPDATE stocks SET name = ?, symbol = ? WHERE id = ?").run(`${old.name}${suffix}`, `${old.symbol}${suffix}`, old.id);
      }
      
      const price = 1_000 + Math.floor(Math.random() * 19_001);
      const targetCap = 500 * EOK + Math.floor(Math.random() * (1_000 * EOK));
      const shares = Math.max(1000, Math.floor(targetCap / price));
      const cap = price * shares;
      const volatility = 0.002 + Math.random() * 0.002;
      db.prepare(`
        INSERT INTO stocks (symbol, name, status, current_price, previous_price, initial_price, total_shares, market_cap, volatility, is_bluechip, sector, listed_at)
        VALUES (?, ?, 'listed', ?, ?, ?, ?, ?, ?, 1, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      `).run(bc.symbol, bc.name, price, price, price, shares, cap, volatility, bc.sector);
    }
  }
});
initBlueChips();

const rebaseOversizedStockMarketCaps = db.transaction(() => {
  const migrationKey = "stock_market_cap_rebase_v5";
  if (db.prepare("SELECT 1 FROM system_config WHERE key = ?").get(migrationKey)) return;

  const rows = db
    .prepare(
      `SELECT id, status, current_price, is_bluechip
       FROM stocks
       WHERE status != 'delisted'
         AND status != 'final_crash'
         AND COALESCE(delist_risk_status, 'normal') != 'final_crash'
         AND COALESCE(is_etf, 0) = 0`,
    )
    .all();
  const update = db.prepare(
    `UPDATE stocks
     SET current_price = ?,
         previous_price = ?,
         initial_price = ?,
         offering_price = CASE WHEN status = 'ipo_subscription' THEN ? ELSE offering_price END,
         total_shares = ?,
         market_cap = ?,
         blue_chip_day_open_price = CASE WHEN is_bluechip = 1 THEN ? ELSE blue_chip_day_open_price END,
         blue_chip_day_started_at = CASE WHEN is_bluechip = 1 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE blue_chip_day_started_at END,
         blue_chip_daily_high_limit_price = CASE WHEN is_bluechip = 1 THEN ? ELSE blue_chip_daily_high_limit_price END,
         blue_chip_daily_low_limit_price = CASE WHEN is_bluechip = 1 THEN ? ELSE blue_chip_daily_low_limit_price END,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  );
  const randomBetween = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
  const priceRange = (tierKey) => {
    const ranges = {
      ipo_micro: [100, 1_000],
      ipo_small: [300, 2_000],
      ipo_small_mid: [500, 5_000],
      ipo_mid: [1_000, 10_000],
      ipo_large_rare: [2_000, 20_000],
      bluechip: [1_000, 20_000],
      micro: [100, 1_500],
      small: [300, 3_000],
      small_mid: [500, 8_000],
      mid: [1_000, 20_000],
      large: [3_000, 50_000],
      mega: [5_000, 100_000],
    };
    return ranges[tierKey] || [500, 5_000];
  };
  const pickTierAndCap = (stock) => {
    if (stock.is_bluechip === 1) {
      return {
        key: "bluechip",
        cap: randomBetween(500 * EOK, 1_500 * EOK),
      };
    }
    if (stock.status === "ipo_subscription") {
      const roll = Math.random();
      if (roll < 0.48) return { key: "ipo_micro", cap: randomBetween(60 * EOK, 85 * EOK) };
      if (roll < 0.80) return { key: "ipo_small", cap: randomBetween(85 * EOK, 160 * EOK) };
      if (roll < 0.94) return { key: "ipo_small_mid", cap: randomBetween(160 * EOK, 350 * EOK) };
      if (roll < 0.99) return { key: "ipo_mid", cap: randomBetween(350 * EOK, 900 * EOK) };
      return { key: "ipo_large_rare", cap: randomBetween(900 * EOK, 3_000 * EOK) };
    }
    const roll = Math.random();
    if (roll < 0.38) return { key: "micro", cap: randomBetween(62 * EOK, 95 * EOK) };
    if (roll < 0.68) return { key: "small", cap: randomBetween(95 * EOK, 180 * EOK) };
    if (roll < 0.86) return { key: "small_mid", cap: randomBetween(180 * EOK, 500 * EOK) };
    if (roll < 0.95) return { key: "mid", cap: randomBetween(500 * EOK, 1_500 * EOK) };
    if (roll < 0.99) return { key: "large", cap: randomBetween(1_500 * EOK, 5_000 * EOK) };
    return { key: "mega", cap: randomBetween(5_000 * EOK, 2 * JO) };
  };

  for (const stock of rows) {
    const tier = pickTierAndCap(stock);
    const [minPrice, maxPrice] = priceRange(tier.key);
    const currentPrice = randomBetween(minPrice, maxPrice);
    const targetCap = tier.cap;
    const totalShares = Math.max(1000, Math.floor(targetCap / currentPrice));
    update.run(
      currentPrice,
      currentPrice,
      currentPrice,
      currentPrice,
      totalShares,
      currentPrice * totalShares,
      currentPrice,
      Math.floor(currentPrice * 1.15),
      Math.max(1, Math.floor(currentPrice * 0.87)),
      stock.id,
    );
  }

  db.prepare("INSERT INTO system_config (key, value) VALUES (?, 'complete')").run(
    migrationKey,
  );
});
rebaseOversizedStockMarketCaps();
enforceStockMarketLimit(db);
initializeStockDelistingLifecycle(db);

const rebaseOwnerEtfsToTotalAssets = db.transaction(() => {
  const migrationKey = "owner_etf_total_asset_basis_v1";
  if (db.prepare("SELECT 1 FROM system_config WHERE key = ?").get(migrationKey)) return;

  const ownerEtfs = db
    .prepare(
      "SELECT id, owner_user_id FROM stocks WHERE is_etf = 1 AND status = 'acquired' AND owner_user_id IS NOT NULL",
    )
    .all();
  const update = db.prepare(`
    UPDATE stocks
    SET etf_base_price = current_price,
        etf_base_owner_asset = ?,
        etf_last_tracked_owner_asset = ?
    WHERE id = ?
  `);

  for (const stock of ownerEtfs) {
    const valuation = calculateUserTotalEvaluatedAsset(db, stock.owner_user_id);
    const ownerAsset = Math.max(valuation.totalEvaluatedAsset || 0, 1);
    update.run(ownerAsset, ownerAsset, stock.id);
  }

  db.prepare("INSERT INTO system_config (key, value) VALUES (?, 'complete')").run(
    migrationKey,
  );
});
rebaseOwnerEtfsToTotalAssets();

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
    isAdmin: user.isAdmin === true || user.username === "admin",
    createdAt: user.created_at,
    mineClickCount: user.mine_click_count || 0,
    mineTotalEarned: user.mine_total_earned || 0,
    lastMinedAt: user.last_mined_at || null,
    jackpotTickets: user.jackpot_tickets || 0,
  };
}
