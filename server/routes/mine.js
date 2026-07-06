import express from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { createServerNotification } from "../services/serverNotificationService.js";
import { formatSignedWon, formatWon } from "../utils/formatWon.js";

export const mineRouter = express.Router();

mineRouter.use(requireAuth);

mineRouter.get("/status", (req, res) => {
  const user = db.prepare("SELECT balance, mine_click_count, mine_total_earned FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ message: "사용자를 찾을 수 없어요." });

  const recentFinds = db.prepare(`
    SELECT result_type, label, actual_reward, created_at 
    FROM mine_logs 
    WHERE user_id = ? 
    ORDER BY created_at DESC 
    LIMIT 10
  `).all(req.user.id);

  res.json({
    canEnterMine: true,
    canMine: true,
    balance: user.balance,
    totalMineClicks: user.mine_click_count || 0,
    totalMineEarned: user.mine_total_earned || 0,
    recentFinds: recentFinds.map(f => ({
      resultType: f.result_type,
      label: f.label,
      reward: f.actual_reward,
      createdAt: f.created_at,
    })),
  });
});

const REWARDS = [
  { type: "diamond", label: "다이아몬드", reward: 50000, cumulativeProb: 0.010 },
  { type: "gold", label: "금 조각", reward: 5000, cumulativeProb: 0.060 },
  { type: "iron", label: "철광석", reward: 1000, cumulativeProb: 0.200 },
  { type: "coal", label: "석탄", reward: 300, cumulativeProb: 0.500 },
  { type: "stone", label: "앗! 작은 돌멩이", reward: 100, cumulativeProb: 1.000 },
];

function getRandomReward() {
  const r = Math.random();
  for (const item of REWARDS) {
    if (r < item.cumulativeProb) return item;
  }
  return REWARDS[REWARDS.length - 1]; // fallback
}

mineRouter.post("/click", (req, res) => {
  const processMine = db.transaction((userId) => {
    const user = db.prepare("SELECT id, username, nickname, balance, mine_click_count, mine_total_earned FROM users WHERE id = ?").get(userId);
    if (!user) throw new Error("사용자를 찾을 수 없어요.");

    const item = getRandomReward();
    const rawReward = item.reward;
    const actualReward = rawReward;
    const balanceAfter = user.balance + actualReward;

    db.prepare(`
      UPDATE users 
      SET balance = ?, 
          mine_click_count = mine_click_count + 1,
          mine_total_earned = mine_total_earned + ?,
          last_mined_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(balanceAfter, actualReward, userId);

    const logResult = db.prepare(`
      INSERT INTO mine_logs (user_id, result_type, label, raw_reward, actual_reward, balance_before, balance_after)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, item.type, item.label, rawReward, actualReward, user.balance, balanceAfter);

    const logId = logResult.lastInsertRowid;

    db.prepare(`
      INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_type, source_id, detail_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, 'mine_reward', actualReward, user.balance, balanceAfter, 'mine_log', String(logId), JSON.stringify({ label: item.label, result_type: item.type }));

    if (item.type === "gold" || item.type === "diamond" || actualReward >= 10000) {
      createServerNotification(db, {
        userId: user.id,
        nickname: user.nickname,
        type: "big_win",
        title: "탄광 대박",
        message: `${user.nickname}님이 탄광에서 ${item.label}을(를) 발견해 ${formatWon(actualReward)}을 획득했어요!`,
        amount: actualReward,
        gameType: "mine",
        gameName: "탄광",
        metadata: { resultType: item.type, label: item.label },
        sourceType: "mine_log",
        sourceId: logId,
      });
    }

    const isStone = item.type === "stone";
    const msg = isStone 
      ? `앗! 작은 돌멩이를 캤어요. 그래도 +100원!` 
      : `${item.label}을(를) 발견했어요! ${formatSignedWon(actualReward)}`;

    return {
      success: true,
      resultType: item.type,
      label: item.label,
      rawReward,
      actualReward,
      balanceBefore: user.balance,
      balanceAfter,
      canMine: true,
      message: msg
    };
  });

  try {
    const result = processMine(req.user.id);
    if (!result.success) {
      return res.status(400).json({ message: result.message, balance: result.balance, canMine: false });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message || "채굴 중 오류가 발생했어요." });
  }
});
