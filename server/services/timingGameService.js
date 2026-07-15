import crypto from "node:crypto";
import { awardAchievements } from "./achievementService.js";
import { recordAssetEvent } from "./assetEventService.js";
import { addJackpotContribution } from "./economyRtpService.js";
import { GameError, getFreshUser, validateBet } from "./gameService.js";
import { incrementDailyMissionProgress } from "./dailyMissionService.js";
import { createGameNotification } from "./serverNotificationService.js";

// 기본 밸런스 값
export const TIMING_GAME_MODES_DEFAULT = {
  10: {
    nominalSeconds: 10,
    targetMinSeconds: 8,
    targetMaxSeconds: 12,
    failWindowSeconds: 0.65,
    maxMultiplier: 2.20,
    curvePower: 4.0,
    maxBetCashRate: 0.30,
    fadeStartMinSeconds: 2.2,
    fadeStartMaxSeconds: 2.8,
    fadeDurationSeconds: 0.75
  },
  20: {
    nominalSeconds: 20,
    targetMinSeconds: 18,
    targetMaxSeconds: 22,
    failWindowSeconds: 0.85,
    maxMultiplier: 3.20,
    curvePower: 4.8,
    maxBetCashRate: 0.25,
    fadeStartMinSeconds: 2.2,
    fadeStartMaxSeconds: 2.8,
    fadeDurationSeconds: 0.75
  },
  30: {
    nominalSeconds: 30,
    targetMinSeconds: 28,
    targetMaxSeconds: 32,
    failWindowSeconds: 1.05,
    maxMultiplier: 4.50,
    curvePower: 5.2,
    maxBetCashRate: 0.20,
    fadeStartMinSeconds: 2.2,
    fadeStartMaxSeconds: 2.8,
    fadeDurationSeconds: 0.75
  },
  45: {
    nominalSeconds: 45,
    targetMinSeconds: 43,
    targetMaxSeconds: 47,
    failWindowSeconds: 1.25,
    maxMultiplier: 6.00,
    curvePower: 5.8,
    maxBetCashRate: 0.15,
    fadeStartMinSeconds: 2.2,
    fadeStartMaxSeconds: 2.8,
    fadeDurationSeconds: 0.75
  },
  60: {
    nominalSeconds: 60,
    targetMinSeconds: 58,
    targetMaxSeconds: 62,
    failWindowSeconds: 1.50,
    maxMultiplier: 8.00,
    curvePower: 7.0,
    maxBetCashRate: 0.10,
    fadeStartMinSeconds: 2.2,
    fadeStartMaxSeconds: 2.8,
    fadeDurationSeconds: 0.75
  }
};

export function getTimingGameConfig(database) {
  const row = database.prepare("SELECT value FROM system_config WHERE key = 'timing_game_config'").get();
  if (row) {
    try {
      return JSON.parse(row.value);
    } catch (e) {
      // 파싱 실패시 기본값 반환
    }
  }
  return TIMING_GAME_MODES_DEFAULT;
}

export function updateTimingGameConfig(database, adminUserId, newConfig) {
  return database.transaction(() => {
    const beforeConfig = getTimingGameConfig(database);
    database.prepare(`
      INSERT INTO system_config (key, value) VALUES ('timing_game_config', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(newConfig));

    database.prepare(`
      INSERT INTO admin_logs (admin_user_id, target_user_id, action_type, before_value, after_value)
      VALUES (?, ?, 'update_timing_game_config', ?, ?)
    `).run(adminUserId, adminUserId, JSON.stringify(beforeConfig), JSON.stringify(newConfig));

    return newConfig;
  })();
}

function activeSeason(database) {
  return database.prepare(
    "SELECT id, season_number FROM seasons WHERE status = 'active' ORDER BY season_number DESC LIMIT 1",
  ).get();
}

export function createTargetTimeMs(nominalSeconds, config) {
  const modeConfig = config[nominalSeconds];
  if (!modeConfig) {
    throw new GameError("올바르지 않은 시간 모드입니다.");
  }
  const minCentiseconds = (modeConfig.targetMinSeconds) * 100;
  const maxCentiseconds = (modeConfig.targetMaxSeconds) * 100;
  const targetCentiseconds = crypto.randomInt(minCentiseconds, maxCentiseconds + 1);
  return targetCentiseconds * 10;
}

export function calculateTimingMultiplier({
  absoluteErrorSeconds,
  failWindowSeconds,
  maxMultiplier,
  curvePower
}) {
  if (absoluteErrorSeconds >= failWindowSeconds) {
    return 0;
  }
  if (absoluteErrorSeconds <= 0.02) {
    return maxMultiplier;
  }
  const accuracy = Math.max(0, 1 - absoluteErrorSeconds / failWindowSeconds);
  const rawMultiplier = maxMultiplier * Math.pow(accuracy, curvePower);
  return Math.max(0.05, Math.round(rawMultiplier * 100) / 100);
}

export function checkAndApplyExpiration(database, round) {
  if (!round || round.status !== "running" && round.status !== "waiting_start") {
    return round;
  }

  const startsAtMs = new Date(round.starts_at).getTime();
  const expirationThresholdMs = startsAtMs + round.target_time_ms + round.fail_window_ms + 5000;
  
  if (Date.now() >= expirationThresholdMs) {
    database.prepare(`
      UPDATE timing_game_rounds
      SET status = 'expired',
          multiplier = 0,
          gross_payout = 0,
          gross_profit = -bet_amount,
          prize_contribution = 0,
          final_payout = 0,
          settled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          expired_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND status IN ('waiting_start', 'running')
    `).run(round.id);

    // expired 된 상태의 라운드를 재조회하여 반환
    return database.prepare("SELECT * FROM timing_game_rounds WHERE id = ?").get(round.id);
  }

  return round;
}

export function serializeTimingRound(round) {
  if (!round) return null;
  return {
    id: round.id,
    userId: round.user_id,
    seasonId: round.season_id,
    seasonNumber: round.season_number,
    modeSeconds: round.mode_seconds,
    targetTimeMs: round.target_time_ms,
    failWindowMs: round.fail_window_ms,
    maxMultiplier: round.max_multiplier,
    curvePower: round.curve_power,
    betAmount: round.bet_amount,
    startsAt: round.starts_at,
    stopReceivedAt: round.stop_received_at,
    latencyCompensationMs: round.latency_compensation_ms,
    clientElapsedMs: round.client_elapsed_ms,
    serverElapsedMs: round.server_elapsed_ms,
    absoluteErrorMs: round.absolute_error_ms,
    multiplier: round.multiplier,
    grossPayout: round.gross_payout,
    grossProfit: round.gross_profit,
    prizeContribution: round.prize_contribution,
    finalPayout: round.final_payout,
    status: round.status,
    createdAt: round.created_at,
    settledAt: round.settled_at,
    expiredAt: round.expired_at,
  };
}

// 비정상 플레이 감지 로직
export function detectAndRecordAbuse(database, userId, round, detail) {
  const errorSec = detail.absoluteErrorMs / 1000;
  const timeDifferenceMs = Math.abs(detail.serverElapsedMs - detail.clientElapsedMs);
  
  // 1. 비정상적으로 극도로 낮은 오차 감지 (0.00초 ~ 0.01초)
  if (detail.absoluteErrorMs <= 10) {
    const priorCounts = database.prepare(`
      SELECT COUNT(*) AS count FROM game_logs
      WHERE user_id = ? AND game_type = 'timing' AND payout > 0
    `).get(userId).count;

    if (priorCounts >= 5) {
      const luckyGames = database.prepare(`
        SELECT detail_json FROM game_logs
        WHERE user_id = ? AND game_type = 'timing' AND payout > 0
        ORDER BY id DESC LIMIT 5
      `).all(userId);

      let perfectCount = 0;
      for (const game of luckyGames) {
        try {
          const d = JSON.parse(game.detail_json);
          if (d.absoluteErrorMs <= 10) perfectCount += 1;
        } catch {}
      }

      if (perfectCount >= 3) {
        database.prepare(`
          INSERT INTO abuse_logs (user_id, action_type, reason, metadata_json)
          VALUES (?, 'timing_perfect_abuse', '최근 5판 중 3판 이상이 0.01초 이하 오차를 기록했습니다.', ?)
        `).run(userId, JSON.stringify({ userId, perfectCount, roundId: round.id }));
      }
    }
  }

  // 2. 수십 회 연속 동일한 오차 발생 (오토 봇 의심)
  const lastGames = database.prepare(`
    SELECT detail_json FROM game_logs
    WHERE user_id = ? AND game_type = 'timing'
    ORDER BY id DESC LIMIT 10
  `).all(userId);

  if (lastGames.length >= 5) {
    let sameErrorCount = 0;
    try {
      const matchError = detail.absoluteErrorMs;
      for (const game of lastGames) {
        const d = JSON.parse(game.detail_json);
        if (d.absoluteErrorMs === matchError) sameErrorCount += 1;
      }
      if (sameErrorCount >= 4) {
        database.prepare(`
          INSERT INTO abuse_logs (user_id, action_type, reason, metadata_json)
          VALUES (?, 'timing_identical_error_abuse', '최근 플레이한 10판 중 4판 이상의 오차가 완전히 일치합니다.', ?)
        `).run(userId, JSON.stringify({ userId, sameErrorCount, matchErrorMs: matchError, roundId: round.id }));
      }
    } catch {}
  }

  // 3. 클라이언트 시간과 서버 경과시간의 큰 차이 (500ms 이상)
  if (timeDifferenceMs >= 500) {
    database.prepare(`
      INSERT INTO abuse_logs (user_id, action_type, reason, metadata_json)
      VALUES (?, 'timing_latency_desync_abuse', '클라이언트 경과 시간과 서버 경과 시간의 차이가 500ms 이상입니다.', ?)
    `).run(userId, JSON.stringify({ userId, timeDifferenceMs, serverElapsedMs: detail.serverElapsedMs, clientElapsedMs: detail.clientElapsedMs, roundId: round.id }));
  }

  // 4. 비정상적인 지연 보정 시도 (예: RTT가 음수이거나 비정상 데이터 입력)
  if (detail.latencyCompensationMs > 120 || detail.latencyCompensationMs < 0) {
    database.prepare(`
      INSERT INTO abuse_logs (user_id, action_type, reason, metadata_json)
      VALUES (?, 'timing_invalid_compensation_abuse', '보정된 네트워크 지연 속도가 허용 범위(0~120ms)를 이탈했습니다.', ?)
    `).run(userId, JSON.stringify({ userId, latencyCompensationMs: detail.latencyCompensationMs, roundId: round.id }));
  }
}

export function startTimingRound(database, { userId, modeSeconds, betAmount }) {
  return database.transaction(() => {
    const user = getFreshUser(userId);
    const config = getTimingGameConfig(database);
    const modeConfig = config[modeSeconds];
    if (!modeConfig) throw new GameError("올바르지 않은 시간 모드입니다.");

    // 활성 round가 이미 존재하는지 체크 (만료 처리 먼저 수행)
    const active = database.prepare(
      "SELECT * FROM timing_game_rounds WHERE user_id = ? AND status IN ('running', 'waiting_start', 'stopping')"
    ).get(userId);
    if (active) {
      const checked = checkAndApplyExpiration(database, active);
      if (checked.status === "waiting_start" || checked.status === "running" || checked.status === "stopping") {
        throw new GameError("이미 진행 중인 시간 감각 게임이 있어요.", 409);
      }
    }

    // 모드별 베팅 한도 확인
    const maxBetByRate = Math.floor(user.balance * modeConfig.maxBetCashRate);
    const finalMaxBet = maxBetByRate; // 최소 베팅은 1000원

    if (betAmount < 1000) {
      throw new GameError("최소 베팅금은 1,000원입니다.");
    }
    if (betAmount > finalMaxBet) {
      throw new GameError(`이 모드의 최대 베팅금은 ${maxBetByRate.toLocaleString("ko-KR")}원(보유 현금의 ${(modeConfig.maxBetCashRate * 100).toFixed(0)}%)입니다.`);
    }
    if (betAmount > user.balance) {
      throw new GameError("보유한 현금 잔액보다 많이 베팅할 수 없어요.");
    }

    const season = activeSeason(database);
    const id = `timing_${crypto.randomUUID()}`;
    const targetTimeMs = createTargetTimeMs(modeSeconds, config);
    const failWindowMs = Math.round(modeConfig.failWindowSeconds * 1000);
    
    const serverNow = Date.now();
    const startsAtMs = serverNow + 1500;
    const startsAt = new Date(startsAtMs).toISOString();

    const balanceAfterBet = user.balance - betAmount;

    database.prepare(`
      INSERT INTO timing_game_rounds
       (id, user_id, season_id, season_number, mode_seconds, target_time_ms, fail_window_ms,
        max_multiplier, curve_power, bet_amount, starts_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting_start')
    `).run(
      id, user.id, season?.id ?? null, season?.season_number ?? null,
      modeSeconds, targetTimeMs, failWindowMs, modeConfig.maxMultiplier,
      modeConfig.curvePower, betAmount, startsAt
    );

    database.prepare(
      "UPDATE users SET balance = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
    ).run(balanceAfterBet, user.id);

    recordAssetEvent({
      userId: user.id,
      eventType: "timing_game_bet",
      gameType: "timing",
      amount: -betAmount,
      balanceBefore: user.balance,
      balanceAfter: balanceAfterBet,
      sourceType: "timing_game_bet",
      sourceId: id,
      detail: { modeSeconds, targetTimeMs, failWindowMs },
    });

    const round = database.prepare("SELECT * FROM timing_game_rounds WHERE id = ?").get(id);
    return {
      round: serializeTimingRound(round),
      balance: balanceAfterBet,
      serverNow: new Date(serverNow).toISOString(),
    };
  })();
}

export function stopTimingRound(database, { userId, roundId, clientElapsedMs, clientRttMs }) {
  const stopReceivedAtMs = Date.now();
  
  return database.transaction(() => {
    let round = database.prepare(
      "SELECT * FROM timing_game_rounds WHERE id = ? AND user_id = ? FOR UPDATE"
    ).get(roundId, userId);

    if (!round) throw new GameError("게임 기록을 찾을 수 없어요.", 404);

    // 만료 처리 먼저 수행
    round = checkAndApplyExpiration(database, round);
    
    if (round.status === "expired") {
      throw new GameError("시간 초과로 인해 이미 실패 처리된 게임입니다.", 410);
    }
    if (round.status === "settled" || round.status === "cancelled") {
      throw new GameError("이미 결과가 확정된 게임이에요.", 409);
    }

    if (round.status !== "running" && round.status !== "waiting_start") {
      throw new GameError("진행 중인 게임이 아닙니다.", 400);
    }

    const startsAtMs = new Date(round.starts_at).getTime();
    
    // 지연 보정 계산 (median Rtt의 절반, 0 ~ 120ms)
    const clientRtt = Number(clientRttMs || 0);
    const latencyCompensationMs = Math.min(120, Math.max(0, Math.floor(clientRtt / 2)));
    
    const adjustedStoppedAtMs = stopReceivedAtMs - latencyCompensationMs;
    const serverElapsedMs = adjustedStoppedAtMs - startsAtMs;

    const absoluteErrorMs = Math.abs(serverElapsedMs - round.target_time_ms);
    const absoluteErrorSeconds = absoluteErrorMs / 1000;
    const failWindowSeconds = round.fail_window_ms / 1000;

    const multiplier = calculateTimingMultiplier({
      absoluteErrorSeconds,
      failWindowSeconds,
      maxMultiplier: round.max_multiplier,
      curvePower: round.curve_power
    });

    const won = multiplier > 0;
    const grossPayout = Math.floor(round.bet_amount * multiplier);
    const grossProfit = won ? grossPayout - round.bet_amount : -round.bet_amount;
    const prizeContribution = multiplier > 1.0 ? Math.floor(Math.max(0, grossProfit) * 0.01) : 0;
    const finalPayout = grossPayout - prizeContribution;

    const user = getFreshUser(userId);
    const balanceAfter = user.balance + finalPayout;
    const profit = finalPayout - round.bet_amount;

    const detail = {
      roundId: round.id,
      modeSeconds: round.mode_seconds,
      targetTimeMs: round.target_time_ms,
      failWindowMs: round.fail_window_ms,
      serverElapsedMs,
      clientElapsedMs,
      latencyCompensationMs,
      absoluteErrorMs,
      multiplier,
      grossPayout,
      grossProfit,
      prizeContribution,
      finalPayout,
    };

    // 1. 비정상 감지 및 abuse 기록
    detectAndRecordAbuse(database, userId, round, detail);

    // 2. DB 업데이트
    database.prepare(`
      UPDATE timing_game_rounds
      SET stop_received_at = ?,
          latency_compensation_ms = ?,
          client_elapsed_ms = ?,
          server_elapsed_ms = ?,
          absolute_error_ms = ?,
          multiplier = ?,
          gross_payout = ?,
          gross_profit = ?,
          prize_contribution = ?,
          final_payout = ?,
          status = 'settled',
          settled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND status IN ('waiting_start', 'running')
    `).run(
      new Date(stopReceivedAtMs).toISOString(),
      latencyCompensationMs,
      clientElapsedMs,
      serverElapsedMs,
      absoluteErrorMs,
      multiplier,
      grossPayout,
      grossProfit,
      prizeContribution,
      finalPayout,
      round.id
    );

    database.prepare(`
      UPDATE users
      SET balance = ?,
          highest_balance = MAX(highest_balance, ?),
          total_profit = total_profit + ?,
          total_bet = total_bet + ?,
          total_win = total_win + ?,
          total_loss = total_loss + ?,
          jackpot_tickets = jackpot_tickets + 1,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(balanceAfter, balanceAfter, profit, round.bet_amount, won ? 1 : 0, won ? 0 : 1, userId);

    const gameLog = database.prepare(`
      INSERT INTO game_logs
       (user_id, game_type, bet_amount, result, payout, profit, balance_before, balance_after, detail_json)
       VALUES (?, 'timing', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      round.bet_amount,
      won ? "win" : "loss",
      finalPayout,
      profit,
      user.balance,
      balanceAfter,
      JSON.stringify(detail)
    );

    if (won) {
      recordAssetEvent({
        userId,
        eventType: "timing_game_win",
        gameType: "timing",
        amount: grossPayout,
        balanceBefore: user.balance,
        balanceAfter: user.balance + grossPayout,
        sourceType: "timing_game_win",
        sourceId: round.id,
        detail,
      });
    }

    if (prizeContribution > 0) {
      addJackpotContribution(database, prizeContribution, {
        sourceType: "timing_daily_prize_contribution",
        sourceId: round.id,
        userId,
        metadata: detail,
      });
      recordAssetEvent({
        userId,
        eventType: "daily_prize_contribution",
        gameType: "timing",
        amount: -prizeContribution,
        balanceBefore: user.balance + grossPayout,
        balanceAfter,
        sourceType: "timing_daily_prize_contribution",
        sourceId: round.id,
        detail,
      });
    }

    incrementDailyMissionProgress(database, userId, "timing_play");

    const achievements = awardAchievements(database, userId, {
      gameType: "timing",
      gameCompleted: true,
      won,
      modeSeconds: round.mode_seconds,
      absoluteErrorMs,
      multiplier,
      profit,
      payout: finalPayout,
    });

    const currentUser = getFreshUser(userId);
    createGameNotification(database, {
      gameLogId: gameLog.lastInsertRowid,
      user: currentUser,
      gameType: "timing",
      bet: Number(round.bet_amount),
      payout: finalPayout,
      won,
      detail,
    });

    const settledRound = database.prepare("SELECT * FROM timing_game_rounds WHERE id = ?").get(round.id);
    return {
      round: serializeTimingRound(settledRound),
      won,
      payout: finalPayout,
      profit,
      balance: currentUser.balance,
      achievements,
      detail,
    };
  })();
}

export function getTimingRound(database, { userId, roundId }) {
  let round = database.prepare("SELECT * FROM timing_game_rounds WHERE id = ? AND user_id = ?").get(roundId, userId);
  if (!round) throw new GameError("게임 기록을 찾을 수 없어요.", 404);
  
  // 만료 처리 체크
  round = checkAndApplyExpiration(database, round);
  return serializeTimingRound(round);
}

export function getActiveTimingRound(database, { userId }) {
  let round = database.prepare(
    "SELECT * FROM timing_game_rounds WHERE user_id = ? AND status IN ('waiting_start', 'running', 'stopping') ORDER BY created_at DESC LIMIT 1"
  ).get(userId);
  
  if (round) {
    // 만료 처리 체크
    round = checkAndApplyExpiration(database, round);
    if (round.status === "waiting_start" || round.status === "running" || round.status === "stopping") {
      return serializeTimingRound(round);
    }
  }
  
  return null;
}

// 어드민 통계 함수
export function getTimingGameStats(database) {
  const totalPlay = database.prepare("SELECT COUNT(*) AS count FROM game_logs WHERE game_type = 'timing'").get().count;
  
  const financial = database.prepare(`
    SELECT COALESCE(SUM(bet_amount), 0) AS totalBet,
           COALESCE(SUM(payout), 0) AS totalPayout
    FROM game_logs WHERE game_type = 'timing'
  `).get();

  const totalBet = Number(financial.totalBet);
  const totalPayout = Number(financial.totalPayout);
  
  const avgMultiplierRaw = database.prepare(`
    SELECT AVG(payout * 1.0 / NULLIF(bet_amount, 0)) AS avgMult
    FROM game_logs WHERE game_type = 'timing' AND payout > 0
  `).get().avgMult;
  const avgMultiplier = avgMultiplierRaw ? Number(Number(avgMultiplierRaw).toFixed(2)) : 0;

  const avgErrorRaw = database.prepare(`
    SELECT AVG(absolute_error_ms) AS avgErr
    FROM timing_game_rounds WHERE status = 'settled'
  `).get().avgErr;
  const avgErrorMs = avgErrorRaw ? Math.round(Number(avgErrorRaw)) : 0;

  const perfectCount = database.prepare(`
    SELECT COUNT(*) AS count FROM timing_game_rounds
    WHERE status = 'settled' AND absolute_error_ms <= 20
  `).get().count;

  const abuseCount = database.prepare(`
    SELECT COUNT(*) AS count FROM abuse_logs
    WHERE action_type LIKE 'timing_%'
  `).get().count;

  // 24시간 지급률
  const recentFinancial = database.prepare(`
    SELECT COALESCE(SUM(bet_amount), 0) AS totalBet,
           COALESCE(SUM(payout), 0) AS totalPayout
    FROM game_logs
    WHERE game_type = 'timing'
      AND created_at >= datetime('now', '-24 hours')
  `).get();
  
  const payoutRate24h = Number(recentFinancial.totalBet) > 0
    ? Number((Number(recentFinancial.totalPayout) / Number(recentFinancial.totalBet) * 100).toFixed(1))
    : 0;

  // 모드별 통계
  const modes = [10, 20, 30, 45, 60];
  const modeStats = {};

  for (const m of modes) {
    const mRow = database.prepare(`
      SELECT COUNT(*) AS count,
             COALESCE(SUM(bet_amount), 0) AS totalBet,
             COALESCE(SUM(payout), 0) AS totalPayout,
             AVG(absolute_error_ms) AS avgErr
      FROM timing_game_rounds
      WHERE mode_seconds = ? AND status = 'settled'
    `).get(m);

    const mBet = Number(mRow.totalBet);
    const mPayout = Number(mRow.totalPayout);
    const mCount = Number(mRow.count);
    
    const lossRate = mBet > 0
      ? Number((((mBet - mPayout) / mBet) * 100).toFixed(1))
      : 0;

    const avgMultRow = database.prepare(`
      SELECT AVG(multiplier) AS avgM
      FROM timing_game_rounds
      WHERE mode_seconds = ? AND status = 'settled' AND multiplier > 0
    `).get(m);

    modeStats[m] = {
      playCount: mCount,
      totalBet: mBet,
      totalPayout: mPayout,
      avgMultiplier: avgMultRow.avgM ? Number(Number(avgMultRow.avgM).toFixed(2)) : 0,
      avgErrorMs: mRow.avgErr ? Math.round(Number(mRow.avgErr)) : 0,
      lossRate,
    };
  }

  return {
    totalPlay,
    totalBet,
    totalPayout,
    avgMultiplier,
    avgErrorMs,
    perfectCount,
    abuseCount,
    payoutRate24h,
    modeStats,
  };
}
