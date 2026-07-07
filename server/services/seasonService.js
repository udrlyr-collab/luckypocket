import { createServerNotification } from "./serverNotificationService.js";

export const SEASON_STARTING_BALANCE = 1_000_000;
export const SEASON_TOP_BONUSES = new Map([
  [1, 30_000_000],
  [2, 15_000_000],
  [3, 5_000_000],
]);

export function getActiveSeason(database) {
  return database
    .prepare("SELECT * FROM seasons WHERE status = 'active' ORDER BY season_number DESC LIMIT 1")
    .get();
}

export function getStartingBalanceForRank(rank) {
  return SEASON_TOP_BONUSES.get(Number(rank)) || SEASON_STARTING_BALANCE;
}

function unrealizedForPosition(position, currentPrice) {
  const direction = position.side === "short" ? -1 : 1;
  return Math.floor(position.quantity * (currentPrice - position.entry_price) * direction);
}

function insertAssetEvent(database, {
  userId,
  eventType,
  amount,
  balanceBefore,
  balanceAfter,
  sourceType,
  sourceId,
  detail = {},
}) {
  database
    .prepare(
      `INSERT INTO asset_events
       (user_id, event_type, amount, balance_before, balance_after,
        source_type, source_id, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      eventType,
      amount,
      balanceBefore,
      balanceAfter,
      sourceType,
      sourceId === null || sourceId === undefined ? null : String(sourceId),
      JSON.stringify(detail),
    );
}

function settleHoldings(database, season) {
  const holdings = database
    .prepare(
      `SELECT h.*, s.current_price, s.status
       FROM stock_holdings h
       JOIN stocks s ON s.id = h.stock_id
       WHERE h.quantity > 0`,
    )
    .all();

  for (const holding of holdings) {
    const amount = holding.status === "delisted"
      ? 0
      : Math.floor(holding.quantity * holding.current_price);
    const user = database.prepare("SELECT * FROM users WHERE id = ?").get(holding.user_id);
    if (!user) continue;
    const balanceAfter = user.balance + amount;

    database
      .prepare("UPDATE users SET balance = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
      .run(balanceAfter, user.id);
    database
      .prepare(
        `INSERT INTO stock_trades
         (user_id, stock_id, trade_type, amount, quantity, price, leverage,
          realized_pnl, balance_before, balance_after)
         VALUES (?, ?, 'season_end_settlement', ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(
        user.id,
        holding.stock_id,
        amount,
        holding.quantity,
        holding.current_price,
        Math.floor(amount - holding.quantity * holding.average_price),
        user.balance,
        balanceAfter,
      );
    insertAssetEvent(database, {
      userId: user.id,
      eventType: "season_end_settlement",
      amount,
      balanceBefore: user.balance,
      balanceAfter,
      sourceType: "season_holding_settlement",
      sourceId: `${season.id}:${holding.id}`,
      detail: {
        seasonNumber: season.season_number,
        stockId: holding.stock_id,
        quantity: holding.quantity,
        price: holding.current_price,
      },
    });
  }
}

function settlePositions(database, season) {
  const positions = database
    .prepare(
      `SELECT p.*, s.current_price, s.status
       FROM stock_positions p
       JOIN stocks s ON s.id = p.stock_id
       WHERE p.status = 'open'`,
    )
    .all();

  for (const position of positions) {
    const currentPrice = position.status === "delisted" ? 0 : position.current_price;
    const pnl = unrealizedForPosition(position, currentPrice);
    const payout = Math.max(0, Math.floor(position.margin_amount + pnl));
    const user = database.prepare("SELECT * FROM users WHERE id = ?").get(position.user_id);
    if (!user) continue;
    const balanceAfter = user.balance + payout;

    database
      .prepare("UPDATE users SET balance = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
      .run(balanceAfter, user.id);
    database
      .prepare(
        `UPDATE stock_positions
         SET status = 'closed',
             closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             close_price = ?,
             realized_pnl = ?,
             payout_amount = ?
         WHERE id = ?`,
      )
      .run(currentPrice, pnl, payout, position.id);
    database
      .prepare(
        `INSERT INTO stock_trades
         (user_id, stock_id, trade_type, amount, quantity, price, leverage,
          realized_pnl, balance_before, balance_after)
         VALUES (?, ?, 'season_end_settlement', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.id,
        position.stock_id,
        payout,
        position.quantity,
        currentPrice,
        position.leverage,
        pnl,
        user.balance,
        balanceAfter,
      );
    insertAssetEvent(database, {
      userId: user.id,
      eventType: "season_end_settlement",
      amount: payout,
      balanceBefore: user.balance,
      balanceAfter,
      sourceType: "season_position_settlement",
      sourceId: `${season.id}:${position.id}`,
      detail: {
        seasonNumber: season.season_number,
        stockId: position.stock_id,
        side: position.side,
        leverage: position.leverage,
        closePrice: currentPrice,
        realizedPnl: pnl,
      },
    });
  }
}

function rankSeasonUsers(database, season) {
  const users = database.prepare("SELECT * FROM users ORDER BY id ASC").all();
  const gameCounts = new Map(
    database
      .prepare(
        `SELECT user_id, COUNT(*) AS total_games
         FROM game_logs
         WHERE season_id = ?
         GROUP BY user_id`,
      )
      .all(season.id)
      .map((row) => [row.user_id, row.total_games]),
  );

  const sorted = users
    .map((user) => ({
      ...user,
      finalBalance: Math.floor(user.balance),
      finalStockValue: 0,
      finalTotalEvaluatedAsset: Math.floor(user.balance),
      totalGames: gameCounts.get(user.id) || 0,
    }))
    .sort((a, b) => {
      if (b.finalTotalEvaluatedAsset !== a.finalTotalEvaluatedAsset) {
        return b.finalTotalEvaluatedAsset - a.finalTotalEvaluatedAsset;
      }
      return a.id - b.id;
    });

  let previousAsset = null;
  let previousRank = 0;
  return sorted.map((user, index) => {
    const rank = user.finalTotalEvaluatedAsset === previousAsset
      ? previousRank
      : index + 1;
    previousAsset = user.finalTotalEvaluatedAsset;
    previousRank = rank;
    return { ...user, rank, startingBonusForNextSeason: getStartingBalanceForRank(rank) };
  });
}

export function endCurrentSeason(database, adminUser) {
  return database.transaction(() => {
    const season = getActiveSeason(database);
    if (!season) {
      throw new Error("진행 중인 시즌이 없어요.");
    }

    settleHoldings(database, season);
    settlePositions(database, season);

    database.prepare("DELETE FROM stock_holdings").run();
    database.prepare("DELETE FROM stock_positions").run();
    database.prepare("DELETE FROM game_sessions").run();

    const ranked = rankSeasonUsers(database, season);
    const insertResult = database.prepare(
      `INSERT OR REPLACE INTO season_results
       (season_id, season_number, user_id, username, nickname_snapshot, rank,
        final_balance, final_stock_value, final_total_evaluated_asset,
        total_profit, total_games, starting_bonus_for_next_season)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const user of ranked) {
      insertResult.run(
        season.id,
        season.season_number,
        user.id,
        user.username,
        user.nickname,
        user.rank,
        user.finalBalance,
        user.finalStockValue,
        user.finalTotalEvaluatedAsset,
        user.total_profit || 0,
        user.totalGames,
        user.startingBonusForNextSeason,
      );
    }

    database
      .prepare(
        `UPDATE seasons
         SET status = 'ended',
             ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             ended_by_user_id = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      )
      .run(adminUser.id, season.id);

    const newSeasonNumber = season.season_number + 1;
    const newSeasonId = database
      .prepare("INSERT INTO seasons (season_number, status) VALUES (?, 'active')")
      .run(newSeasonNumber).lastInsertRowid;
    const newSeason = database.prepare("SELECT * FROM seasons WHERE id = ?").get(newSeasonId);

    database.prepare("DELETE FROM user_achievements").run();
    database.prepare("DELETE FROM lucky_seven_uses").run();
    database.prepare("DELETE FROM revival_claims").run();

    for (const user of ranked) {
      const startingBalance = user.startingBonusForNextSeason;
      database
        .prepare(
          `UPDATE users
           SET balance = ?,
               initial_balance = ?,
               highest_balance = ?,
               total_profit = 0,
               total_bet = 0,
               total_win = 0,
               total_loss = 0,
               bankruptcy_count = 0,
               last_bankruptcy_at = NULL,
               bankruptcy_prompt_dismissed_at = NULL,
               mine_click_count = 0,
               mine_total_earned = 0,
               last_mined_at = NULL,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
        )
        .run(startingBalance, startingBalance, startingBalance, user.id);
      insertAssetEvent(database, {
        userId: user.id,
        eventType: "season_start_bonus",
        amount: startingBalance - user.finalBalance,
        balanceBefore: user.finalBalance,
        balanceAfter: startingBalance,
        sourceType: "season",
        sourceId: `${newSeasonId}:${user.id}`,
        detail: {
          previousSeasonNumber: season.season_number,
          seasonNumber: newSeasonNumber,
          previousRank: user.rank,
          startingBalance,
        },
      });
      database
        .prepare(
          `INSERT OR IGNORE INTO user_season_notices
           (user_id, season_id, season_number, notice_type)
           VALUES (?, ?, ?, 'season_started')`,
        )
        .run(user.id, newSeasonId, newSeasonNumber);
    }

    createServerNotification(database, {
      userId: adminUser.id,
      nickname: adminUser.nickname,
      type: "season_started",
      title: "새 시즌 시작",
      message: `시즌 ${season.season_number}이 종료되고 시즌 ${newSeasonNumber}이 시작되었어요.`,
      gameType: "season",
      gameName: "시즌",
      metadata: {
        previousSeasonNumber: season.season_number,
        seasonNumber: newSeasonNumber,
      },
      sourceType: "season",
      sourceId: newSeasonId,
    });

    return {
      endedSeason: season,
      newSeason,
      top3: ranked.slice(0, 3).map((user) => ({
        userId: user.id,
        nickname: user.nickname,
        rank: user.rank,
        finalTotalEvaluatedAsset: user.finalTotalEvaluatedAsset,
        startingBonusForNextSeason: user.startingBonusForNextSeason,
      })),
      userCount: ranked.length,
    };
  })();
}
