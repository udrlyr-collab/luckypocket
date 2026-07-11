import { calculateUserTotalEvaluatedAsset } from "./portfolioValuationService.js";
import { createServerNotification } from "./serverNotificationService.js";

export const DAILY_UNLUCKY_POLICY = Object.freeze({
  minimumStartAsset: 1_000_000,
  minimumActivityCount: 3,
  minimumLossRate: 0.05,
  awardedLuckTickets: 1,
});

function kstDateKey(nowMs = Date.now()) {
  const shifted = new Date(nowMs + 9 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function previousDateKey(nowMs = Date.now()) {
  return kstDateKey(nowMs - 24 * 60 * 60 * 1000);
}

function dayBounds(dateKey) {
  return {
    start: `${dateKey}T00:00:00.000Z`,
    end: `${dateKey}T23:59:59.999Z`,
  };
}

function amountFrom(queryResult) {
  return Math.floor(Number(queryResult?.amount || 0));
}

function assetAdjustmentsForDay(db, userId, dateKey) {
  const dateFilter = "date(created_at, '+9 hours') = ?";
  const incomingTransfers = amountFrom(db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS amount FROM transfer_logs
    WHERE receiver_user_id = ? AND ${dateFilter}
  `).get(userId, dateKey));
  const outgoingTransfers = amountFrom(db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS amount FROM transfer_logs
    WHERE sender_user_id = ? AND ${dateFilter}
  `).get(userId, dateKey));
  const adminAdjustments = amountFrom(db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS amount FROM asset_events
    WHERE user_id = ? AND ${dateFilter} AND event_type LIKE 'admin_%'
  `).get(userId, dateKey));
  const bankruptcyAdjustments = amountFrom(db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS amount FROM asset_events
    WHERE user_id = ? AND ${dateFilter} AND event_type = 'bankruptcy_reset'
  `).get(userId, dateKey));
  const seasonAdjustments = amountFrom(db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS amount FROM asset_events
    WHERE user_id = ? AND ${dateFilter} AND event_type LIKE 'season_%'
  `).get(userId, dateKey));
  return { incomingTransfers, outgoingTransfers, adminAdjustments, bankruptcyAdjustments, seasonAdjustments };
}

function activityCountForDay(db, userId, dateKey) {
  const gameCount = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM game_logs
    WHERE user_id = ? AND date(created_at, '+9 hours') = ?
  `).get(userId, dateKey)?.count || 0);
  const stockCount = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM stock_trades
    WHERE user_id = ? AND date(created_at, '+9 hours') = ?
  `).get(userId, dateKey)?.count || 0);
  return gameCount + stockCount;
}

export function ensureTodayAssetSnapshots(db, nowMs = Date.now()) {
  const dateKey = kstDateKey(nowMs);
  const users = db.prepare(`
    SELECT id FROM users
    WHERE username != 'admin'
  `).all();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO daily_user_asset_snapshots (user_id, date_key, start_total_asset)
    VALUES (?, ?, ?)
  `);
  let created = 0;
  for (const user of users) {
    const valuation = calculateUserTotalEvaluatedAsset(db, user.id).totalEvaluatedAsset;
    created += insert.run(user.id, dateKey, valuation).changes;
  }
  return { dateKey, created };
}

function captureUnfinalizedDayEnd(db, dateKey) {
  const snapshots = db.prepare(`
    SELECT id, user_id FROM daily_user_asset_snapshots
    WHERE date_key = ? AND end_total_asset IS NULL
  `).all(dateKey);
  const update = db.prepare("UPDATE daily_user_asset_snapshots SET end_total_asset = ? WHERE id = ?");
  for (const snapshot of snapshots) {
    update.run(calculateUserTotalEvaluatedAsset(db, snapshot.user_id).totalEvaluatedAsset, snapshot.id);
  }
  return snapshots.length;
}

export function finalizeDailyUnluckyAward(db, dateKey = previousDateKey()) {
  const existing = db.prepare("SELECT * FROM daily_unlucky_awards WHERE date_key = ?").get(dateKey);
  if (existing) return { awarded: false, reason: "already_awarded", award: existing };

  const snapshots = db.prepare(`
    SELECT snapshot.*, u.username, u.nickname, u.balance
    FROM daily_user_asset_snapshots snapshot
    JOIN users u ON u.id = snapshot.user_id
    WHERE snapshot.date_key = ? AND u.username != 'admin'
  `).all(dateKey);
  const candidates = [];
  const update = db.prepare(`
    UPDATE daily_user_asset_snapshots
    SET end_total_asset = ?, adjusted_start_asset = ?, adjusted_end_asset = ?, absolute_loss = ?, loss_rate = ?,
        incoming_transfers = ?, outgoing_transfers = ?, admin_adjustments = ?, bankruptcy_adjustments = ?, season_adjustments = ?, finalized_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `);

  for (const snapshot of snapshots) {
    // A finalized historical row is never silently recalculated.
    if (snapshot.finalized_at) continue;
    const adjustments = assetAdjustmentsForDay(db, snapshot.user_id, dateKey);
    const endAsset = Number.isFinite(Number(snapshot.end_total_asset))
      ? Math.floor(Number(snapshot.end_total_asset))
      : calculateUserTotalEvaluatedAsset(db, snapshot.user_id).totalEvaluatedAsset;
    const adjustedStart = Number(snapshot.start_total_asset || 0);
    const adjustedEnd = endAsset
      - adjustments.incomingTransfers
      - adjustments.adminAdjustments
      - adjustments.seasonAdjustments
      - adjustments.bankruptcyAdjustments
      + adjustments.outgoingTransfers;
    const absoluteLoss = Math.max(0, adjustedStart - adjustedEnd);
    const lossRate = adjustedStart > 0 ? absoluteLoss / adjustedStart : 0;
    update.run(
      endAsset, adjustedStart, Math.floor(adjustedEnd), absoluteLoss, lossRate,
      adjustments.incomingTransfers, adjustments.outgoingTransfers, adjustments.adminAdjustments,
      adjustments.bankruptcyAdjustments, adjustments.seasonAdjustments, snapshot.id,
    );
    const activityCount = activityCountForDay(db, snapshot.user_id, dateKey);
    if (
      adjustedStart >= DAILY_UNLUCKY_POLICY.minimumStartAsset &&
      activityCount >= DAILY_UNLUCKY_POLICY.minimumActivityCount &&
      lossRate >= DAILY_UNLUCKY_POLICY.minimumLossRate
    ) {
      candidates.push({ ...snapshot, endAsset, adjustedStart, adjustedEnd, absoluteLoss, lossRate, activityCount });
    }
  }

  candidates.sort((a, b) => b.lossRate - a.lossRate || b.absoluteLoss - a.absoluteLoss || a.user_id - b.user_id);
  const winner = candidates[0];
  if (!winner) return { awarded: false, reason: "no_eligible_user" };

  const insert = db.prepare(`
    INSERT INTO daily_unlucky_awards
      (date_key, user_id, loss_rate, absolute_loss, start_total_asset, end_total_asset, awarded_luck_tickets)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    dateKey, winner.user_id, winner.lossRate, winner.absoluteLoss,
    winner.adjustedStart, winner.endAsset, DAILY_UNLUCKY_POLICY.awardedLuckTickets,
  );
  db.prepare("UPDATE users SET jackpot_tickets = jackpot_tickets + ? WHERE id = ?")
    .run(DAILY_UNLUCKY_POLICY.awardedLuckTickets, winner.user_id);
  createServerNotification(db, {
    userId: winner.user_id,
    nickname: winner.nickname,
    type: "daily_unlucky_award",
    title: "오늘의 불운왕",
    message: `${winner.nickname}님이 총평가자산 ${(winner.lossRate * 100).toFixed(1)}% 손실로 오늘의 불운왕에 선정됐어요. 내일은 반등할지도 몰라요!`,
    gameType: "stock",
    gameName: "주식",
    metadata: { dateKey, lossRate: winner.lossRate, awardedLuckTickets: DAILY_UNLUCKY_POLICY.awardedLuckTickets, awardId: insert.lastInsertRowid },
  });
  return { awarded: true, awardId: insert.lastInsertRowid, userId: winner.user_id, lossRate: winner.lossRate };
}

export function runDailyUnluckyScheduler(db, nowMs = Date.now()) {
  const snapshot = ensureTodayAssetSnapshots(db, nowMs);
  const kstNow = new Date(nowMs + 9 * 60 * 60 * 1000);
  const previousDate = previousDateKey(nowMs);
  const capturedPreviousDayEnd = captureUnfinalizedDayEnd(db, previousDate);
  const shouldFinalize = kstNow.getUTCHours() === 0 && kstNow.getUTCMinutes() >= 5;
  const finalized = shouldFinalize ? finalizeDailyUnluckyAward(db, previousDate) : null;
  return { snapshot, capturedPreviousDayEnd, finalized };
}

export function getLatestDailyUnluckyAward(db) {
  return db.prepare(`
    SELECT a.*, u.nickname AS nickname_snapshot
    FROM daily_unlucky_awards a JOIN users u ON u.id = a.user_id
    ORDER BY a.date_key DESC LIMIT 1
  `).get() || null;
}

export const getKstDateKey = kstDateKey;
