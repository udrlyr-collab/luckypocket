import { createServerNotification } from "./serverNotificationService.js";
import { ACHIEVEMENTS } from "./achievementService.js";
import { calculateLeveragedPositionOutcome } from "./leverageRiskService.js";
import { calculateUserTotalEvaluatedAsset } from "./portfolioValuationService.js";
import {
  applyLeverageSettlementTax,
  applySpotSettlementTax,
  calculateLeverageSettlement,
  calculateSpotSettlement,
} from "./stockSettlementService.js";
import { applyStockTaxLedgerImpact } from "./stockTaxLedgerService.js";

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
    const settlement = calculateSpotSettlement(database, {
      userId: holding.user_id,
      holding,
      sellQuantity: holding.quantity,
      sellPrice: holding.status === "delisted" ? 0 : holding.current_price,
    });
    const amount = settlement.finalReceiveAmount;
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
        settlement.finalProfit,
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
        settlement,
      },
    });
    applySpotSettlementTax(database, user.id, settlement);
  }
}

function settlePositions(database, season) {
  const positions = database
    .prepare(
      `SELECT p.*, s.current_price, s.status, s.delist_risk_status, s.market_cap, s.is_bluechip
       FROM stock_positions p
       JOIN stocks s ON s.id = p.stock_id
       WHERE p.status = 'open'`,
    )
    .all();

  for (const position of positions) {
    const currentPrice = position.status === "delisted" ? 0 : position.current_price;
    const outcome = calculateLeveragedPositionOutcome(position, position, currentPrice);
    const settlement = outcome.liquidated
      ? null
      : calculateLeverageSettlement(database, {
        userId: position.user_id,
        position,
        cappedPnl: outcome.cappedPnl,
      });
    const pnl = settlement ? settlement.finalProfit : -position.margin_amount;
    const payout = settlement ? settlement.finalPayout : 0;
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
        rawPnl: outcome.rawPnl,
        cappedPnl: outcome.cappedPnl,
        riskLevel: outcome.riskLevel,
        profitCapApplied: outcome.profitCapApplied,
        liquidated: outcome.liquidated,
        settlement,
      },
    });
    if (settlement) applyLeverageSettlementTax(database, user.id, settlement);
    else applyStockTaxLedgerImpact(database, user.id, -Math.floor(position.margin_amount || 0));
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
    .map((user) => {
      const valuation = calculateUserTotalEvaluatedAsset(database, user.id);
      return {
        ...user,
        valuation,
        finalBalance: Math.floor(valuation.cashBalance),
        finalGrossStockValue: Math.floor(valuation.grossStockMarketValue),
        finalEstimatedStockTax: Math.floor(valuation.estimatedStockTaxes),
        finalStockValue: Math.floor(valuation.stockNetLiquidationValue),
        finalLeverageNetValue: Math.floor(valuation.leverageNetSettlementValue),
        finalTotalEvaluatedAsset: Math.floor(valuation.totalEvaluatedAsset),
        totalGames: gameCounts.get(user.id) || 0,
      };
    })
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

    const ranked = rankSeasonUsers(database, season);

    settleHoldings(database, season);
    settlePositions(database, season);

    database.prepare("DELETE FROM stock_holdings").run();
    database.prepare("DELETE FROM stock_positions").run();
    database.prepare("DELETE FROM game_sessions").run();

    const insertResult = database.prepare(
      `INSERT OR REPLACE INTO season_results
       (season_id, season_number, user_id, username, nickname_snapshot, rank,
        final_balance, final_stock_value, final_total_evaluated_asset,
        final_cash_balance, final_gross_stock_value, final_estimated_stock_tax,
        final_stock_net_value, final_leverage_net_value,
        total_profit, total_games, starting_bonus_for_next_season)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        user.finalBalance,
        user.finalGrossStockValue,
        user.finalEstimatedStockTax,
        user.finalStockValue,
        user.finalLeverageNetValue,
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

    database.prepare("DELETE FROM lucky_seven_uses").run();
    database.prepare("DELETE FROM revival_claims").run();

    for (const user of ranked) {
      // 업적 보상 재지급 (여태 달성했던 업적들에 대한 보상 합산)
      const userAchRows = database.prepare("SELECT achievement_key FROM user_achievements WHERE user_id = ?").all(user.id);
      let extraReward = 0;
      for (const row of userAchRows) {
        const ach = ACHIEVEMENTS.find(a => a.key === row.achievement_key || row.achievement_key.startsWith(a.key + ":"));
        if (ach && ach.reward) {
          extraReward += ach.reward;
        }
      }

      const startingBalance = user.startingBonusForNextSeason + extraReward;
      const settledUser = database.prepare("SELECT balance FROM users WHERE id = ?").get(user.id);
      const balanceBeforeReset = Math.floor(Number(settledUser?.balance || 0));
      
      database
        .prepare(
          `UPDATE users
           SET balance = ?,
               initial_balance = ?,
               highest_balance = ?,
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
        amount: startingBalance - balanceBeforeReset,
        balanceBefore: balanceBeforeReset,
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
