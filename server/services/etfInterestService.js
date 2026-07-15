import { createUserAssetSnapshot } from "./assetSnapshotService.js";
import { calculateUserTotalEvaluatedAsset } from "./portfolioValuationService.js";

export const ETF_HOURLY_INTEREST_RATE = 0.001;
const KST_OFFSET_MS = 9 * 60 * 60_000;

export function kstHourKey(nowMs = Date.now()) {
  const shifted = new Date(nowMs + KST_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}T${String(shifted.getUTCHours()).padStart(2, "0")}`;
}

export function calculateEtfHourlyInterest(totalEvaluatedAsset) {
  return Math.max(0, Math.floor(Number(totalEvaluatedAsset || 0) * ETF_HOURLY_INTEREST_RATE));
}

function recordInterestAdminLog(database, userId, actionType, detail) {
  const admin = database.prepare("SELECT id FROM users WHERE username = 'admin' LIMIT 1").get();
  if (!admin) return;
  const hourMarker = `%\"hourKey\":\"${String(detail.hourKey)}\"%`;
  const existing = database.prepare(`
    SELECT id FROM admin_logs
    WHERE target_user_id = ? AND action_type = ? AND after_value LIKE ?
    LIMIT 1
  `).get(userId, actionType, hourMarker);
  if (existing) return;
  database.prepare(`
    INSERT INTO admin_logs
      (admin_user_id, target_user_id, action_type, before_value, after_value, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    admin.id,
    userId,
    actionType,
    JSON.stringify({ hourKey: detail.hourKey, balanceBefore: detail.balanceBefore }),
    JSON.stringify(detail),
    detail.reason || "ETF 시간 이자 정산",
  );
}

export function getEligibleEtfInterestUsers(database) {
  return database.prepare(`
    SELECT DISTINCT u.id, u.username, u.nickname, u.balance,
      CASE WHEN EXISTS (
        SELECT 1 FROM stocks owned
        WHERE owned.owner_user_id = u.id
          AND owned.is_etf = 1
          AND owned.etf_tracking_type = 'owner_asset'
          AND owned.status = 'acquired'
      ) THEN 1 ELSE 0 END AS owns_active_etf,
      CASE WHEN EXISTS (
        SELECT 1
        FROM stock_holdings h
        JOIN stocks held ON held.id = h.stock_id
        WHERE h.user_id = u.id AND h.quantity >= 1
          AND held.is_etf = 1
          AND held.etf_tracking_type = 'owner_asset'
          AND held.status = 'acquired'
      ) THEN 1 ELSE 0 END AS holds_active_etf
    FROM users u
    WHERE COALESCE(u.account_status, 'active') = 'active'
      AND COALESCE(u.is_system_account, 0) = 0
      AND LOWER(u.username) != 'admin'
      AND (
        EXISTS (
          SELECT 1 FROM stocks owned
          WHERE owned.owner_user_id = u.id
            AND owned.is_etf = 1
            AND owned.etf_tracking_type = 'owner_asset'
            AND owned.status = 'acquired'
        )
        OR EXISTS (
          SELECT 1 FROM stock_holdings h
          JOIN stocks held ON held.id = h.stock_id
          WHERE h.user_id = u.id AND h.quantity >= 1
            AND held.is_etf = 1
            AND held.etf_tracking_type = 'owner_asset'
            AND held.status = 'acquired'
        )
      )
    ORDER BY u.id ASC
  `).all();
}

function payInterestBatch(database, prepared, hourKey) {
  return database.transaction(() => {
    const results = [];
    for (const row of prepared) {
      const existing = database.prepare(`
        SELECT * FROM etf_hourly_interest_events WHERE user_id = ? AND hour_key = ?
      `).get(row.user.id, hourKey);
      if (existing) {
        results.push({ ...existing, alreadyProcessed: true });
        continue;
      }
      const current = database.prepare("SELECT balance FROM users WHERE id = ?").get(row.user.id);
      if (!current) continue;
      const balanceBefore = Math.floor(Number(current.balance || 0));
      const amount = calculateEtfHourlyInterest(row.totalEvaluatedAsset);
      const balanceAfter = balanceBefore + amount;
      database.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, row.user.id);
      const inserted = database.prepare(`
        INSERT INTO etf_hourly_interest_events
          (user_id, hour_key, pre_interest_total_evaluated_asset, interest_rate,
           interest_amount, balance_before, balance_after, eligible_reason_json,
           valuation_snapshot_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid')
      `).run(
        row.user.id,
        hourKey,
        row.totalEvaluatedAsset,
        ETF_HOURLY_INTEREST_RATE,
        amount,
        balanceBefore,
        balanceAfter,
        JSON.stringify({
          ownsActiveEtf: row.user.owns_active_etf === 1,
          holdsActiveEtf: row.user.holds_active_etf === 1,
        }),
        row.snapshotId,
      );
      database.prepare(`
        INSERT OR IGNORE INTO asset_events
          (user_id, event_type, amount, balance_before, balance_after,
           source_type, source_id, detail_json)
        VALUES (?, 'etf_hourly_interest', ?, ?, ?, 'etf_hourly_interest', ?, ?)
      `).run(
        row.user.id,
        amount,
        balanceBefore,
        balanceAfter,
        `${row.user.id}:${hourKey}`,
        JSON.stringify({
          hourKey,
          interestRate: ETF_HOURLY_INTEREST_RATE,
          preInterestTotalEvaluatedAsset: row.totalEvaluatedAsset,
          valuationSnapshotId: row.snapshotId,
        }),
      );
      recordInterestAdminLog(database, row.user.id, "etf_hourly_interest_paid", {
        hourKey,
        interestRate: ETF_HOURLY_INTEREST_RATE,
        preInterestTotalEvaluatedAsset: row.totalEvaluatedAsset,
        interestAmount: amount,
        balanceBefore,
        balanceAfter,
        valuationSnapshotId: row.snapshotId,
      });
      results.push({
        id: Number(inserted.lastInsertRowid),
        userId: row.user.id,
        hourKey,
        preInterestTotalEvaluatedAsset: row.totalEvaluatedAsset,
        interestAmount: amount,
        balanceBefore,
        balanceAfter,
        alreadyProcessed: false,
      });
    }
    return results;
  })();
}

export function settleCurrentEtfHourlyInterest(database, { nowMs = Date.now() } = {}) {
  const hourKey = kstHourKey(nowMs);
  const users = getEligibleEtfInterestUsers(database);
  const cycleId = `etf-interest-${hourKey}`;
  const prepared = [];
  for (const user of users) {
    const existing = database.prepare(`
      SELECT id FROM etf_hourly_interest_events WHERE user_id = ? AND hour_key = ?
    `).get(user.id, hourKey);
    if (existing) continue;
    const valuation = calculateUserTotalEvaluatedAsset(database, user.id);
    if (valuation.valuationComplete === false) {
      recordInterestAdminLog(database, user.id, "etf_hourly_interest_skipped", {
        hourKey,
        balanceBefore: user.balance,
        balanceAfter: user.balance,
        valuationErrors: valuation.valuationErrors || [],
        reason: "총평가금액 불완전",
      });
      continue;
    }
    const snapshot = createUserAssetSnapshot(database, user.id, {
      valuationCycleId: cycleId,
      valuation,
    });
    prepared.push({
      user,
      totalEvaluatedAsset: valuation.totalEvaluatedAsset,
      snapshotId: snapshot.id,
    });
  }
  const results = payInterestBatch(database, prepared, hourKey);
  return { hourKey, eligibleUserCount: users.length, preparedCount: prepared.length, results };
}

function utcRangeForKstHourKey(hourKey) {
  const [datePart, hourPart] = String(hourKey).split("T");
  const startMs = Date.parse(`${datePart}T${hourPart}:00:00.000+09:00`);
  return { start: new Date(startMs).toISOString(), end: new Date(startMs + 3_600_000).toISOString() };
}

export function catchUpMissingEtfInterest(database, { nowMs = Date.now(), maxHours = 24 } = {}) {
  const hours = Math.min(24, Math.max(1, Number(maxHours) || 24));
  const users = getEligibleEtfInterestUsers(database);
  const paid = [];
  const skipped = [];
  for (let offset = hours; offset >= 1; offset -= 1) {
    const hourKey = kstHourKey(nowMs - offset * 3_600_000);
    const range = utcRangeForKstHourKey(hourKey);
    for (const user of users) {
      if (database.prepare(`
        SELECT id FROM etf_hourly_interest_events WHERE user_id = ? AND hour_key = ?
      `).get(user.id, hourKey)) continue;
      const snapshot = database.prepare(`
        SELECT * FROM user_asset_snapshots
        WHERE user_id = ? AND valuation_complete = 1
          AND calculated_at >= ? AND calculated_at < ?
        ORDER BY id ASC LIMIT 1
      `).get(user.id, range.start, range.end);
      if (!snapshot) {
        const current = database.prepare("SELECT balance FROM users WHERE id = ?").get(user.id);
        const balance = Number(current?.balance || 0);
        database.prepare(`
          INSERT OR IGNORE INTO etf_hourly_interest_events
            (user_id, hour_key, pre_interest_total_evaluated_asset, interest_rate,
             interest_amount, balance_before, balance_after, eligible_reason_json,
             valuation_snapshot_id, status)
          VALUES (?, ?, 0, ?, 0, ?, ?, ?, NULL, 'skipped_no_snapshot')
        `).run(
          user.id,
          hourKey,
          ETF_HOURLY_INTEREST_RATE,
          balance,
          balance,
          JSON.stringify({ reason: "exact_historical_snapshot_unavailable" }),
        );
        recordInterestAdminLog(database, user.id, "etf_hourly_interest_skipped", {
          hourKey,
          balanceBefore: balance,
          balanceAfter: balance,
          reason: "정확한 과거 총평가금액 스냅샷 없음",
        });
        skipped.push({ userId: user.id, hourKey, reason: "exact_historical_snapshot_unavailable" });
        continue;
      }
      const result = payInterestBatch(database, [{
        user,
        totalEvaluatedAsset: Number(snapshot.total_evaluated_asset),
        snapshotId: snapshot.id,
      }], hourKey);
      paid.push(...result);
    }
  }
  return { maxHours: hours, paid, skipped };
}

export function getEtfInterestMissingSummary(database, { nowMs = Date.now(), maxHours = 24 } = {}) {
  const users = getEligibleEtfInterestUsers(database);
  const missing = [];
  for (let offset = Math.min(24, maxHours); offset >= 0; offset -= 1) {
    const hourKey = kstHourKey(nowMs - offset * 3_600_000);
    for (const user of users) {
      if (!database.prepare(`SELECT id FROM etf_hourly_interest_events WHERE user_id = ? AND hour_key = ?`)
        .get(user.id, hourKey)) missing.push({ userId: user.id, username: user.username, hourKey });
    }
  }
  return { eligibleUserCount: users.length, missingCount: missing.length, missing };
}

export function startEtfInterestScheduler(database) {
  const run = () => {
    try {
      settleCurrentEtfHourlyInterest(database);
    } catch (error) {
      console.error("ETF hourly interest settlement failed:", error);
    }
  };
  run();
  const timer = setInterval(run, 60_000);
  timer.unref?.();
  return timer;
}
