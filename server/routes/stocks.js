import express from "express";
import { db } from "../db.js";
import { requireAuth, checkUserActionSuspended } from "../middleware/auth.js";
import { createServerNotification } from "../services/serverNotificationService.js";
import {
  ACTIVE_TRADABLE_STOCK_STATUSES,
  delistStock,
  requiredCompanyAcquisitionBalance,
  getStockMarketClock,
  settleDueIpoSubscriptions,
  STOCK_MARKET_POLICY,
  liquidatePosition,
} from "../services/stockService.js";
import {
  calculateOwnerEtfTrackingAsset,
  calculateUserTotalEvaluatedAsset,
  getPortfolioSnapshot,
} from "../services/portfolioValuationService.js";
import {
  assertCanOpenLeveragePosition,
  calculateLeveragedPositionOutcome,
  getMaxAllowedLeverage,
} from "../services/leverageRiskService.js";
import {
  assertStockMarketOpen,
  isStockMarketOpen,
} from "../services/marketStateService.js";
import { addJackpotContribution } from "../services/economyRtpService.js";
import { incrementDailyMissionProgress } from "../services/dailyMissionService.js";
import {
  STOCK_FEE_CONFIG,
  calculateFee,
  getMaxAffordableLeverageMargin,
  getMaxAffordableQuantity,
  getMaxAffordableTradeValue,
  getFeeConfig,
} from "../services/stockFeeService.js";
import {
  applyLeverageSettlementTax,
  applySpotSettlementTax,
  calculateLeverageSettlement,
  calculateSpotSettlement,
  getHoldingTotalCostBasis,
} from "../services/stockSettlementService.js";
import { formatWon } from "../utils/formatWon.js";
import { getStockListingInfo } from "../utils/stockListingFormat.js";
import {
  incrementUserStockStat,
  STOCK_STAT_TYPES,
} from "../services/stockTradeStatsService.js";
import { getMarketRegime } from "../services/marketDynamicsService.js";
import { getLatestDailyUnluckyAward } from "../services/dailyUnluckyService.js";

function assertStockTradeAllowed(stock) {
  assertStockMarketOpen(db);
  if (stock.is_trading_suspended) {
    throw new Error("해당 종목은 현재 거래가 정지되었습니다.");
  }
}

function assertCanOpenNewStockTrade(user, stock) {
  assertStockTradeAllowed(stock);
  const isOwnOwnerEtf = stock.is_etf === 1 && stock.etf_tracking_type === "owner_asset" && stock.owner_user_id === user.id;
  if (isOwnOwnerEtf) {
    throw new Error("본인이 인수한 ETF는 직접 거래할 수 없어요.");
  }
}

function mergeSpotPurchase(holding, { quantity, price, buyFee }) {
  const oldQuantity = Number(holding?.quantity || 0);
  const oldTotalCostBasis = getHoldingTotalCostBasis(holding);
  const oldBuyFees = Math.max(0, Math.floor(Number(holding?.total_buy_fees || 0)));
  const additionalCostBasis = Math.floor(Number(quantity) * Number(price)) + Math.max(0, Math.floor(Number(buyFee) || 0));
  const newQuantity = oldQuantity + Number(quantity);
  const totalCostBasis = oldTotalCostBasis + additionalCostBasis;
  return {
    oldQuantity,
    oldTotalCostBasis,
    additionalCostBasis,
    newQuantity,
    totalCostBasis,
    totalBuyFees: oldBuyFees + Math.max(0, Math.floor(Number(buyFee) || 0)),
    averagePrice: newQuantity > 0 ? totalCostBasis / newQuantity : 0,
  };
}

function normalizeBuyBudget(value, balance) {
  const requestedBudget = Math.floor(Number(value));
  if (!Number.isFinite(requestedBudget) || requestedBudget <= 0) {
    throw new Error("매수 예산을 올바르게 입력해주세요.");
  }
  return Math.min(requestedBudget, Math.max(0, Math.floor(Number(balance) || 0)));
}

function getBuyPreview({ stock, user, budgetAmount }) {
  assertCanOpenNewStockTrade(user, stock);
  const availableBudget = normalizeBuyBudget(budgetAmount, user.balance);
  const isIpo = stock.status === "ipo_subscription";
  const price = Math.floor(Number(isIpo ? stock.offering_price : stock.current_price));
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("현재 가격을 확인할 수 없어 매수할 수 없어요.");
  }

  const tradeValue = isIpo
    ? getMaxAffordableTradeValue({ availableBalance: availableBudget })
    : getMaxAffordableQuantity({
      availableBalance: availableBudget,
      currentPrice: price,
      buyFeeRate: STOCK_FEE_CONFIG.spotBuyFeeRate,
    }) * price;
  const quantity = isIpo
    ? tradeValue / price
    : Math.floor(tradeValue / price);
  const buyFee = calculateFee(tradeValue, STOCK_FEE_CONFIG.spotBuyFeeRate);
  const totalCost = tradeValue + buyFee;

  return {
    budgetAmount: availableBudget,
    quantity,
    price,
    tradeValue,
    buyFee,
    totalCost,
    remainingBalance: Math.max(0, Math.floor(user.balance) - totalCost),
    isIpo,
  };
}

function serializeOpenPosition(row) {
  const outcome = calculateLeveragedPositionOutcome(
    row,
    {
      ...row,
      status: row.stock_status || row.status,
      delist_risk_status: row.stock_delist_risk_status || row.delist_risk_status,
      current_price: row.stock_current_price || row.current_price,
      market_cap: row.stock_market_cap || row.market_cap,
      is_bluechip: row.stock_is_bluechip ?? row.is_bluechip,
    },
    row.stock_current_price || row.current_price,
  );

  return {
    ...row,
    live_unrealized_pnl: outcome.cappedPnl,
    raw_unrealized_pnl: outcome.rawPnl,
    profit_rate: outcome.profitRate,
    profit_cap_applied: outcome.profitCapApplied,
    leverage_risk_level: outcome.riskLevel,
    would_liquidate: outcome.liquidated,
  };
}

function getSerializedPortfolio(userId) {
  const valuation = getPortfolioSnapshot(db, userId);
  const holdingByStockId = new Map(valuation.holdings.map((holding) => [Number(holding.stockId), holding]));
  const positionById = new Map(valuation.positions.map((position) => [Number(position.positionId), position]));
  const holdings = db.prepare(`
    SELECT h.*, s.symbol, s.name, s.current_price, s.status, s.is_etf
    FROM stock_holdings h
    JOIN stocks s ON h.stock_id = s.id
    WHERE h.user_id = ? AND h.quantity > 0
  `).all(userId).map((holding) => {
    const estimate = holdingByStockId.get(Number(holding.stock_id));
    return {
      ...holding,
      gross_value: estimate?.grossMarketValue ?? 0,
      estimated_sell_fee: estimate?.estimatedSellFee ?? 0,
      estimated_capital_gains_tax: estimate?.estimatedCapitalGainsTax ?? 0,
      value: estimate?.netLiquidationValue ?? 0,
      unrealized_pnl: estimate?.unrealizedProfitAfterEstimatedTax ?? 0,
      unrealized_pnl_before_tax: estimate?.unrealizedProfitBeforeTax ?? 0,
    };
  });
  const positions = db.prepare(`
    SELECT p.*, s.symbol, s.name, s.current_price as stock_current_price,
           s.status as stock_status, s.delist_risk_status as stock_delist_risk_status,
           s.market_cap as stock_market_cap, s.is_bluechip as stock_is_bluechip
    FROM stock_positions p
    JOIN stocks s ON p.stock_id = s.id
    WHERE p.user_id = ? AND p.status = 'open'
  `).all(userId).map(serializeOpenPosition).map((position) => {
    const estimate = positionById.get(Number(position.id));
    return {
      ...position,
      gross_settlement_value: estimate?.grossSettlementValue ?? 0,
      estimated_close_fee: estimate?.estimatedCloseFee ?? 0,
      estimated_capital_gains_tax: estimate?.estimatedCapitalGainsTax ?? 0,
      net_settlement_value: estimate?.netSettlementValue ?? 0,
      live_unrealized_pnl: estimate?.unrealizedProfitBeforeTax ?? position.live_unrealized_pnl,
      unrealized_pnl_after_tax: estimate
        ? estimate.netSettlementValue - Number(position.margin_amount || 0)
        : position.live_unrealized_pnl,
    };
  });
  return { ...valuation, holdings, positions };
}

function parseJsonObject(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function getVolatilityBadge(stock) {
  const volatility = Number(stock?.volatility || 0);
  if (volatility < 0.012) return "안정";
  if (volatility < 0.03) return "보통";
  if (volatility < 0.06) return "변동성 큼";
  return "급등락 주의";
}

function getTodayTradeStats(stockIds) {
  const ids = [...new Set(stockIds.map((id) => Number(id)).filter(Number.isFinite))];
  if (ids.length === 0) return new Map();

  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT
         stock_id,
         COALESCE(TOTAL(ABS(CAST(quantity AS REAL))), 0) AS today_trade_volume,
         COALESCE(TOTAL(ABS(CAST(amount AS REAL))), 0) AS today_trade_value
       FROM stock_trades
       WHERE stock_id IN (${placeholders})
         AND date(created_at, '+9 hours') = date('now', '+9 hours')
       GROUP BY stock_id`,
    )
    .all(...ids);

  return new Map(
    rows.map((row) => [
      Number(row.stock_id),
      {
        todayTradeVolume: Number(row.today_trade_volume || 0),
        todayTradeValue: Math.floor(Number(row.today_trade_value || 0)),
      },
    ]),
  );
}

function getWatchedStockIds(userId) {
  if (!userId) return new Set();
  const rows = db
    .prepare("SELECT stock_id FROM stock_watchlists WHERE user_id = ?")
    .all(userId);
  return new Set(rows.map((row) => Number(row.stock_id)));
}

function serializeStock(s, { now = new Date(), tradeStatsByStockId = new Map(), watchedStockIds = new Set() } = {}) {
  const tradeStats = tradeStatsByStockId.get(Number(s.id)) || {
    todayTradeVolume: 0,
    todayTradeValue: 0,
  };

  return {
    ...s,
    ...getStockListingInfo(s, now),
    sector: s.sector || "소비재",
    currentPrice: s.current_price,
    previousPrice: s.previous_price,
    offeringPrice: s.offering_price,
    ipoSubscriptionStartedAt: s.ipo_subscription_started_at,
    ipoSubscriptionEndsAt: s.ipo_subscription_ends_at,
    recoveryTickCount: Number(s.recovery_tick_count || 0),
    recoveryRequiredTicks: Number(s.recovery_required_ticks || STOCK_MARKET_POLICY.recoveryRequiredTicks),
    recoveryElapsedSeconds: Number(s.recovery_tick_count || 0) * STOCK_MARKET_POLICY.stockTickIntervalSeconds,
    recoveryRequiredSeconds: Number(s.recovery_required_ticks || STOCK_MARKET_POLICY.recoveryRequiredTicks) * STOCK_MARKET_POLICY.stockTickIntervalSeconds,
    priceChangeAmount: s.current_price - s.previous_price,
    priceChangeRate: s.previous_price > 0 ? (s.current_price - s.previous_price) / s.previous_price : 0,
    offeringChangeAmount: s.offering_price ? s.current_price - s.offering_price : null,
    offeringChangeRate: s.offering_price ? (s.current_price - s.offering_price) / s.offering_price : null,
    is_bluechip: s.is_bluechip,
    isBlueChip: s.is_bluechip === 1,
    blueChipRampActive: s.blue_chip_ramp_active === 1,
    blueChipTargetPrice: s.blue_chip_target_price,
    blueChipRampPercentPerTick: s.blue_chip_ramp_percent_per_tick,
    blueChipRampStartedAt: s.blue_chip_ramp_started_at,
    blueChipRampEndedAt: s.blue_chip_ramp_ended_at,
    blueChipRampReason: s.blue_chip_ramp_reason,
    blueChipRampStartedByUserId: s.blue_chip_ramp_started_by_user_id,
    adminPriceTargetActive: s.admin_price_target_active === 1,
    adminPriceTarget: s.admin_price_target,
    adminPriceTargetDirection: s.admin_price_target_direction,
    adminPriceTargetPercentPerTick: s.admin_price_target_percent_per_tick,
    adminPriceTargetStartedAt: s.admin_price_target_started_at,
    adminPriceTargetEndedAt: s.admin_price_target_ended_at,
    adminPriceTargetReason: s.admin_price_target_reason,
    adminPriceTargetStartedByUserId: s.admin_price_target_started_by_user_id,
    volatilityBadge: getVolatilityBadge(s),
    todayTradeVolume: tradeStats.todayTradeVolume,
    todayTradeValue: tradeStats.todayTradeValue,
    isWatched: watchedStockIds.has(Number(s.id)),
    trendRegime: s.trend_regime || null,
    trendRegimeStartedAt: s.trend_regime_started_at || null,
    trendRegimeEndsAt: s.trend_regime_ends_at || null,
    trendMarketCapBasis: Number(s.trend_market_cap_basis || s.market_cap || 0),
    trendDriftPerTick: Number(s.trend_drift_per_tick || 0),
    trendVolatility: Number(s.trend_volatility || s.volatility || 0),
    marketCapEma24h: Number(s.market_cap_ema_24h || s.market_cap || 0),
    tradingHaltedUntil: s.trading_halted_until || null,
  };
}

export const stocksRouter = express.Router();

stocksRouter.get("/", (req, res) => {
  settleDueIpoSubscriptions(db);
  const clock = getStockMarketClock();
  const stocksRaw = db.prepare(`
    SELECT * FROM stocks 
    WHERE status != 'delisted'
    ORDER BY market_cap DESC
  `).all();
  
  const recentDelisted = db.prepare(`
    SELECT * FROM stocks
    WHERE status = 'delisted'
    ORDER BY delisted_at DESC LIMIT 5
  `).all();

  const now = new Date();
  const tradeStatsByStockId = getTodayTradeStats([
    ...stocksRaw.map((stock) => stock.id),
    ...recentDelisted.map((stock) => stock.id),
  ]);
  const stocks = stocksRaw.map((stock) => serializeStock(stock, { now, tradeStatsByStockId }));
  const recentDelistedStocks = recentDelisted.map((stock) => serializeStock(stock, { now, tradeStatsByStockId }));

  const activeTradableStocks = stocks.filter(
    (s) =>
      ACTIVE_TRADABLE_STOCK_STATUSES.includes(s.status) &&
      (s.delist_risk_status || "normal") !== "final_crash",
  );
  const ipoStocks = stocks.filter((s) => s.status === "ipo_subscription");
  const summary = {
    total: stocks.length,
    activeTradableStockCount: activeTradableStocks.length,
    targetActiveTradableStockCount:
      STOCK_MARKET_POLICY.targetActiveTradableStockCount,
    ipoCount: ipoStocks.length,
    recentDelistedCount: recentDelistedStocks.length,
    cautionCount: stocks.filter((s) => s.delist_risk_status === "caution").length,
    distressReviewCount: stocks.filter((s) => s.delist_risk_status === "distress_review").length,
    delistReviewCount: stocks.filter((s) => s.delist_risk_status === "delist_review").length,
    recoveryCount: stocks.filter((s) => s.delist_risk_status === "recovery").length,
    up: stocks.filter(s => s.priceChangeAmount > 0).length,
    down: stocks.filter(s => s.priceChangeAmount < 0).length,
    ipo: ipoStocks.length,
    delisted: db.prepare("SELECT COUNT(*) as c FROM stocks WHERE status = 'delisted'").get().c
  };

  res.json({
    stocks,
    recentDelistedStocks,
    summary,
    marketOpen: isStockMarketOpen(db),
    ...clock,
  });
});

stocksRouter.get("/news", (req, res) => {
  const news = db.prepare(`
    SELECT * FROM (
      SELECT id, event_type, title, message, created_at
      FROM stock_events
      UNION ALL
      SELECT id, type as event_type, title, message, created_at
      FROM server_notifications
      WHERE user_id IS NULL
    )
    ORDER BY created_at DESC LIMIT 20
  `).all();
  res.json({ news });
});

stocksRouter.get("/market-movers", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT
         s.id,
         s.name,
         s.symbol,
         s.sector,
         s.status,
         s.current_price,
         COALESCE(
           (
             SELECT h.price
             FROM stock_price_history h
             WHERE h.stock_id = s.id
               AND date(h.created_at, '+9 hours') = date('now', '+9 hours')
             ORDER BY h.created_at ASC
             LIMIT 1
           ),
           s.previous_price,
           s.initial_price,
           s.current_price
         ) AS open_price
       FROM stocks s
       WHERE s.status NOT IN ('delisted', 'ipo_subscription')`,
    )
    .all()
    .map((row) => {
      const openPrice = Math.max(1, Number(row.open_price || row.current_price || 1));
      const currentPrice = Math.max(1, Number(row.current_price || 1));
      const changeAmount = currentPrice - openPrice;
      return {
        stockId: row.id,
        name: row.name,
        symbol: row.symbol,
        sector: row.sector,
        status: row.status,
        openPrice,
        currentPrice,
        changeAmount,
        changeRate: changeAmount / openPrice,
      };
    });

  const gainers = [...rows]
    .filter((row) => row.changeAmount > 0)
    .sort((a, b) => b.changeRate - a.changeRate)
    .slice(0, 5);
  const losers = [...rows]
    .filter((row) => row.changeAmount < 0)
    .sort((a, b) => a.changeRate - b.changeRate)
    .slice(0, 5);

  res.json({ gainers, losers });
});

stocksRouter.get("/trade-volume-rankings", (_req, res) => {
  const rankings = db
    .prepare(
      `SELECT
         s.id AS stockId,
         s.name,
         s.symbol,
         s.sector,
         s.current_price AS currentPrice,
         COALESCE(TOTAL(ABS(CAST(t.quantity AS REAL))), 0) AS todayTradeVolume,
         COALESCE(TOTAL(ABS(CAST(t.amount AS REAL))), 0) AS todayTradeValue
       FROM stock_trades t
       JOIN stocks s ON s.id = t.stock_id
       WHERE date(t.created_at, '+9 hours') = date('now', '+9 hours')
         AND s.status != 'delisted'
       GROUP BY s.id
       ORDER BY todayTradeVolume DESC, todayTradeValue DESC
       LIMIT 5`,
    )
    .all()
    .map((row) => ({
      ...row,
      todayTradeVolume: Number(row.todayTradeVolume || 0),
      todayTradeValue: Math.floor(Number(row.todayTradeValue || 0)),
    }));

  res.json({ rankings });
});

stocksRouter.get("/sector-events", (_req, res) => {
  const events = db
    .prepare(
      `SELECT id, sector, sentiment, title, content, effect_until AS effectUntil, created_at AS createdAt
       FROM sector_events
       WHERE effect_until > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       ORDER BY created_at DESC
       LIMIT 10`,
    )
    .all();
  res.json({ events });
});

stocksRouter.get("/market-overview", (_req, res) => {
  const regime = getMarketRegime(db);
  const leadingSectors = db.prepare(`
    SELECT id, sector, sentiment, title, content, effect_until AS effectUntil, created_at AS createdAt
    FROM sector_events
    WHERE effect_until > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ORDER BY created_at DESC
    LIMIT 6
  `).all();
  const unluckyAward = getLatestDailyUnluckyAward(db);
  res.json({
    marketRegime: regime ? {
      id: regime.id,
      key: regime.market_regime,
      strength: Number(regime.strength || 0),
      startedAt: regime.started_at,
      endsAt: regime.ends_at,
    } : null,
    sectorRotation: leadingSectors,
    dailyUnluckyAward: unluckyAward ? {
      dateKey: unluckyAward.date_key,
      nickname: unluckyAward.nickname_snapshot,
      lossRate: Number(unluckyAward.loss_rate || 0),
      awardedLuckTickets: Number(unluckyAward.awarded_luck_tickets || 0),
    } : null,
  });
});

stocksRouter.get("/fees/config", (_req, res) => {
  res.json(getFeeConfig());
});

stocksRouter.use(requireAuth);

stocksRouter.get("/portfolio", (req, res) => {
  res.json(getSerializedPortfolio(req.user.id));
});

stocksRouter.get("/market-snapshot", (req, res) => {
  const userId = req.user.id;
  settleDueIpoSubscriptions(db);
  const clock = getStockMarketClock();

  // 폴링 시 실시간으로 ETF 가격 최신화

  const stocksRaw = db.prepare(`
    SELECT * FROM stocks 
    WHERE status != 'delisted'
    ORDER BY market_cap DESC
  `).all();

  const portfolio = getSerializedPortfolio(userId);

  const now = new Date();
  const tradeStatsByStockId = getTodayTradeStats(stocksRaw.map((stock) => stock.id));
  const watchedStockIds = getWatchedStockIds(userId);
  const stocks = stocksRaw.map((stock) => serializeStock(stock, { now, tradeStatsByStockId, watchedStockIds }));
  const activeTradableStocks = stocks.filter(
    (s) =>
      ACTIVE_TRADABLE_STOCK_STATUSES.includes(s.status) &&
      (s.delist_risk_status || "normal") !== "final_crash",
  );
  const summary = {
    total: stocks.length,
    activeTradableStockCount: activeTradableStocks.length,
    targetActiveTradableStockCount:
      STOCK_MARKET_POLICY.targetActiveTradableStockCount,
    ipoCount: stocks.filter((s) => s.status === "ipo_subscription").length,
    recentDelistedCount: db
      .prepare("SELECT COUNT(*) AS count FROM stocks WHERE status = 'delisted'")
      .get().count,
    up: stocks.filter((s) => s.priceChangeAmount > 0).length,
    down: stocks.filter((s) => s.priceChangeAmount < 0).length,
  };

  res.json({
    ...clock,
    marketOpen: isStockMarketOpen(db),
    stocks,
    summary,
    portfolio,
  });
});

stocksRouter.get("/watchlist", (req, res) => {
  const rows = db
    .prepare(
      `SELECT w.stock_id AS stockId, w.created_at AS createdAt
       FROM stock_watchlists w
       JOIN stocks s ON s.id = w.stock_id
       WHERE w.user_id = ?
       ORDER BY w.created_at DESC`,
    )
    .all(req.user.id);
  res.json({ watchlist: rows });
});

stocksRouter.post("/:id/watch", (req, res) => {
  const stockId = Number(req.params.id);
  if (!Number.isSafeInteger(stockId)) {
    return res.status(400).json({ message: "올바른 종목 ID가 아닙니다." });
  }

  const stock = db.prepare("SELECT id FROM stocks WHERE id = ?").get(stockId);
  if (!stock) {
    return res.status(404).json({ message: "종목을 찾을 수 없습니다." });
  }

  db.prepare(
    `INSERT OR IGNORE INTO stock_watchlists (user_id, stock_id)
     VALUES (?, ?)`,
  ).run(req.user.id, stockId);

  res.json({ message: "관심종목에 추가되었습니다.", isWatched: true });
});

stocksRouter.delete("/:id/watch", (req, res) => {
  const stockId = Number(req.params.id);
  if (!Number.isSafeInteger(stockId)) {
    return res.status(400).json({ message: "올바른 종목 ID가 아닙니다." });
  }

  db.prepare(
    "DELETE FROM stock_watchlists WHERE user_id = ? AND stock_id = ?",
  ).run(req.user.id, stockId);

  res.json({ message: "관심종목에서 제거되었습니다.", isWatched: false });
});

stocksRouter.get("/price-alerts", (req, res) => {
  const alerts = db
    .prepare(
      `SELECT
         a.id,
         a.stock_id AS stockId,
         s.name AS stockName,
         s.symbol,
         s.current_price AS currentPrice,
         a.target_price AS targetPrice,
         a.direction,
         a.triggered_at AS triggeredAt,
         a.created_at AS createdAt
       FROM stock_price_alerts a
       JOIN stocks s ON s.id = a.stock_id
       WHERE a.user_id = ?
       ORDER BY a.triggered_at IS NOT NULL ASC, a.created_at DESC`,
    )
    .all(req.user.id);

  res.json({ alerts });
});

stocksRouter.post("/:id/watchlist", (req, res) => {
  const stockId = Number(req.params.id);
  if (!Number.isSafeInteger(stockId)) {
    return res.status(400).json({ message: "올바른 종목 ID가 아닙니다." });
  }

  const stock = db.prepare("SELECT id FROM stocks WHERE id = ?").get(stockId);
  if (!stock) {
    return res.status(404).json({ message: "종목을 찾을 수 없습니다." });
  }

  db.prepare(
    `INSERT OR IGNORE INTO stock_watchlists (user_id, stock_id)
     VALUES (?, ?)`,
  ).run(req.user.id, stockId);

  res.json({ message: "관심종목에 추가했습니다.", isWatched: true });
});

stocksRouter.delete("/:id/watchlist", (req, res) => {
  const stockId = Number(req.params.id);
  if (!Number.isSafeInteger(stockId)) {
    return res.status(400).json({ message: "올바른 종목 ID가 아닙니다." });
  }

  db.prepare(
    "DELETE FROM stock_watchlists WHERE user_id = ? AND stock_id = ?",
  ).run(req.user.id, stockId);

  res.json({ message: "관심종목에서 해제했습니다.", isWatched: false });
});

stocksRouter.get("/:id/alerts", (req, res) => {
  const stockId = Number(req.params.id);
  if (!Number.isSafeInteger(stockId)) {
    return res.status(400).json({ message: "올바른 종목 ID가 아닙니다." });
  }

  const alerts = db
    .prepare(
      `SELECT id, target_price AS targetPrice, direction, triggered_at AS triggeredAt, created_at AS createdAt
       FROM stock_price_alerts
       WHERE user_id = ? AND stock_id = ?
       ORDER BY triggered_at IS NOT NULL ASC, created_at DESC`,
    )
    .all(req.user.id, stockId);

  res.json({ alerts });
});

stocksRouter.post("/:id/alerts", (req, res) => {
  const stockId = Number(req.params.id);
  const targetPrice = Math.floor(Number(req.body?.targetPrice));
  const direction = String(req.body?.direction || "").trim();

  if (!Number.isSafeInteger(stockId)) {
    return res.status(400).json({ message: "올바른 종목 ID가 아닙니다." });
  }
  if (!Number.isSafeInteger(targetPrice) || targetPrice <= 0) {
    return res.status(400).json({ message: "목표 가격을 1원 이상으로 입력해주세요." });
  }
  if (!["above", "below"].includes(direction)) {
    return res.status(400).json({ message: "알림 방향은 above 또는 below만 가능합니다." });
  }

  const stock = db.prepare("SELECT id FROM stocks WHERE id = ?").get(stockId);
  if (!stock) {
    return res.status(404).json({ message: "종목을 찾을 수 없습니다." });
  }

  const info = db
    .prepare(
      `INSERT INTO stock_price_alerts (user_id, stock_id, target_price, direction)
       VALUES (?, ?, ?, ?)`,
    )
    .run(req.user.id, stockId, targetPrice, direction);

  res.json({
    message: "가격 알림을 추가했습니다.",
    alert: {
      id: info.lastInsertRowid,
      targetPrice,
      direction,
      triggeredAt: null,
    },
  });
});

stocksRouter.post("/:id/price-alerts", (req, res) => {
  const stockId = Number(req.params.id);
  const targetPrice = Math.floor(Number(req.body?.targetPrice));
  const direction = String(req.body?.direction || "").trim();

  if (!Number.isSafeInteger(stockId)) {
    return res.status(400).json({ message: "올바른 종목 ID가 아닙니다." });
  }
  if (!Number.isSafeInteger(targetPrice) || targetPrice <= 0) {
    return res.status(400).json({ message: "목표 가격을 1원 이상으로 입력해주세요." });
  }
  if (!["above", "below"].includes(direction)) {
    return res.status(400).json({ message: "알림 방향은 above 또는 below만 가능합니다." });
  }

  const stock = db.prepare("SELECT id FROM stocks WHERE id = ?").get(stockId);
  if (!stock) {
    return res.status(404).json({ message: "종목을 찾을 수 없습니다." });
  }

  const info = db
    .prepare(
      `INSERT INTO stock_price_alerts (user_id, stock_id, target_price, direction)
       VALUES (?, ?, ?, ?)`,
    )
    .run(req.user.id, stockId, targetPrice, direction);

  res.json({
    message: "가격 알림을 추가했습니다.",
    alert: {
      id: info.lastInsertRowid,
      stockId,
      targetPrice,
      direction,
      triggeredAt: null,
    },
  });
});

stocksRouter.delete("/alerts/:alertId", (req, res) => {
  const alertId = Number(req.params.alertId);
  if (!Number.isSafeInteger(alertId)) {
    return res.status(400).json({ message: "올바른 알림 ID가 아닙니다." });
  }

  const result = db
    .prepare("DELETE FROM stock_price_alerts WHERE id = ? AND user_id = ?")
    .run(alertId, req.user.id);

  if (result.changes === 0) {
    return res.status(404).json({ message: "가격 알림을 찾을 수 없습니다." });
  }

  res.json({ message: "가격 알림을 삭제했습니다." });
});

stocksRouter.delete("/price-alerts/:alertId", (req, res) => {
  const alertId = Number(req.params.alertId);
  if (!Number.isSafeInteger(alertId)) {
    return res.status(400).json({ message: "올바른 알림 ID가 아닙니다." });
  }

  const result = db
    .prepare("DELETE FROM stock_price_alerts WHERE id = ? AND user_id = ?")
    .run(alertId, req.user.id);

  if (result.changes === 0) {
    return res.status(404).json({ message: "가격 알림을 찾을 수 없습니다." });
  }

  res.json({ message: "가격 알림을 삭제했습니다." });
});

function topLimit(value) {
  const limit = Number(value || 5);
  if (!Number.isSafeInteger(limit)) return 5;
  return Math.min(20, Math.max(1, limit));
}

function getCompanyAcquisitionInfo(user, stock) {
  const acquisitionPrice = Math.max(0, Math.floor(Number(stock?.market_cap || 0)));
  const requiredTotalAsset = requiredCompanyAcquisitionBalance(acquisitionPrice);
  const valuation = user
    ? calculateUserTotalEvaluatedAsset(db, user.id)
    : { totalEvaluatedAsset: 0, valuationComplete: false, valuationErrors: [] };
  const userTotalEvaluatedAsset = Math.floor(
    Number(valuation.totalEvaluatedAsset || 0),
  );
  const userCashBalance = Math.floor(Number(user?.balance || 0));
  const hasOwnHolding = Boolean(user && stock && db
    .prepare("SELECT 1 FROM stock_holdings WHERE user_id = ? AND stock_id = ? AND quantity > 0")
    .get(user.id, stock.id));
  const hasOwnPosition = Boolean(user && stock && db
    .prepare("SELECT 1 FROM stock_positions WHERE user_id = ? AND stock_id = ? AND status = 'open'")
    .get(user.id, stock.id));
  const existingEtf = user
    ? db
        .prepare(
          "SELECT id FROM stocks WHERE owner_user_id = ? AND is_etf = 1 AND status = 'acquired'",
        )
        .get(user.id)
    : null;

  let canAcquire = true;
  let reason = "ok";
  if (!stock || stock.status === "delisted") {
    canAcquire = false;
    reason = "not_tradable";
  } else if (stock.is_bluechip === 1) {
    canAcquire = false;
    reason = "bluechip";
  } else if (stock.is_etf === 1 || stock.status === "acquired") {
    canAcquire = false;
    reason = "already_acquired";
  } else if (existingEtf) {
    canAcquire = false;
    reason = "already_owns_company";
  } else if (valuation.valuationComplete === false) {
    canAcquire = false;
    reason = "valuation_incomplete";
  } else if (userTotalEvaluatedAsset < requiredTotalAsset) {
    canAcquire = false;
    reason = "total_asset_required";
  } else if (hasOwnHolding || hasOwnPosition) {
    canAcquire = false;
    reason = "own_exposure_must_close";
  } else if (userCashBalance < acquisitionPrice) {
    canAcquire = false;
    reason = "cash_required";
  }

  return {
    canAcquire,
    reason,
    acquisitionPrice,
    requiredTotalAsset,
    userTotalEvaluatedAsset,
    userCashBalance,
    autoSellValue: 0,
    autoCloseValue: 0,
    estimatedCashAfterAutoClear: userCashBalance,
    hasOwnHolding,
    hasOwnPosition,
    meetsAssetRequirement: userTotalEvaluatedAsset >= requiredTotalAsset,
    hasEnoughCash: userCashBalance >= acquisitionPrice,
    valuationComplete: valuation.valuationComplete !== false,
    valuationErrors: valuation.valuationErrors || [],
    balanceMultiplier: STOCK_MARKET_POLICY.companyAcquisitionBalanceMultiplier,
    cost: acquisitionPrice,
    requiredBalance: requiredTotalAsset,
  };
}

stocksRouter.get("/:stockId/top-holders", (req, res) => {
  const stockId = Number(req.params.stockId);
  const limit = topLimit(req.query.limit);
  const stock = db
    .prepare("SELECT id, name, current_price FROM stocks WHERE id = ?")
    .get(stockId);
  if (!stock) {
    return res.status(404).json({ message: "종목을 찾을 수 없어요." });
  }

  const rows = db
    .prepare(
      `SELECT
         h.user_id,
         u.nickname,
         h.quantity,
         h.average_price,
         s.current_price,
         h.quantity * s.current_price AS holding_value,
         h.quantity * h.average_price AS cost_basis
       FROM stock_holdings h
       JOIN users u ON u.id = h.user_id
       JOIN stocks s ON s.id = h.stock_id
       WHERE h.stock_id = ?
         AND h.quantity > 0
       ORDER BY holding_value DESC, h.user_id ASC
       LIMIT ?`,
    )
    .all(stockId, limit);

  const holders = rows.map((row, index) => {
    const holdingValue = Math.floor(Number(row.holding_value) || 0);
    const costBasis = Math.floor(Number(row.cost_basis) || 0);
    const profit = holdingValue - costBasis;
    return {
      rank: index + 1,
      userId: row.user_id,
      nickname: row.nickname,
      quantity: row.quantity,
      averagePrice: row.average_price,
      currentPrice: row.current_price,
      holdingValue,
      costBasis,
      profit,
      profitRate: costBasis > 0 ? profit / costBasis : 0,
    };
  });

  return res.json({
    stockId: stock.id,
    stockName: stock.name,
    holders,
  });
});

stocksRouter.get("/:stockId/top-positions", (req, res) => {
  const stockId = Number(req.params.stockId);
  const limit = topLimit(req.query.limit);
  const stock = db
    .prepare("SELECT id, name, current_price FROM stocks WHERE id = ?")
    .get(stockId);
  if (!stock) {
    return res.status(404).json({ message: "종목을 찾을 수 없어요." });
  }

  const rows = db
    .prepare(
      `SELECT
         p.user_id,
         u.nickname,
         p.side,
         p.leverage,
         p.margin_amount,
         p.position_size,
         p.quantity,
         p.entry_price,
         s.current_price,
         s.status,
         s.delist_risk_status,
         s.market_cap,
         s.is_bluechip,
         p.liquidation_price
       FROM stock_positions p
       JOIN users u ON u.id = p.user_id
       JOIN stocks s ON s.id = p.stock_id
       WHERE p.stock_id = ?
         AND p.status = 'open'
       ORDER BY p.position_size DESC, p.id ASC
       LIMIT ?`,
    )
    .all(stockId, limit);

  const positions = rows.map((row, index) => {
    const outcome = calculateLeveragedPositionOutcome(row, row, row.current_price);
    return {
      rank: index + 1,
      userId: row.user_id,
      nickname: row.nickname,
      side: row.side === "short" ? "short" : "long",
      leverage: row.leverage,
      marginAmount: row.margin_amount,
      positionSize: row.position_size,
      quantity: row.quantity,
      entryPrice: row.entry_price,
      currentPrice: row.current_price,
      liquidationPrice: row.liquidation_price,
      unrealizedPnl: outcome.cappedPnl,
      rawUnrealizedPnl: outcome.rawPnl,
      profitRate: outcome.profitRate,
      profitCapApplied: outcome.profitCapApplied,
      riskLevel: outcome.riskLevel,
    };
  });

  return res.json({
    stockId: stock.id,
    stockName: stock.name,
    positions,
  });
});

stocksRouter.get("/:id", (req, res) => {
  settleDueIpoSubscriptions(db);
  const clock = getStockMarketClock();
  const { id } = req.params;
  const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(id);
  if (!stock) return res.status(404).json({ message: "종목을 찾을 수 없어요." });

  const stockWithCalculations = serializeStock(stock, {
    now: new Date(),
    tradeStatsByStockId: getTodayTradeStats([stock.id]),
    watchedStockIds: getWatchedStockIds(req.user.id),
  });

  const history = db.prepare(`
    SELECT * FROM stock_price_history 
    WHERE stock_id = ? 
    ORDER BY created_at DESC LIMIT 60
  `).all(id).reverse(); // Last 10 minutes (60 ticks)

  const holding = db.prepare("SELECT * FROM stock_holdings WHERE user_id = ? AND stock_id = ?").get(req.user.id, id);
  const positions = db.prepare(`
    SELECT p.*, s.current_price as stock_current_price,
           s.status as stock_status, s.delist_risk_status as stock_delist_risk_status,
           s.market_cap as stock_market_cap, s.is_bluechip as stock_is_bluechip
    FROM stock_positions p
    JOIN stocks s ON p.stock_id = s.id
    WHERE p.user_id = ? AND p.stock_id = ? AND p.status = 'open'
  `).all(req.user.id, id).map(serializeOpenPosition);
  const priceAlerts = db.prepare(`
    SELECT id, target_price AS targetPrice, direction, triggered_at AS triggeredAt, created_at AS createdAt
    FROM stock_price_alerts
    WHERE user_id = ? AND stock_id = ?
    ORDER BY triggered_at IS NOT NULL ASC, created_at DESC
  `).all(req.user.id, id);
  const trades = db
    .prepare(
      `SELECT *
       FROM stock_trades
       WHERE user_id = ?
         AND stock_id = ?
       ORDER BY created_at DESC
       LIMIT 30`,
    )
    .all(req.user.id, id)
    .map((trade) => {
      const realizedPnl = Math.floor(Number(trade.realized_pnl || 0));
      const costBasis = Math.max(1, Number(trade.amount || 0) - realizedPnl);
      return {
        id: trade.id,
        tradeType: trade.trade_type,
        amount: trade.amount,
        quantity: trade.quantity,
        price: trade.price,
        leverage: trade.leverage,
        realizedPnl,
        profitRate: realizedPnl === 0 ? null : realizedPnl / costBasis,
        balanceBefore: trade.balance_before,
        balanceAfter: trade.balance_after,
        detail: parseJsonObject(trade.detail_json),
        createdAt: trade.created_at,
      };
    });
  const currentUser = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const acquisition = getCompanyAcquisitionInfo(currentUser, stock);
  let hostileTakeover = null;
  if (
    stock.status === "acquired" &&
    stock.is_etf === 1 &&
    stock.owner_user_id &&
    stock.owner_user_id !== req.user.id
  ) {
    const cost = Math.max(1, Math.floor(Number(stock.market_cap || 0)));
    const requiredTotalAsset = requiredCompanyAcquisitionBalance(cost);
    const attackerValuation = calculateUserTotalEvaluatedAsset(db, req.user.id);
    hostileTakeover = {
      targetMarketCap: cost,
      targetPrice: Number(stock.current_price || 0),
      targetTotalShares: Number(stock.total_shares || 0),
      targetOwnerUserId: Number(stock.owner_user_id),
      acquisitionCost: cost,
      cost,
      requiredBalance: requiredTotalAsset,
      requiredTotalAsset,
      userTotalEvaluatedAsset: attackerValuation.totalEvaluatedAsset,
      userCashBalance: currentUser.balance,
      valuationComplete: attackerValuation.valuationComplete !== false,
      valuationErrors: attackerValuation.valuationErrors || [],
      meetsAssetRequirement:
        attackerValuation.valuationComplete !== false &&
        attackerValuation.totalEvaluatedAsset >= requiredTotalAsset,
      hasEnoughCash: currentUser.balance >= cost,
      balanceMultiplier: STOCK_MARKET_POLICY.companyAcquisitionBalanceMultiplier,
    };
  }

  const events = db.prepare(`
    SELECT * FROM stock_events 
    WHERE stock_id = ? 
    ORDER BY created_at DESC LIMIT 20
  `).all(id);
  const corporateEvents = db.prepare(`
    SELECT id, event_type AS eventType, status, expected_revenue AS expectedRevenue,
           actual_revenue AS actualRevenue, expected_profit AS expectedProfit,
           actual_profit AS actualProfit, surprise_rate AS surpriseRate,
           dividend_rate AS dividendRate, record_at AS recordAt, pay_at AS payAt,
           starts_at AS startsAt, ends_at AS endsAt, metadata_json AS metadata
    FROM stock_corporate_events
    WHERE stock_id = ?
    ORDER BY created_at DESC
    LIMIT 12
  `).all(id).map((event) => ({ ...event, metadata: parseJsonObject(event.metadata) }));
  const shortValue = Number(db.prepare(`
    SELECT COALESCE(SUM(position_size), 0) AS value
    FROM stock_positions WHERE stock_id = ? AND side = 'short' AND status = 'open'
  `).get(id)?.value || 0);
  const shortInterestRatio = shortValue / Math.max(1, Number(stock.market_cap || 1));
  const hostileTakeoverEvent = db.prepare(`
    SELECT h.id, h.status, h.attack_cash AS attackCash, h.defense_cash AS defenseCash,
           h.target_market_cap_snapshot AS targetMarketCap,
           h.target_price_snapshot AS targetPrice,
           h.target_total_shares_snapshot AS targetTotalShares,
           h.acquisition_cost_snapshot AS acquisitionCost,
           h.attacker_total_evaluated_asset_snapshot AS attackerTotalEvaluatedAsset,
           h.attacker_cash_snapshot AS attackerCash,
           h.attack_strength AS attackStrength, h.defense_strength AS defenseStrength,
           h.ends_at AS endsAt, attacker.nickname AS attackerNickname, defender.nickname AS defenderNickname
    FROM hostile_takeover_events h
    JOIN users attacker ON attacker.id = h.attacker_user_id
    JOIN users defender ON defender.id = h.defender_user_id
    WHERE h.stock_id = ? AND h.status IN ('declared', 'defended')
    ORDER BY h.id DESC LIMIT 1
  `).get(id) || null;

  res.json({
    stock: stockWithCalculations,
    history,
    holding,
    positions,
    trades,
    events,
    corporateEvents,
    shortInterestRatio,
    priceAlerts,
    marketOpen: isStockMarketOpen(db),
    ...clock,
    acquisition,
    hostileTakeover,
    hostileTakeoverEvent,
  });
});

stocksRouter.post("/:stockId/buy-preview", (req, res) => {
  const stockId = Number(req.params.stockId);
  try {
    settleDueIpoSubscriptions(db);
    const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
    if (!stock || stock.status === "delisted") throw new Error("거래할 수 없는 종목입니다.");
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    const preview = getBuyPreview({ stock, user, budgetAmount: req.body?.budgetAmount });
    if (preview.quantity <= 0) {
      throw new Error("현재 잔액으로는 수수료를 포함해 1주도 매수할 수 없어요.");
    }
    return res.json(preview);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

stocksRouter.post("/:stockId/sell-preview", (req, res) => {
  const stockId = Number(req.params.stockId);
  const fraction = Number(req.body?.fraction ?? 1);
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    return res.status(400).json({ message: "매도 비율이 올바르지 않아요." });
  }

  try {
    const holding = db.prepare("SELECT * FROM stock_holdings WHERE user_id = ? AND stock_id = ?").get(req.user.id, stockId);
    const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
    if (!holding || holding.quantity <= 0) throw new Error("보유 중인 주식이 없어요.");
    if (!stock || stock.status === "delisted") throw new Error("거래할 수 없는 종목입니다.");
    assertStockTradeAllowed(stock);
    return res.json(calculateSpotSettlement(db, {
      userId: req.user.id,
      holding,
      sellQuantity: holding.quantity * fraction,
      sellPrice: stock.current_price,
    }));
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

stocksRouter.post("/buy", checkUserActionSuspended, (req, res) => {
  const { stockId, quantity: requestedQuantity, budgetAmount } = req.body;
  const userId = req.user.id;

  let result;
  try {
    result = db.transaction(() => {
      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
      if (!stock || stock.status === 'delisted') throw new Error("거래할 수 없는 종목입니다.");
      
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      assertCanOpenNewStockTrade(user, stock);

      const quantity = budgetAmount !== undefined && budgetAmount !== null
        ? getBuyPreview({ stock, user, budgetAmount }).quantity
        : Math.floor(Number(requestedQuantity));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("현재 잔액으로는 수수료를 포함해 1주도 매수할 수 없어요.");
      }
      const amount = Math.floor(quantity * stock.current_price);
      const buyFee = calculateFee(amount, STOCK_FEE_CONFIG.spotBuyFeeRate);
      const totalCost = amount + buyFee;
      if (amount <= 0) throw new Error("매수 금액이 너무 작습니다.");

      if (user.balance < totalCost) throw new Error("매수 금액과 수수료를 합친 금액보다 보유 잔액이 부족해요.");
      
      let holding = db.prepare("SELECT * FROM stock_holdings WHERE user_id = ? AND stock_id = ?").get(userId, stockId);
      const holdingBefore = holding
        ? {
          quantity: holding.quantity,
          averagePrice: holding.average_price,
          totalCostBasis: getHoldingTotalCostBasis(holding),
        }
        : { quantity: 0, averagePrice: 0, totalCostBasis: 0 };
      const mergedHolding = mergeSpotPurchase(holding, {
        quantity,
        price: stock.current_price,
        buyFee,
      });
      const buyDetail = {
        tradeValue: amount,
        buyFee,
        totalCost,
        oldQuantity: holdingBefore.quantity,
        buyQuantity: quantity,
        newQuantity: mergedHolding.newQuantity,
        oldAveragePrice: holdingBefore.averagePrice,
        buyPrice: stock.current_price,
        newAveragePrice: mergedHolding.averagePrice,
        oldTotalCostBasis: holdingBefore.totalCostBasis,
        addedCostBasis: mergedHolding.additionalCostBasis,
        newTotalCostBasis: mergedHolding.totalCostBasis,
      };
      if (holding) {
        db.prepare(`
          UPDATE stock_holdings
          SET quantity = ?, average_price = ?, total_cost_basis = ?, total_buy_fees = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?
        `).run(mergedHolding.newQuantity, mergedHolding.averagePrice, mergedHolding.totalCostBasis, mergedHolding.totalBuyFees, holding.id);
      } else {
        db.prepare(`
          INSERT INTO stock_holdings (user_id, stock_id, quantity, average_price, total_cost_basis, total_buy_fees)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, stockId, mergedHolding.newQuantity, mergedHolding.averagePrice, mergedHolding.totalCostBasis, mergedHolding.totalBuyFees);
      }

      const balanceAfter = user.balance - totalCost;
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, userId);

      db.prepare(`
        INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id, detail_json)
        VALUES (?, 'stock_buy', ?, ?, ?, ?, ?)
      `).run(userId, -totalCost, user.balance, balanceAfter, stockId, JSON.stringify(buyDetail));

      const trade = db.prepare(`
        INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, balance_before, balance_after, detail_json)
        VALUES (?, ?, 'buy', ?, ?, ?, 1, ?, ?, ?)
      `).run(userId, stockId, amount, quantity, stock.current_price, user.balance, balanceAfter, JSON.stringify(buyDetail));
      incrementUserStockStat(db, {
        userId,
        stat: STOCK_STAT_TYPES.spotTradeCount,
        sourceType: "stock_trade",
        sourceId: trade.lastInsertRowid,
      });

      incrementDailyMissionProgress(db, userId, "stock_buy");

      return {
        balance: balanceAfter, quantity, stockPrice: stock.current_price, tradeValue: amount, buyFee, totalCost,
        holdingMerge: {
          oldQuantity: holdingBefore.quantity,
          buyQuantity: quantity,
          newQuantity: mergedHolding.newQuantity,
          oldAveragePrice: holdingBefore.averagePrice,
          buyPrice: stock.current_price,
          newAveragePrice: mergedHolding.averagePrice,
          oldTotalCostBasis: holdingBefore.totalCostBasis,
          addedCostBasis: mergedHolding.additionalCostBasis,
          newTotalCostBasis: mergedHolding.totalCostBasis,
        },
      };
    })();
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: "매수 주문이 체결되었어요.", ...result });
});

stocksRouter.post("/buy-ipo", checkUserActionSuspended, (req, res) => {
  const { stockId, amount: requestedAmount, budgetAmount } = req.body;
  const userId = req.user.id;

  let result;
  try {
    settleDueIpoSubscriptions(db);
    result = db.transaction(() => {
      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
      if (!stock || stock.status !== 'ipo_subscription') throw new Error("현재 공모 청약 기간이 아닙니다.");

      const now = Date.now();
      const endsAt = new Date(stock.ipo_subscription_ends_at).getTime();
      if (now >= endsAt) throw new Error("공모 청약 기간이 종료되었습니다.");

      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      assertCanOpenNewStockTrade(user, stock);
      const preview = budgetAmount !== undefined && budgetAmount !== null
        ? getBuyPreview({ stock, user, budgetAmount })
        : (() => {
          const tradeValue = Math.floor(Number(requestedAmount));
          if (!Number.isFinite(tradeValue) || tradeValue <= 0) throw new Error("올바른 구매 금액을 입력해주세요.");
          const buyFee = calculateFee(tradeValue, STOCK_FEE_CONFIG.spotBuyFeeRate);
          return {
            tradeValue,
            buyFee,
            totalCost: tradeValue + buyFee,
            quantity: tradeValue / stock.offering_price,
          };
        })();
      const { tradeValue: amount, buyFee, totalCost, quantity } = preview;
      if (quantity <= 0) throw new Error("현재 잔액으로는 수수료를 포함해 청약할 수 없어요.");
      if (user.balance < totalCost) throw new Error("매수 금액과 수수료를 합친 금액보다 보유 잔액이 부족해요.");

      let holding = db.prepare("SELECT * FROM stock_holdings WHERE user_id = ? AND stock_id = ?").get(userId, stockId);
      const holdingBefore = holding
        ? {
          quantity: holding.quantity,
          averagePrice: holding.average_price,
          totalCostBasis: getHoldingTotalCostBasis(holding),
        }
        : { quantity: 0, averagePrice: 0, totalCostBasis: 0 };
      const mergedHolding = mergeSpotPurchase(holding, {
        quantity,
        price: stock.offering_price,
        buyFee,
      });
      const buyDetail = {
        tradeValue: amount,
        buyFee,
        totalCost,
        oldQuantity: holdingBefore.quantity,
        buyQuantity: quantity,
        newQuantity: mergedHolding.newQuantity,
        oldAveragePrice: holdingBefore.averagePrice,
        buyPrice: stock.offering_price,
        newAveragePrice: mergedHolding.averagePrice,
        oldTotalCostBasis: holdingBefore.totalCostBasis,
        addedCostBasis: mergedHolding.additionalCostBasis,
        newTotalCostBasis: mergedHolding.totalCostBasis,
      };
      if (holding) {
        db.prepare(`
          UPDATE stock_holdings
          SET quantity = ?, average_price = ?, total_cost_basis = ?, total_buy_fees = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?
        `).run(mergedHolding.newQuantity, mergedHolding.averagePrice, mergedHolding.totalCostBasis, mergedHolding.totalBuyFees, holding.id);
      } else {
        db.prepare(`
          INSERT INTO stock_holdings (user_id, stock_id, quantity, average_price, total_cost_basis, total_buy_fees)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, stockId, mergedHolding.newQuantity, mergedHolding.averagePrice, mergedHolding.totalCostBasis, mergedHolding.totalBuyFees);
      }

      const balanceAfter = user.balance - totalCost;
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, userId);

      db.prepare(`
        INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id, detail_json)
        VALUES (?, 'stock_ipo_subscribe', ?, ?, ?, ?, ?)
      `).run(userId, -totalCost, user.balance, balanceAfter, stockId, JSON.stringify(buyDetail));

      const trade = db.prepare(`
        INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, balance_before, balance_after, detail_json)
        VALUES (?, ?, 'ipo_subscribe', ?, ?, ?, 1, ?, ?, ?)
      `).run(userId, stockId, amount, quantity, stock.offering_price, user.balance, balanceAfter, JSON.stringify(buyDetail));
      incrementUserStockStat(db, {
        userId,
        stat: STOCK_STAT_TYPES.spotTradeCount,
        sourceType: "stock_trade",
        sourceId: trade.lastInsertRowid,
      });

      incrementDailyMissionProgress(db, userId, "stock_buy");

      return {
        balance: balanceAfter, quantity, tradeValue: amount, buyFee, totalCost,
        holdingMerge: {
          oldQuantity: holdingBefore.quantity,
          buyQuantity: quantity,
          newQuantity: mergedHolding.newQuantity,
          oldAveragePrice: holdingBefore.averagePrice,
          buyPrice: stock.offering_price,
          newAveragePrice: mergedHolding.averagePrice,
          oldTotalCostBasis: holdingBefore.totalCostBasis,
          addedCostBasis: mergedHolding.additionalCostBasis,
          newTotalCostBasis: mergedHolding.totalCostBasis,
        },
      };
    })();
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: "공모주 청약에 성공했어요!", ...result });
});

stocksRouter.post("/sell", (req, res) => {
  const { stockId, fraction = 1 } = req.body; // fraction to sell (1 = 100%)
  const userId = req.user.id;

  if (fraction <= 0 || fraction > 1) return res.status(400).json({ message: "매도 비율이 올바르지 않아요." });

  let result;
  try {
    result = db.transaction(() => {
      const holding = db.prepare("SELECT * FROM stock_holdings WHERE user_id = ? AND stock_id = ?").get(userId, stockId);
      if (!holding || holding.quantity <= 0) throw new Error("보유 중인 주식이 없어요.");

      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
      if (!stock) {
        // If delisted, allow selling but at 0 price
        if (stock && stock.status === 'delisted') {
           db.prepare("UPDATE stock_holdings SET quantity = 0, average_price = 0, total_cost_basis = 0 WHERE id = ?").run(holding.id);
           return { balance: req.user.balance, amountSold: 0 };
        }
        throw new Error("거래할 수 없는 종목입니다.");
      }
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      const sellPrice = stock.status === "delisted" ? 0 : stock.current_price;
      if (stock.status !== "delisted") assertStockTradeAllowed(stock);

      const sellQuantity = holding.quantity * fraction;
      const settlement = calculateSpotSettlement(db, {
        userId,
        holding,
        sellQuantity,
        sellPrice,
      });
      const {
        grossSellAmount,
        sellFee,
        costBasis,
        realizedProfitBeforeTax,
        capitalGainsTax,
        jackpotContribution,
        finalProfit,
        finalReceiveAmount,
      } = settlement;
      const realizedPnl = finalProfit;

      const newQuantity = Math.max(0, holding.quantity - sellQuantity);
      const oldTotalCostBasis = getHoldingTotalCostBasis(holding);
      const soldCostBasis = settlement.soldCostBasis;
      const remainingCostBasis = newQuantity <= 0 ? 0 : Math.max(0, oldTotalCostBasis - soldCostBasis);
      const remainingAveragePrice = newQuantity > 0 ? remainingCostBasis / newQuantity : 0;
      db.prepare(`
        UPDATE stock_holdings
        SET quantity = ?, average_price = ?, total_cost_basis = ?,
            realized_profit = realized_profit + ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(newQuantity, remainingAveragePrice, remainingCostBasis, realizedProfitBeforeTax, holding.id);

      const balanceAfter = user.balance + finalReceiveAmount;
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, userId);

      const afterGrossSale = user.balance + grossSellAmount;
      const afterSellFee = afterGrossSale - sellFee;
      const afterTax = afterSellFee - capitalGainsTax;
      const detailJson = JSON.stringify({
        ...settlement,
        tradeValue: grossSellAmount,
        finalReceiveAmount,
        oldQuantity: holding.quantity,
        soldQuantity: sellQuantity,
        newQuantity,
        oldTotalCostBasis,
        soldCostBasis,
        remainingCostBasis,
        previousCumulativeTaxableProfit: settlement.taxLedger.previousCumulativeTaxableProfit,
        newCumulativeTaxableProfit: settlement.taxLedger.newCumulativeTaxableProfit,
      });

      db.prepare(`
        INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id, detail_json)
        VALUES (?, 'stock_sell', ?, ?, ?, ?, ?)
      `).run(
        userId,
        grossSellAmount,
        user.balance,
        afterGrossSale,
        stockId,
        detailJson,
      );
      if (sellFee > 0) {
        db.prepare(`
          INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id, detail_json)
          VALUES (?, 'stock_fee', ?, ?, ?, ?, ?)
        `).run(userId, -sellFee, afterGrossSale, afterSellFee, stockId, detailJson);
      }
      if (capitalGainsTax > 0) {
        db.prepare(`
          INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id, detail_json)
          VALUES (?, 'capital_gains_tax', ?, ?, ?, ?, ?)
        `).run(userId, -capitalGainsTax, afterSellFee, afterTax, stockId, detailJson);
      }
      if (realizedPnl > 0) {
        db.prepare(`
          INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id, detail_json)
          VALUES (?, 'stock_realized_profit', ?, ?, ?, ?, ?)
        `).run(userId, 0, afterTax, afterTax, stockId, detailJson);
      }

      const trade = db.prepare(`
        INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, realized_pnl, balance_before, balance_after, detail_json)
        VALUES (?, ?, 'sell', ?, ?, ?, 1, ?, ?, ?, ?)
      `).run(userId, stockId, grossSellAmount, sellQuantity, sellPrice, realizedPnl, user.balance, balanceAfter, detailJson);
      const appliedTaxLedger = applySpotSettlementTax(db, userId, settlement);
      incrementUserStockStat(db, {
        userId,
        stat: STOCK_STAT_TYPES.spotTradeCount,
        sourceType: "stock_trade",
        sourceId: trade.lastInsertRowid,
      });

      const appliedJackpotContribution = capitalGainsTax > 0
        ? addJackpotContribution(db, capitalGainsTax, {
          sourceType: "stock_capital_gains_tax",
          sourceId: trade.lastInsertRowid,
          userId,
          metadata: {
            stockId: stock.id,
            realizedProfitBeforeTax,
            capitalGainsTax,
          },
        })
        : 0;

      incrementDailyMissionProgress(db, userId, "stock_sell");

      if (realizedPnl >= 1000000) {
        createServerNotification(db, {
          userId,
          nickname: user.nickname,
          type: "stock_big_profit",
          title: "주식 대박",
          message: `${user.nickname}님이 주식 현물 투자로 ${formatWon(realizedPnl)}의 수익을 실현했어요!`,
          amount: realizedPnl,
          gameType: "stock",
          gameName: "주식"
        });
      }

      return {
        balance: balanceAfter,
        amountSold: finalReceiveAmount,
        realizedPnl,
        sellFee,
        costBasis,
        realizedProfitBeforeTax,
        capitalGainsTax,
        jackpotPoolContribution: appliedJackpotContribution,
        finalReceiveAmount,
        taxType: settlement.taxType,
      };
    })();
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: "매도 주문이 체결되었어요.", ...result });
});

stocksRouter.post("/open-position", checkUserActionSuspended, (req, res) => {
  const { stockId, margin, budgetAmount, leverage, side = "long" } = req.body;
  const userId = req.user.id;
  const rawMargin = Math.floor(Number(margin));
  const requestedLeverage = Number(leverage);

  if ((!rawMargin || rawMargin <= 0) && (budgetAmount === undefined || budgetAmount === null)) return res.status(400).json({ message: "증거금 또는 레버리지가 올바르지 않아요." });
  if (![2, 5, 10, 50, 100].includes(requestedLeverage)) return res.status(400).json({ message: "지원하지 않는 레버리지 배율이에요." });
  if (!["long", "short"].includes(side)) return res.status(400).json({ message: "포지션 방향이 올바르지 않아요." });

  let result;
  try {
    result = db.transaction(() => {
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);

      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
      if (!stock || stock.status === 'delisted') throw new Error("거래할 수 없는 종목입니다.");
      
      assertCanOpenNewStockTrade(user, stock);
      assertCanOpenLeveragePosition(stock, requestedLeverage);

      const requestedMargin = budgetAmount !== undefined && budgetAmount !== null
        ? getMaxAffordableLeverageMargin({
          availableBalance: normalizeBuyBudget(budgetAmount, user.balance),
          leverage: requestedLeverage,
        })
        : rawMargin;
      if (!requestedMargin || requestedMargin <= 0) {
        throw new Error("현재 잔액으로는 수수료를 포함해 포지션을 열 수 없어요.");
      }

      const oppositeSide = side === "long" ? "short" : "long";
      const oppositePosition = db
        .prepare(
          "SELECT id FROM stock_positions WHERE user_id = ? AND stock_id = ? AND side = ? AND status = 'open' LIMIT 1",
        )
        .get(userId, stockId, oppositeSide);
      if (oppositePosition) {
        throw new Error("같은 종목에서 롱과 숏을 동시에 보유할 수 없어요. 기존 포지션을 먼저 정리해 주세요.");
      }

      const positionSize = requestedMargin * requestedLeverage;
      const openFee = calculateFee(positionSize, STOCK_FEE_CONFIG.leverageOpenFeeRate);
      const requiredBalance = requestedMargin + openFee;
      if (user.balance < requiredBalance) throw new Error("증거금과 수수료를 합친 금액보다 보유 잔액이 부족해요.");
      const quantity = positionSize / stock.current_price;
      const liquidationPrice = side === "short" 
        ? Math.ceil(stock.current_price * (1 + 1 / requestedLeverage))
        : Math.floor(stock.current_price * (1 - 1 / requestedLeverage));
      const detail = {
        positionSize,
        openFee,
        requiredBalance,
        side,
        marginAmount: requestedMargin,
        leverage: requestedLeverage,
      };
      const existingBucket = db.prepare(`
        SELECT * FROM stock_positions
        WHERE user_id = ? AND stock_id = ? AND side = ? AND leverage = ? AND status = 'open'
        LIMIT 1
      `).get(userId, stockId, side, requestedLeverage);
      let positionId;
      let positionMerge;
      if (existingBucket) {
        const combinedQuantity = Number(existingBucket.quantity) + quantity;
        const combinedPositionSize = Number(existingBucket.position_size) + positionSize;
        const combinedMargin = Number(existingBucket.margin_amount) + requestedMargin;
        const combinedEntryPrice = combinedQuantity > 0
          ? ((Number(existingBucket.quantity) * Number(existingBucket.entry_price)) + (quantity * Number(stock.current_price))) / combinedQuantity
          : Number(stock.current_price);
        const combinedLiquidationPrice = side === "short"
          ? Math.ceil(combinedEntryPrice * (1 + 1 / requestedLeverage))
          : Math.floor(combinedEntryPrice * (1 - 1 / requestedLeverage));
        const combinedDetail = {
          ...detail,
          oldQuantity: existingBucket.quantity,
          additionalQuantity: quantity,
          combinedQuantity,
          oldEntryPrice: existingBucket.entry_price,
          additionalEntryPrice: stock.current_price,
          combinedEntryPrice,
          oldMargin: existingBucket.margin_amount,
          additionalMargin: requestedMargin,
          combinedMargin,
          newLiquidationPrice: combinedLiquidationPrice,
        };
        db.prepare(`
          UPDATE stock_positions
          SET margin_amount = ?, position_size = ?, quantity = ?, entry_price = ?, liquidation_price = ?,
              total_open_fees = total_open_fees + ?, detail_json = ?
          WHERE id = ?
        `).run(combinedMargin, combinedPositionSize, combinedQuantity, combinedEntryPrice, combinedLiquidationPrice, openFee, JSON.stringify(combinedDetail), existingBucket.id);
        positionId = existingBucket.id;
        positionMerge = combinedDetail;
      } else {
        const positionInsert = db.prepare(`
          INSERT INTO stock_positions (user_id, stock_id, side, margin_amount, leverage, position_size, quantity, entry_price, liquidation_price, total_open_fees, detail_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(userId, stockId, side, requestedMargin, requestedLeverage, positionSize, quantity, stock.current_price, liquidationPrice, openFee, JSON.stringify(detail));
        positionId = positionInsert.lastInsertRowid;
        positionMerge = {
          oldQuantity: 0,
          additionalQuantity: quantity,
          combinedQuantity: quantity,
          oldEntryPrice: 0,
          additionalEntryPrice: stock.current_price,
          combinedEntryPrice: stock.current_price,
          oldMargin: 0,
          additionalMargin: requestedMargin,
          combinedMargin: requestedMargin,
          newLiquidationPrice: liquidationPrice,
        };
      }

      const afterMargin = user.balance - requestedMargin;
      const balanceAfter = afterMargin - openFee;
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, userId);

      db.prepare(`
        INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id)
        VALUES (?, 'stock_position_open', ?, ?, ?, ?)
      `).run(userId, -requestedMargin, user.balance, afterMargin, stockId);
      if (openFee > 0) {
        db.prepare(`
          INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id, detail_json)
          VALUES (?, 'stock_fee', ?, ?, ?, ?, ?)
        `).run(userId, -openFee, afterMargin, balanceAfter, stockId, JSON.stringify(detail));
      }

      const openTrade = db.prepare(`
        INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, balance_before, balance_after, detail_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, stockId, `open_${side}`, requestedMargin, quantity, stock.current_price, requestedLeverage, user.balance, balanceAfter, JSON.stringify({ ...detail, ...positionMerge, positionId }));
      incrementUserStockStat(db, {
        userId,
        stat: STOCK_STAT_TYPES.leverageOpenCount,
        sourceType: "leverage_trade_open",
        sourceId: openTrade.lastInsertRowid,
      });

      return { balance: balanceAfter, positionId, positionMerge, maxAllowedLeverage: getMaxAllowedLeverage(stock), openFee, requiredBalance };
    })();
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: `${requestedLeverage}배 레버리지 포지션을 열었어요.`, ...result });
});

stocksRouter.post("/close-position", (req, res) => {
  const { positionId } = req.body;
  const userId = req.user.id;

  let result;
  try {
    result = db.transaction(() => {
      const position = db.prepare("SELECT * FROM stock_positions WHERE id = ? AND user_id = ? AND status = 'open'").get(positionId, userId);
      if (!position) throw new Error("포지션을 찾을 수 없어요.");

      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(position.stock_id);
      if (!stock) throw new Error("종목을 찾을 수 없어요.");
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      assertStockTradeAllowed(stock);
      const closePrice = (stock && stock.status !== 'delisted') ? stock.current_price : 0;

      const outcome = calculateLeveragedPositionOutcome(position, stock, closePrice);
      if (outcome.liquidated) {
        liquidatePosition(db, position, closePrice, "manual_close_liquidation_check");
        return {
          balance: user.balance,
          payout: 0,
          realizedPnl: -position.margin_amount,
          jackpotPoolContribution: 0,
          liquidated: true,
        };
      }

      const grossRealizedPnl = outcome.cappedPnl;
      const settlement = calculateLeverageSettlement(db, {
        userId,
        position,
        cappedPnl: outcome.cappedPnl,
      });
      const {
        closeFee,
        realizedPnlBeforeTax,
        capitalGainsTax,
        jackpotContribution,
        finalProfit,
        finalPayout,
      } = settlement;
      const payout = outcome.payoutBeforeTax;
      const realizedPnl = finalProfit;
      const detail = {
        grossPayout: Math.max(0, payout),
        rawPnl: outcome.rawPnl,
        cappedPnl: outcome.cappedPnl,
        grossRealizedPnl,
        realizedPnlBeforeTax,
        closeFee,
        capitalGainsTax,
        taxBracketsApplied: settlement.bracketsApplied,
        profitAfterTax: realizedPnlBeforeTax > 0 ? realizedPnlBeforeTax - capitalGainsTax : realizedPnlBeforeTax,
        jackpotPoolContribution: jackpotContribution,
        prizeContribution: jackpotContribution,
        finalProfit,
        finalPayout,
        taxType: settlement.taxType,
        riskLevel: outcome.riskLevel,
        profitCapApplied: outcome.profitCapApplied,
        liquidated: false,
        forceCloseReason: null,
        side: outcome.side,
        entryPrice: outcome.entryPrice,
        closePrice: outcome.closePrice,
        marginAmount: outcome.marginAmount,
        positionSize: position.position_size,
        leverage: outcome.leverage,
        liquidationPrice: outcome.liquidationPrice,
        previousCumulativeTaxableProfit: settlement.taxLedger.previousCumulativeTaxableProfit,
        newCumulativeTaxableProfit: settlement.taxLedger.newCumulativeTaxableProfit,
      };

      db.prepare(`
        UPDATE stock_positions 
        SET status = 'closed',
            closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            close_price = ?,
            payout_amount = ?,
            unrealized_pnl = 0,
            realized_pnl = ?,
            detail_json = ?
        WHERE id = ?
      `).run(closePrice, finalPayout, realizedPnl, JSON.stringify(detail), position.id);

      const balanceAfter = user.balance + finalPayout;
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, userId);

      const afterGrossPayout = user.balance + Math.max(0, payout);
      const afterCloseFee = afterGrossPayout - closeFee;
      const afterTax = afterCloseFee - capitalGainsTax;

      db.prepare(`
        INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id, detail_json)
        VALUES (?, 'stock_position_close', ?, ?, ?, ?, ?)
      `).run(
        userId,
        Math.max(0, payout),
        user.balance,
        afterGrossPayout,
        stock.id,
        JSON.stringify(detail),
      );
      if (closeFee > 0) {
        db.prepare(`
          INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id, detail_json)
          VALUES (?, 'stock_fee', ?, ?, ?, ?, ?)
        `).run(userId, -closeFee, afterGrossPayout, afterCloseFee, stock.id, JSON.stringify(detail));
      }
      if (capitalGainsTax > 0) {
        db.prepare(`
          INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id, detail_json)
          VALUES (?, 'capital_gains_tax', ?, ?, ?, ?, ?)
        `).run(userId, -capitalGainsTax, afterCloseFee, afterTax, stock.id, JSON.stringify(detail));
      }
      if (realizedPnl > 0) {
        db.prepare(`
          INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id, detail_json)
          VALUES (?, 'stock_realized_profit', ?, ?, ?, ?, ?)
        `).run(userId, 0, afterTax, afterTax, stock.id, JSON.stringify(detail));
      }

      const trade = db.prepare(`
        INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, realized_pnl, balance_before, balance_after, detail_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, stock.id, `close_${position.side || "long"}`, Math.max(0, payout), position.quantity, closePrice, position.leverage, realizedPnl, user.balance, balanceAfter, JSON.stringify(detail));
      applyLeverageSettlementTax(db, userId, settlement);
      incrementUserStockStat(db, {
        userId,
        stat: STOCK_STAT_TYPES.leverageCloseCount,
        sourceType: "leverage_position_close",
        sourceId: position.id,
      });
      incrementUserStockStat(db, {
        userId,
        stat: STOCK_STAT_TYPES.leverageRoundTripCount,
        sourceType: "leverage_round_trip",
        sourceId: position.id,
      });

      const appliedJackpotContribution = capitalGainsTax > 0
        ? addJackpotContribution(db, capitalGainsTax, {
          sourceType: "stock_position_capital_gains_tax",
          sourceId: trade.lastInsertRowid,
          userId,
          metadata: {
            stockId: stock.id,
            positionId: position.id,
            realizedPnlBeforeTax,
            capitalGainsTax,
          },
        })
        : 0;

      if (position.leverage >= 10 && realizedPnl >= 1000000) {
        createServerNotification(db, {
          userId,
          nickname: user.nickname,
          type: "stock_big_profit",
          title: "레버리지 대박",
          message: `${user.nickname}님이 ${position.leverage}배 레버리지로 ${formatWon(realizedPnl)}의 수익을 올렸어요!`,
          amount: realizedPnl,
          gameType: "stock",
          gameName: "주식"
        });
      }

      return {
        balance: balanceAfter,
        payout: finalPayout,
        realizedPnl,
        rawPnl: outcome.rawPnl,
        cappedPnl: outcome.cappedPnl,
        realizedPnlBeforeTax,
        closeFee,
        capitalGainsTax,
        profitCapApplied: outcome.profitCapApplied,
        riskLevel: outcome.riskLevel,
        jackpotPoolContribution: appliedJackpotContribution,
        taxType: settlement.taxType,
      };
    })();
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: "포지션을 청산했어요.", ...result });
});

stocksRouter.post("/:id/acquire", (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    db.transaction(() => {
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(id);

      if (!stock || stock.status === 'delisted') throw new Error("인수할 수 없는 종목입니다.");
      assertStockTradeAllowed(stock);
      if (stock.is_bluechip === 1) throw new Error("우량주는 인수할 수 없습니다.");
      if (stock.is_etf || stock.status === 'acquired') throw new Error("이미 인수된 종목입니다.");
      const acquisitionPrice = Math.floor(Number(stock.market_cap || 0));
      const requiredTotalAsset = requiredCompanyAcquisitionBalance(acquisitionPrice);
      const valuation = calculateUserTotalEvaluatedAsset(db, userId);
      if (valuation.valuationComplete === false) {
        throw new Error("총평가금액을 완전하게 계산할 수 없어 회사 인수 자격을 판정할 수 없습니다.");
      }
      const userTotalEvaluatedAsset = valuation.totalEvaluatedAsset;
      if (userTotalEvaluatedAsset < requiredTotalAsset) {
        throw new Error(
          `회사를 인수하려면 총 평가자산이 인수 금액의 ${STOCK_MARKET_POLICY.companyAcquisitionBalanceMultiplier}배(${formatWon(requiredTotalAsset)}) 이상이어야 해요.`,
        );
      }

      const existingEtf = db.prepare("SELECT id FROM stocks WHERE owner_user_id = ? AND is_etf = 1 AND status = 'acquired'").get(userId);
      if (existingEtf) throw new Error("인수자 ETF는 한 개만 보유할 수 있습니다.");

      const holding = db.prepare("SELECT * FROM stock_holdings WHERE user_id = ? AND stock_id = ?").get(userId, id);
      if (holding && holding.quantity > 0) {
        throw new Error("Close your own holding before acquiring this company.");
      }

      const ownPosition = db.prepare("SELECT id FROM stock_positions WHERE user_id = ? AND stock_id = ? AND status = 'open' LIMIT 1").get(userId, id);
      if (ownPosition) {
        throw new Error("Close your own leveraged position before acquiring this company.");
      }

      const cost = acquisitionPrice;
      if (user.balance < cost) {
        throw new Error(
          `인수 비용 ${formatWon(cost)}을 현금으로 보유해야 해요.`,
        );
      }
      const balanceAfter = user.balance - cost;
      
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, userId);
      const ownerAsset = calculateOwnerEtfTrackingAsset(db, userId, Number(id));
      
      db.prepare(`
        UPDATE stocks 
        SET status = 'acquired', is_etf = 1, etf_tracking_type = 'owner_asset', 
            owner_user_id = ?, owner_nickname_snapshot = ?,
            etf_base_price = current_price,
            etf_base_owner_asset = ?, etf_last_tracked_owner_asset = ?,
            etf_acquisition_cost = ?,
            etf_delist_reference_price = current_price,
            etf_delist_reference_set_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            etf_delist_trigger_price = MAX(1, CAST(current_price * 0.15 AS INTEGER)),
            etf_delist_triggered_at = NULL, etf_delist_reason = NULL,
            delist_risk_status = 'normal', is_market_cap_warning = 0,
            caution_tick_count = 0, recovery_tick_count = 0, delist_review_tick_count = 0
        WHERE id = ?
      `).run(userId, user.nickname, ownerAsset, ownerAsset, cost, id);

      db.prepare(`
        INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id)
        VALUES (?, 'stock_acquire_company', ?, ?, ?, ?)
      `).run(userId, -cost, user.balance, balanceAfter, id);

      db.prepare(`
        INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, balance_before, balance_after)
        VALUES (?, ?, 'acquire', ?, 0, ?, 1, ?, ?)
      `).run(userId, id, cost, stock.current_price, user.balance, balanceAfter);

      createServerNotification(db, {
        userId,
        nickname: user.nickname,
        type: "stock_acquired",
        title: "회사 인수",
        message: `${user.nickname}님이 ${stock.name}을(를) 인수했어요! 이제 ${user.nickname}님의 자산을 추종하는 ETF가 됩니다.`,
        amount: -cost,
        gameType: "stock",
        gameName: "주식",
        metadata: { stockId: id, symbol: stock.symbol }
      });
    })();
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: "회사 인수에 성공했어요!" });
});

stocksRouter.post("/:id/revert-by-owner", (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    db.transaction(() => {
      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(id);
      
      if (!stock || stock.status !== 'acquired' || !stock.is_etf) throw new Error("일반 주식으로 되돌릴 수 없는 상태입니다.");
      if (stock.owner_user_id !== userId) throw new Error("본인이 인수한 종목만 되돌릴 수 있습니다.");

      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      assertStockMarketOpen(db);
      const refund = stock.etf_acquisition_cost ? Math.floor(stock.etf_acquisition_cost * 0.5) : 0;
      const newBalance = user.balance + refund;

      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(newBalance, userId);

      db.prepare(`
        UPDATE stocks 
        SET status = 'listed', is_etf = 0, etf_tracking_type = NULL, 
            owner_user_id = NULL, owner_nickname_snapshot = NULL,
            etf_base_owner_asset = 0, etf_last_tracked_owner_asset = 0,
            etf_acquisition_cost = NULL,
            etf_delist_reference_price = NULL, etf_delist_reference_set_at = NULL,
            etf_delist_trigger_price = NULL, etf_delist_triggered_at = NULL, etf_delist_reason = NULL
        WHERE id = ?
      `).run(id);

      if (refund > 0) {
        db.prepare(`
          INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id)
          VALUES (?, 'stock_revert_refund', ?, ?, ?, ?)
        `).run(userId, refund, user.balance, newBalance, id);
      }

      createServerNotification(db, {
        userId,
        nickname: user.nickname,
        type: "stock_reverted",
        title: "일반 주식 전환",
        message: `${user.nickname}님이 ${stock.name}을(를) 일반 주식으로 되돌렸습니다.`,
        amount: refund,
        gameType: "stock",
        gameName: "주식",
        metadata: { stockId: id, symbol: stock.symbol }
      });
    })();
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: "일반 주식으로 되돌렸습니다. (인수 금액의 50% 환불)" });
});

stocksRouter.post("/:id/update-meta", (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { name, symbol, description } = req.body;

  try {
    if (!name || !name.trim()) throw new Error("회사 제목은 필수 입력 항목입니다.");
    if (!symbol || !symbol.trim()) throw new Error("종목코드(심볼)는 필수 입력 항목입니다.");

    // 비속어 필터
    const badWords = ["개새끼", "씨발", "병신", "좆", "씹", "아가리", "느금마", "지랄", "존나", "쌍년", "썅", "엠창", "시발", "미친년", "미친놈"];
    const sanitizedName = name.replace(/\s+/g, ""); // 공백을 다 빼고 매치함
    for (const word of badWords) {
      if (sanitizedName.includes(word)) {
        throw new Error("회사 제목에 비속어가 포함될 수 없습니다.");
      }
    }

    // 종목코드 유효성 검증 (영문, 숫자, 대시 2~12글자)
    const upperSymbol = symbol.toUpperCase().trim();
    if (!/^[A-Z0-9\-]{2,12}$/.test(upperSymbol)) {
      throw new Error("종목코드는 영문 대문자, 숫자, 대시(-)로 구성된 2~12자 형태여야 합니다.");
    }

    db.transaction(() => {
      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(id);
      if (!stock) throw new Error("존재하지 않는 종목입니다.");
      if (stock.status !== 'acquired' || !stock.is_etf) {
        throw new Error("인수된 회사(ETF)가 아닙니다.");
      }
      if (stock.owner_user_id !== userId) {
        throw new Error("회사 오너만 메타데이터를 수정할 수 있습니다.");
      }

      // 종목코드 중복 검증
      const dup = db.prepare("SELECT id FROM stocks WHERE symbol = ? AND id != ?").get(upperSymbol, id);
      if (dup) throw new Error("이미 등록된 다른 종목코드입니다.");

      db.prepare(`
        UPDATE stocks
        SET name = ?, symbol = ?, description = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(name.trim(), upperSymbol, description ? description.trim() : null, id);
    })();

    res.json({ message: "회사 정보를 성공적으로 업데이트했어요!" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

stocksRouter.post("/:id/hostile-takeover", (req, res) => {
  return res.status(410).json({
    message: "적대적 M&A는 공개 입찰 방식으로 바뀌었어요. /hostile-takeover/declare를 사용하세요.",
  });

  const { id } = req.params;
  const attackerId = req.user.id;

  try {
    db.transaction(() => {
      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(id);
      
      if (!stock || stock.status !== 'acquired' || !stock.is_etf) throw new Error("인수된 종목만 적대적 M&A가 가능합니다.");
      if (stock.owner_user_id === attackerId) throw new Error("본인의 회사는 적대적 M&A를 할 수 없습니다.");

      const existingEtf = db.prepare("SELECT id FROM stocks WHERE owner_user_id = ? AND is_etf = 1 AND status = 'acquired'").get(attackerId);
      if (existingEtf) throw new Error("인수자 ETF는 한 개만 보유할 수 있습니다.");

      const attacker = db.prepare("SELECT * FROM users WHERE id = ?").get(attackerId);
      const defender = db.prepare("SELECT * FROM users WHERE id = ?").get(stock.owner_user_id);
      assertStockTradeAllowed(stock);

      if (!defender) throw new Error("기존 소유자를 찾을 수 없습니다.");
      const attackerHolding = db
        .prepare("SELECT quantity FROM stock_holdings WHERE user_id = ? AND stock_id = ?")
        .get(attackerId, stock.id);
      if (attackerHolding?.quantity > 0) {
        throw new Error("적대적 M&A 전에 해당 ETF 보유분을 먼저 매도해 주세요.");
      }
      const attackerPosition = db
        .prepare(
          "SELECT id FROM stock_positions WHERE user_id = ? AND stock_id = ? AND status = 'open'",
        )
        .get(attackerId, stock.id);
      if (attackerPosition) {
        throw new Error("적대적 M&A 전에 해당 ETF 레버리지 포지션을 먼저 청산해 주세요.");
      }

      const cost = Math.floor(defender.balance * 0.2);
      const requiredBalance = requiredCompanyAcquisitionBalance(cost);
      const attackerTotalAsset = calculateUserTotalEvaluatedAsset(db, attackerId).totalEvaluatedAsset;
      if (attackerTotalAsset < requiredBalance) {
        throw new Error("적대적 M&A 자격에는 인수 비용의 5배 총평가자산이 필요해요.");
      }
      if (attacker.balance < cost) {
        throw new Error("적대적 M&A 비용은 현금 자산으로 보유해야 해요.");
      }

      const attackerBalanceAfter = attacker.balance - cost;
      const defenderBalanceAfter = defender.balance + cost;

      // Attacker pays cost
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(attackerBalanceAfter, attackerId);
      db.prepare(`
        INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id)
        VALUES (?, 'hostile_takeover_pay', ?, ?, ?, ?)
      `).run(attackerId, -cost, attacker.balance, attackerBalanceAfter, id);

      // Defender receives cost
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(defenderBalanceAfter, defender.id);
      db.prepare(`
        INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id)
        VALUES (?, 'hostile_takeover_receive', ?, ?, ?, ?)
      `).run(defender.id, cost, defender.balance, defenderBalanceAfter, id);

      const attackerAsset = calculateOwnerEtfTrackingAsset(db, attackerId, Number(id));

      // Transfer ETF ownership
      db.prepare(`
        UPDATE stocks 
        SET owner_user_id = ?, owner_nickname_snapshot = ?,
            etf_base_price = current_price,
            etf_base_owner_asset = ?, etf_last_tracked_owner_asset = ?,
            etf_acquisition_cost = ?,
            etf_delist_reference_price = current_price,
            etf_delist_reference_set_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            etf_delist_trigger_price = MAX(1, CAST(current_price * 0.15 AS INTEGER)),
            etf_delist_triggered_at = NULL, etf_delist_reason = NULL,
            delist_risk_status = 'normal', is_market_cap_warning = 0,
            caution_tick_count = 0, recovery_tick_count = 0, delist_review_tick_count = 0
        WHERE id = ?
      `).run(attacker.id, attacker.nickname, attackerAsset, attackerAsset, cost, id);

      db.prepare(`
        INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, balance_before, balance_after)
        VALUES (?, ?, 'hostile_takeover', ?, 0, ?, 1, ?, ?)
      `).run(attackerId, id, cost, stock.current_price, attacker.balance, attackerBalanceAfter);

      // Notify Defender
      createServerNotification(db, {
        userId: defender.id,
        nickname: defender.nickname,
        type: "hostile_takeover_lost",
        title: "적대적 M&A 방어 실패",
        message: `${attacker.nickname}님이 당신의 ${stock.name}을(를) 적대적 M&A로 강제 인수했습니다! 위로금으로 재산의 20%가 입금되었습니다.`,
        amount: cost,
        gameType: "stock",
        gameName: "주식",
        metadata: { stockId: id, symbol: stock.symbol, attackerId: attacker.id }
      });

      // Global Notification
      createServerNotification(db, {
        type: "hostile_takeover_success",
        title: "적대적 M&A 성공",
        message: `${attacker.nickname}님이 ${defender.nickname}님의 ${stock.name}을(를) 적대적 M&A로 빼앗았습니다!`,
        amount: -cost,
        gameType: "stock",
        gameName: "주식",
        metadata: { stockId: id, symbol: stock.symbol }
      });
    })();
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: "적대적 M&A에 성공하여 회사를 탈취했습니다!" });
});


stocksRouter.post("/:id/hostile-takeover/declare", (req, res) => {
  const stockId = Number(req.params.id);
  const attackerId = req.user.id;
  try {
    const declaration = db.transaction(() => {
      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
      if (!stock || stock.status !== "acquired" || stock.is_etf !== 1) {
        throw new Error("인수된 회사만 적대적 M&A를 시작할 수 있습니다.");
      }
      if (Number(stock.owner_user_id) === Number(attackerId)) {
        throw new Error("본인이 소유한 회사에는 적대적 M&A를 할 수 없습니다.");
      }
      assertStockTradeAllowed(stock);
      if (db.prepare(`
        SELECT id FROM hostile_takeover_events
        WHERE stock_id = ? AND status IN ('declared', 'defended')
      `).get(stockId)) {
        throw new Error("이미 진행 중인 적대적 M&A가 있습니다.");
      }

      const attacker = db.prepare("SELECT * FROM users WHERE id = ?").get(attackerId);
      const defender = db.prepare("SELECT * FROM users WHERE id = ?").get(stock.owner_user_id);
      if (!attacker || !defender) throw new Error("공격자 또는 현재 소유자를 찾을 수 없습니다.");
      if (db.prepare(`
        SELECT id FROM stocks
        WHERE owner_user_id = ? AND is_etf = 1 AND status = 'acquired' AND id != ?
      `).get(attackerId, stockId)) {
        throw new Error("활성 인수자 ETF는 한 개만 소유할 수 있습니다.");
      }

      const targetMarketCap = Math.max(1, Math.floor(Number(stock.market_cap || 0)));
      const acquisitionCost = targetMarketCap;
      const requiredTotalAsset = requiredCompanyAcquisitionBalance(targetMarketCap);
      const valuation = calculateUserTotalEvaluatedAsset(db, attackerId);
      if (valuation.valuationComplete === false) {
        throw new Error("총평가금액을 완전하게 계산할 수 없어 M&A 자격을 판정할 수 없습니다.");
      }
      if (valuation.totalEvaluatedAsset < requiredTotalAsset) {
        throw new Error("대상 회사 시가총액의 5배 이상인 총평가금액이 필요합니다.");
      }
      if (Number(attacker.balance) < acquisitionCost) {
        throw new Error("대상 회사 시가총액과 같은 인수 대금을 현금으로 보유해야 합니다.");
      }

      const balanceAfter = Number(attacker.balance) - acquisitionCost;
      const endsAt = new Date(Date.now() + 5 * 60_000).toISOString();
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, attackerId);
      const inserted = db.prepare(`
        INSERT INTO hostile_takeover_events
          (stock_id, attacker_user_id, defender_user_id, attack_cash,
           defense_cash, attacker_asset_snapshot, defender_asset_snapshot,
           target_market_cap_snapshot, target_price_snapshot,
           target_total_shares_snapshot, target_owner_user_id_snapshot,
           attacker_total_evaluated_asset_snapshot, attacker_cash_snapshot,
           acquisition_cost_snapshot, ends_at, metadata_json)
        VALUES (?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        stockId,
        attackerId,
        defender.id,
        acquisitionCost,
        valuation.totalEvaluatedAsset,
        targetMarketCap,
        stock.current_price,
        stock.total_shares,
        defender.id,
        valuation.totalEvaluatedAsset,
        attacker.balance,
        acquisitionCost,
        endsAt,
        JSON.stringify({ policy: "target_market_cap_v1" }),
      );
      const eventId = Number(inserted.lastInsertRowid);
      db.prepare(`
        INSERT INTO hostile_takeover_supports
          (hostile_takeover_event_id, user_id, side, cash_amount)
        VALUES (?, ?, 'attack', ?)
      `).run(eventId, attackerId, acquisitionCost);
      db.prepare(`
        INSERT INTO asset_events
          (user_id, event_type, amount, balance_before, balance_after,
           source_type, source_id, detail_json)
        VALUES (?, 'hostile_takeover_escrow', ?, ?, ?, 'hostile_takeover', ?, ?)
      `).run(
        attackerId,
        -acquisitionCost,
        attacker.balance,
        balanceAfter,
        `escrow:${eventId}`,
        JSON.stringify({ stockId, targetMarketCap, acquisitionCost, requiredTotalAsset, endsAt }),
      );
      db.prepare(`
        INSERT INTO stock_trades
          (user_id, stock_id, trade_type, amount, quantity, price, leverage,
           balance_before, balance_after, detail_json)
        VALUES (?, ?, 'hostile_takeover_declare', ?, 0, ?, 1, ?, ?, ?)
      `).run(
        attackerId,
        stockId,
        acquisitionCost,
        stock.current_price,
        attacker.balance,
        balanceAfter,
        JSON.stringify({ hostileTakeoverEventId: eventId, targetMarketCap, endsAt }),
      );
      createServerNotification(db, {
        userId: defender.id,
        nickname: defender.nickname,
        type: "hostile_takeover_declared",
        title: "적대적 M&A 공개 입찰",
        message: `${attacker.nickname}님이 ${stock.name} 인수를 선언했어요. 종료 전까지 방어 자금을 투입할 수 있어요.`,
        gameType: "stock",
        gameName: "주식",
        metadata: { hostileTakeoverEventId: eventId, stockId, targetMarketCap, endsAt },
      });
      return {
        id: eventId,
        targetMarketCap,
        acquisitionCost,
        requiredTotalAsset,
        attackerTotalEvaluatedAsset: valuation.totalEvaluatedAsset,
        attackerCash: attacker.balance,
        endsAt,
      };
    })();
    return res.json({
      message: "적대적 M&A 공개 입찰을 시작했습니다.",
      hostileTakeover: declaration,
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

stocksRouter.post("/:id/hostile-takeover/declare-legacy-disabled", (req, res) => {
  return res.status(410).json({
    message: "폐기된 적대적 M&A 선언 방식입니다. /hostile-takeover/declare를 사용하세요.",
  });

  const stockId = Number(req.params.id);
  const attackerId = req.user.id;
  try {
    const declaration = db.transaction(() => {
      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
      if (!stock || stock.status !== "acquired" || stock.is_etf !== 1) {
        throw new Error("인수된 회사만 적대적 M&A 공개 입찰을 시작할 수 있어요.");
      }
      if (stock.owner_user_id === attackerId) throw new Error("본인의 회사에는 적대적 M&A를 할 수 없어요.");
      assertStockTradeAllowed(stock);
      const existing = db.prepare(`
        SELECT id FROM hostile_takeover_events
        WHERE stock_id = ? AND status IN ('declared', 'defended')
      `).get(stockId);
      if (existing) throw new Error("이미 진행 중인 적대적 M&A 공개 입찰이 있어요.");
      const attacker = db.prepare("SELECT * FROM users WHERE id = ?").get(attackerId);
      const defender = db.prepare("SELECT * FROM users WHERE id = ?").get(stock.owner_user_id);
      if (!attacker || !defender) throw new Error("공격자 또는 방어자 정보를 찾을 수 없어요.");
      const cost = Math.max(1_000, Math.floor(Number(defender.balance || 0) * 0.2));
      const attackerTotalAsset = calculateUserTotalEvaluatedAsset(db, attackerId).totalEvaluatedAsset;
      if (attackerTotalAsset < requiredCompanyAcquisitionBalance(cost)) {
        throw new Error("공개 입찰에는 인수 비용의 5배 총평가자산이 필요해요.");
      }
      if (Number(attacker.balance) < cost) throw new Error("공개 입찰 자금을 현금으로 보유해야 해요.");
      const balanceAfter = Number(attacker.balance) - cost;
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, attackerId);
      const endsAt = new Date(Date.now() + 5 * 60_000).toISOString();
      const result = db.prepare(`
        INSERT INTO hostile_takeover_events
          (stock_id, attacker_user_id, defender_user_id, attack_cash, attacker_asset_snapshot, defender_asset_snapshot, ends_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        stockId, attackerId, defender.id, cost, attackerTotalAsset,
        calculateUserTotalEvaluatedAsset(db, defender.id).totalEvaluatedAsset, endsAt,
      );
      db.prepare(`
        INSERT INTO asset_events
          (user_id, event_type, amount, balance_before, balance_after, source_type, source_id, detail_json)
        VALUES (?, 'hostile_takeover_escrow', ?, ?, ?, 'hostile_takeover', ?, ?)
      `).run(attackerId, -cost, attacker.balance, balanceAfter, `escrow:${result.lastInsertRowid}`, JSON.stringify({ stockId, endsAt }));
      db.prepare(`
        INSERT INTO stock_trades
          (user_id, stock_id, trade_type, amount, quantity, price, leverage, balance_before, balance_after, detail_json)
        VALUES (?, ?, 'hostile_takeover_declare', ?, 0, ?, 1, ?, ?, ?)
      `).run(attackerId, stockId, cost, stock.current_price, attacker.balance, balanceAfter, JSON.stringify({ hostileTakeoverEventId: result.lastInsertRowid, endsAt }));
      createServerNotification(db, {
        userId: defender.id,
        nickname: defender.nickname,
        type: "hostile_takeover_declared",
        title: "적대적 M&A 공개 입찰",
        message: `${attacker.nickname}님이 ${stock.name}의 인수를 선언했어요. 종료 전까지 방어 자금을 투입할 수 있어요.`,
        gameType: "stock",
        gameName: "주식",
        metadata: { hostileTakeoverEventId: result.lastInsertRowid, stockId, endsAt },
      });
      return { id: Number(result.lastInsertRowid), cost, endsAt };
    })();
    return res.json({ message: "적대적 M&A 공개 입찰을 시작했어요. 5분 뒤 공격력과 방어력을 비교합니다.", hostileTakeover: declaration });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

stocksRouter.post("/:id/hostile-takeover/defend", (req, res) => {
  const stockId = Number(req.params.id);
  const defenderId = req.user.id;
  const requestedAmount = Math.floor(Number(req.body?.amount || 0));
  try {
    const result = db.transaction(() => {
      const event = db.prepare(`
        SELECT * FROM hostile_takeover_events
        WHERE stock_id = ? AND status IN ('declared', 'defended')
        ORDER BY id DESC LIMIT 1
      `).get(stockId);
      if (!event) throw new Error("방어할 공개 입찰이 없어요.");
      if (event.defender_user_id !== defenderId) throw new Error("현재 회사 보유자만 방어할 수 있어요.");
      if (new Date(event.ends_at).getTime() <= Date.now()) throw new Error("공개 입찰 시간이 끝났어요.");
      const defender = db.prepare("SELECT * FROM users WHERE id = ?").get(defenderId);
      const amount = requestedAmount > 0 ? requestedAmount : Math.min(Number(defender.balance), Math.max(1_000, Math.floor(event.attack_cash * 0.25)));
      if (amount <= 0 || amount > Number(defender.balance)) throw new Error("방어 자금이 부족해요.");
      const balanceAfter = Number(defender.balance) - amount;
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, defenderId);
      db.prepare(`
        UPDATE hostile_takeover_events
        SET defense_cash = defense_cash + ?, status = 'defended'
        WHERE id = ?
      `).run(amount, event.id);
      db.prepare(`
        INSERT INTO hostile_takeover_supports
          (hostile_takeover_event_id, user_id, side, cash_amount)
        VALUES (?, ?, 'defense', ?)
        ON CONFLICT(hostile_takeover_event_id, user_id, side)
        DO UPDATE SET cash_amount = cash_amount + excluded.cash_amount
      `).run(event.id, defenderId, amount);
      db.prepare(`
        INSERT INTO asset_events
          (user_id, event_type, amount, balance_before, balance_after, source_type, source_id, detail_json)
        VALUES (?, 'hostile_takeover_defense', ?, ?, ?, 'hostile_takeover', ?, ?)
      `).run(defenderId, -amount, defender.balance, balanceAfter, `defense:${event.id}:${Date.now()}`, JSON.stringify({ hostileTakeoverEventId: event.id, stockId }));
      return { amount, endsAt: event.ends_at };
    })();
    return res.json({ message: "방어 자금을 투입했어요. 공개 입찰 종료까지 방어력이 유지됩니다.", hostileTakeover: result });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

stocksRouter.post("/:id/delist-by-owner", (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    db.transaction(() => {
      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(id);
      
      if (!stock || stock.status !== 'acquired' || !stock.is_etf) throw new Error("상장폐지할 수 없는 상태입니다.");
      if (stock.owner_user_id !== userId) throw new Error("회사의 소유자만 상장폐지할 수 있어요.");
      assertStockMarketOpen(db);

      delistStock(db, stock);

      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      
      db.prepare(`
        INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, balance_before, balance_after)
        VALUES (?, ?, 'owner_delist', 0, 0, 0, 1, ?, ?)
      `).run(userId, id, user.balance, user.balance);
      
      createServerNotification(db, {
        userId,
        nickname: user.nickname,
        type: "stock_owner_delisted",
        title: "소유자 상장폐지",
        message: `${user.nickname}님이 인수한 ${stock.name}을(를) 상장폐지시켰습니다.`,
        gameType: "stock",
        gameName: "주식",
        metadata: { stockId: id }
      });
    })();
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: "회사를 상장폐지시켰습니다. 새로운 공모주가 곧 등장합니다." });
});
