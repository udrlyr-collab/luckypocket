import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const logsRouter = Router();
logsRouter.use(requireAuth);

logsRouter.get("/", (req, res) => {
  const allowed = new Set(["risk-button", "card-draw", "bomb-dodge", "slot", "dart"]);
  const allowedEvents = new Set([
    "transfer_out",
    "transfer_in",
    "bonus_code",
    "nickname_change_fee",
    "nickname_change",
    "achievement_reward",
    "support_grant",
    "bankruptcy_reset",
    "bankruptcy_reset",
    "admin_nickname_change",
    "server_notification",
    "stock_buy",
    "stock_sell",
    "stock_position_open",
    "stock_position_close",
    "stock_liquidation",
    "stock_acquire_company",
    "daily_lossback",
    "luck_ticket_use",
    "jackpot_pool_reward",
  ]);
  const filter = allowed.has(req.query.gameType) ? req.query.gameType : null;
  const eventFilter = allowedEvents.has(req.query.eventType) ? req.query.eventType : null;
  const gameRows = eventFilter
    ? []
    : filter
    ? db
        .prepare(
          "SELECT * FROM game_logs WHERE user_id = ? AND game_type = ? ORDER BY id DESC LIMIT 40",
        )
        .all(req.user.id, filter)
    : db
        .prepare("SELECT * FROM game_logs WHERE user_id = ? ORDER BY id DESC LIMIT 40")
        .all(req.user.id);

  const gameLogs = gameRows.map((row) => ({
    id: `game-${row.id}`,
    entryType: "game",
    gameType: row.game_type,
    betAmount: row.bet_amount,
    result: row.result,
    payout: row.payout,
    lossAmount: row.result === "loss" ? row.bet_amount : 0,
    profit: row.profit,
    balanceBefore: row.balance_before,
    balanceAfter: row.balance_after,
    detail: JSON.parse(row.detail_json),
    createdAt: row.created_at,
  }));
  const eventRows = filter || eventFilter === "server_notification"
    ? []
    : eventFilter
      ? db
          .prepare(
            `SELECT * FROM asset_events
             WHERE user_id = ? AND event_type = ?
             ORDER BY id DESC LIMIT 40`,
          )
          .all(req.user.id, eventFilter)
      : db
        .prepare(
          `SELECT * FROM asset_events
           WHERE user_id = ? AND event_type IN (
             'transfer_out', 'transfer_in', 'bonus_code', 'nickname_change_fee',
             'nickname_change',
             'achievement_reward', 'support_grant', 'bankruptcy_reset',
             'admin_nickname_change', 'stock_buy', 'stock_sell',
             'stock_position_open', 'stock_position_close',
             'stock_liquidation', 'stock_acquire_company',
             'daily_lossback', 'luck_ticket_use', 'jackpot_pool_reward'
           )
           ORDER BY id DESC LIMIT 40`,
        )
        .all(req.user.id);
  const eventLogs = eventRows.map((row) => ({
          id: `event-${row.id}`,
          entryType: row.event_type,
          gameType: row.game_type,
          betAmount: 0,
          result: "reward",
          payout: row.amount > 0 ? row.amount : 0,
          lossAmount: row.amount < 0 ? -row.amount : 0,
          profit: row.amount,
          balanceBefore: row.balance_before,
          balanceAfter: row.balance_after,
          detail: JSON.parse(row.detail_json),
          createdAt: row.created_at,
        })); 
  const notificationRows = filter || (eventFilter && eventFilter !== "server_notification")
    ? []
    : eventFilter === "server_notification"
      ? db
          .prepare(
            `SELECT * FROM server_notifications
             WHERE user_id = ? ORDER BY id DESC LIMIT 40`,
          )
          .all(req.user.id)
      : db
          .prepare(
            `SELECT * FROM server_notifications
             WHERE user_id = ? ORDER BY id DESC LIMIT 20`,
          )
          .all(req.user.id);
  const notificationLogs = notificationRows.map((row) => ({
    id: `notification-${row.id}`,
    entryType: "server_notification",
    gameType: row.game_type,
    betAmount: 0,
    result: "notice",
    payout: 0,
    lossAmount: 0,
    profit: 0,
    balanceBefore: null,
    balanceAfter: null,
    detail: {
      type: row.type,
      title: row.title,
      message: row.message,
      amount: row.amount,
      multiplier: row.multiplier,
      metadata: JSON.parse(row.metadata_json),
    },
    createdAt: row.created_at,
  }));
  const logs = [...gameLogs, ...eventLogs, ...notificationLogs]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 20);

  return res.json({
    logs,
  });
});
