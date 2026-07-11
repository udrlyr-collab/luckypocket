const GAME_LABELS = {
  "risk-button": "위험버튼",
  "card-draw": "카드 뽑기",
  "bomb-dodge": "폭탄 숫자 피하기",
  slot: "슬롯머신",
  dart: "다트",
  cup: "컵 속 행운",
  mine: "탄광",
};

function gameLabel(gameType) {
  return GAME_LABELS[gameType] || gameType || "-";
}

export function getLuckStats(database, userId) {
  const gameRows = database
    .prepare(
      `SELECT game_type,
              COUNT(*) AS play_count,
              COALESCE(TOTAL(CASE WHEN profit > 0 THEN CAST(profit AS REAL) ELSE 0 END), 0) AS earned,
              COALESCE(TOTAL(CASE WHEN profit < 0 THEN CAST(-profit AS REAL) ELSE 0 END), 0) AS lost,
              MAX(profit) AS max_profit,
              MIN(profit) AS max_loss
       FROM game_logs
       WHERE user_id = ?
       GROUP BY game_type`,
    )
    .all(userId);

  const mostPlayedGame = [...gameRows].sort((a, b) => b.play_count - a.play_count)[0] || null;
  const mostEarnedGame = [...gameRows].sort((a, b) => b.earned - a.earned)[0] || null;
  const mostLostGame = [...gameRows].sort((a, b) => b.lost - a.lost)[0] || null;
  const bestSingle = database
    .prepare(
      `SELECT game_type, profit, payout, created_at
       FROM game_logs
       WHERE user_id = ?
       ORDER BY profit DESC
       LIMIT 1`,
    )
    .get(userId);
  const worstSingle = database
    .prepare(
      `SELECT game_type, profit, payout, created_at
       FROM game_logs
       WHERE user_id = ?
       ORDER BY profit ASC
       LIMIT 1`,
    )
    .get(userId);

  const bestStock = database
    .prepare(
      `SELECT t.stock_id, s.name, MAX(t.realized_pnl) AS profit
       FROM stock_trades t
       JOIN stocks s ON s.id = t.stock_id
       WHERE t.user_id = ?
         AND t.realized_pnl IS NOT NULL
       GROUP BY t.stock_id
       ORDER BY profit DESC
       LIMIT 1`,
    )
    .get(userId);
  const worstStock = database
    .prepare(
      `SELECT t.stock_id, s.name, MIN(t.realized_pnl) AS profit
       FROM stock_trades t
       JOIN stocks s ON s.id = t.stock_id
       WHERE t.user_id = ?
         AND t.realized_pnl IS NOT NULL
       GROUP BY t.stock_id
       ORDER BY profit ASC
       LIMIT 1`,
    )
    .get(userId);

  const jackpotEntries = database
    .prepare(
      `SELECT COALESCE(TOTAL(extra_entry_count), 0) AS count
       FROM jackpot_entries
       WHERE user_id = ?`,
    )
    .get(userId).count;
  const jackpotWins = database
    .prepare("SELECT COUNT(*) AS count FROM jackpot_rounds WHERE winner_user_id = ?")
    .get(userId).count;

  return {
    mostPlayedGame: mostPlayedGame
      ? {
          gameType: mostPlayedGame.game_type,
          label: gameLabel(mostPlayedGame.game_type),
          count: mostPlayedGame.play_count,
        }
      : null,
    mostEarnedGame: mostEarnedGame
      ? {
          gameType: mostEarnedGame.game_type,
          label: gameLabel(mostEarnedGame.game_type),
          amount: Math.floor(Number(mostEarnedGame.earned || 0)),
        }
      : null,
    mostLostGame: mostLostGame
      ? {
          gameType: mostLostGame.game_type,
          label: gameLabel(mostLostGame.game_type),
          amount: Math.floor(Number(mostLostGame.lost || 0)),
        }
      : null,
    bestSingleProfit: bestSingle
      ? {
          gameType: bestSingle.game_type,
          label: gameLabel(bestSingle.game_type),
          amount: bestSingle.profit,
          payout: bestSingle.payout,
          createdAt: bestSingle.created_at,
        }
      : null,
    worstSingleLoss: worstSingle
      ? {
          gameType: worstSingle.game_type,
          label: gameLabel(worstSingle.game_type),
          amount: worstSingle.profit,
          payout: worstSingle.payout,
          createdAt: worstSingle.created_at,
        }
      : null,
    bestStockProfit: bestStock
      ? {
          stockId: bestStock.stock_id,
          name: bestStock.name,
          amount: bestStock.profit,
        }
      : null,
    worstStockLoss: worstStock
      ? {
          stockId: worstStock.stock_id,
          name: worstStock.name,
          amount: worstStock.profit,
        }
      : null,
    jackpotEntries: Math.floor(Number(jackpotEntries || 0)),
    jackpotWins: Number(jackpotWins || 0),
  };
}
