import { Router } from "express";
import { db, publicUser } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { serializeAchievements } from "../services/achievementService.js";
import { recordAssetEvent } from "../services/assetEventService.js";
import { canPromptBankruptcy } from "../services/bankruptcyService.js";
import { calculateUserTotalEvaluatedAsset } from "../services/portfolioValuationService.js";

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get("/", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (req.user.isAdmin) user.isAdmin = true;
  const todayProfit = db
    .prepare(
      `SELECT TOTAL(profit) AS value
       FROM game_logs
       WHERE user_id = ? AND date(created_at, '+9 hours') = date('now', '+9 hours')`,
    )
    .get(user.id).value;
  const achievements = serializeAchievements(db, user.id);
  const revivalCount = db
    .prepare(
      "SELECT COUNT(*) AS count FROM revival_claims WHERE user_id = ? AND claim_date = date('now', '+9 hours')",
    )
    .get(user.id).count;
  const currentRank = db
    .prepare("SELECT 1 + COUNT(DISTINCT balance) AS rank FROM users WHERE balance > ?")
    .get(user.balance).rank;
  const totalUsers = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;

  const { totalEvaluatedAsset } = calculateUserTotalEvaluatedAsset(db, user.id);

  return res.json({
    user: {
      ...publicUser(user),
      totalAsset: totalEvaluatedAsset,
      todayProfit,
      achievements,
      revivalsRemaining: Math.max(0, 3 - revivalCount),
      currentRank,
      totalUsers,
      bankruptcyEligible: user.balance < 500000,
      bankruptcyShouldPrompt: canPromptBankruptcy(db, user),
    },
  });
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
