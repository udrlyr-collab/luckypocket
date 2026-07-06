import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const rankingsRouter = Router();
rankingsRouter.use(requireAuth);

const TYPE_COLUMNS = {
  currentBalance: "balance",
  profitRate: "today_profit_rate",
  earned: "today_earned",
  lost: "today_lost",
  totalProfit: "total_profit",
  achievements: "achievement_count",
  games: "total_games",
};

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function formatYmd(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function periodBounds(dateValue, period) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day));
  let startCalendar = new Date(anchor);
  let endCalendar;

  if (period === "week") {
    const weekday = anchor.getUTCDay() || 7;
    startCalendar.setUTCDate(anchor.getUTCDate() - weekday + 1);
    endCalendar = new Date(startCalendar);
    endCalendar.setUTCDate(startCalendar.getUTCDate() + 7);
  } else if (period === "month") {
    startCalendar = new Date(Date.UTC(year, month - 1, 1));
    endCalendar = new Date(Date.UTC(year, month, 1));
  } else {
    endCalendar = new Date(anchor);
    endCalendar.setUTCDate(anchor.getUTCDate() + 1);
  }

  return {
    start: new Date(`${formatYmd(startCalendar)}T00:00:00+09:00`).toISOString(),
    end: new Date(`${formatYmd(endCalendar)}T00:00:00+09:00`).toISOString(),
    startDate: formatYmd(startCalendar),
    endDateExclusive: formatYmd(endCalendar),
  };
}

rankingsRouter.get("/", (req, res, next) => {
  try {
    const today = db.prepare("SELECT date('now', '+9 hours') AS value").get().value;
    const date = req.query.date || today;
    if (!validDate(date)) {
      return res.status(400).json({ message: "날짜 형식은 YYYY-MM-DD로 입력해 주세요." });
    }
    const period = ["day", "week", "month"].includes(req.query.period)
      ? req.query.period
      : "day";
    let type = Object.hasOwn(TYPE_COLUMNS, req.query.type)
      ? req.query.type
      : "currentBalance";
    if (!req.query.type && req.query.sort) {
      type = {
        balance: "currentBalance",
        profit: "totalProfit",
        achievements: "achievements",
        games: "games",
      }[req.query.sort] || "currentBalance";
    }
    const sortColumn = TYPE_COLUMNS[type];
    const bounds = periodBounds(date, period);

    const ranked = db
      .prepare(
        `WITH event_stats AS (
           SELECT
             user_id,
             COALESCE(SUM(CASE
               WHEN event_type IN ('game_win', 'achievement_reward', 'bonus_code', 'support_grant', 'stock_sell', 'stock_position_close', 'stock_acquire_refund')
                 AND amount > 0
               THEN amount ELSE 0 END), 0) AS today_earned,
             COALESCE(SUM(CASE
               WHEN (event_type = 'game_loss' OR event_type IN ('stock_buy', 'stock_ipo_subscribe', 'stock_margin_buy', 'stock_acquire')) AND amount < 0
               THEN -amount ELSE 0 END), 0) AS today_lost,
             COALESCE(SUM(CASE WHEN event_type = 'transfer_in' THEN amount ELSE 0 END), 0) AS transfer_received,
             COALESCE(SUM(CASE WHEN event_type = 'transfer_out' THEN -amount ELSE 0 END), 0) AS transfer_sent
           FROM asset_events
           WHERE julianday(created_at) >= julianday(?)
             AND julianday(created_at) < julianday(?)
           GROUP BY user_id
         ),
         user_stats AS (
           SELECT
             u.id,
             u.nickname,
             u.balance,
             u.highest_balance,
             u.total_profit,
             u.bankruptcy_count,
             COALESCE(es.today_earned, 0) AS today_earned,
             COALESCE(es.today_lost, 0) AS today_lost,
             COALESCE(es.transfer_received, 0) AS transfer_received,
             COALESCE(es.transfer_sent, 0) AS transfer_sent,
             COALESCE(
               (
                 SELECT ae.balance_after
                 FROM asset_events ae
                 WHERE ae.user_id = u.id
                   AND julianday(ae.created_at) < julianday(?)
                 ORDER BY julianday(ae.created_at) DESC, ae.id DESC
                 LIMIT 1
               ),
               u.initial_balance
             ) AS start_balance,
             (SELECT COUNT(*) FROM game_logs gl WHERE gl.user_id = u.id) AS total_games,
             (
               SELECT COUNT(DISTINCT
                 CASE
                   WHEN ua.achievement_key LIKE 'daily_play:%' THEN 'daily_play'
                   ELSE ua.achievement_key
                 END
               )
               FROM user_achievements ua
               WHERE ua.user_id = u.id
             ) AS achievement_count
           FROM users u
           LEFT JOIN event_stats es ON es.user_id = u.id
         ),
         computed AS (
           SELECT
             *,
             today_earned - today_lost AS today_net_profit,
             CASE
               WHEN start_balance > 0
               THEN ((today_earned - today_lost) * 100.0) / start_balance
               ELSE 0
             END AS today_profit_rate
           FROM user_stats
         )
         SELECT *,
                RANK() OVER (ORDER BY ${sortColumn} DESC) AS rank
         FROM computed
         ORDER BY ${sortColumn} DESC, id ASC`,
      )
      .all(bounds.start, bounds.end, bounds.start);

    const serialize = (row) => ({
      userId: row.id,
      nickname: row.nickname,
      balance: row.balance,
      highestBalance: row.highest_balance,
      totalProfit: row.total_profit,
      todayEarned: row.today_earned,
      todayLost: row.today_lost,
      todayNetProfit: row.today_net_profit,
      todayProfitRate: row.today_profit_rate,
      transferReceived: row.transfer_received,
      transferSent: row.transfer_sent,
      startBalance: row.start_balance,
      totalGames: row.total_games,
      achievementCount: row.achievement_count,
      bankruptcyCount: row.bankruptcy_count,
      rank: row.rank,
    });
    const mine = ranked.find((row) => row.id === req.user.id);
    const myStats = mine ? serialize(mine) : null;

    return res.json({
      date,
      period,
      type,
      range: bounds,
      rankings: ranked.slice(0, 100).map(serialize),
      mine: myStats,
      myRank: myStats?.rank ?? null,
      myStats,
    });
  } catch (error) {
    return next(error);
  }
});
