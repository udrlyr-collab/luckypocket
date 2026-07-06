function formatWon(value) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

export function createServerNotification(database, {
  userId,
  nickname,
  type,
  title,
  message,
  amount = null,
  multiplier = null,
  gameType = null,
  metadata = {},
  sourceType = null,
  sourceId = null,
}) {
  return database
    .prepare(
      `INSERT OR IGNORE INTO server_notifications
       (user_id, nickname_snapshot, type, title, message, amount, multiplier,
        game_type, metadata_json, source_type, source_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  let notification = null;

  if (gameType === "slot" && detail.outcome === "777") {
    notification = {
      type: "jackpot",
      title: "777 잭팟",
      message: `${user.nickname}님이 슬롯 777로 ${formatWon(payout)}을 획득했어요!`,
    };
  } else if (gameType === "dart" && String(detail.target || "").includes("bullseye")) {
    notification = {
      type: "jackpot",
      title: "다트 불스아이",
      message: `${user.nickname}님이 다트 불스아이를 맞혔어요!`,
    };
  } else if (gameType === "risk-button" && detail.cashedOut && detail.stage >= 5) {
    notification = {
      type: "high_multiplier",
      title: "위험버튼 고배당",
      message: `${user.nickname}님이 위험버튼 ${detail.stage}단계에서 ${Number(multiplier.toFixed(2))}배 보상을 확정했어요!`,
    };
  } else if (gameType === "bomb-dodge" && detail.cashedOut && detail.safeCount >= 8) {
    notification = {
      type: "high_multiplier",
      title: "폭탄 피하기 대기록",
      message: `${user.nickname}님이 안전 칸 ${detail.safeCount}개를 열고 ${formatWon(payout)}을 확정했어요!`,
    };
  } else if (multiplier >= 10) {
    notification = {
      type: "high_multiplier",
      title: "고배당 당첨",
      message: `${user.nickname}님이 ${Number(multiplier.toFixed(2))}배 보상을 획득했어요!`,
    };
  } else if (payout >= 1000000) {
    notification = {
      type: "big_win",
      title: "큰 행운 도착",
      message: `${user.nickname}님이 한 게임에서 ${formatWon(payout)}을 획득했어요!`,
    };
  }

  if (!notification) return null;
  return createServerNotification(database, {
    userId: user.id,
    nickname: user.nickname,
    ...notification,
    amount: payout,
    multiplier,
    gameType,
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
    message: `${user.nickname}님이 업적 ‘${achievement.title}’을 달성하고 ${formatWon(achievement.reward)}을 받았어요!`,
    amount: achievement.reward,
    metadata: {
      achievementKey: achievement.key,
      achievementTitle: achievement.title,
    },
    sourceType: "achievement",
    sourceId: achievementId,
  });
}
