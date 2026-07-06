import { Router } from "express";
import { db, publicUser } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { awardAchievements } from "../services/achievementService.js";
import { recordAssetEvent } from "../services/assetEventService.js";
import { bonusCodeLimitState } from "../services/bonusCodeService.js";
import { createServerNotification } from "../services/serverNotificationService.js";

export const bonusCodesRouter = Router();
bonusCodesRouter.use(requireAuth);

bonusCodesRouter.post("/redeem", (req, res, next) => {
  try {
    const normalizedCode = String(req.body.code || "").trim().toUpperCase();
    if (!/^[A-Z0-9_-]{4,40}$/.test(normalizedCode)) {
      return res.status(400).json({ message: "사용할 수 없는 코드예요." });
    }
    const redeem = db.transaction(() => {
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
      if (normalizedCode === "SEED0315" && user.username !== "admin") {
        const error = new Error("이 행운코드는 사용할 수 없어요.");
        error.status = 403;
        throw error;
      }
      const code = db
        .prepare(
          `SELECT *,
                  CASE
                    WHEN expires_at IS NOT NULL AND julianday(expires_at) <= julianday('now')
                    THEN 1 ELSE 0
                  END AS is_expired
           FROM bonus_codes WHERE code = ?`,
        )
        .get(normalizedCode);
      if (!code || !code.is_active) {
        const error = new Error("사용할 수 없는 코드예요.");
        error.status = 400;
        throw error;
      }
      const totalLimit = bonusCodeLimitState(code, 0);
      if (totalLimit.totalLimitReached) {
        const error = new Error("사용할 수 없는 코드예요.");
        error.status = 400;
        throw error;
      }
      if (code.is_expired) {
        const error = new Error("만료된 코드예요.");
        error.status = 400;
        throw error;
      }
      const userUses = db
        .prepare(
          "SELECT COUNT(*) AS count FROM bonus_code_redemptions WHERE bonus_code_id = ? AND user_id = ?",
        )
        .get(code.id, req.user.id).count;
      
      const isAdminSeed = normalizedCode === "SEED0315" && user.username === "admin";
      if (!isAdminSeed && bonusCodeLimitState(code, userUses).userLimitReached) {
        const error = new Error("이미 사용한 코드예요.");
        error.status = 409;
        throw error;
      }

      const balanceAfter = user.balance + code.reward_amount;
      db.prepare(
        `UPDATE users
         SET balance = ?,
             highest_balance = MAX(highest_balance, ?),
             total_profit = total_profit + ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      ).run(balanceAfter, balanceAfter, code.reward_amount, user.id);
      db.prepare("UPDATE bonus_codes SET used_count = used_count + 1 WHERE id = ?").run(code.id);
      const redemption = db
        .prepare(
          `INSERT INTO bonus_code_redemptions
           (bonus_code_id, user_id, reward_amount, balance_before, balance_after)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(code.id, user.id, code.reward_amount, user.balance, balanceAfter);
      recordAssetEvent({
        userId: user.id,
        eventType: "bonus_code",
        amount: code.reward_amount,
        balanceBefore: user.balance,
        balanceAfter,
        sourceType: "bonus_redemption",
        sourceId: redemption.lastInsertRowid,
        detail: {
          code: code.code,
          description: code.description,
        },
      });
      const achievements = awardAchievements(db, user.id, {
        gameCompleted: false,
        source: "bonus_code",
      });
      if (code.reward_amount >= 10000000) {
        createServerNotification(db, {
          userId: user.id,
          nickname: user.nickname,
          type: "bonus_code",
          title: "행운코드 보너스",
          message: `${user.nickname}님이 행운코드로 ${code.reward_amount.toLocaleString("ko-KR")}원을 받았어요!`,
          amount: code.reward_amount,
          metadata: { bonusCodeId: code.id },
          sourceType: "bonus_redemption",
          sourceId: redemption.lastInsertRowid,
        });
      }
      const finalUser = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
      return {
        rewardAmount: code.reward_amount,
        balance: finalUser.balance,
        user: publicUser(finalUser),
        achievements,
      };
    });

    const result = redeem();
    return res.json({
      message: `행운코드 성공! ${result.rewardAmount.toLocaleString("ko-KR")}원을 받았어요.`,
      ...result,
    });
  } catch (error) {
    return next(error);
  }
});
