import { db } from "../db.js";
import { awardAchievements } from "./achievementService.js";
import { recordAssetEvent } from "./assetEventService.js";
import { createGameNotification } from "./serverNotificationService.js";
import {
  addJackpotContribution,
  buildRtpDetail,
  recordLuckTicketUse,
} from "./economyRtpService.js";
import { formatWon } from "../utils/formatWon.js";

export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function getFreshUser(userId) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) throw new GameError("사용자를 찾을 수 없어요.", 404);
  return user;
}

export function validateBet(user, value, absoluteCap = Number.POSITIVE_INFINITY) {
  const bet = Number(value);
  if (!Number.isFinite(bet) || Math.floor(bet) !== bet) {
    throw new GameError("배팅금은 원 단위 정수로 입력해 주세요.");
  }
  if (bet < 1000) {
    throw new GameError("최소 배팅금은 1,000원이에요.");
  }
  const ratioCap = Math.floor(user.balance * 0.5);
  const maximum = Math.min(ratioCap, absoluteCap);
  if (bet > maximum) {
    throw new GameError(`현재 최대 배팅금은 ${formatWon(maximum)}이에요.`);
  }
  if (bet > user.balance) {
    throw new GameError("현재 자산보다 많이 배팅할 수 없어요.");
  }
  return bet;
}

function updateGameStats(userId, balance, bet, won, profit) {
  db.prepare(
    `UPDATE users
     SET balance = ?,
         highest_balance = MAX(highest_balance, ?),
         total_profit = total_profit + ?,
         total_bet = total_bet + ?,
         total_win = total_win + ?,
         total_loss = total_loss + ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(balance, balance, profit, bet, won ? 1 : 0, won ? 0 : 1, userId);
}

export function finishInstantGame({
  user,
  gameType,
  bet,
  payout,
  detail,
  achievementContext = {},
}) {
  const won = payout > 0;
  const profit = payout - bet;
  let actualPayout = payout;
  let actualProfit = profit;
  if (profit > 0) {
    const tax = Math.floor(profit * 0.01);
    if (tax > 0) {
      actualPayout -= tax;
      actualProfit -= tax;
      finalDetail = {
        ...finalDetail,
        jackpotTax: tax,
        jackpotPoolContribution: addJackpotContribution(db, tax),
      };
    }
  }

  const gameBalance = user.balance - bet + actualPayout;
  updateGameStats(user.id, gameBalance, bet, won, actualProfit);
  db.prepare("UPDATE users SET jackpot_tickets = jackpot_tickets + 1 WHERE id = ?").run(user.id);

  const log = db
    .prepare(
      `INSERT INTO game_logs
       (user_id, game_type, bet_amount, result, payout, profit, balance_before, balance_after, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.id,
      gameType,
      bet,
      won ? "win" : "loss",
      actualPayout,
      actualProfit,
      user.balance,
      gameBalance,
      JSON.stringify(finalDetail),
    );
  recordAssetEvent({
    userId: user.id,
    eventType: won ? "game_win" : "game_loss",
    gameType,
    amount: actualProfit,
    balanceBefore: user.balance,
    balanceAfter: gameBalance,
    sourceType: "game_log",
    sourceId: log.lastInsertRowid,
    detail: finalDetail,
  });
  if (finalDetail.luckTicket?.used) {
    recordLuckTicketUse(db, {
      userId: user.id,
      gameType,
      gameLogId: log.lastInsertRowid,
      bet,
      payoutBoostAmount: finalDetail.luckTicket.payoutBoostAmount || 0,
      balanceAfter: gameBalance,
      luckTicket: finalDetail.luckTicket,
    });
  }

  const achievements = awardAchievements(db, user.id, {
    gameType,
    gameCompleted: true,
    won,
    profit: actualProfit,
    payout: actualPayout,
    ...finalDetail,
    ...achievementContext,
  });
  const userAfterGame = getFreshUser(user.id);
  createGameNotification(db, {
    gameLogId: log.lastInsertRowid,
    user: userAfterGame,
    gameType,
    bet,
    payout: actualPayout,
    won,
    detail: finalDetail,
  });
  const finalUser = getFreshUser(user.id);
  return {
    won,
    payout: actualPayout,
    profit: actualProfit,
    balance: finalUser.balance,
    achievements,
    detail: finalDetail,
  };
}

export function finishReservedGame({
  userId,
  balanceBefore,
  gameType,
  bet,
  payout,
  detail,
  achievementContext = {},
}) {
  const current = getFreshUser(userId);
  const won = payout > 0;
  const profit = payout - bet;
  let actualPayout = payout;
  let actualProfit = profit;
  let finalDetail = detail || {};
  if (profit > 0) {
    const tax = Math.floor(profit * 0.01);
    if (tax > 0) {
      actualPayout -= tax;
      actualProfit -= tax;
      finalDetail = {
        ...finalDetail,
        jackpotTax: tax,
        jackpotPoolContribution: addJackpotContribution(db, tax),
      };
    }
  }

  const gameBalance = current.balance + actualPayout;
  updateGameStats(userId, gameBalance, bet, won, actualProfit);
  db.prepare("UPDATE users SET jackpot_tickets = jackpot_tickets + 1 WHERE id = ?").run(userId);

  const log = db
    .prepare(
      `INSERT INTO game_logs
       (user_id, game_type, bet_amount, result, payout, profit, balance_before, balance_after, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      gameType,
      bet,
      won ? "win" : "loss",
      actualPayout,
      actualProfit,
      balanceBefore,
      gameBalance,
      JSON.stringify(finalDetail),
    );
  const eventBalanceBefore = gameBalance - actualProfit;
  recordAssetEvent({
    userId,
    eventType: won ? "game_win" : "game_loss",
    gameType,
    amount: actualProfit,
    balanceBefore: eventBalanceBefore,
    balanceAfter: gameBalance,
    sourceType: "game_log",
    sourceId: log.lastInsertRowid,
    detail: finalDetail,
  });
  if (finalDetail.luckTicket?.used) {
    recordLuckTicketUse(db, {
      userId,
      gameType,
      gameLogId: log.lastInsertRowid,
      bet,
      payoutBoostAmount: finalDetail.luckTicket.payoutBoostAmount || 0,
      balanceAfter: gameBalance,
      luckTicket: finalDetail.luckTicket,
    });
  }

  const achievements = awardAchievements(db, userId, {
    gameType,
    gameCompleted: true,
    won,
    profit: actualProfit,
    payout: actualPayout,
    ...finalDetail,
    ...achievementContext,
  });
  const userAfterGame = getFreshUser(userId);
  createGameNotification(db, {
    gameLogId: log.lastInsertRowid,
    user: userAfterGame,
    gameType,
    bet,
    payout: actualPayout,
    won,
    detail: finalDetail,
  });
  const finalUser = getFreshUser(userId);
  return {
    won,
    payout: actualPayout,
    profit: actualProfit,
    balance: finalUser.balance,
    achievements,
    detail: finalDetail,
  };
}
