import { calculateLeveragedPositionOutcome } from "./leverageRiskService.js";

function safeJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function pushUniqueIssue(issues, issue) {
  const key = `${issue.userId || "system"}:${issue.reason}:${issue.sourceId || ""}`;
  if (issues.some((item) => `${item.userId || "system"}:${item.reason}:${item.sourceId || ""}` === key)) {
    return;
  }
  issues.push(issue);
}

function getUserMap(database) {
  return new Map(
    database
      .prepare("SELECT id, username, nickname, balance FROM users")
      .all()
      .map((user) => [user.id, user]),
  );
}

function detectRapidAssetGrowth(database, issues, users, { minutes, multiplier }) {
  const rows = database
    .prepare(
      `SELECT user_id, balance_before, balance_after, created_at
       FROM asset_events
       WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
         AND balance_before > 0
         AND balance_after >= balance_before * ?
       ORDER BY balance_after DESC
       LIMIT 50`,
    )
    .all(`-${minutes} minutes`, multiplier);

  for (const row of rows) {
    const user = users.get(row.user_id);
    pushUniqueIssue(issues, {
      userId: row.user_id,
      nickname: user?.nickname || null,
      reason: `${minutes}분 내 자산 ${multiplier}배 이상 증가`,
      beforeAsset: row.balance_before,
      afterAsset: row.balance_after,
      createdAt: row.created_at,
    });
  }
}

function detectTransferBankruptcyLoop(database, issues, users) {
  const rows = database
    .prepare(
      `SELECT
         b.user_id,
         COUNT(t.id) AS transfer_count,
         MIN(t.balance_before) AS before_asset,
         MAX(b.balance_after) AS after_asset,
         MAX(b.created_at) AS created_at
       FROM asset_events b
       JOIN asset_events t
         ON t.user_id = b.user_id
        AND t.event_type = 'transfer_out'
        AND ABS((julianday(b.created_at) - julianday(t.created_at)) * 24 * 60) <= 30
       WHERE b.event_type = 'bankruptcy_reset'
       GROUP BY b.user_id
       HAVING transfer_count >= 2
       LIMIT 50`,
    )
    .all();

  for (const row of rows) {
    const user = users.get(row.user_id);
    pushUniqueIssue(issues, {
      userId: row.user_id,
      nickname: user?.nickname || null,
      reason: "파산 전후 송금 반복 의심",
      beforeAsset: row.before_asset,
      afterAsset: row.after_asset,
      sourceId: "bankruptcy_transfer_loop",
      createdAt: row.created_at,
      metadata: { transferCount: row.transfer_count },
    });
  }
}

function detectRepeatedLeverageClose(database, issues, users) {
  const rows = database
    .prepare(
      `SELECT user_id, stock_id, COUNT(*) AS close_count, TOTAL(realized_pnl) AS total_pnl
       FROM stock_trades
       WHERE trade_type LIKE 'close_%'
         AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')
       GROUP BY user_id, stock_id
       HAVING close_count >= 10
       LIMIT 50`,
    )
    .all();

  for (const row of rows) {
    const user = users.get(row.user_id);
    pushUniqueIssue(issues, {
      userId: row.user_id,
      nickname: user?.nickname || null,
      reason: "같은 종목 레버리지 반복 정산",
      sourceId: `stock_${row.stock_id}`,
      beforeAsset: null,
      afterAsset: null,
      metadata: { stockId: row.stock_id, closeCount: row.close_count, totalPnl: row.total_pnl },
    });
  }
}

function detectDuplicateJackpotReward(database, issues, users) {
  const rows = database
    .prepare(
      `SELECT user_id, source_id, COUNT(*) AS reward_count, TOTAL(amount) AS amount
       FROM asset_events
       WHERE event_type = 'daily_jackpot_reward'
       GROUP BY user_id, source_id
       HAVING reward_count > 1
       LIMIT 50`,
    )
    .all();

  for (const row of rows) {
    const user = users.get(row.user_id);
    pushUniqueIssue(issues, {
      userId: row.user_id,
      nickname: user?.nickname || null,
      reason: "잭팟 중복 수령 의심",
      sourceId: row.source_id,
      beforeAsset: null,
      afterAsset: row.amount,
      metadata: { rewardCount: row.reward_count },
    });
  }
}

function detectAdminAfterProfit(database, issues, users) {
  const rows = database
    .prepare(
      `SELECT e.user_id, e.amount, e.balance_before, e.balance_after, e.created_at, a.id AS admin_log_id
       FROM asset_events e
       JOIN admin_logs a
         ON a.created_at <= e.created_at
        AND (julianday(e.created_at) - julianday(a.created_at)) * 24 * 60 <= 30
       WHERE e.amount >= 10000000
         AND e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')
       ORDER BY e.amount DESC
       LIMIT 50`,
    )
    .all();

  for (const row of rows) {
    const user = users.get(row.user_id);
    pushUniqueIssue(issues, {
      userId: row.user_id,
      nickname: user?.nickname || null,
      reason: "관리자 조작 직후 큰 수익 발생",
      sourceId: `admin_log_${row.admin_log_id}`,
      beforeAsset: row.balance_before,
      afterAsset: row.balance_after,
      createdAt: row.created_at,
      metadata: { amount: row.amount },
    });
  }
}

function detectDelistedLeverageProfit(database, issues, users) {
  const rows = database
    .prepare(
      `SELECT t.user_id, t.stock_id, t.realized_pnl, t.created_at, s.name, s.status
       FROM stock_trades t
       JOIN stocks s ON s.id = t.stock_id
       WHERE t.trade_type LIKE 'close_%'
         AND t.realized_pnl >= 10000000
         AND (s.status = 'delisted' OR s.delist_risk_status IN ('final_crash', 'delisted'))
       ORDER BY t.realized_pnl DESC
       LIMIT 50`,
    )
    .all();

  for (const row of rows) {
    const user = users.get(row.user_id);
    pushUniqueIssue(issues, {
      userId: row.user_id,
      nickname: user?.nickname || null,
      reason: "상장폐지 위험 종목 레버리지 과수익",
      sourceId: `stock_${row.stock_id}`,
      beforeAsset: null,
      afterAsset: row.realized_pnl,
      createdAt: row.created_at,
      metadata: { stockId: row.stock_id, stockName: row.name },
    });
  }
}

export function runEconomyAudit(database, adminUserId = null) {
  const users = getUserMap(database);
  const issues = [];
  detectRapidAssetGrowth(database, issues, users, { minutes: 10, multiplier: 10 });
  detectRapidAssetGrowth(database, issues, users, { minutes: 60, multiplier: 100 });
  detectTransferBankruptcyLoop(database, issues, users);
  detectRepeatedLeverageClose(database, issues, users);
  detectDuplicateJackpotReward(database, issues, users);
  detectAdminAfterProfit(database, issues, users);
  detectDelistedLeverageProfit(database, issues, users);

  const summary = {
    checkedUsers: users.size,
    suspiciousCount: issues.length,
    checkedAt: new Date().toISOString(),
  };

  const log = database
    .prepare(
      `INSERT INTO economy_audit_logs
       (admin_user_id, audit_type, summary_json, issues_json)
       VALUES (?, 'stability_audit', ?, ?)`,
    )
    .run(adminUserId, JSON.stringify(summary), JSON.stringify(issues));

  return {
    id: log.lastInsertRowid,
    suspiciousUsers: issues,
    summary,
  };
}

export function getLatestEconomyAudit(database) {
  const row = database
    .prepare(
      `SELECT *
       FROM economy_audit_logs
       WHERE audit_type = 'stability_audit'
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get();
  if (!row) return null;
  return {
    id: row.id,
    suspiciousUsers: safeJson(row.issues_json, []),
    summary: safeJson(row.summary_json, {}),
    createdAt: row.created_at,
  };
}

export function runConsistencyCheck(database, adminUserId = null) {
  const issues = [];

  for (const row of database.prepare("SELECT id, nickname, balance FROM users WHERE balance < 0").all()) {
    issues.push({
      level: "fix_required",
      userId: row.id,
      nickname: row.nickname,
      message: "유저 현금 자산이 음수입니다.",
      value: row.balance,
    });
  }

  for (const row of database.prepare("SELECT * FROM stock_holdings WHERE quantity < 0 LIMIT 100").all()) {
    issues.push({
      level: "fix_required",
      userId: row.user_id,
      stockId: row.stock_id,
      message: "보유 주식 수량이 음수입니다.",
      value: row.quantity,
    });
  }

  const positions = database
    .prepare(
      `SELECT p.*, s.current_price, s.status, s.delist_risk_status, s.market_cap, s.is_bluechip
       FROM stock_positions p
       JOIN stocks s ON s.id = p.stock_id
       WHERE p.status = 'open'
       LIMIT 500`,
    )
    .all();
  for (const position of positions) {
    const outcome = calculateLeveragedPositionOutcome(position, position, position.current_price);
    if (Math.abs(outcome.rawPnl) > position.position_size * 10) {
      issues.push({
        level: "warning",
        userId: position.user_id,
        stockId: position.stock_id,
        message: "포지션 손익이 포지션 규모 대비 비정상적으로 큽니다.",
        value: outcome.rawPnl,
      });
    }
  }

  const jackpotDuplicates = database
    .prepare(
      `SELECT user_id, source_id, COUNT(*) AS count
       FROM asset_events
       WHERE event_type = 'daily_jackpot_reward'
       GROUP BY user_id, source_id
       HAVING count > 1`,
    )
    .all();
  for (const row of jackpotDuplicates) {
    issues.push({
      level: "fix_required",
      userId: row.user_id,
      message: "동일 잭팟 회차 지급 기록이 중복되어 있습니다.",
      sourceId: row.source_id,
      value: row.count,
    });
  }

  const summary = {
    checkedAt: new Date().toISOString(),
    issueCount: issues.length,
    status:
      issues.some((issue) => issue.level === "fix_required")
        ? "수정 필요"
        : issues.length > 0
          ? "주의 필요"
          : "정상",
  };

  database
    .prepare(
      `INSERT INTO economy_audit_logs
       (admin_user_id, audit_type, summary_json, issues_json)
       VALUES (?, 'consistency_check', ?, ?)`,
    )
    .run(adminUserId, JSON.stringify(summary), JSON.stringify(issues));

  return { summary, issues };
}

export function getAdminDashboardSummary(database) {
  const userSummary = database
    .prepare(
      `SELECT COUNT(*) AS total_users,
              COALESCE(TOTAL(CAST(balance AS REAL)), 0) AS total_cash_assets
       FROM users`,
    )
    .get();
  const stockValue = database
    .prepare(
      `SELECT COALESCE(TOTAL(CAST(h.quantity AS REAL) * CAST(s.current_price AS REAL)), 0) AS value
       FROM stock_holdings h
       JOIN stocks s ON s.id = h.stock_id
       WHERE h.quantity > 0`,
    )
    .get().value;
  const assetFlow = database
    .prepare(
      `SELECT
         COALESCE(TOTAL(CASE WHEN amount > 0 THEN CAST(amount AS REAL) ELSE 0 END), 0) AS created_assets,
         COALESCE(TOTAL(CASE WHEN amount < 0 THEN CAST(-amount AS REAL) ELSE 0 END), 0) AS removed_assets
       FROM asset_events
       WHERE date(created_at, '+9 hours') = date('now', '+9 hours')`,
    )
    .get();
  const jackpot = database
    .prepare(
      "SELECT COALESCE(total_prize_amount, 0) AS pool FROM jackpot_rounds WHERE status = 'active' ORDER BY id DESC LIMIT 1",
    )
    .get();
  const stockStates = database
    .prepare(
      `SELECT
         SUM(CASE WHEN admin_price_target_active = 1 THEN 1 ELSE 0 END) AS target_event_count,
         SUM(CASE WHEN blue_chip_ramp_active = 1 THEN 1 ELSE 0 END) AS blue_chip_ramp_count,
         SUM(CASE WHEN delist_risk_status IN ('delist_review', 'recovery') THEN 1 ELSE 0 END) AS delist_review_count,
         SUM(CASE WHEN delist_risk_status = 'distress_review' THEN 1 ELSE 0 END) AS distress_review_count
       FROM stocks
       WHERE status != 'delisted'`,
    )
    .get();
  const audit = getLatestEconomyAudit(database);

  return {
    totalUsers: Number(userSummary.total_users || 0),
    totalCashAssets: Math.floor(Number(userSummary.total_cash_assets || 0)),
    totalStockValue: Math.floor(Number(stockValue || 0)),
    todayCreatedAssets: Math.floor(Number(assetFlow.created_assets || 0)),
    todayRemovedAssets: Math.floor(Number(assetFlow.removed_assets || 0)),
    todayJackpotPool: Math.floor(Number(jackpot?.pool || 0)),
    targetPriceEventCount: Number(stockStates.target_event_count || 0),
    blueChipRampCount: Number(stockStates.blue_chip_ramp_count || 0),
    delistReviewCount: Number(stockStates.delist_review_count || 0),
    distressReviewCount: Number(stockStates.distress_review_count || 0),
    suspiciousAccountCount: Number(audit?.summary?.suspiciousCount || 0),
    latestAuditAt: audit?.createdAt || null,
  };
}
