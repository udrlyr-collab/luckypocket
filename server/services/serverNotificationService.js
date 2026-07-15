import { formatWon } from "../utils/formatWon.js";

export const GAME_NAMES = {
  "risk-button": "위험버튼",
  "card-draw": "카드 뽑기",
  "bomb-dodge": "폭탄 숫자 피하기",
  "slot": "슬롯머신",
  "dart": "다트 던지기",
  "cup": "컵 속 행운",
  "mine": "탄광",
  "bonus_code": "행운코드",
  "achievement": "업적",
  "timing": "시간 감각",
};

export function createServerNotification(database, {
  userId,
  nickname,
  type,
  title,
  message,
  amount = null,
  multiplier = null,
  gameType = null,
  gameName = null,
  metadata = {},
  sourceType = null,
  sourceId = null,
}) {
  return database
    .prepare(
      `INSERT OR IGNORE INTO server_notifications
       (user_id, nickname_snapshot, type, title, message, amount, multiplier,
        game_type, game_name, metadata_json, source_type, source_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      nickname,
      type,
      title,
      message,
      amount,
      multiplier,
      gameType,
      gameName,
      JSON.stringify(metadata),
      sourceType,
      sourceId === null ? null : String(sourceId),
    );
}

export function createGameNotification(database, {
  gameLogId,
  user,
  gameType,
  bet,
  payout,
  won,
  detail,
}) {
  if (!won) return null;
  const multiplier = bet > 0 ? payout / bet : 0;
  const profit = payout - bet;
  let notification = null;

  if (gameType === "slot" && detail.outcome === "777") {
    notification = {
      type: "jackpot",
      title: "777 잭팟",
      message: `${user.nickname}님이 슬롯머신에서 777을 띄워 순수익 ${formatWon(profit)}을(를) 획득했어요!`,
    };
  } else if (gameType === "dart" && String(detail.target || "").includes("bullseye")) {
    notification = {
      type: "jackpot",
      title: "다트 불스아이",
      message: `${user.nickname}님이 다트 던지기에서 불스아이를 맞혀 순수익 ${formatWon(profit)}을(를) 획득했어요!`,
    };
  } else if (gameType === "risk-button" && detail.cashedOut && detail.stage >= 5) {
    notification = {
      type: "high_multiplier",
      title: "위험버튼 고배당",
      message: `${user.nickname}님이 위험버튼 ${detail.stage}단계에서 ${Number(multiplier.toFixed(2))}배 보상을 확정해 순수익 ${formatWon(profit)}을(를) 획득했어요!`,
    };
  } else if (gameType === "bomb-dodge" && detail.cashedOut && detail.safeCount >= 8) {
    notification = {
      type: "high_multiplier",
      title: "폭탄 피하기 대기록",
      message: `${user.nickname}님이 폭탄 숫자 피하기에서 안전 칸 ${detail.safeCount}개를 열고 순수익 ${formatWon(profit)}을(를) 획득했어요!`,
    };
  } else if (gameType === "cup" && (
    Number(detail.cupCount) === 8 ||
    Number(detail.finalPayout || payout) >= 1_000_000 ||
    Number(detail.cupWinStreak) >= 5
  )) {
    notification = {
      type: "high_multiplier",
      title: "컵 속 행운 8배 당첨",
      message: `${user.nickname}님이 컵 속 행운 8개 도전에 성공해 8배 당첨금을 획득했어요!`,
    };
  } else if (gameType === "timing") {
    const errorSec = detail.absoluteErrorMs / 1000;
    if (detail.absoluteErrorMs <= 20) {
      notification = {
        type: "jackpot",
        title: "완벽한 감각",
        message: `${user.nickname}님이 시간 감각 ${detail.modeSeconds}초 모드에서 ${errorSec.toFixed(2)}초 오차로 완벽한 기록을 세웠어요!`,
      };
    } else if (detail.modeSeconds === 60 && multiplier >= 4) {
      notification = {
        type: "high_multiplier",
        title: "시간 지배자",
        message: `${user.nickname}님이 시간 감각 60초 모드에서 ${Number(multiplier.toFixed(2))}배 보상을 획득해 순수익 ${formatWon(profit)}을(를) 획득했어요!`,
      };
    } else {
      // 3회 연속 오차 0.10초 이하 판정
      const prior = database.prepare(
        "SELECT detail_json FROM game_logs WHERE user_id = ? AND game_type = 'timing' ORDER BY id DESC LIMIT 2"
      ).all(user.id);
      
      let isStreak3 = false;
      if (detail.absoluteErrorMs <= 100 && prior.length === 2) {
        try {
          const p0 = JSON.parse(prior[0].detail_json);
          const p1 = JSON.parse(prior[1].detail_json);
          if (p0.absoluteErrorMs <= 100 && p1.absoluteErrorMs <= 100) {
            isStreak3 = true;
          }
        } catch {}
      }

      if (isStreak3) {
        notification = {
          type: "high_multiplier",
          title: "초인적인 감각",
          message: `${user.nickname}님이 시간 감각에서 3회 연속 오차 0.10초 이하를 기록해 대단한 능력을 보여줬어요!`,
        };
      } else if (profit >= 1000000) {
        notification = {
          type: "big_win",
          title: "큰 행운 도착",
          message: `${user.nickname}님이 시간 감각에서 순수익 ${formatWon(profit)}을(를) 획득했어요!`,
        };
      }
    }
  } else if (multiplier >= 10) {
    notification = {
      type: "high_multiplier",
      title: "고배당 당첨",
      message: `${user.nickname}님이 ${GAME_NAMES[gameType] || '게임'}에서 ${Number(multiplier.toFixed(2))}배 보상으로 순수익 ${formatWon(profit)}을(를) 획득했어요!`,
    };
  } else if (profit >= 1000000) {
    notification = {
      type: "big_win",
      title: "큰 행운 도착",
      message: `${user.nickname}님이 ${GAME_NAMES[gameType] || '게임'}에서 순수익 ${formatWon(profit)}을(를) 획득했어요!`,
    };
  }

  if (!notification) return null;
  return createServerNotification(database, {
    userId: user.id,
    nickname: user.nickname,
    ...notification,
    amount: profit,
    multiplier,
    gameType,
    gameName: GAME_NAMES[gameType] || null,
    metadata: detail,
    sourceType: "game_log",
    sourceId: gameLogId,
  });
}

export function createAchievementNotification(database, {
  achievementId,
  user,
  achievement,
}) {
  if (achievement.reward < 1000000) return null;
  return createServerNotification(database, {
    userId: user.id,
    nickname: user.nickname,
    type: "achievement",
    title: "큰 업적 달성",
    message: `${user.nickname}님이 업적 ‘${achievement.title}’을 달성하고 ${formatWon(achievement.reward)}을 획득했어요!`,
    amount: achievement.reward,
    gameType: "achievement",
    gameName: GAME_NAMES["achievement"],
    metadata: {
      achievementKey: achievement.key,
      achievementTitle: achievement.title,
    },
    sourceType: "achievement",
    sourceId: achievementId,
  });
}
