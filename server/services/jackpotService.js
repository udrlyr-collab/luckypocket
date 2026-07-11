import { createServerNotification } from "./serverNotificationService.js";
import { formatWon } from "../utils/formatWon.js";

const JACKPOT_INITIAL_AMOUNT = 0;

function getNextJackpotDrawAt() {
  const now = new Date();
  const nextDraw = new Date(now);
  nextDraw.setUTCHours(15, 0, 0, 0); // KST 24:00
  if (now.getTime() >= nextDraw.getTime()) {
    nextDraw.setUTCDate(nextDraw.getUTCDate() + 1);
  }
  return nextDraw.toISOString();
}

export function ensureActiveJackpotRound(db) {
  const active = db.prepare("SELECT * FROM jackpot_rounds WHERE status = 'active' ORDER BY id DESC LIMIT 1").get();
  if (active) return active;

  const lastRound = db.prepare("SELECT round_number FROM jackpot_rounds ORDER BY round_number DESC LIMIT 1").get();
  const nextRoundNum = lastRound ? lastRound.round_number + 1 : 1;

  const drawAt = getNextJackpotDrawAt();
  const result = db.prepare(`
    INSERT INTO jackpot_rounds (round_number, status, total_prize_amount, total_extra_entries, draw_at)
    VALUES (?, 'active', ?, 0, ?)
  `).run(nextRoundNum, JACKPOT_INITIAL_AMOUNT, drawAt);

  return db.prepare("SELECT * FROM jackpot_rounds WHERE id = ?").get(result.lastInsertRowid);
}

export function drawJackpotRound(db, roundId, force = false) {
  const draw = db.transaction(() => {
    const round = db.prepare("SELECT * FROM jackpot_rounds WHERE id = ?").get(roundId);
    if (!round || round.status !== 'active') return;

    if (!force && Date.now() < new Date(round.draw_at).getTime()) return;

    const users = db.prepare("SELECT id, nickname, balance FROM users").all();
    const entries = db.prepare("SELECT user_id, extra_entry_count FROM jackpot_entries WHERE round_id = ?").all(roundId);
    
    const entryMap = new Map(entries.map(e => [e.user_id, e.extra_entry_count]));

    let totalEffectiveEntries = 0;
    const weightedUsers = users.map(user => {
      const extraEntryCount = entryMap.get(user.id) ?? 0;
      const effectiveEntryCount = 1 + extraEntryCount;
      totalEffectiveEntries += effectiveEntryCount;
      return { user, effectiveEntryCount, maxThreshold: totalEffectiveEntries };
    });

    if (totalEffectiveEntries === 0) {
      db.prepare("UPDATE jackpot_rounds SET status = 'drawn', drawn_at = ?, total_effective_entries = 0 WHERE id = ?").run(new Date().toISOString(), roundId);
      return;
    }

    const rand = Math.random() * totalEffectiveEntries;
    const winnerData = weightedUsers.find(p => rand <= p.maxThreshold) || weightedUsers[0];
    const winner = winnerData.user;
    const winnerEntryCount = winnerData.effectiveEntryCount;
    const prizeAmount = round.total_prize_amount;

    if (prizeAmount > 0) {
      const balanceAfter = winner.balance + prizeAmount;
      db.prepare(`
        UPDATE users
        SET balance = ?,
            highest_balance = MAX(highest_balance, ?),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(balanceAfter, balanceAfter, winner.id);

      db.prepare(`
        INSERT INTO asset_events
        (user_id, event_type, amount, balance_before, balance_after, source_type, source_id, detail_json)
        VALUES (?, 'daily_jackpot_reward', ?, ?, ?, 'daily_jackpot', ?, ?)
      `).run(
        winner.id, prizeAmount, winner.balance, balanceAfter, String(roundId),
        JSON.stringify({ roundId, prizeAmount, totalEffectiveEntries, winnerEntryCount })
      );
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE jackpot_rounds
      SET status = 'drawn', drawn_at = ?, winner_user_id = ?, winner_nickname_snapshot = ?, winner_entry_count = ?, winner_prize_amount = ?, total_effective_entries = ?
      WHERE id = ?
    `).run(now, winner.id, winner.nickname, winnerEntryCount, prizeAmount, totalEffectiveEntries, roundId);

    db.prepare(`
      INSERT INTO user_jackpot_notices (user_id, round_id, notice_type)
      SELECT id, ?, 'jackpot_draw_result' FROM users
    `).run(roundId);

    createServerNotification(db, {
      userId: null,
      nickname: winner.nickname,
      type: "jackpot",
      title: "오늘의 잭팟!",
      message: `축하합니다! ${winner.nickname}님이 오늘의 잭팟에 당첨되어 ${formatWon(prizeAmount)}을(를) 받았어요!`,
      amount: prizeAmount,
      gameName: "오늘의 잭팟",
      metadata: { roundId, prizeAmount },
      sourceType: "daily_jackpot",
      sourceId: String(roundId),
    });

    return { winner, prizeAmount, roundId };
  });

  return draw();
}

export function drawOverdueJackpotRounds(db) {
  const overdue = db.prepare("SELECT id FROM jackpot_rounds WHERE status = 'active' AND draw_at <= ?").all(new Date().toISOString());
  let lastResult = null;
  for (const r of overdue) {
    lastResult = drawJackpotRound(db, r.id);
  }
  ensureActiveJackpotRound(db);
  return lastResult;
}

export function getActiveJackpotRound(db) {
  return ensureActiveJackpotRound(db);
}

export function getJackpotInfo(db) {
  const round = getActiveJackpotRound(db);
  const usersCount = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
  const totalEffective = usersCount + round.total_extra_entries;

  return {
    roundId: round.id,
    roundNumber: round.round_number,
    pool: round.total_prize_amount,
    drawAt: round.draw_at,
    totalExtraEntries: round.total_extra_entries,
    totalEffectiveEntries: totalEffective
  };
}

export function getJackpotPool(db) {
  return getJackpotInfo(db).pool;
}

export function getJackpotEntryStats(db, date = null) {
  const info = getJackpotInfo(db);
  const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users").get().count;

  return {
    date,
    roundId: info.roundId,
    totalAppliedTickets: info.totalEffectiveEntries,
    totalExtraEntries: info.totalExtraEntries,
    totalEffectiveEntries: info.totalEffectiveEntries,
    totalParticipants: totalUsers,
  };
}

export function setJackpotPool(db, amount) {
  const round = getActiveJackpotRound(db);
  const pool = Math.max(0, Math.floor(Number(amount) || 0));
  db.prepare(`
    UPDATE jackpot_rounds
    SET total_prize_amount = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(pool, round.id);
  return pool;
}

export function runJackpotDraw(db) {
  const round = getActiveJackpotRound(db);
  const pool = Number(round.total_prize_amount || 0);
  const result = drawJackpotRound(db, round.id, true);
  ensureActiveJackpotRound(db);

  if (!result) {
    return {
      success: false,
      reason: "추첨할 수 있는 활성 잭팟 회차가 없어요.",
      pool,
    };
  }

  return {
    success: true,
    ...result,
    pool,
  };
}

export function applyJackpotTickets(db, userId) {
  const apply = db.transaction(() => {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    if (!user) throw new Error("사용자를 찾을 수 없어요.");
    if (user.jackpot_tickets <= 0) {
      const err = new Error("응모할 행운권이 없어요.");
      err.status = 400;
      throw err;
    }

    const tickets = user.jackpot_tickets;
    db.prepare("UPDATE users SET jackpot_tickets = 0 WHERE id = ?").run(userId);

    const round = ensureActiveJackpotRound(db);
    db.prepare(`
      INSERT INTO jackpot_entries (round_id, user_id, extra_entry_count)
      VALUES (?, ?, ?)
      ON CONFLICT(round_id, user_id) DO UPDATE SET extra_entry_count = extra_entry_count + excluded.extra_entry_count
    `).run(round.id, userId, tickets);

    db.prepare("UPDATE jackpot_rounds SET total_extra_entries = total_extra_entries + ? WHERE id = ?").run(tickets, round.id);

    const entry = db.prepare("SELECT extra_entry_count FROM jackpot_entries WHERE round_id = ? AND user_id = ?").get(round.id, userId);

    return {
      message: `${tickets}장의 행운권으로 오늘의 잭팟에 추가 응모했어요!`,
      totalApplied: entry.extra_entry_count,
      jackpotInfo: getJackpotInfo(db)
    };
  });
  return apply();
}

let schedulerTimer = null;
export function startJackpotScheduler(db) {
  if (schedulerTimer) clearInterval(schedulerTimer);
  
  ensureActiveJackpotRound(db);
  drawOverdueJackpotRounds(db);

  schedulerTimer = setInterval(() => {
    try {
      drawOverdueJackpotRounds(db);
    } catch (e) {
      console.error("Jackpot scheduler error:", e);
    }
  }, 1000 * 60); // Check every minute
}
