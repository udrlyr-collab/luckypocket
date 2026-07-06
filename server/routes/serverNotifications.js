import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const serverNotificationsRouter = Router();
serverNotificationsRouter.use(requireAuth);

serverNotificationsRouter.get("/", (req, res) => {
  const requestedLimit = Number(req.query.limit || 20);
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.min(50, Math.max(1, requestedLimit))
    : 20;
  const notifications = db
    .prepare(
      `SELECT id, nickname_snapshot, type, title, message, amount, multiplier,
              game_type, game_name, metadata_json, created_at
       FROM server_notifications
       ORDER BY id DESC LIMIT ?`,
    )
    .all(limit)
    .map((row) => ({
      id: row.id,
      nickname: row.nickname_snapshot,
      type: row.type,
      title: row.title,
      message: row.message,
      amount: row.amount,
      multiplier: row.multiplier,
      gameType: row.game_type,
      gameName: row.game_name,
      metadata: JSON.parse(row.metadata_json),
      createdAt: row.created_at,
    }));
  return res.json({ notifications });
});
