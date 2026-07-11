import { Router } from "express";
import { db, publicUser } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { serializeAchievements } from "../services/achievementService.js";
import { recordAssetEvent } from "../services/assetEventService.js";
import { getBankruptcyStatus } from "../services/bankruptcyService.js";
import { calculateUserTotalEvaluatedAsset } from "../services/portfolioValuationService.js";
import {
  claimDailyMissionReward,
  getUserDailyMissions,
} from "../services/dailyMissionService.js";
import { getLuckStats } from "../services/luckStatsService.js";

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get("/", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (req.user.isAdmin) user.isAdmin = true;
  const activeSeason = db
    .prepare("SELECT id FROM seasons WHERE status = 'active' ORDER BY season_number DESC LIMIT 1")
    .get();
  const todayProfit = db
    .prepare(
      `SELECT TOTAL(profit) AS value
       FROM game_logs
       WHERE user_id = ?
         AND date(created_at, '+9 hours') = date('now', '+9 hours')
         AND (? IS NULL OR season_id = ?)`,
    )
    .get(user.id, activeSeason?.id ?? null, activeSeason?.id ?? null).value;
  const achievements = serializeAchievements(db, user.id);
  const revivalCount = db
    .prepare(
      "SELECT COUNT(*) AS count FROM revival_claims WHERE user_id = ? AND claim_date = date('now', '+9 hours')",
    )
    .get(user.id).count;
  const valuation = calculateUserTotalEvaluatedAsset(db, user.id);
  const { totalEvaluatedAsset } = valuation;
  const rankedUsers = db.prepare("SELECT id FROM users ORDER BY id ASC").all()
    .map((entry) => ({
      id: entry.id,
      totalEvaluatedAsset: calculateUserTotalEvaluatedAsset(db, entry.id).totalEvaluatedAsset,
    }))
    .sort((left, right) => right.totalEvaluatedAsset - left.totalEvaluatedAsset || left.id - right.id);
  let previousAsset = null;
  let previousRank = 0;
  const currentRank = rankedUsers.reduce((rank, entry, index) => {
    const nextRank = entry.totalEvaluatedAsset === previousAsset ? previousRank : index + 1;
    previousAsset = entry.totalEvaluatedAsset;
    previousRank = nextRank;
    return entry.id === user.id ? nextRank : rank;
  }, 1);
  const totalUsers = rankedUsers.length;
  const bankruptcyStatus = getBankruptcyStatus(db, user, valuation);

  if (!bankruptcyStatus.eligible && user.bankruptcy_prompt_dismissed_at) {
    db.prepare("UPDATE users SET bankruptcy_prompt_dismissed_at = NULL WHERE id = ?").run(user.id);
    user.bankruptcy_prompt_dismissed_at = null;
  }

  return res.json({
    user: {
      ...publicUser(user),
      totalAsset: totalEvaluatedAsset,
      todayProfit,
      achievements,
      revivalsRemaining: Math.max(0, 3 - revivalCount),
      currentRank,
      totalUsers,
      bankruptcyEligible: bankruptcyStatus.eligible,
      bankruptcyShouldPrompt: bankruptcyStatus.shouldPrompt,
      bankruptcyStatus,
    },
  });
});

meRouter.get("/season-results", (req, res) => {
  const results = db
    .prepare(
      `SELECT
         season_number,
         rank,
         final_balance,
         final_total_evaluated_asset,
         total_games,
         total_profit,
         starting_bonus_for_next_season,
         created_at
       FROM season_results
       WHERE user_id = ?
       ORDER BY season_number DESC`,
    )
    .all(req.user.id)
    .map((row) => ({
      seasonNumber: row.season_number,
      rank: row.rank,
      finalBalance: row.final_balance,
      finalTotalEvaluatedAsset: row.final_total_evaluated_asset,
      totalGames: row.total_games,
      totalProfit: row.total_profit,
      startingBonusForNextSeason: row.starting_bonus_for_next_season,
      createdAt: row.created_at,
    }));

  return res.json({ results });
});

meRouter.get("/daily-missions", (req, res) => {
  return res.json({ missions: getUserDailyMissions(db, req.user.id) });
});

meRouter.post("/daily-missions/:missionId/claim", (req, res, next) => {
  try {
    const missionId = Number(req.params.missionId);
    if (!Number.isSafeInteger(missionId)) {
      return res.status(400).json({ message: "올바른 미션 ID가 아닙니다." });
    }
    return res.json(claimDailyMissionReward(db, req.user.id, missionId));
  } catch (error) {
    return next(error);
  }
});

meRouter.get("/luck-stats", (req, res) => {
  return res.json({ luckStats: getLuckStats(db, req.user.id) });
});

meRouter.post("/revive", (req, res, next) => {
  try {
    const revive = db.transaction(() => {
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
      if (user.balance >= 1000) {
        const error = new Error("현재 자산이 1,000원 미만일 때만 지원금을 받을 수 있어요.");
        error.status = 400;
        throw error;
      }
      const row = db
        .prepare(
          "SELECT COUNT(*) AS count FROM revival_claims WHERE user_id = ? AND claim_date = date('now', '+9 hours')",
        )
        .get(user.id);
      if (row.count >= 3) {
        const error = new Error("오늘 받을 수 있는 부활 지원금을 모두 사용했어요.");
        error.status = 429;
        throw error;
      }
      db.prepare(
        "INSERT INTO revival_claims (user_id, claim_date, amount) VALUES (?, date('now', '+9 hours'), 100000)",
      ).run(user.id);
      const balanceAfter = user.balance + 100000;
      db.prepare(
        `UPDATE users
         SET balance = ?,
             total_profit = total_profit + 100000,
             highest_balance = MAX(highest_balance, ?),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      ).run(balanceAfter, balanceAfter, user.id);
      const claim = db
        .prepare("SELECT id FROM revival_claims WHERE user_id = ? ORDER BY id DESC LIMIT 1")
        .get(user.id);
      recordAssetEvent({
        userId: user.id,
        eventType: "support_grant",
        amount: 100000,
        balanceBefore: user.balance,
        balanceAfter,
        sourceType: "revival_claim",
        sourceId: claim.id,
        detail: { label: "행운주머니 지원금" },
      });
      return { balance: balanceAfter, revivalsRemaining: 2 - row.count };
    });
    return res.json(revive());
  } catch (error) {
    return next(error);
  }
});
