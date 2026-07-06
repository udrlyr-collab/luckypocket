import { recordAssetEvent } from "./assetEventService.js";
import { delistStock } from "./stockService.js";

export function parseAdminUserIds(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("대상 사용자를 한 명 이상 선택해 주세요.");
  }

  const ids = [];
  const seen = new Set();
  for (const rawId of value) {
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new TypeError("대상 사용자 목록이 올바르지 않습니다.");
    }
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function getTargetUser(database, targetId) {
  const target = database.prepare("SELECT * FROM users WHERE id = ?").get(targetId);
  if (!target) {
    throw new Error(`사용자 ID ${targetId}을(를) 찾을 수 없습니다.`);
  }
  return target;
}

function resetOneUser(database, adminUserId, targetId, resetTargets) {
  const target = getTargetUser(database, targetId);
  const selected = new Set(resetTargets);

  if (selected.has("games")) {
    database.prepare("DELETE FROM game_logs WHERE user_id = ?").run(targetId);
    database.prepare("DELETE FROM game_sessions WHERE user_id = ?").run(targetId);
    database.prepare("DELETE FROM lucky_seven_uses WHERE user_id = ?").run(targetId);
    database
      .prepare(
        `UPDATE users
         SET total_bet = 0, total_win = 0, total_loss = 0
         WHERE id = ?`,
      )
      .run(targetId);
  }

  if (selected.has("achievements")) {
    database.prepare("DELETE FROM user_achievements WHERE user_id = ?").run(targetId);
  }

  if (selected.has("history")) {
    database.prepare("DELETE FROM asset_events WHERE user_id = ?").run(targetId);
    database
      .prepare(
        "DELETE FROM transfer_logs WHERE sender_user_id = ? OR receiver_user_id = ?",
      )
      .run(targetId, targetId);
  }

  if (selected.has("stocks")) {
    database.prepare("DELETE FROM stock_holdings WHERE user_id = ?").run(targetId);
    database.prepare("DELETE FROM stock_positions WHERE user_id = ?").run(targetId);
    database.prepare("DELETE FROM stock_trades WHERE user_id = ?").run(targetId);

    const ownedStocks = database
      .prepare("SELECT * FROM stocks WHERE owner_user_id = ? AND status != 'delisted'")
      .all(targetId);
    for (const stock of ownedStocks) {
      delistStock(database, stock);
    }
  }

  if (selected.has("mine")) {
    database.prepare("DELETE FROM mine_logs WHERE user_id = ?").run(targetId);
    database
      .prepare(
        `UPDATE users
         SET mine_click_count = 0, mine_total_earned = 0, last_mined_at = NULL
         WHERE id = ?`,
      )
      .run(targetId);
  }

  if (selected.has("account")) {
    database.prepare("DELETE FROM revival_claims WHERE user_id = ?").run(targetId);
    database
      .prepare(
        `UPDATE users
         SET nickname_change_count = 0,
             bankruptcy_count = 0,
             last_bankruptcy_at = NULL,
             bankruptcy_prompt_dismissed_at = NULL
         WHERE id = ?`,
      )
      .run(targetId);
  }

  if (selected.has("balance")) {
    database
      .prepare(
        `UPDATE users
         SET balance = 5000000,
             initial_balance = 5000000,
             highest_balance = 5000000,
             total_profit = 0
         WHERE id = ?`,
      )
      .run(targetId);
  }

  database
    .prepare(
      `UPDATE users
       SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    )
    .run(targetId);

  const updated = getTargetUser(database, targetId);
  const adminLog = database
    .prepare(
      `INSERT INTO admin_logs
       (admin_user_id, target_user_id, action_type, before_value, after_value)
       VALUES (?, ?, 'force_user_selective_reset', ?, ?)`,
    )
    .run(
      adminUserId,
      targetId,
      JSON.stringify({
        targets: resetTargets,
        balance: target.balance,
        totalBet: target.total_bet,
        totalWin: target.total_win,
        totalLoss: target.total_loss,
        bankruptcyCount: target.bankruptcy_count || 0,
        mineClickCount: target.mine_click_count || 0,
      }),
      JSON.stringify({
        targets: resetTargets,
        balance: updated.balance,
        totalBet: updated.total_bet,
        totalWin: updated.total_win,
        totalLoss: updated.total_loss,
        bankruptcyCount: updated.bankruptcy_count || 0,
        mineClickCount: updated.mine_click_count || 0,
      }),
    );

  if (selected.has("balance")) {
    recordAssetEvent({
      userId: targetId,
      eventType: "admin_force_reset",
      amount: 5_000_000 - target.balance,
      balanceBefore: target.balance,
      balanceAfter: 5_000_000,
      sourceType: "admin_log",
      sourceId: adminLog.lastInsertRowid,
      detail: {
        label: "관리자 선택 초기화",
        resetTargets,
      },
    });
  }

  return updated;
}

export function resetAdminUsers(
  database,
  { adminUserId, userIds, resetTargets },
) {
  return database.transaction(() =>
    userIds.map((targetId) =>
      resetOneUser(database, adminUserId, targetId, resetTargets),
    ),
  )();
}

export function setAdminUsersBalance(
  database,
  { adminUserId, userIds, newBalance },
) {
  return database.transaction(() =>
    userIds.map((targetId) => {
      const target = getTargetUser(database, targetId);
      database
        .prepare(
          `UPDATE users
           SET balance = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
        )
        .run(newBalance, targetId);

      const log = database
        .prepare(
          `INSERT INTO admin_logs
           (admin_user_id, target_user_id, action_type, before_value, after_value)
           VALUES (?, ?, 'force_balance_change', ?, ?)`,
        )
        .run(
          adminUserId,
          targetId,
          target.balance.toString(),
          newBalance.toString(),
        );

      recordAssetEvent({
        userId: targetId,
        eventType: "admin_balance_adjustment",
        amount: newBalance - target.balance,
        balanceBefore: target.balance,
        balanceAfter: newBalance,
        sourceType: "admin_log",
        sourceId: log.lastInsertRowid,
        detail: {
          label: "관리자 자산 조절",
        },
      });

      return getTargetUser(database, targetId);
    }),
  )();
}
