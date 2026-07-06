import { recordAssetEvent } from "./assetEventService.js";
import { createAchievementNotification } from "./serverNotificationService.js";

export const ACHIEVEMENTS = [
  { key: "first_play", title: "첫 발자국", description: "첫 게임 플레이", reward: 50000 },
  { key: "first_win", title: "첫 수확", description: "첫 승리", reward: 100000 },
  { key: "profit_100k", title: "작은 행운", description: "한 판 순수익 100,000원 이상", reward: 150000 },
  { key: "balance_2m", title: "행운주머니 입문자", description: "현재 자산 2,000,000원 달성", reward: 200000 },
  { key: "balance_5m", title: "주머니가 묵직해요", description: "현재 자산 5,000,000원 달성", reward: 400000 },
  { key: "balance_10m", title: "천만 주머니", description: "현재 자산 10,000,000원 달성", reward: 800000 },
  { key: "balance_50m", title: "행운 부자", description: "현재 자산 50,000,000원 달성", reward: 2500000 },
  { key: "card_10_wins", title: "안정적인 카드 수집가", description: "카드 뽑기 10승", reward: 250000 },
  { key: "card_50_wins", title: "카드 장인", description: "카드 뽑기 50승", reward: 800000 },
  { key: "card_exact", title: "정확히 맞혔어요", description: "정확한 숫자 맞히기", reward: 400000 },
  { key: "risk_4", title: "위험한 손가락", description: "위험버튼 4단계 이상에서 금액 확정", reward: 500000 },
  { key: "risk_5", title: "멈출 줄 아는 사람", description: "위험버튼 5단계 이상에서 금액 확정", reward: 1000000 },
  { key: "risk_7", title: "전설의 버튼", description: "위험버튼 7단계 성공 후 금액 확정", reward: 7000000 },
  { key: "bomb_5", title: "폭탄 감별사", description: "안전 칸 5개 이상 열고 확정", reward: 600000 },
  { key: "bomb_8", title: "폭탄 해체반", description: "안전 칸 8개 이상 열고 확정", reward: 1500000 },
  { key: "bomb_expert", title: "위험한 해체 전문가", description: "폭탄 6개 이상, 안전 칸 5개 이상 확정", reward: 2500000 },
  { key: "slot_pair", title: "슬롯 입문자", description: "같은 숫자 2개", reward: 150000 },
  { key: "slot_sequence", title: "슬롯 행운아", description: "연속 숫자", reward: 400000 },
  { key: "slot_triple", title: "슬롯 장인", description: "같은 숫자 3개", reward: 1200000 },
  { key: "slot_777", title: "777의 주인", description: "777 달성", reward: 7770000 },
  { key: "dart_wide", title: "다트 연습생", description: "넓은 원 성공", reward: 150000 },
  { key: "dart_small", title: "다트 명중", description: "작은 원 성공", reward: 800000 },
  { key: "dart_bullseye", title: "불스아이!", description: "불스아이 성공", reward: 3500000 },
  { key: "dart_sector", title: "섹터 스나이퍼", description: "특정 섹터 성공", reward: 1200000 },
  { key: "comeback", title: "기사회생", description: "자산 100,000원 이하에서 1,000,000원 이상 회복", reward: 700000 },
  { key: "streak_3", title: "연승의 시작", description: "3연승", reward: 250000 },
  { key: "streak_5", title: "행운의 흐름", description: "5연승", reward: 800000 },
  { key: "daily_profit_5m", title: "오늘의 주인공", description: "하루 누적 순수익 5,000,000원 이상", reward: 1200000 },
  { key: "games_100", title: "꾸준한 플레이어", description: "총 100판 플레이", reward: 1200000 },
  { key: "achievements_10", title: "행운 수집가", description: "일회성 업적 10개 획득", reward: 2500000 },
  { key: "achievements_20", title: "행운주머니의 전설", description: "일회성 업적 20개 획득", reward: 6000000 },
  { key: "all_games_1", title: "모든 게임 탐험가", description: "5개 게임을 모두 1회 이상 플레이", reward: 500000 },
  { key: "all_games_10", title: "균형 잡힌 플레이어", description: "5개 게임을 모두 10회 이상 플레이", reward: 2000000 },
  { key: "loss_recovery", title: "손실 복구왕", description: "누적 손실 1,000,000원 이후 게임 순수익 플러스 전환", reward: 1500000 },
  { key: "daily_play", title: "오늘도 출석", description: "오늘 첫 게임 플레이", reward: 50000, repeatable: true },
];

const ONE_TIME_KEYS = new Set(
  ACHIEVEMENTS.filter((achievement) => !achievement.repeatable).map((achievement) => achievement.key),
);
const GAME_TYPES = ["risk-button", "card-draw", "bomb-dodge", "slot", "dart"];

function getSeoulDate(database) {
  return database.prepare("SELECT date('now', '+9 hours') AS value").get().value;
}

function getStats(database, userId) {
  const totals = database
    .prepare(
      `SELECT
         COUNT(*) AS games,
         SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins,
         COALESCE(MAX(profit), 0) AS max_profit,
         TOTAL(profit) AS net_profit,
         TOTAL(CASE WHEN profit < 0 THEN -profit ELSE 0 END) AS total_loss,
         TOTAL(CASE WHEN date(created_at, '+9 hours') = date('now', '+9 hours') THEN profit ELSE 0 END) AS today_profit
       FROM game_logs WHERE user_id = ?`,
    )
    .get(userId);
  const gameRows = database
    .prepare(
      `SELECT game_type,
              COUNT(*) AS games,
              SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins
       FROM game_logs WHERE user_id = ? GROUP BY game_type`,
    )
    .all(userId);
  const gameCounts = new Map(gameRows.map((row) => [row.game_type, row]));
  const recent = database
    .prepare("SELECT result FROM game_logs WHERE user_id = ? ORDER BY id DESC LIMIT 5")
    .all(userId);
  const streak = recent.findIndex((row) => row.result !== "win");
  const currentStreak = streak === -1 ? recent.length : streak;
  const lowBalance = database
    .prepare("SELECT MIN(balance_after) AS value FROM asset_events WHERE user_id = ?")
    .get(userId).value;
  const oneTimeCount = database
    .prepare("SELECT achievement_key FROM user_achievements WHERE user_id = ?")
    .all(userId)
    .filter((row) => ONE_TIME_KEYS.has(row.achievement_key)).length;

  return {
    ...totals,
    gameCounts,
    currentStreak,
    lowBalance: lowBalance ?? 1000000,
    oneTimeCount,
  };
}

function qualifies(key, { database, userId, user, stats, context }) {
  const gameCount = (gameType) => stats.gameCounts.get(gameType)?.games || 0;
  const gameWins = (gameType) => stats.gameCounts.get(gameType)?.wins || 0;
  switch (key) {
    case "first_play": return stats.games >= 1;
    case "first_win": return stats.wins >= 1;
    case "profit_100k": return stats.max_profit >= 100000;
    case "balance_2m": return user.balance >= 2000000;
    case "balance_5m": return user.balance >= 5000000;
    case "balance_10m": return user.balance >= 10000000;
    case "balance_50m": return user.balance >= 50000000;
    case "card_10_wins": return gameWins("card-draw") >= 10;
    case "card_50_wins": return gameWins("card-draw") >= 50;
    case "card_exact":
      return context.gameType === "card-draw" && context.won && context.condition === "exact";
    case "risk_4":
      return context.gameType === "risk-button" && context.cashedOut && context.stage >= 4;
    case "risk_5":
      return context.gameType === "risk-button" && context.cashedOut && context.stage >= 5;
    case "risk_7":
      return context.gameType === "risk-button" && context.cashedOut && context.stage >= 7;
    case "bomb_5":
      return context.gameType === "bomb-dodge" && context.cashedOut && context.safeCount >= 5;
    case "bomb_8":
      return context.gameType === "bomb-dodge" && context.cashedOut && context.safeCount >= 8;
    case "bomb_expert":
      return context.gameType === "bomb-dodge" && context.cashedOut &&
        context.safeCount >= 5 && context.bombCount >= 6;
    case "slot_pair": return context.gameType === "slot" && context.outcome === "pair";
    case "slot_sequence": return context.gameType === "slot" && context.outcome === "sequence";
    case "slot_triple": return context.gameType === "slot" && context.outcome === "triple";
    case "slot_777": return context.gameType === "slot" && context.outcome === "777";
    case "dart_wide":
      return context.gameType === "dart" && context.won && context.target === "wide";
    case "dart_small":
      return context.gameType === "dart" && context.won && context.target === "small";
    case "dart_bullseye":
      return context.gameType === "dart" && context.won && context.radius <= 0.1;
    case "dart_sector":
      return context.gameType === "dart" && context.won && context.target?.startsWith("sector");
    case "comeback": return stats.lowBalance <= 100000 && user.balance >= 1000000;
    case "streak_3": return stats.currentStreak >= 3;
    case "streak_5": return stats.currentStreak >= 5;
    case "daily_profit_5m": return stats.today_profit >= 5000000;
    case "games_100": return stats.games >= 100;
    case "achievements_10": return stats.oneTimeCount >= 10;
    case "achievements_20": return stats.oneTimeCount >= 20;
    case "all_games_1": return GAME_TYPES.every((gameType) => gameCount(gameType) >= 1);
    case "all_games_10": return GAME_TYPES.every((gameType) => gameCount(gameType) >= 10);
    case "loss_recovery": return stats.total_loss >= 1000000 && stats.net_profit > 0;
    case "daily_play": return context.gameCompleted === true;
    default:
      return false;
  }
}

function award(database, userId, achievement, recordKey) {
  const user = database.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  const before = user.balance;
  const insert = database
    .prepare(
      "INSERT INTO user_achievements (user_id, achievement_key, reward) VALUES (?, ?, ?)",
    )
    .run(userId, recordKey, achievement.reward);
  const after = before + achievement.reward;
  if (achievement.reward > 0) {
    database
      .prepare(
        `UPDATE users
         SET balance = ?,
             total_profit = total_profit + ?,
             highest_balance = MAX(highest_balance, ?),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      )
      .run(after, achievement.reward, after, userId);
    recordAssetEvent({
      userId,
      eventType: "achievement_reward",
      amount: achievement.reward,
      balanceBefore: before,
      balanceAfter: after,
      sourceType: "achievement",
      sourceId: insert.lastInsertRowid,
      detail: {
        achievementKey: achievement.key,
        title: achievement.title,
      },
    });
    createAchievementNotification(database, {
      achievementId: insert.lastInsertRowid,
      user,
      achievement,
    });
  }
}

export function awardAchievements(database, userId, context) {
  const earned = [];
  const seoulDate = getSeoulDate(database);

  for (let pass = 0; pass < 4; pass += 1) {
    const rows = database
      .prepare("SELECT achievement_key FROM user_achievements WHERE user_id = ?")
      .all(userId);
    const unlocked = new Set(rows.map((row) => row.achievement_key));
    let awardedThisPass = false;

    for (const achievement of ACHIEVEMENTS) {
      const recordKey = achievement.repeatable
        ? `${achievement.key}:${seoulDate}`
        : achievement.key;
      if (unlocked.has(recordKey)) continue;

      const user = database.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      const stats = getStats(database, userId);
      if (!qualifies(achievement.key, { database, userId, user, stats, context })) continue;

      award(database, userId, achievement, recordKey);
      unlocked.add(recordKey);
      earned.push(achievement);
      awardedThisPass = true;
    }

    if (!awardedThisPass) break;
  }

  return earned;
}

export function serializeAchievements(database, userId) {
  const seoulDate = getSeoulDate(database);
  const rows = database
    .prepare(
      "SELECT achievement_key, unlocked_at FROM user_achievements WHERE user_id = ?",
    )
    .all(userId);
  const unlocked = new Map(rows.map((row) => [row.achievement_key, row.unlocked_at]));
  return ACHIEVEMENTS.map((achievement) => {
    const recordKey = achievement.repeatable
      ? `${achievement.key}:${seoulDate}`
      : achievement.key;
    return {
      ...achievement,
      unlockedAt: unlocked.get(recordKey) || null,
    };
  });
}

export function achievementCount(database, userId) {
  const keys = database
    .prepare("SELECT achievement_key FROM user_achievements WHERE user_id = ?")
    .all(userId)
    .map((row) => row.achievement_key);
  return new Set(
    keys
      .map((key) => (key.startsWith("daily_play:") ? "daily_play" : key))
      .filter((key) => ONE_TIME_KEYS.has(key) || key === "daily_play"),
  ).size;
}
