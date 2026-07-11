import { Router } from "express";
import { db, publicUser } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { achievementCount } from "../services/achievementService.js";
import { recordAssetEvent } from "../services/assetEventService.js";
import {
  findUserByNickname,
  validateNickname,
} from "../services/nicknameService.js";
import { getUserStockStats } from "../services/stockTradeStatsService.js";

export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.get("/summary", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS total_games,
         COUNT(*) AS total_bets,
         TOTAL(CASE WHEN profit > 0 THEN profit ELSE 0 END) AS total_profit,
         TOTAL(CASE WHEN profit < 0 THEN -profit ELSE 0 END) AS total_loss,
         TOTAL(profit) AS net_profit,
         TOTAL(payout) AS total_payout,
         TOTAL(CASE WHEN result = 'loss' THEN bet_amount ELSE 0 END) AS total_lost_amount
       FROM game_logs WHERE user_id = ?`,
    )
    .get(user.id);
  const walletTotals = db
    .prepare(
      `SELECT
         TOTAL(CASE WHEN event_type = 'transfer_in' THEN amount ELSE 0 END) AS received_transfer,
         TOTAL(CASE WHEN event_type = 'transfer_out' THEN -amount ELSE 0 END) AS sent_transfer,
         TOTAL(CASE WHEN event_type = 'bonus_code' THEN amount ELSE 0 END) AS bonus_code_total,
         TOTAL(CASE WHEN event_type = 'nickname_change_fee' THEN -amount ELSE 0 END) AS nickname_fee_total,
         TOTAL(CASE WHEN event_type = 'transfer_in' AND date(created_at, '+9 hours') = date('now', '+9 hours') THEN amount ELSE 0 END) AS today_received_transfer,
         TOTAL(CASE WHEN event_type = 'transfer_out' AND date(created_at, '+9 hours') = date('now', '+9 hours') THEN -amount ELSE 0 END) AS today_sent_transfer
       FROM asset_events WHERE user_id = ?`,
    )
    .get(user.id);

  return res.json({
    summary: {
      ...publicUser(user),
      totalGames: totals.total_games,
      totalBets: totals.total_bets,
      grossProfit: totals.total_profit,
      grossLoss: totals.total_loss,
      netGameProfit: totals.net_profit,
      totalPayout: totals.total_payout,
      totalLostAmount: totals.total_lost_amount,
      achievementCount: achievementCount(db, user.id),
      receivedTransfer: walletTotals.received_transfer,
      sentTransfer: walletTotals.sent_transfer,
      bonusCodeTotal: walletTotals.bonus_code_total,
      nicknameFeeTotal: walletTotals.nickname_fee_total,
      todayReceivedTransfer: walletTotals.today_received_transfer,
      todaySentTransfer: walletTotals.today_sent_transfer,
    },
  });
});

profileRouter.patch("/nickname", (req, res, next) => {
  try {
    const validation = validateNickname(req.body.newNickname);
    if (validation.error) {
      return res.status(400).json({ message: validation.error });
    }
    const changeNickname = db.transaction(() => {
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
      const existing = findUserByNickname(db, validation.nickname);
      if (existing) {
        const error = new Error("이미 사용 중인 닉네임이에요.");
        error.status = 409;
        throw error;
      }
      const changeCost = user.nickname_change_count === 0 ? 0 : 500000;
      if (user.balance < changeCost) {
        const error = new Error("자산이 부족해요.");
        error.status = 400;
        throw error;
      }
      const balanceAfter = user.balance - changeCost;
      db.prepare(
        `UPDATE users
         SET nickname = ?,
             balance = ?,
             total_profit = total_profit - ?,
             nickname_change_count = nickname_change_count + 1,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      ).run(validation.nickname, balanceAfter, changeCost, user.id);
      if (changeCost > 0) {
        recordAssetEvent({
          userId: user.id,
          eventType: "nickname_change_fee",
          amount: -changeCost,
          balanceBefore: user.balance,
          balanceAfter,
          detail: {
            oldNickname: user.nickname,
            newNickname: validation.nickname,
            label: "닉네임 변경 비용",
          },
        });
      } else {
        recordAssetEvent({
          userId: user.id,
          eventType: "nickname_change",
          amount: 0,
          balanceBefore: user.balance,
          balanceAfter,
          detail: {
            oldNickname: user.nickname,
            newNickname: validation.nickname,
            label: "첫 닉네임 무료 변경",
          },
        });
      }
      return db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    });

    try {
      const updated = changeNickname();
      return res.json({
        message: "닉네임이 변경되었어요.",
        user: publicUser(updated),
      });
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).json({ message: "이미 사용 중인 닉네임이에요." });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

profileRouter.get("/asset-history", (req, res) => {
  const ranges = {
    day: "-1 day",
    week: "-7 days",
    month: "-30 days",
  };
  const range = Object.hasOwn(ranges, req.query.range) ? req.query.range : "day";
  const modifier = ranges[range];
  const boundary = db
    .prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?) AS value")
    .get(modifier).value;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const previous = db
    .prepare(
      `SELECT balance_after FROM asset_events
       WHERE user_id = ? AND julianday(created_at) < julianday('now', ?)
       ORDER BY julianday(created_at) DESC, id DESC LIMIT 1`,
    )
    .get(user.id, modifier);
  const startBalance = previous?.balance_after ?? user.initial_balance;
  const events = db
    .prepare(
      `SELECT id, event_type, amount, balance_after, created_at
       FROM asset_events
       WHERE user_id = ? AND julianday(created_at) >= julianday('now', ?)
       ORDER BY julianday(created_at) ASC, id ASC`,
    )
    .all(user.id, modifier);
  const points = [
    {
      id: "start",
      eventType: "range_start",
      amount: 0,
      balance: startBalance,
      createdAt: boundary,
    },
    ...events.map((event) => ({
      id: event.id,
      eventType: event.event_type,
      amount: event.amount,
      balance: event.balance_after,
      createdAt: event.created_at,
    })),
  ];
  if (points.at(-1).balance !== user.balance) {
    points.push({
      id: "current",
      eventType: "current",
      amount: user.balance - points.at(-1).balance,
      balance: user.balance,
      createdAt: new Date().toISOString(),
    });
  }

  return res.json({
    range,
    startBalance: points[0].balance,
    endBalance: points.at(-1).balance,
    change: points.at(-1).balance - points[0].balance,
    points,
  });
});

profileRouter.get("/game-stats", (req, res) => {
  const rows = db
    .prepare(
      `SELECT
         game_type,
         COUNT(*) AS total_games,
         COUNT(*) AS total_bets,
         SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) AS losses,
         TOTAL(bet_amount) AS total_bet,
         TOTAL(payout) AS total_payout,
         TOTAL(CASE WHEN result = 'loss' THEN bet_amount ELSE 0 END) AS lost_amount,
         TOTAL(profit) AS net_profit,
         COALESCE(MAX(payout), 0) AS max_payout
       FROM game_logs
       WHERE user_id = ?
       GROUP BY game_type`,
    )
    .all(req.user.id);
  const byType = new Map(rows.map((row) => [row.game_type, row]));
  const gameTypes = ["risk-button", "card-draw", "bomb-dodge", "slot", "dart", "cup"];

  return res.json({
    stats: gameTypes.map((gameType) => {
      const row = byType.get(gameType);
      const totalGames = row?.total_games || 0;
      return {
        gameType,
        totalGames,
        totalBets: row?.total_bets || 0,
        wins: row?.wins || 0,
        losses: row?.losses || 0,
        winRate: totalGames ? (row.wins || 0) / totalGames : 0,
        totalBet: row?.total_bet || 0,
        totalPayout: row?.total_payout || 0,
        lostAmount: row?.lost_amount || 0,
        netProfit: row?.net_profit || 0,
        maxPayout: row?.max_payout || 0,
      };
    }),
  });
});

profileRouter.get("/stock-stats", (req, res) => {
  return res.json({ stats: getUserStockStats(db, req.user.id) });
});
