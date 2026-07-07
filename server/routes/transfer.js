import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { awardAchievements } from "../services/achievementService.js";
import { recordAssetEvent } from "../services/assetEventService.js";
import { assertCanTransferAfterBankruptcy } from "../services/bankruptcyService.js";
import { findUserByNickname } from "../services/nicknameService.js";

export const transferRouter = Router();
transferRouter.use(requireAuth);

transferRouter.post("/", (req, res, next) => {
  try {
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount < 1000 || Math.floor(amount) !== amount) {
      return res.status(400).json({ message: "송금할 금액을 확인해주세요." });
    }
    const transfer = db.transaction(() => {
      const sender = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
      assertCanTransferAfterBankruptcy(sender);
      const receiver = findUserByNickname(db, req.body.receiverNickname);
      if (!receiver) {
        const error = new Error("받는 사람을 찾을 수 없어요.");
        error.status = 404;
        throw error;
      }
      if (receiver.id === sender.id) {
        const error = new Error("자기 자신에게는 송금할 수 없어요.");
        error.status = 400;
        throw error;
      }
      const receiverOwnsCompany = db
        .prepare(
          `SELECT 1
           FROM stocks
           WHERE owner_user_id = ?
             AND is_etf = 1
             AND status = 'acquired'
           LIMIT 1`,
        )
        .get(receiver.id);
      if (receiverOwnsCompany) {
        const error = new Error("회사를 인수한 사용자는 다른 플레이어의 송금을 받을 수 없어요.");
        error.status = 400;
        throw error;
      }
      if (amount > sender.balance) {
        const error = new Error("자산이 부족해요.");
        error.status = 400;
        throw error;
      }

      const senderAfter = sender.balance - amount;
      const receiverAfter = receiver.balance + amount;
      db.prepare(
        `UPDATE users SET balance = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      ).run(senderAfter, sender.id);
      db.prepare(
        `UPDATE users
         SET balance = ?,
             highest_balance = MAX(highest_balance, ?),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      ).run(receiverAfter, receiverAfter, receiver.id);
      const log = db
        .prepare(
          `INSERT INTO transfer_logs
           (sender_user_id, receiver_user_id, sender_nickname_snapshot,
            receiver_nickname_snapshot, amount, sender_balance_before,
            sender_balance_after, receiver_balance_before, receiver_balance_after)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sender.id,
          receiver.id,
          sender.nickname,
          receiver.nickname,
          amount,
          sender.balance,
          senderAfter,
          receiver.balance,
          receiverAfter,
        );

      recordAssetEvent({
        userId: sender.id,
        eventType: "transfer_out",
        amount: -amount,
        balanceBefore: sender.balance,
        balanceAfter: senderAfter,
        sourceType: "transfer_out",
        sourceId: log.lastInsertRowid,
        detail: {
          transferId: Number(log.lastInsertRowid),
          otherUserId: receiver.id,
          otherNickname: receiver.nickname,
        },
      });
      recordAssetEvent({
        userId: receiver.id,
        eventType: "transfer_in",
        amount,
        balanceBefore: receiver.balance,
        balanceAfter: receiverAfter,
        sourceType: "transfer_in",
        sourceId: log.lastInsertRowid,
        detail: {
          transferId: Number(log.lastInsertRowid),
          otherUserId: sender.id,
          otherNickname: sender.nickname,
        },
      });

      const achievements = awardAchievements(db, receiver.id, {
        gameCompleted: false,
        source: "transfer",
      });
      const finalSender = db.prepare("SELECT balance FROM users WHERE id = ?").get(sender.id);
      return {
        transferId: Number(log.lastInsertRowid),
        amount,
        receiverNickname: receiver.nickname,
        balance: finalSender.balance,
        receiverAchievements: achievements,
      };
    });

    return res.json({
      message: "송금 완료! 행운을 나눴어요.",
      ...transfer(),
    });
  } catch (error) {
    return next(error);
  }
});
