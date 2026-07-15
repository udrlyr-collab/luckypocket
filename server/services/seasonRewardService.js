import { calculateOwnerEtfTrackingAsset, calculateUserTotalEvaluatedAsset } from "./portfolioValuationService.js";

const USER_TO_COMPANY_RANK = Object.freeze({ 1: 2, 2: 3, 3: 4 });

function activeSeason(database) {
  return database.prepare(
    "SELECT * FROM seasons WHERE status = 'active' ORDER BY season_number DESC LIMIT 1",
  ).get();
}

export function buildSeasonRewardPreview(database, season = activeSeason(database)) {
  if (!season) throw new Error("진행 중인 시즌이 없습니다.");
  const userRanking = database.prepare("SELECT * FROM users ORDER BY id ASC").all()
    .map((user) => {
      const valuation = calculateUserTotalEvaluatedAsset(database, user.id);
      return {
        userId: user.id,
        username: user.username,
        nickname: user.nickname,
        totalEvaluatedAsset: valuation.totalEvaluatedAsset,
        valuationComplete: valuation.valuationComplete !== false,
        valuationErrors: valuation.valuationErrors || [],
      };
    })
    .sort((left, right) => (
      right.totalEvaluatedAsset - left.totalEvaluatedAsset || left.userId - right.userId
    ))
    .map((row, index) => ({ ...row, rank: index + 1 }));

  if (userRanking.some((row) => !row.valuationComplete)) {
    throw new Error("불완전한 총평가금액이 있어 시즌 보상 순위를 확정할 수 없습니다.");
  }

  const companyRanking = database.prepare(`
    SELECT id AS stock_id, name, symbol, market_cap, current_price, total_shares
    FROM stocks
    WHERE is_etf = 0
      AND status IN ('listed', 'newly_listed', 'caution')
      AND COALESCE(delist_risk_status, 'normal') IN ('normal', 'caution')
      AND COALESCE(is_trading_suspended, 0) = 0
    ORDER BY market_cap DESC, id ASC
  `).all().map((row, index) => ({
    stockId: row.stock_id,
    name: row.name,
    symbol: row.symbol,
    marketCap: Number(row.market_cap),
    currentPrice: Number(row.current_price),
    totalShares: Number(row.total_shares),
    rank: index + 1,
  }));

  if (userRanking.length < 3 || companyRanking.length < 4) {
    throw new Error("시즌 ETF 보상에 필요한 사용자 3명 또는 적격 회사 4개가 부족합니다.");
  }

  const mappings = [1, 2, 3].map((winnerRank) => {
    const companyRank = USER_TO_COMPANY_RANK[winnerRank];
    const winner = userRanking[winnerRank - 1];
    const company = companyRanking[companyRank - 1];
    return {
      winnerRank,
      winnerUserId: winner.userId,
      winnerUsername: winner.username,
      winnerNickname: winner.nickname,
      winnerTotalEvaluatedAsset: winner.totalEvaluatedAsset,
      companyRank,
      sourceStockId: company.stockId,
      sourceStockName: company.name,
      sourceStockSymbol: company.symbol,
      sourceMarketCap: company.marketCap,
    };
  });
  return {
    seasonId: season.id,
    seasonNumber: season.season_number,
    frozenAt: new Date().toISOString(),
    userRanking,
    companyRanking,
    mappings,
  };
}

export function ensureSeasonRewardJob(database, { season = activeSeason(database), adminUserId = null } = {}) {
  const existing = season && database.prepare(
    "SELECT * FROM season_reward_jobs WHERE season_id = ?",
  ).get(season.id);
  if (existing) return getSeasonRewardJob(database, existing.id);

  const preview = buildSeasonRewardPreview(database, season);
  return database.transaction(() => {
    const result = database.prepare(`
      INSERT INTO season_reward_jobs
        (season_id, season_number, status, user_ranking_json, company_ranking_json, started_by_user_id)
      VALUES (?, ?, 'previewed', ?, ?, ?)
    `).run(
      season.id,
      season.season_number,
      JSON.stringify(preview.userRanking),
      JSON.stringify(preview.companyRanking),
      adminUserId,
    );
    const jobId = Number(result.lastInsertRowid);
    const insertMapping = database.prepare(`
      INSERT INTO season_reward_mappings
        (job_id, season_id, winner_rank, winner_user_id, company_rank, source_stock_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const mapping of preview.mappings) {
      insertMapping.run(
        jobId,
        season.id,
        mapping.winnerRank,
        mapping.winnerUserId,
        mapping.companyRank,
        mapping.sourceStockId,
      );
    }
    return getSeasonRewardJob(database, jobId);
  })();
}

export function getSeasonRewardJob(database, jobId) {
  const job = database.prepare("SELECT * FROM season_reward_jobs WHERE id = ?").get(jobId);
  if (!job) return null;
  const mappings = database.prepare(`
    SELECT m.*, u.username, u.nickname, s.name AS source_stock_name,
           s.symbol AS source_stock_symbol, s.market_cap AS source_market_cap
    FROM season_reward_mappings m
    JOIN users u ON u.id = m.winner_user_id
    JOIN stocks s ON s.id = m.source_stock_id
    WHERE m.job_id = ?
    ORDER BY m.winner_rank ASC
  `).all(jobId);
  return {
    ...job,
    userRanking: JSON.parse(job.user_ranking_json || "[]"),
    companyRanking: JSON.parse(job.company_ranking_json || "[]"),
    mappings,
  };
}

function reserveExactUserSymbol(database, userId, sourceStockId) {
  const symbol = String(userId);
  const conflict = database.prepare("SELECT id FROM stocks WHERE symbol = ? AND id != ?")
    .get(symbol, sourceStockId);
  if (conflict) {
    database.prepare("UPDATE stocks SET symbol = ? WHERE id = ?")
      .run(`ARCHIVE-${conflict.id}-${Date.now()}`, conflict.id);
  }
  return symbol;
}

function convertCompanyInPlace(database, mapping, user, source) {
  const symbol = reserveExactUserSymbol(database, user.id, source.id);
  const trackingAsset = calculateOwnerEtfTrackingAsset(database, user.id, source.id);
  database.prepare(`
    UPDATE stocks
    SET name = ?, symbol = ?, status = 'acquired', is_etf = 1,
        etf_tracking_type = 'owner_asset', owner_user_id = ?,
        owner_nickname_snapshot = ?, sector = 'OTHER',
        etf_base_price = current_price,
        etf_base_owner_asset = ?, etf_last_tracked_owner_asset = ?,
        etf_acquisition_cost = 0,
        etf_delist_reference_price = current_price,
        etf_delist_reference_set_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        etf_delist_trigger_price = MAX(1, CAST(current_price * 0.15 AS INTEGER)),
        etf_delist_triggered_at = NULL, etf_delist_reason = NULL,
        delist_risk_status = 'normal', is_market_cap_warning = 0,
        season_reward_origin_season_id = ?, season_reward_winner_user_id = ?,
        season_reward_source_stock_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(
    `${user.username}의 회사`,
    symbol,
    user.id,
    user.nickname,
    trackingAsset,
    trackingAsset,
    mapping.season_id,
    user.id,
    source.id,
    source.id,
  );
  return { action: "convert", targetEtfStockId: source.id, trackingAsset };
}

function mergeCompanyIntoExistingEtf(database, mapping, user, source, target) {
  const targetPrice = Math.max(1, Math.floor(Number(target.current_price || 1)));
  const sourcePrice = Math.max(0, Math.floor(Number(source.current_price || 0)));
  const holders = database.prepare(`
    SELECT * FROM stock_holdings WHERE stock_id = ? AND quantity > 0 ORDER BY id ASC
  `).all(source.id);
  let issuedSharesTotal = 0;
  let cashRemainderTotal = 0;
  for (const holding of holders) {
    const preservedValue = Math.max(0, Math.floor(Number(holding.quantity) * sourcePrice));
    const issuedShares = Math.floor(preservedValue / targetPrice);
    const cashRemainder = preservedValue - issuedShares * targetPrice;
    issuedSharesTotal += issuedShares;
    cashRemainderTotal += cashRemainder;
    if (issuedShares > 0) {
      const existing = database.prepare(
        "SELECT * FROM stock_holdings WHERE user_id = ? AND stock_id = ?",
      ).get(holding.user_id, target.id);
      const oldQuantity = Number(existing?.quantity || 0);
      const oldCost = Number(existing?.total_cost_basis || oldQuantity * Number(existing?.average_price || 0));
      const addedCost = issuedShares * targetPrice;
      const newQuantity = oldQuantity + issuedShares;
      const newCost = Math.floor(oldCost + addedCost);
      database.prepare(`
        INSERT INTO stock_holdings
          (user_id, stock_id, quantity, average_price, total_cost_basis, total_buy_fees)
        VALUES (?, ?, ?, ?, ?, 0)
        ON CONFLICT(user_id, stock_id) DO UPDATE SET
          quantity = excluded.quantity,
          average_price = excluded.average_price,
          total_cost_basis = excluded.total_cost_basis,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      `).run(holding.user_id, target.id, newQuantity, newCost / Math.max(1, newQuantity), newCost);
    }
    if (cashRemainder > 0) {
      const owner = database.prepare("SELECT balance FROM users WHERE id = ?").get(holding.user_id);
      const before = Number(owner?.balance || 0);
      const after = before + cashRemainder;
      database.prepare("UPDATE users SET balance = ? WHERE id = ?").run(after, holding.user_id);
      database.prepare(`
        INSERT OR IGNORE INTO asset_events
          (user_id, event_type, amount, balance_before, balance_after,
           source_type, source_id, detail_json)
        VALUES (?, 'season_etf_merge_remainder', ?, ?, ?, 'season_reward_merge', ?, ?)
      `).run(
        holding.user_id,
        cashRemainder,
        before,
        after,
        `${mapping.id}:${holding.id}`,
        JSON.stringify({ sourceStockId: source.id, targetEtfStockId: target.id, issuedShares, targetPrice }),
      );
    }
  }
  database.prepare("DELETE FROM stock_holdings WHERE stock_id = ?").run(source.id);
  database.prepare(`
    UPDATE stocks
    SET total_shares = total_shares + ?,
        market_cap = current_price * (total_shares + ?),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(issuedSharesTotal, issuedSharesTotal, target.id);
  database.prepare(`
    UPDATE stocks
    SET status = 'merged', is_trading_suspended = 1, merged_into_stock_id = ?,
        merged_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        season_reward_origin_season_id = ?, season_reward_winner_user_id = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(target.id, mapping.season_id, user.id, source.id);
  return { action: "merge", targetEtfStockId: target.id, issuedSharesTotal, cashRemainderTotal };
}

function recordRewardAdminLog(database, job, mapping, detail) {
  if (!job.started_by_user_id) return;
  database.prepare(`
    INSERT INTO admin_logs
      (admin_user_id, target_user_id, target_stock_id, action_type,
       before_value, after_value, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.started_by_user_id,
    mapping.winner_user_id,
    mapping.source_stock_id,
    detail.action === "merge" ? "season_reward_etf_merged" : "season_reward_etf_created",
    JSON.stringify({ sourceStockId: mapping.source_stock_id, companyRank: mapping.company_rank }),
    JSON.stringify(detail),
    `시즌 ${job.season_number} ${mapping.winner_rank}위 ETF 보상`,
  );
}

export function runSeasonRewardJob(database, jobId) {
  const job = getSeasonRewardJob(database, jobId);
  if (!job) throw new Error("시즌 보상 작업을 찾을 수 없습니다.");
  if (job.status === "completed") return job;
  try {
    return database.transaction(() => {
      database.prepare(`
        UPDATE season_reward_jobs
        SET status = 'running', started_at = COALESCE(started_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            error_message = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(jobId);
      for (const mapping of job.mappings) {
        if (mapping.status === "completed") continue;
        const user = database.prepare("SELECT * FROM users WHERE id = ?").get(mapping.winner_user_id);
        const source = database.prepare("SELECT * FROM stocks WHERE id = ?").get(mapping.source_stock_id);
        if (!user || !source) throw new Error(`보상 매핑 ${mapping.id}의 사용자 또는 원본 회사를 찾을 수 없습니다.`);
        const existingEtf = database.prepare(`
          SELECT * FROM stocks
          WHERE owner_user_id = ? AND is_etf = 1 AND etf_tracking_type = 'owner_asset'
            AND status = 'acquired' AND id != ?
          ORDER BY id ASC LIMIT 1
        `).get(user.id, source.id);
        const detail = existingEtf
          ? mergeCompanyIntoExistingEtf(database, mapping, user, source, existingEtf)
          : convertCompanyInPlace(database, mapping, user, source);
        recordRewardAdminLog(database, job, mapping, detail);
        database.prepare(`
          UPDATE season_reward_mappings
          SET target_etf_stock_id = ?, action = ?, status = 'completed', detail_json = ?,
              completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?
        `).run(detail.targetEtfStockId, detail.action, JSON.stringify(detail), mapping.id);
      }
      database.prepare(`
        UPDATE season_reward_jobs
        SET status = 'completed', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(jobId);
      return getSeasonRewardJob(database, jobId);
    })();
  } catch (error) {
    // The reward conversion is all-or-nothing. Persist the failed state only
    // after the conversion transaction has rolled back, so admins can retry it.
    database.prepare(`
      UPDATE season_reward_jobs
      SET status = 'failed', error_message = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(String(error?.message || error), jobId);
    if (job.started_by_user_id) {
      database.prepare(`
        INSERT INTO admin_logs
          (admin_user_id, target_user_id, action_type, before_value, after_value, reason)
        VALUES (?, ?, 'season_reward_failed', ?, ?, ?)
      `).run(
        job.started_by_user_id,
        job.started_by_user_id,
        JSON.stringify({ jobId, previousStatus: job.status }),
        JSON.stringify({ jobId, status: "failed" }),
        String(error?.message || error).slice(0, 500),
      );
    }
    throw error;
  }
}

export function checkSeasonRewardConsistency(database, jobId) {
  const job = getSeasonRewardJob(database, jobId);
  if (!job) throw new Error("시즌 보상 작업을 찾을 수 없습니다.");
  const issues = [];
  for (const mapping of job.mappings) {
    const target = mapping.target_etf_stock_id
      ? database.prepare("SELECT * FROM stocks WHERE id = ?").get(mapping.target_etf_stock_id)
      : null;
    if (mapping.status === "completed" && !target) issues.push(`매핑 ${mapping.id}: 대상 ETF 없음`);
    if (target && Number(target.owner_user_id) !== Number(mapping.winner_user_id)) {
      issues.push(`매핑 ${mapping.id}: ETF 소유자 불일치`);
    }
  }
  const duplicateOwners = database.prepare(`
    SELECT owner_user_id, COUNT(*) AS count
    FROM stocks
    WHERE is_etf = 1 AND etf_tracking_type = 'owner_asset' AND status = 'acquired'
    GROUP BY owner_user_id HAVING COUNT(*) > 1
  `).all();
  for (const row of duplicateOwners) issues.push(`사용자 ${row.owner_user_id}: 활성 owner ETF ${row.count}개`);
  return { jobId, ok: issues.length === 0, issues, job };
}
