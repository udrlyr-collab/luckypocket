import express from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const mineRouter = express.Router();

const TARGET_BALANCE = 1000000;
const ENTER_THRESHOLD = 500000;

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
    canEnterMine: user.balance < ENTER_THRESHOLD,
    canMine: user.balance < TARGET_BALANCE,
    balance: user.balance,
    targetBalance: TARGET_BALANCE,
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
  { type: "diamond", label: "다이아몬드", reward: 20000, cumulativeProb: 0.005 },
  { type: "gold", label: "금 조각", reward: 2000, cumulativeProb: 0.030 },
  { type: "iron", label: "철광석", reward: 500, cumulativeProb: 0.100 },
  { type: "coal", label: "석탄", reward: 150, cumulativeProb: 0.300 },
  { type: "stone", label: "돌", reward: 50, cumulativeProb: 1.000 },
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
    const user = db.prepare("SELECT id, balance, mine_click_count, mine_total_earned FROM users WHERE id = ?").get(userId);
    if (!user) throw new Error("사용자를 찾을 수 없어요.");
    
    if (user.balance >= TARGET_BALANCE) {
      return { 
        success: false, 
        message: "목표 달성! 자산이 1,000,000원이 되었어요.", 
        balance: user.balance 
      };
    }

    const item = getRandomReward();
    const rawReward = item.reward;
    const actualReward = Math.min(rawReward, TARGET_BALANCE - user.balance);
    const balanceAfter = user.balance + actualReward;

    db.prepare(`
      UPDATE users 
      SET balance = ?, 
          mine_click_count = mine_click_count + 1,
          mine_total_earned = mine_total_earned + ?,
          last_mined_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(balanceAfter, actualReward, userId);

    db.prepare(`
      INSERT INTO mine_logs (user_id, result_type, label, raw_reward, actual_reward, balance_before, balance_after)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, item.type, item.label, rawReward, actualReward, user.balance, balanceAfter);

    db.prepare(`
      INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_type, source_id, detail_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, 'mine_reward', actualReward, user.balance, balanceAfter, 'mine_log', '0', JSON.stringify({ label: item.label, result_type: item.type }));

    return {
      success: true,
      resultType: item.type,
      label: item.label,
      rawReward,
      actualReward,
      balanceBefore: user.balance,
      balanceAfter,
      canMine: balanceAfter < TARGET_BALANCE,
      message: balanceAfter >= TARGET_BALANCE 
        ? "목표 달성! 자산이 1,000,000원이 되었어요." 
        : `${item.label}을(를) 발견했어요! +${actualReward.toLocaleString('ko-KR')}원`
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
