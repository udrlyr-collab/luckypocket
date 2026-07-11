import crypto from "node:crypto";
import { awardAchievements } from "./achievementService.js";
import { recordAssetEvent } from "./assetEventService.js";
import { addJackpotContribution } from "./economyRtpService.js";
import { GameError, getFreshUser, validateBet } from "./gameService.js";
import { incrementDailyMissionProgress } from "./dailyMissionService.js";
import { createGameNotification } from "./serverNotificationService.js";

export const CUP_GAME_CONFIG = Object.freeze(
  Object.fromEntries(Array.from({ length: 6 }, (_, index) => {
    const cupCount = index + 3;
    return [cupCount, { winProbability: 1 / cupCount, multiplier: cupCount }];
  })),
);

function cupSpec(cupCount) {
  const numericCupCount = Number(cupCount);
  const spec = CUP_GAME_CONFIG[numericCupCount];
  if (!spec) throw new GameError("컵 개수는 3개부터 8개까지 선택할 수 있어요.");
  return { cupCount: numericCupCount, ...spec };
}

function activeSeason(database) {
  return database.prepare(
    "SELECT id, season_number FROM seasons WHERE status = 'active' ORDER BY season_number DESC LIMIT 1",
  ).get();
}

function parseJsonArray(value, fallback = []) {
  try {
    const parsed = value ? JSON.parse(value) : fallback;
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function createShufflePlan(cupCount, randomInt = crypto.randomInt) {
  const initialOrder = Array.from({ length: cupCount }, (_, index) => `cup-${index + 1}`);
  const luckyCupId = initialOrder[randomInt(0, cupCount)];
  const operations = [];
  const shuffledOrder = [...initialOrder];
  const operationCount = Math.max(6, cupCount * 2 + randomInt(0, cupCount + 1));
  for (let step = 0; step < operationCount; step += 1) {
    const fromIndex = randomInt(0, cupCount);
    let toIndex = randomInt(0, cupCount - 1);
    if (toIndex >= fromIndex) toIndex += 1;
    operations.push({ fromIndex, toIndex, durationMs: 280 + randomInt(0, 140) });
    [shuffledOrder[fromIndex], shuffledOrder[toIndex]] = [
      shuffledOrder[toIndex],
      shuffledOrder[fromIndex],
    ];
  }
  return { initialOrder, luckyCupId, operations, shuffledOrder };
}

function safeFinalOrder(round) {
  const fallback = Array.from({ length: Number(round.cup_count) }, (_, index) => `cup-${index + 1}`);
  const stored = parseJsonArray(round.cup_order_json, fallback);
  return stored.length === fallback.length ? stored : fallback;
}

function safeInitialLuckyCupId(round) {
  if (round.initial_winning_cup_id) return round.initial_winning_cup_id;
  const finalOrder = safeFinalOrder(round);
  return finalOrder[Number(round.winning_cup_index)] || `cup-${Number(round.winning_cup_index) + 1}`;
}

export function createCupRoundId() {
  return `cup_${crypto.randomUUID()}`;
}

// Before settlement this payload contains the visual choreography only for a
// newly-created round. It never exposes the server's final winning index.
export function serializeCupRound(round, { reveal = false, includeChoreography = false } = {}) {
  if (!round) return null;
  const settled = round.status === "settled";
  const finalOrder = safeFinalOrder(round);
  const selectedCupId = round.selected_cup_id || (
    round.selected_cup_index === null ? null : finalOrder[Number(round.selected_cup_index)] || null
  );
  const base = {
    id: round.id,
    cupCount: Number(round.cup_count),
    betAmount: Number(round.bet_amount),
    multiplier: Number(round.multiplier),
    cupIds: finalOrder,
    selectedCupId,
    selectedCupIndex: selectedCupId ? finalOrder.indexOf(selectedCupId) : null,
    won: settled ? Boolean(round.won) : null,
    grossPayout: settled ? Number(round.gross_payout) : null,
    grossProfit: settled ? Number(round.gross_profit) : null,
    prizeContribution: settled ? Number(round.prize_contribution) : null,
    finalPayout: settled ? Number(round.final_payout) : null,
    status: round.status,
    createdAt: round.created_at,
    settledAt: round.settled_at,
  };
  if (settled || reveal) {
    const winningCupId = safeInitialLuckyCupId(round);
    return {
      ...base,
      winningCupId,
      winningCupIndex: finalOrder.indexOf(winningCupId),
    };
  }
  if (includeChoreography) {
    return {
      ...base,
      cupIds: Array.from({ length: Number(round.cup_count) }, (_, index) => `cup-${index + 1}`),
      luckyCupId: safeInitialLuckyCupId(round),
      shuffleOperations: parseJsonArray(round.shuffle_operations_json),
    };
  }
  return base;
}

export function startCupRound(database, { userId, cupCount, betAmount, randomInt = crypto.randomInt }) {
  return database.transaction(() => {
    const user = getFreshUser(userId);
    const spec = cupSpec(cupCount);
    const bet = validateBet(user, betAmount);
    const active = database.prepare(
      "SELECT id FROM cup_game_rounds WHERE user_id = ? AND status = 'awaiting_pick'",
    ).get(userId);
    if (active) throw new GameError("선택을 기다리는 컵 게임이 이미 있어요.", 409);

    const season = activeSeason(database);
    const id = createCupRoundId();
    const plan = createShufflePlan(spec.cupCount, randomInt);
    const winningCupIndex = plan.shuffledOrder.indexOf(plan.luckyCupId);
    const balanceAfterBet = user.balance - bet;
    database.prepare(`
      INSERT INTO cup_game_rounds
       (id, user_id, season_id, season_number, balance_before, cup_count, bet_amount,
        winning_cup_index, initial_winning_cup_id, shuffle_operations_json, cup_order_json, multiplier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, user.id, season?.id ?? null, season?.season_number ?? null,
      user.balance, spec.cupCount, bet, winningCupIndex, plan.luckyCupId,
      JSON.stringify(plan.operations), JSON.stringify(plan.shuffledOrder), spec.multiplier,
    );
    database.prepare(
      "UPDATE users SET balance = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
    ).run(balanceAfterBet, user.id);
    recordAssetEvent({
      userId: user.id,
      eventType: "cup_game_bet",
      gameType: "cup",
      amount: -bet,
      balanceBefore: user.balance,
      balanceAfter: balanceAfterBet,
      sourceType: "cup_game_bet",
      sourceId: id,
      detail: { cupCount: spec.cupCount, multiplier: spec.multiplier },
    });

    const round = database.prepare("SELECT * FROM cup_game_rounds WHERE id = ?").get(id);
    return {
      round: serializeCupRound(round, { includeChoreography: true }),
      balance: balanceAfterBet,
    };
  })();
}

export function pickCupRound(database, { userId, roundId, selectedCupId, selectedCupIndex }) {
  return database.transaction(() => {
    const round = database.prepare(
      "SELECT * FROM cup_game_rounds WHERE id = ? AND user_id = ?",
    ).get(roundId, userId);
    if (!round) throw new GameError("컵 게임 기록을 찾을 수 없어요.", 404);
    if (round.status !== "awaiting_pick") throw new GameError("이미 결과가 확정된 컵 게임이에요.", 409);

    const finalOrder = safeFinalOrder(round);
    const legacyIndex = Number(selectedCupIndex);
    const pickedCupId = typeof selectedCupId === "string" && selectedCupId
      ? selectedCupId
      : finalOrder[legacyIndex];
    const selected = finalOrder.indexOf(pickedCupId);
    if (selected < 0) throw new GameError("선택한 컵 번호가 올바르지 않아요.");

    const winningCupId = safeInitialLuckyCupId(round);
    const won = pickedCupId === winningCupId;
    const grossPayout = won ? Math.floor(round.bet_amount * round.multiplier) : 0;
    const grossProfit = won ? grossPayout - round.bet_amount : -round.bet_amount;
    const prizeContribution = won ? Math.floor(Math.max(0, grossProfit) * 0.01) : 0;
    const finalPayout = grossPayout - prizeContribution;
    const user = getFreshUser(userId);
    const balanceAfter = user.balance + finalPayout;
    const profit = finalPayout - round.bet_amount;
    const priorCupResults = database.prepare(
      "SELECT result FROM game_logs WHERE user_id = ? AND game_type = 'cup' ORDER BY id DESC LIMIT 4",
    ).all(userId);
    const priorCupWinStreak = priorCupResults.findIndex((entry) => entry.result !== "win");
    const cupWinStreak = won
      ? (priorCupWinStreak === -1 ? priorCupResults.length : priorCupWinStreak) + 1
      : 0;
    const detail = {
      roundId: round.id,
      cupCount: Number(round.cup_count),
      selectedCupId: pickedCupId,
      selectedCupIndex: selected,
      winningCupId,
      winningCupIndex: finalOrder.indexOf(winningCupId),
      multiplier: Number(round.multiplier),
      grossPayout,
      grossProfit,
      prizeContribution,
      finalPayout,
      cupWinStreak,
    };

    const settled = database.prepare(`
      UPDATE cup_game_rounds
       SET selected_cup_index = ?, selected_cup_id = ?, won = ?, gross_payout = ?, gross_profit = ?,
           prize_contribution = ?, final_payout = ?, status = 'settled',
           settled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ? AND status = 'awaiting_pick'
    `).run(selected, pickedCupId, won ? 1 : 0, grossPayout, grossProfit, prizeContribution, finalPayout, round.id, userId);
    if (settled.changes !== 1) throw new GameError("이미 결과가 확정된 컵 게임이에요.", 409);

    database.prepare(`
      UPDATE users
       SET balance = ?, highest_balance = MAX(highest_balance, ?),
           total_profit = total_profit + ?, total_bet = total_bet + ?,
           total_win = total_win + ?, total_loss = total_loss + ?, jackpot_tickets = jackpot_tickets + 1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?
    `).run(balanceAfter, balanceAfter, profit, round.bet_amount, won ? 1 : 0, won ? 0 : 1, userId);

    const gameLog = database.prepare(`
      INSERT INTO game_logs
       (user_id, game_type, bet_amount, result, payout, profit, balance_before, balance_after, detail_json)
       VALUES (?, 'cup', ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, round.bet_amount, won ? "win" : "loss", finalPayout, profit, round.balance_before, balanceAfter, JSON.stringify(detail));

    if (won) {
      const grossBalance = user.balance + grossPayout;
      recordAssetEvent({
        userId, eventType: "cup_game_win", gameType: "cup", amount: grossPayout,
        balanceBefore: user.balance, balanceAfter: grossBalance,
        sourceType: "cup_game_win", sourceId: round.id, detail,
      });
    }
    if (prizeContribution > 0) {
      const grossBalance = user.balance + grossPayout;
      addJackpotContribution(database, prizeContribution, {
        sourceType: "cup_daily_prize_contribution", sourceId: round.id, userId, metadata: detail,
      });
      recordAssetEvent({
        userId, eventType: "daily_prize_contribution", gameType: "cup", amount: -prizeContribution,
        balanceBefore: grossBalance, balanceAfter,
        sourceType: "cup_daily_prize_contribution", sourceId: round.id, detail,
      });
    }

    incrementDailyMissionProgress(database, userId, "cup_play");
    const achievements = awardAchievements(database, userId, {
      gameType: "cup", gameCompleted: true, won, cupCount: Number(round.cup_count), profit, payout: finalPayout,
    });
    const currentUser = getFreshUser(userId);
    createGameNotification(database, {
      gameLogId: gameLog.lastInsertRowid, user: currentUser, gameType: "cup",
      bet: Number(round.bet_amount), payout: finalPayout, won, detail,
    });

    const settledRound = database.prepare("SELECT * FROM cup_game_rounds WHERE id = ?").get(round.id);
    return {
      round: serializeCupRound(settledRound, { reveal: true }),
      won, payout: finalPayout, profit, balance: getFreshUser(userId).balance, achievements, detail,
    };
  })();
}

export function getCupRound(database, { userId, roundId }) {
  const round = database.prepare("SELECT * FROM cup_game_rounds WHERE id = ? AND user_id = ?").get(roundId, userId);
  if (!round) throw new GameError("컵 게임 기록을 찾을 수 없어요.", 404);
  return serializeCupRound(round, { reveal: round.status === "settled" });
}

export function getActiveCupRound(database, { userId }) {
  const round = database.prepare(
    "SELECT * FROM cup_game_rounds WHERE user_id = ? AND status = 'awaiting_pick' ORDER BY created_at DESC LIMIT 1",
  ).get(userId);
  return serializeCupRound(round);
}
