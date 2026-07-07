import { createServerNotification } from "./serverNotificationService.js";
import { formatWon } from "../utils/formatWon.js";

export const RTP_POLICY = {
  repeatableMaxRtp: 0.992,
  highBetFloorRtp: 0.96,
  dailyLossback: {
    minimumNetLoss: 1_000_000,
    rate: 0.05,
    maximumAmount: 200_000,
  },
  dailyLuckTickets: {
    count: 3,
    maxBetAmount: 100_000,
    rtpBoost: 0.03,
  },
  jackpotPool: {
    lossContributionRate: 0.01,
    maxContributionPerGame: 50_000,
    minimumAwardPool: 100_000,
    awardChance: 0.001,
    maximumAwardAmount: 500_000,
  },
};

function todayKst(database) {
  return database.prepare("SELECT date('now', '+9 hours') AS value").get().value;
}

export function getDailyLuckTicketStatus(database, userId) {
  const date = todayKst(database);
  const row = database
    .prepare(
      `SELECT COUNT(*) AS used
       FROM asset_events
       WHERE user_id = ?
         AND event_type = 'luck_ticket_use'
         AND date(created_at, '+9 hours') = ?`,
    )
    .get(userId, date);
  const used = Number(row?.used || 0);
  const total = RTP_POLICY.dailyLuckTickets.count;
  return {
    date,
    total,
    used,
    remaining: Math.max(0, total - used),
    maxBetAmount: RTP_POLICY.dailyLuckTickets.maxBetAmount,
    rtpBoost: RTP_POLICY.dailyLuckTickets.rtpBoost,
  };
}

export function prepareLuckTicket(database, { userId, bet, useLuckTicket }) {
  if (!useLuckTicket) {
    return {
      used: false,
      requested: false,
      payoutBoostRate: 0,
      payoutBoostAmount: 0,
    };
  }
  const status = getDailyLuckTicketStatus(database, userId);
  if (status.remaining <= 0) {
    const error = new Error("오늘 사용할 수 있는 행운권이 없어요.");
    error.status = 400;
    throw error;
  }
  if (bet > RTP_POLICY.dailyLuckTickets.maxBetAmount) {
    const error = new Error("행운권은 100,000원 이하 배팅에서만 사용할 수 있어요.");
    error.status = 400;
    throw error;
  }
  return {
    used: true,
    requested: true,
    payoutBoostRate: RTP_POLICY.dailyLuckTickets.rtpBoost,
    payoutBoostAmount: 0,
    ticketNumber: status.used + 1,
    remainingBefore: status.remaining,
    remainingAfter: Math.max(0, status.remaining - 1),
    maxBetAmount: RTP_POLICY.dailyLuckTickets.maxBetAmount,
  };
}

export function applyLuckTicketPayout(payout, luckTicket) {
  if (!luckTicket?.used || payout <= 0) {
    return { payout, luckTicket: luckTicket || { used: false, requested: false } };
  }
  const payoutBoostAmount = Math.floor(payout * RTP_POLICY.dailyLuckTickets.rtpBoost);
  return {
    payout: payout + payoutBoostAmount,
    luckTicket: {
      ...luckTicket,
      payoutBoostAmount,
    },
  };
}

export function recordLuckTicketUse(database, {
  userId,
  gameType,
  gameLogId,
  bet,
  payoutBoostAmount,
  balanceAfter,
  luckTicket,
}) {
  const date = todayKst(database);
  database
    .prepare(
      `INSERT INTO asset_events
       (user_id, event_type, game_type, amount, balance_before, balance_after,
        source_type, source_id, detail_json)
       VALUES (?, 'luck_ticket_use', ?, 0, ?, ?, 'luck_ticket', ?, ?)`,
    )
    .run(
      userId,
      gameType,
      balanceAfter,
      balanceAfter,
      `${userId}:${date}:${gameLogId}`,
      JSON.stringify({
        date,
        gameLogId,
        bet,
        payoutBoostAmount,
        ...luckTicket,
      }),
    );
}

function systemConfigNumber(database, key, fallback = 0) {
  const row = database.prepare("SELECT value FROM system_config WHERE key = ?").get(key);
  const value = Number(row?.value);
  return Number.isFinite(value) ? value : fallback;
}

function setSystemConfigNumber(database, key, value) {
  database
    .prepare(
      `INSERT INTO system_config (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, String(Math.max(0, Math.floor(value))));
}

export function getDailyGameStats(database, userId, gameType = null) {
  const params = [userId, todayKst(database)];
  const gameFilter = gameType ? "AND game_type = ?" : "";
  if (gameType) params.push(gameType);
  const row = database
    .prepare(
      `SELECT
         COUNT(*) AS game_count,
         COALESCE(SUM(bet_amount), 0) AS wagered,
         COALESCE(SUM(payout), 0) AS paid,
         COALESCE(SUM(profit), 0) AS profit
       FROM game_logs
       WHERE user_id = ?
         AND date(created_at, '+9 hours') = ?
         ${gameFilter}`,
    )
    .get(...params);
  return {
    gameCount: Number(row?.game_count || 0),
    wagered: Number(row?.wagered || 0),
    paid: Number(row?.paid || 0),
    profit: Number(row?.profit || 0),
  };
}

export function getRecentGameCount(database, userId, gameType, minutes = 5) {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM game_logs
       WHERE user_id = ?
         AND game_type = ?
         AND julianday(created_at) >= julianday('now', ?)`,
    )
    .get(userId, gameType, `-${minutes} minutes`);
  return Number(row?.count || 0);
}

function estimateLoggedRtp(gameType, detail) {
  if (gameType === "bomb-dodge") return Number(detail?.targetRtp || 0);
  if (gameType === "risk-button") return Number(detail?.adjustedRtp || detail?.baseRtp || 0);
  if (gameType === "card-draw" && detail?.multiplier) {
    const chanceByCondition = {
      odd: 0.5,
      even: 0.5,
      ge7: 0.4,
      ge8: 0.3,
      ge9: 0.2,
      exact: 0.1,
    };
    return Number(chanceByCondition[detail.condition] || 0) * Number(detail.multiplier);
  }
  if (gameType === "dart" && detail?.multiplier) {
    const chanceByTarget = {
      wide: 0.49,
      middle: 0.25,
      small: 0.0625,
      bullseye: 0.01,
      sector: 0.05,
      sector_middle: 0.0125,
      sector_bullseye: 0.0005,
    };
    return Number(chanceByTarget[detail.target] || 0) * Number(detail.multiplier);
  }
  if (gameType === "slot" && detail?.outcome === "777") return null;
  return null;
}

export function buildRtpDetail(database, { userId, gameType, bet, detail }) {
  const dailyStats = getDailyGameStats(database, userId, gameType);
  const allDailyStats = getDailyGameStats(database, userId, null);
  const recentCount = getRecentGameCount(database, userId, gameType, 5);
  const baseLoggedRtp = estimateLoggedRtp(gameType, detail);
  const dailyFunBoost = detail?.luckTicket?.used ? RTP_POLICY.dailyLuckTickets.rtpBoost : 0;
  const repetitionModifier =
    dailyStats.gameCount >= 200 || dailyStats.wagered >= 200_000_000
      ? -0.025
      : dailyStats.gameCount >= 100 || dailyStats.wagered >= 100_000_000
        ? -0.015
        : dailyStats.gameCount >= 50 || dailyStats.wagered >= 50_000_000
          ? -0.007
          : 0;

  return {
    ...detail,
    rtpPolicy: {
      repeatableMaxRtp: RTP_POLICY.repeatableMaxRtp,
      baseRtp: baseLoggedRtp,
      baseLoggedRtp,
      skillBonus: 0,
      dailyFunBoost,
      luckTicketUsed: Boolean(detail?.luckTicket?.used),
      repetitionModifier,
      highBetModifier: 0,
      finalLoggedRtp:
        baseLoggedRtp === null
          ? null
          : Number(Math.min(RTP_POLICY.repeatableMaxRtp, Math.max(0, baseLoggedRtp + dailyFunBoost + repetitionModifier)).toFixed(6)),
      finalRtp:
        baseLoggedRtp === null
          ? null
          : Number(Math.min(RTP_POLICY.repeatableMaxRtp, Math.max(0, baseLoggedRtp + dailyFunBoost + repetitionModifier)).toFixed(6)),
      dailyGameCountBefore: dailyStats.gameCount,
      dailyWagerBefore: dailyStats.wagered,
      dailyNetProfitBefore: allDailyStats.profit,
      currentBet: bet,
      recentFiveMinuteCount: recentCount,
      macroSuspected: recentCount >= 100,
    },
  };
}

export function addJackpotContribution(database, lossAmount) {
  const loss = Math.max(0, Number(lossAmount) || 0);
  if (loss <= 0) return 0;
  const contribution = Math.min(
    RTP_POLICY.jackpotPool.maxContributionPerGame,
    Math.floor(loss * RTP_POLICY.jackpotPool.lossContributionRate),
  );
  if (contribution <= 0) return 0;
  const current = systemConfigNumber(database, "jackpot_pool_amount", 0);
  setSystemConfigNumber(database, "jackpot_pool_amount", current + contribution);
  return contribution;
}

export function getJackpotPool(database) {
  return systemConfigNumber(database, "jackpot_pool_amount", 0);
}


