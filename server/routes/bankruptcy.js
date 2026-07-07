import { Router } from "express";
import { db, publicUser } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { recordAssetEvent } from "../services/assetEventService.js";
import {
  BANKRUPTCY_POLICY,
  assertCanApplyBankruptcy,
  getBankruptcyStatus,
} from "../services/bankruptcyService.js";
import { createServerNotification } from "../services/serverNotificationService.js";

export const bankruptcyRouter = Router();
bankruptcyRouter.use(requireAuth);

bankruptcyRouter.get("/status", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const status = getBankruptcyStatus(db, user);
  return res.json({
    ...status,
    bankruptcyCount: user.bankruptcy_count,
    lastBankruptcyAt: user.last_bankruptcy_at,
  });
});

bankruptcyRouter.post("/apply", (req, res, next) => {
  try {
    const apply = db.transaction(() => {
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
      const bankruptcyStatus = assertCanApplyBankruptcy(db, user);
      const balanceAfter = BANKRUPTCY_POLICY.resetBalance;
      const amount = balanceAfter - user.balance;
      db.prepare(
        `UPDATE users
         SET balance = ?,
             highest_balance = MAX(highest_balance, ?),
             total_profit = total_profit + ?,
             bankruptcy_count = bankruptcy_count + 1,
             last_bankruptcy_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             bankruptcy_prompt_dismissed_at = NULL,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      ).run(balanceAfter, balanceAfter, amount, user.id);
      const event = recordAssetEvent({
        userId: user.id,
        eventType: "bankruptcy_reset",
        amount,
        balanceBefore: user.balance,
        balanceAfter,
        detail: {
          label: "파산신청 자산 재설정",
          bankruptcyCount: user.bankruptcy_count + 1,
          totalEvaluatedAsset: bankruptcyStatus.totalEvaluatedAsset,
          recentOutgoingTransferAmount:
            bankruptcyStatus.recentOutgoingTransferAmount,
          effectiveBankruptcyAsset: bankruptcyStatus.effectiveBankruptcyAsset,
        },
      });
      createServerNotification(db, {
        userId: user.id,
        nickname: user.nickname,
        type: "bankruptcy",
        title: "행운주머니 새출발",
        message: `${user.nickname}님이 행운주머니를 다시 채우고 1,000,000원부터 시작했어요.`,
        amount,
        metadata: {
          balanceBefore: user.balance,
          balanceAfter,
          bankruptcyCount: user.bankruptcy_count + 1,
        },
        sourceType: "bankruptcy",
        sourceId: event.lastInsertRowid,
      });
      return db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    });
    const user = apply();
    return res.json({
      message: "자산이 1,000,000원으로 재설정되었어요.",
      user: publicUser(user),
    });
  } catch (error) {
    return next(error);
  }
});

bankruptcyRouter.post("/dismiss", (req, res, next) => {
  try {
    db.prepare(
      `UPDATE users
       SET bankruptcy_prompt_dismissed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    ).run(req.user.id);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    const status = getBankruptcyStatus(db, user);
    return res.json({
      ...status,
    });
  } catch (error) {
    return next(error);
  }
});
