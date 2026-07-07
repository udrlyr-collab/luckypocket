import { createServerNotification } from "./serverNotificationService.js";
import { formatWon } from "../utils/formatWon.js";

function todayKst(database) {
  return database.prepare("SELECT date('now', '+9 hours') AS value").get().value;
}

function systemConfigNumber(database, key, fallback = 0) {
  const row = database.prepare("SELECT value FROM system_config WHERE key = ?").get(key);
  const value = Number(row?.value);
  return Number.isFinite(value) ? value : fallback;
}

function setSystemConfigNumber(database, key, value) {
  database
    .prepare(
      `INSERT INTO system_config (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, String(Math.max(0, Math.floor(value))));
}

export function getJackpotPool(database) {
  return systemConfigNumber(database, "jackpot_pool_amount", 0);
}

export function applyJackpotTickets(database, userId) {
  const apply = database.transaction(() => {
    const user = database.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    if (!user) throw new Error("사용자를 찾을 수 없어요.");
    if (user.jackpot_tickets <= 0) {
      const err = new Error("응모할 행운권이 없어요.");
      err.status = 400;
      throw err;
    }

    const date = todayKst(database);
    const tickets = user.jackpot_tickets;

    database.prepare("UPDATE users SET jackpot_tickets = 0 WHERE id = ?").run(userId);

    database.prepare(`
      INSERT INTO jackpot_entries (user_id, entry_date, tickets)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, entry_date) DO UPDATE SET tickets = tickets + excluded.tickets
    `).run(userId, date, tickets);

    const totalApplied = database
      .prepare("SELECT tickets FROM jackpot_entries WHERE user_id = ? AND entry_date = ?")
      .get(userId, date).tickets;

    return {
      message: `${tickets}장의 행운권으로 오늘의 잭팟에 응모했어요!`,
      totalApplied
    };
  });
  return apply();
}

export function runJackpotDraw(database) {
  const draw = database.transaction(() => {
    const date = todayKst(database);
    const pool = getJackpotPool(database);
    
    if (pool <= 0) return { success: false, reason: "풀이 비어있음" };

    const entries = database.prepare(`
      SELECT user_id, tickets
      FROM jackpot_entries
      WHERE entry_date = ?
    `).all(date);

    if (entries.length === 0) {
      // 아무도 응모하지 않으면 다음 날로 이월 (풀 유지)
      return { success: false, reason: "응모자가 없음" };
    }

    let totalWeight = 0;
    const participants = entries.map(entry => {
      const weight = 1 + entry.tickets * 0.001; // 기본 1 + 행운권장당 0.1%
      totalWeight += weight;
      return { userId: entry.user_id, weight, maxThreshold: totalWeight };
    });

    const rand = Math.random() * totalWeight;
    const winner = participants.find(p => rand <= p.maxThreshold);

    if (!winner) return { success: false, reason: "당첨자 선정 실패" };

    const winnerUser = database.prepare("SELECT id, nickname, balance FROM users WHERE id = ?").get(winner.userId);
    const balanceAfter = winnerUser.balance + pool;

    database.prepare(`
      UPDATE users
      SET balance = ?,
          highest_balance = MAX(highest_balance, ?),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(balanceAfter, balanceAfter, winner.userId);

    setSystemConfigNumber(database, "jackpot_pool_amount", 0); // 잭팟 초기화

    database.prepare(`
      INSERT INTO asset_events
      (user_id, event_type, amount, balance_before, balance_after, source_type, source_id, detail_json)
      VALUES (?, 'daily_jackpot_reward', ?, ?, ?, 'daily_jackpot', ?, ?)
    `).run(
      winner.userId,
      pool,
      winnerUser.balance,
      balanceAfter,
      date,
      JSON.stringify({ pool, date, totalParticipants: entries.length, totalWeight, tickets: entries.find(e => e.user_id === winner.userId).tickets })
    );

    createServerNotification(database, {
      userId: winner.userId,
      nickname: winnerUser.nickname,
      type: "jackpot",
      title: "오늘의 잭팟!",
      message: `축하합니다! ${winnerUser.nickname}님이 오늘의 잭팟에 당첨되어 ${formatWon(pool)}을(를) 받았어요!`,
      amount: pool,
      gameName: "오늘의 잭팟",
      metadata: { pool, date },
      sourceType: "daily_jackpot",
      sourceId: date,
    });

    return {
      success: true,
      winnerId: winner.userId,
      pool,
    };
  });
  return draw();
}
