import { db } from "../db.js";
import { awardAchievements } from "./achievementService.js";
import { recordAssetEvent } from "./assetEventService.js";
import { createGameNotification } from "./serverNotificationService.js";

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
  if (!Number.isSafeInteger(bet)) {
    throw new GameError("배팅금은 원 단위 정수로 입력해 주세요.");
  }
  if (bet < 1000) {
    throw new GameError("최소 배팅금은 1,000원이에요.");
  }
  const ratioCap = Math.floor(user.balance * 0.5);
  const maximum = Math.min(ratioCap, absoluteCap);
  if (bet > maximum) {
    throw new GameError(`현재 최대 배팅금은 ${maximum.toLocaleString("ko-KR")}원이에요.`);
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
  const gameBalance = user.balance - bet + payout;
  updateGameStats(user.id, gameBalance, bet, won, profit);

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
      payout,
      profit,
      user.balance,
      gameBalance,
      JSON.stringify(detail),
    );
  recordAssetEvent({
    userId: user.id,
    eventType: won ? "game_win" : "game_loss",
    gameType,
    amount: profit,
    balanceBefore: user.balance,
    balanceAfter: gameBalance,
    sourceType: "game_log",
    sourceId: log.lastInsertRowid,
    detail,
  });

  const achievements = awardAchievements(db, user.id, {
    gameType,
    gameCompleted: true,
    won,
    profit,
    payout,
    ...detail,
    ...achievementContext,
  });
  const finalUser = getFreshUser(user.id);
  createGameNotification(db, {
    gameLogId: log.lastInsertRowid,
    user: finalUser,
    gameType,
    bet,
    payout,
    won,
    detail,
  });

  return {
    won,
    payout,
    profit,
    balance: finalUser.balance,
    achievements,
    detail,
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
  const gameBalance = current.balance + payout;
  updateGameStats(userId, gameBalance, bet, won, profit);

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
      payout,
      profit,
      balanceBefore,
      gameBalance,
      JSON.stringify(detail),
    );
  const eventBalanceBefore = gameBalance - profit;
  recordAssetEvent({
    userId,
    eventType: won ? "game_win" : "game_loss",
    gameType,
    amount: profit,
    balanceBefore: eventBalanceBefore,
    balanceAfter: gameBalance,
    sourceType: "game_log",
    sourceId: log.lastInsertRowid,
    detail,
  });

  const achievements = awardAchievements(db, userId, {
    gameType,
    gameCompleted: true,
    won,
    profit,
    payout,
    ...detail,
    ...achievementContext,
  });
  const finalUser = getFreshUser(userId);
  createGameNotification(db, {
    gameLogId: log.lastInsertRowid,
    user: finalUser,
    gameType,
    bet,
    payout,
    won,
    detail,
  });

  return {
    won,
    payout,
    profit,
    balance: finalUser.balance,
    achievements,
    detail,
  };
}
