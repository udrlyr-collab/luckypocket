import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const serverStatsRouter = Router();
serverStatsRouter.use(requireAuth);

serverStatsRouter.get("/", (_req, res) => {
  const stats = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS total_users,
         (SELECT COUNT(*) FROM game_logs) AS total_games,
         (SELECT TOTAL(balance) FROM users) AS total_assets,
         (SELECT COUNT(*) FROM users
          WHERE date(created_at, '+9 hours') = date('now', '+9 hours')) AS today_new_users,
         (SELECT COUNT(DISTINCT user_id) FROM game_logs
          WHERE date(created_at, '+9 hours') = date('now', '+9 hours')) AS active_users_today`,
    )
    .get();
  return res.json({
    totalUsers: stats.total_users,
    totalGames: stats.total_games,
    totalAssets: stats.total_assets,
    todayNewUsers: stats.today_new_users,
    activeUsersToday: stats.active_users_today,
  });
});
