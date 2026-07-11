import { recordAssetEvent } from "./assetEventService.js";
import { ensureActiveJackpotRound } from "./jackpotService.js";

const DEFAULT_DAILY_MISSIONS = [
  {
    missionType: "bomb-dodge_play",
    title: "폭탄 숫자 피하기 3회 플레이",
    targetCount: 3,
    rewardType: "jackpot_ticket",
    rewardAmount: 1,
  },
  {
    missionType: "card-draw_play",
    title: "카드 뽑기 3회 플레이",
    targetCount: 3,
    rewardType: "jackpot_ticket",
    rewardAmount: 1,
  },
  {
    missionType: "cup_play",
    title: "컵 속 행운 3회 플레이",
    targetCount: 3,
    rewardType: "jackpot_ticket",
    rewardAmount: 1,
  },
  {
    missionType: "mine_click",
    title: "탄광 10회 캐기",
    targetCount: 10,
    rewardType: "balance",
    rewardAmount: 50_000,
  },
  {
    missionType: "stock_buy",
    title: "주식 1회 매수",
    targetCount: 1,
    rewardType: "jackpot_ticket",
    rewardAmount: 1,
  },
  {
    missionType: "stock_sell",
    title: "주식 1회 매도",
    targetCount: 1,
    rewardType: "jackpot_ticket",
    rewardAmount: 1,
  },
  {
    missionType: "jackpot_apply",
    title: "행운권 1장 응모",
    targetCount: 1,
    rewardType: "jackpot_extra_entry",
    rewardAmount: 1,
  },
];

export function getKstDateKey(database) {
  return database.prepare("SELECT date('now', '+9 hours') AS value").get().value;
}

export function ensureDailyMissions(database, dateKey = getKstDateKey(database)) {
  const insert = database.prepare(
    `INSERT OR IGNORE INTO daily_missions
     (date_key, mission_type, title, target_count, reward_type, reward_amount)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const mission of DEFAULT_DAILY_MISSIONS) {
    insert.run(
      dateKey,
      mission.missionType,
      mission.title,
      mission.targetCount,
      mission.rewardType,
      mission.rewardAmount,
    );
  }
  return database
    .prepare("SELECT * FROM daily_missions WHERE date_key = ? ORDER BY id ASC")
    .all(dateKey);
}

export function getUserDailyMissions(database, userId, dateKey = getKstDateKey(database)) {
  const missions = ensureDailyMissions(database, dateKey);
  const progressByMissionId = new Map(
    database
      .prepare(
        `SELECT *
         FROM user_daily_mission_progress
         WHERE user_id = ?
           AND mission_id IN (${missions.map(() => "?").join(",") || "NULL"})`,
      )
      .all(userId, ...missions.map((mission) => mission.id))
      .map((row) => [row.mission_id, row]),
  );

  return missions.map((mission) => {
    const progress = progressByMissionId.get(mission.id);
    const progressCount = Math.min(
      Number(progress?.progress_count || 0),
      Number(mission.target_count || 0),
    );
    return {
      id: mission.id,
      dateKey: mission.date_key,
      missionType: mission.mission_type,
      title: mission.title,
      targetCount: mission.target_count,
      progressCount,
      rewardType: mission.reward_type,
      rewardAmount: mission.reward_amount,
      completedAt: progress?.completed_at || null,
      claimedAt: progress?.claimed_at || null,
      completed: progressCount >= mission.target_count,
      claimed: Boolean(progress?.claimed_at),
    };
  });
}

export function incrementDailyMissionProgress(database, userId, missionType, amount = 1) {
  if (!userId || !missionType) return [];
  const dateKey = getKstDateKey(database);
  const missions = ensureDailyMissions(database, dateKey).filter(
    (mission) => mission.mission_type === missionType,
  );
  if (missions.length === 0) return [];

  const touched = [];
  for (const mission of missions) {
    database
      .prepare(
        `INSERT OR IGNORE INTO user_daily_mission_progress
         (user_id, mission_id, progress_count)
         VALUES (?, ?, 0)`,
      )
      .run(userId, mission.id);

    const progress = database
      .prepare(
        `SELECT *
         FROM user_daily_mission_progress
         WHERE user_id = ? AND mission_id = ?`,
      )
      .get(userId, mission.id);

    if (!progress || progress.claimed_at) continue;
    const nextCount = Math.min(
      Number(mission.target_count),
      Number(progress.progress_count || 0) + Math.max(1, Math.floor(amount)),
    );
    const completedAt =
      progress.completed_at ||
      (nextCount >= Number(mission.target_count)
        ? new Date().toISOString()
        : null);

    database
      .prepare(
        `UPDATE user_daily_mission_progress
         SET progress_count = ?,
             completed_at = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      )
      .run(nextCount, completedAt, progress.id);
    touched.push({ missionId: mission.id, progressCount: nextCount, completedAt });
  }
  return touched;
}

export function claimDailyMissionReward(database, userId, missionId) {
  return database.transaction(() => {
    ensureDailyMissions(database);
    const mission = database
      .prepare("SELECT * FROM daily_missions WHERE id = ?")
      .get(missionId);
    if (!mission) {
      const error = new Error("미션을 찾을 수 없습니다.");
      error.status = 404;
      throw error;
    }

    const progress = database
      .prepare(
        `SELECT *
         FROM user_daily_mission_progress
         WHERE user_id = ? AND mission_id = ?`,
      )
      .get(userId, mission.id);
    if (!progress || Number(progress.progress_count || 0) < Number(mission.target_count)) {
      const error = new Error("아직 완료하지 않은 미션입니다.");
      error.status = 400;
      throw error;
    }
    if (progress.claimed_at) {
      const error = new Error("이미 보상을 받은 미션입니다.");
      error.status = 409;
      throw error;
    }

    const user = database.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    if (!user) {
      const error = new Error("사용자를 찾을 수 없습니다.");
      error.status = 404;
      throw error;
    }

    let balanceAfter = user.balance;
    if (mission.reward_type === "balance") {
      balanceAfter = user.balance + Number(mission.reward_amount || 0);
      database
        .prepare(
          `UPDATE users
           SET balance = ?,
               total_profit = total_profit + ?,
               highest_balance = MAX(highest_balance, ?),
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
        )
        .run(balanceAfter, mission.reward_amount, balanceAfter, userId);
      recordAssetEvent({
        userId,
        eventType: "daily_mission_reward",
        amount: mission.reward_amount,
        balanceBefore: user.balance,
        balanceAfter,
        sourceType: "daily_mission",
        sourceId: mission.id,
        detail: {
          missionType: mission.mission_type,
          title: mission.title,
          rewardType: mission.reward_type,
        },
      });
    } else if (mission.reward_type === "jackpot_ticket") {
      database
        .prepare("UPDATE users SET jackpot_tickets = jackpot_tickets + ? WHERE id = ?")
        .run(mission.reward_amount, userId);
      recordAssetEvent({
        userId,
        eventType: "daily_mission_reward",
        amount: 0,
        balanceBefore: user.balance,
        balanceAfter: user.balance,
        sourceType: "daily_mission",
        sourceId: mission.id,
        detail: {
          missionType: mission.mission_type,
          title: mission.title,
          rewardType: mission.reward_type,
          rewardAmount: mission.reward_amount,
        },
      });
    } else if (mission.reward_type === "jackpot_extra_entry") {
      const round = ensureActiveJackpotRound(database);
      database
        .prepare(
          `INSERT INTO jackpot_entries (round_id, user_id, extra_entry_count)
           VALUES (?, ?, ?)
           ON CONFLICT(round_id, user_id)
           DO UPDATE SET extra_entry_count = extra_entry_count + excluded.extra_entry_count`,
        )
        .run(round.id, userId, mission.reward_amount);
      database
        .prepare("UPDATE jackpot_rounds SET total_extra_entries = total_extra_entries + ? WHERE id = ?")
        .run(mission.reward_amount, round.id);
      recordAssetEvent({
        userId,
        eventType: "daily_mission_reward",
        amount: 0,
        balanceBefore: user.balance,
        balanceAfter: user.balance,
        sourceType: "daily_mission",
        sourceId: mission.id,
        detail: {
          missionType: mission.mission_type,
          title: mission.title,
          rewardType: mission.reward_type,
          rewardAmount: mission.reward_amount,
          roundId: round.id,
        },
      });
    } else {
      const error = new Error("지원하지 않는 미션 보상입니다.");
      error.status = 500;
      throw error;
    }

    const claimedAt = new Date().toISOString();
    database
      .prepare(
        `UPDATE user_daily_mission_progress
         SET claimed_at = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      )
      .run(claimedAt, progress.id);

    return {
      missionId: mission.id,
      rewardType: mission.reward_type,
      rewardAmount: mission.reward_amount,
      balance: balanceAfter,
      missions: getUserDailyMissions(database, userId, mission.date_key),
    };
  })();
}
