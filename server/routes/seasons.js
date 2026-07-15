import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { getActiveSeason } from "../services/seasonService.js";

export const seasonsRouter = Router();
seasonsRouter.use(requireAuth);

function serializeSeason(row) {
  if (!row) return null;
  return {
    id: row.id,
    seasonNumber: row.season_number,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

function latestEndedTop3() {
  const season = db
    .prepare("SELECT * FROM seasons WHERE status = 'ended' ORDER BY season_number DESC LIMIT 1")
    .get();
  if (!season) return { season: null, top3: [] };
  const top3 = db
    .prepare(
      `SELECT
         sr.user_id,
         sr.nickname_snapshot,
         sr.rank,
         sr.final_balance,
         sr.final_total_evaluated_asset,
         sr.starting_bonus_for_next_season,
         m.company_rank AS reward_company_rank,
         COALESCE(target.name, source.name) AS reward_company_name,
         COALESCE(target.symbol, source.symbol) AS reward_company_symbol,
         m.action AS reward_action
       FROM season_results sr
       LEFT JOIN season_reward_mappings m
         ON m.season_id = sr.season_id AND m.winner_user_id = sr.user_id
       LEFT JOIN stocks source ON source.id = m.source_stock_id
       LEFT JOIN stocks target ON target.id = m.target_etf_stock_id
       WHERE sr.season_id = ?
         AND sr.rank <= 3
       ORDER BY sr.rank ASC, sr.final_total_evaluated_asset DESC`,
    )
    .all(season.id)
    .map((row) => ({
      userId: row.user_id,
      nickname: row.nickname_snapshot,
      rank: row.rank,
      finalBalance: row.final_balance,
      finalTotalEvaluatedAsset: row.final_total_evaluated_asset,
      startingBonusForNextSeason: row.starting_bonus_for_next_season,
      rewardCompanyRank: row.reward_company_rank,
      rewardCompanyName: row.reward_company_name,
      rewardCompanySymbol: row.reward_company_symbol,
      rewardAction: row.reward_action,
    }));
  return { season: serializeSeason(season), top3 };
}

seasonsRouter.get("/", (_req, res) => {
  const seasons = db
    .prepare("SELECT * FROM seasons ORDER BY season_number DESC")
    .all()
    .map(serializeSeason);
  return res.json({ seasons });
});

seasonsRouter.get("/current", (req, res) => {
  const season = getActiveSeason(db);
  const notice = season
    ? db
        .prepare(
          `SELECT *
           FROM user_season_notices
           WHERE user_id = ?
             AND season_id = ?
             AND seen_at IS NULL
           ORDER BY id ASC
           LIMIT 1`,
        )
        .get(req.user.id, season.id)
    : null;
  const latestEnded = latestEndedTop3();
  return res.json({
    season: serializeSeason(season),
    notice: notice
      ? {
          id: notice.id,
          seasonId: notice.season_id,
          seasonNumber: notice.season_number,
          noticeType: notice.notice_type,
        }
      : null,
    latestEnded,
  });
});

seasonsRouter.get("/latest-ended/top3", (_req, res) => {
  return res.json(latestEndedTop3());
});

seasonsRouter.post("/notices/:noticeId/seen", (req, res) => {
  const noticeId = Number(req.params.noticeId);
  const result = db
    .prepare(
      `UPDATE user_season_notices
       SET seen_at = COALESCE(seen_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       WHERE id = ?
         AND user_id = ?`,
    )
    .run(noticeId, req.user.id);
  if (result.changes === 0) {
    return res.status(404).json({ message: "시즌 안내를 찾을 수 없어요." });
  }
  return res.json({ ok: true });
});
