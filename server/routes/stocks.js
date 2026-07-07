import express from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { createServerNotification } from "../services/serverNotificationService.js";
import {
  ACTIVE_TRADABLE_STOCK_STATUSES,
  delistStock,
  recalculateOwnerEtfs,
  requiredCompanyAcquisitionBalance,
  getStockMarketClock,
  settleDueIpoSubscriptions,
  STOCK_MARKET_POLICY,
} from "../services/stockService.js";
import { getPortfolioSnapshot } from "../services/portfolioValuationService.js";
import { calculateUserTotalEvaluatedAsset } from "../services/portfolioValuationService.js";
import {
  assertStockMarketOpen,
  isStockMarketOpen,
} from "../services/marketStateService.js";
import { addJackpotContribution } from "../services/economyRtpService.js";
import { formatWon } from "../utils/formatWon.js";

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

  const processStock = (s) => {
    return {
      ...s,
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
      adminPriceTargetStartedByUserId: s.admin_price_target_started_by_user_id
    };
  };

  const stocks = stocksRaw.map(processStock);
  const recentDelistedStocks = recentDelisted.map(processStock);

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
    SELECT * FROM stock_events 
    ORDER BY created_at DESC LIMIT 20
  `).all();
  res.json({ news });
});

stocksRouter.use(requireAuth);

stocksRouter.get("/portfolio", (req, res) => {
  const userId = req.user.id;
  
  const holdings = db.prepare(`
    SELECT h.*, s.symbol, s.name, s.current_price, s.status, s.is_etf,
           (s.current_price - h.average_price) * h.quantity as unrealized_pnl,
           (s.current_price * h.quantity) as value
    FROM stock_holdings h
    JOIN stocks s ON h.stock_id = s.id
    WHERE h.user_id = ? AND h.quantity > 0
  `).all(userId);

  const positions = db.prepare(`
    SELECT p.*, s.symbol, s.name, s.current_price as stock_current_price, s.status as stock_status,
           CASE 
             WHEN p.side = 'short' THEN (p.entry_price - s.current_price) * p.quantity
             ELSE (s.current_price - p.entry_price) * p.quantity 
           END as live_unrealized_pnl
    FROM stock_positions p
    JOIN stocks s ON p.stock_id = s.id
    WHERE p.user_id = ? AND p.status = 'open'
  `).all(userId);

  res.json({ holdings, positions });
});

stocksRouter.get("/market-snapshot", (req, res) => {
  const userId = req.user.id;
  settleDueIpoSubscriptions(db);
  const clock = getStockMarketClock();

  // 폴링 시 실시간으로 ETF 가격 최신화
  recalculateOwnerEtfs(db);

  const stocksRaw = db.prepare(`
    SELECT * FROM stocks 
    WHERE status != 'delisted'
    ORDER BY market_cap DESC
  `).all();

  const portfolio = getPortfolioSnapshot(db, userId);

  const holdings = db.prepare(`
    SELECT h.*, s.symbol, s.name, s.current_price, s.status, s.is_etf,
           (s.current_price - h.average_price) * h.quantity as unrealized_pnl,
           (s.current_price * h.quantity) as value
    FROM stock_holdings h
    JOIN stocks s ON h.stock_id = s.id
    WHERE h.user_id = ? AND h.quantity > 0
  `).all(userId);

  const positions = db.prepare(`
    SELECT p.*, s.symbol, s.name, s.current_price as stock_current_price, s.status as stock_status,
           CASE 
             WHEN p.side = 'short' THEN (p.entry_price - s.current_price) * p.quantity
             ELSE (s.current_price - p.entry_price) * p.quantity 
           END as live_unrealized_pnl
    FROM stock_positions p
    JOIN stocks s ON p.stock_id = s.id
    WHERE p.user_id = ? AND p.status = 'open'
  `).all(userId);

  const processStock = (s) => {
    return {
      ...s,
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
      offeringChangeRate: s.offering_price ? (s.current_price - s.offering_price) / s.offering_price : null
    };
  };

  const stocks = stocksRaw.map(processStock);
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
    portfolio: { ...portfolio, holdings, positions }
  });
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
    : { totalEvaluatedAsset: 0 };
  const userTotalEvaluatedAsset = Math.floor(
    Number(valuation.totalEvaluatedAsset || 0),
  );
  const userCashBalance = Math.floor(Number(user?.balance || 0));
  const autoSellRow =
    user && stock
      ? db
          .prepare(
            `SELECT TOTAL(h.quantity * s.current_price) AS value
             FROM stock_holdings h
             JOIN stocks s ON s.id = h.stock_id
             WHERE h.user_id = ?
               AND h.stock_id = ?
               AND h.quantity > 0`,
          )
          .get(user.id, stock.id)
      : null;
  const autoSellValue = Math.floor(Number(autoSellRow?.value || 0));
  const autoCloseValue = user && stock
    ? db
        .prepare(
          `SELECT p.side, p.margin_amount, p.quantity, p.entry_price, s.current_price
           FROM stock_positions p
           JOIN stocks s ON s.id = p.stock_id
           WHERE p.user_id = ?
             AND p.stock_id = ?
             AND p.status = 'open'`,
        )
        .all(user.id, stock.id)
        .reduce((sum, position) => {
          const direction = position.side === "short" ? -1 : 1;
          const pnl = Math.floor(
            position.quantity *
              (position.current_price - position.entry_price) *
              direction,
          );
          return sum + Math.max(0, Math.floor(position.margin_amount + pnl));
        }, 0)
    : 0;
  const estimatedCashAfterAutoClear =
    userCashBalance + autoSellValue + autoCloseValue;
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
  } else if (userTotalEvaluatedAsset < requiredTotalAsset) {
    canAcquire = false;
    reason = "total_asset_required";
  } else if (estimatedCashAfterAutoClear < acquisitionPrice) {
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
    autoSellValue,
    autoCloseValue,
    estimatedCashAfterAutoClear,
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
    const direction = row.side === "short" ? -1 : 1;
    const unrealizedPnl = Math.floor(
      row.quantity * (row.current_price - row.entry_price) * direction,
    );
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
      unrealizedPnl,
      profitRate: row.margin_amount > 0 ? unrealizedPnl / row.margin_amount : 0,
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

  const processStock = (s) => ({
    ...s,
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
    adminPriceTargetStartedByUserId: s.admin_price_target_started_by_user_id
  });

  const stockWithCalculations = processStock(stock);

  const history = db.prepare(`
    SELECT * FROM stock_price_history 
    WHERE stock_id = ? 
    ORDER BY created_at DESC LIMIT 60
  `).all(id).reverse(); // Last 10 minutes (60 ticks)

  const holding = db.prepare("SELECT * FROM stock_holdings WHERE user_id = ? AND stock_id = ?").get(req.user.id, id);
  const positions = db.prepare("SELECT * FROM stock_positions WHERE user_id = ? AND stock_id = ? AND status = 'open'").all(req.user.id, id);
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
    const defender = db
      .prepare("SELECT balance FROM users WHERE id = ?")
      .get(stock.owner_user_id);
    if (defender) {
      const cost = Math.floor(defender.balance * 0.2);
      hostileTakeover = {
        cost,
        requiredBalance: requiredCompanyAcquisitionBalance(cost),
        balanceMultiplier: STOCK_MARKET_POLICY.companyAcquisitionBalanceMultiplier,
      };
    }
  }

  const events = db.prepare(`
    SELECT * FROM stock_events 
    WHERE stock_id = ? 
    ORDER BY created_at DESC LIMIT 20
  `).all(id);

  res.json({
    stock: stockWithCalculations,
    history,
    holding,
    positions,
    trades,
    events,
    marketOpen: isStockMarketOpen(db),
    ...clock,
    acquisition,
    hostileTakeover,
  });
});

stocksRouter.post("/buy", (req, res) => {
  const { stockId, quantity } = req.body; // quantity is the number of shares
  const userId = req.user.id;

  if (!quantity || quantity <= 0) return res.status(400).json({ message: "매수 수량을 올바르게 입력해주세요." });

  let result;
  try {
    result = db.transaction(() => {
      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
      if (!stock || stock.status === 'delisted') throw new Error("거래할 수 없는 종목입니다.");
      
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      assertCanOpenNewStockTrade(user, stock);

      const amount = Math.floor(quantity * stock.current_price);
      if (amount <= 0) throw new Error("매수 금액이 너무 작습니다.");

      if (user.balance < amount) throw new Error("잔액이 부족해요.");
      
      let holding = db.prepare("SELECT * FROM stock_holdings WHERE user_id = ? AND stock_id = ?").get(userId, stockId);
      if (holding) {
        const totalCost = (holding.average_price * holding.quantity) + amount;
        const newQuantity = holding.quantity + quantity;
        const newAvgPrice = totalCost / newQuantity;
        db.prepare("UPDATE stock_holdings SET quantity = ?, average_price = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(newQuantity, newAvgPrice, holding.id);
      } else {
        db.prepare("INSERT INTO stock_holdings (user_id, stock_id, quantity, average_price) VALUES (?, ?, ?, ?)").run(userId, stockId, quantity, stock.current_price);
      }

      const balanceAfter = user.balance - amount;
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, userId);

      db.prepare(`
        INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id)
        VALUES (?, 'stock_buy', ?, ?, ?, ?)
      `).run(userId, -amount, user.balance, balanceAfter, stockId);

      db.prepare(`
        INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, balance_before, balance_after)
        VALUES (?, ?, 'buy', ?, ?, ?, 1, ?, ?)
      `).run(userId, stockId, amount, quantity, stock.current_price, user.balance, balanceAfter);

      return { balance: balanceAfter, stockPrice: stock.current_price };
    })();
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: "매수 주문이 체결되었어요.", ...result });
});

stocksRouter.post("/buy-ipo", (req, res) => {
  const { stockId, amount } = req.body;
  const userId = req.user.id;

  if (!amount || amount <= 0) return res.status(400).json({ message: "올바른 구매 금액을 입력해주세요." });

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
      if (user.balance < amount) throw new Error("잔액이 부족해요.");

      const quantity = amount / stock.offering_price;

      let holding = db.prepare("SELECT * FROM stock_holdings WHERE user_id = ? AND stock_id = ?").get(userId, stockId);
      if (holding) {
        const newQuantity = holding.quantity + quantity;
        const totalCost = (holding.average_price * holding.quantity) + amount;
        const newAvg = totalCost / newQuantity;
        db.prepare("UPDATE stock_holdings SET quantity = ?, average_price = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(newQuantity, newAvg, holding.id);
      } else {
        db.prepare("INSERT INTO stock_holdings (user_id, stock_id, quantity, average_price) VALUES (?, ?, ?, ?)").run(userId, stockId, quantity, stock.offering_price);
      }

      const balanceAfter = user.balance - amount;
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, userId);

      db.prepare(`
        INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id)
        VALUES (?, 'stock_ipo_subscribe', ?, ?, ?, ?)
      `).run(userId, -amount, user.balance, balanceAfter, stockId);

      db.prepare(`
        INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, balance_before, balance_after)
        VALUES (?, ?, 'ipo_subscribe', ?, ?, ?, 1, ?, ?)
      `).run(userId, stockId, amount, quantity, stock.offering_price, user.balance, balanceAfter);

      return { balance: balanceAfter };
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
      if (!stock || stock.status === 'delisted') {
        // If delisted, allow selling but at 0 price
        if (stock && stock.status === 'delisted') {
           db.prepare("UPDATE stock_holdings SET quantity = 0 WHERE id = ?").run(holding.id);
           return { balance: req.user.balance, amountSold: 0 };
        }
        throw new Error("거래할 수 없는 종목입니다.");
      }
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      assertStockTradeAllowed(stock);

      const sellQuantity = holding.quantity * fraction;
      const grossSellAmount = Math.floor(sellQuantity * stock.current_price);
      const grossRealizedPnl = Math.floor(sellQuantity * (stock.current_price - holding.average_price));
      const jackpotContribution = grossRealizedPnl > 0 ? Math.floor(grossRealizedPnl * 0.01) : 0;
      const sellAmount = Math.max(0, grossSellAmount - jackpotContribution);
      const realizedPnl = grossRealizedPnl - jackpotContribution;
      if (jackpotContribution > 0) {
        addJackpotContribution(db, jackpotContribution);
      }

      const newQuantity = holding.quantity - sellQuantity;
      db.prepare("UPDATE stock_holdings SET quantity = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(newQuantity, holding.id);

      const balanceAfter = user.balance + sellAmount;
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, userId);

      db.prepare(`
        INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id, detail_json)
        VALUES (?, 'stock_sell', ?, ?, ?, ?, ?)
      `).run(
        userId,
        sellAmount,
        user.balance,
        balanceAfter,
        stockId,
        JSON.stringify({
          grossSellAmount,
          grossRealizedPnl,
          jackpotPoolContribution: jackpotContribution,
          netRealizedPnl: realizedPnl,
        }),
      );

      db.prepare(`
        INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, realized_pnl, balance_before, balance_after)
        VALUES (?, ?, 'sell', ?, ?, ?, 1, ?, ?, ?)
      `).run(userId, stockId, sellAmount, sellQuantity, stock.current_price, realizedPnl, user.balance, balanceAfter);

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

      return { balance: balanceAfter, amountSold: sellAmount, realizedPnl, jackpotPoolContribution: jackpotContribution };
    })();
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: "매도 주문이 체결되었어요.", ...result });
});

stocksRouter.post("/open-position", (req, res) => {
  const { stockId, margin, leverage, side = "long" } = req.body;
  const userId = req.user.id;

  if (!margin || margin <= 0 || !leverage || leverage <= 1) return res.status(400).json({ message: "증거금 또는 레버리지가 올바르지 않아요." });
  if (![2, 5, 10, 50, 100].includes(leverage)) return res.status(400).json({ message: "지원하지 않는 레버리지 배율이에요." });
  if (!["long", "short"].includes(side)) return res.status(400).json({ message: "포지션 방향이 올바르지 않아요." });

  let result;
  try {
    result = db.transaction(() => {
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      if (user.balance < margin) throw new Error("잔액이 부족해요.");

      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
      if (!stock || stock.status === 'delisted') throw new Error("거래할 수 없는 종목입니다.");
      
      assertCanOpenNewStockTrade(user, stock);
      if (stock.is_bluechip === 1 && leverage > 10) throw new Error("우량주는 10배까지만 레버리지가 가능합니다.");

      const positionSize = margin * leverage;
      const quantity = positionSize / stock.current_price;
      const liquidationPrice = side === "short" 
        ? Math.ceil(stock.current_price * (1 + 1 / leverage))
        : Math.floor(stock.current_price * (1 - 1 / leverage));

      db.prepare(`
        INSERT INTO stock_positions (user_id, stock_id, side, margin_amount, leverage, position_size, quantity, entry_price, liquidation_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, stockId, side, margin, leverage, positionSize, quantity, stock.current_price, liquidationPrice);

      const balanceAfter = user.balance - margin;
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, userId);

      db.prepare(`
        INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id)
        VALUES (?, 'stock_position_open', ?, ?, ?, ?)
      `).run(userId, -margin, user.balance, balanceAfter, stockId);

      db.prepare(`
        INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, balance_before, balance_after)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, stockId, `open_${side}`, margin, quantity, stock.current_price, leverage, user.balance, balanceAfter);

      return { balance: balanceAfter };
    })();
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: `${leverage}배 레버리지 포지션을 열었어요.`, ...result });
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

      let unrealizedPnl = 0;
      if (position.side === "short") {
        unrealizedPnl = (position.entry_price - closePrice) * position.quantity;
        if (closePrice === 0) { // Delisted cap
          const maxShortProfit = position.margin_amount * position.leverage * 0.95;
          unrealizedPnl = Math.min(unrealizedPnl, maxShortProfit);
        }
      } else {
        unrealizedPnl = (closePrice - position.entry_price) * position.quantity;
      }

      const grossRealizedPnl = Math.floor(unrealizedPnl);
      const jackpotContribution = grossRealizedPnl > 0 ? Math.floor(grossRealizedPnl * 0.01) : 0;
      if (jackpotContribution > 0) {
        addJackpotContribution(db, jackpotContribution);
      }
      const payout = Math.floor(position.margin_amount + grossRealizedPnl);
      const finalPayout = Math.max(0, payout - jackpotContribution); // Cannot lose more than margin if manually closed before liquidation processing
      const realizedPnl = grossRealizedPnl - jackpotContribution;

      db.prepare(`
        UPDATE stock_positions 
        SET status = 'closed', closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), unrealized_pnl = 0, realized_pnl = ?
        WHERE id = ?
      `).run(realizedPnl, position.id);

      const balanceAfter = user.balance + finalPayout;
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, userId);

      db.prepare(`
        INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id, detail_json)
        VALUES (?, 'stock_position_close', ?, ?, ?, ?, ?)
      `).run(
        userId,
        finalPayout,
        user.balance,
        balanceAfter,
        stock.id,
        JSON.stringify({
          grossPayout: Math.max(0, payout),
          grossRealizedPnl,
          jackpotPoolContribution: jackpotContribution,
          netRealizedPnl: realizedPnl,
        }),
      );

      db.prepare(`
        INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, realized_pnl, balance_before, balance_after)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, stock.id, `close_${position.side || "long"}`, finalPayout, position.quantity, closePrice, position.leverage, realizedPnl, user.balance, balanceAfter);

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

      return { balance: balanceAfter, payout: finalPayout, realizedPnl, jackpotPoolContribution: jackpotContribution };
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
      const userTotalEvaluatedAsset =
        calculateUserTotalEvaluatedAsset(db, userId).totalEvaluatedAsset;
      if (userTotalEvaluatedAsset < requiredTotalAsset) {
        throw new Error(
          `회사를 인수하려면 총 평가자산이 인수 금액의 ${STOCK_MARKET_POLICY.companyAcquisitionBalanceMultiplier}배(${formatWon(requiredTotalAsset)}) 이상이어야 해요.`,
        );
      }

      const existingEtf = db.prepare("SELECT id FROM stocks WHERE owner_user_id = ? AND is_etf = 1 AND status = 'acquired'").get(userId);
      if (existingEtf) throw new Error("인수자 ETF는 한 개만 보유할 수 있습니다.");

      // Auto-clear existing holdings and positions to prevent owning own ETF
      const holding = db.prepare("SELECT * FROM stock_holdings WHERE user_id = ? AND stock_id = ?").get(userId, id);
      let clearedAmount = 0;
      if (holding && holding.quantity > 0) {
        const sellAmount = Math.floor(holding.quantity * stock.current_price);
        clearedAmount += sellAmount;
        db.prepare("UPDATE stock_holdings SET quantity = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(holding.id);
        
        db.prepare(`
          INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id)
          VALUES (?, 'stock_auto_sell_acquire', ?, ?, ?, ?)
        `).run(userId, sellAmount, user.balance, user.balance + sellAmount, id);

        db.prepare(`
          INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, balance_before, balance_after)
          VALUES (?, ?, 'sell', ?, ?, ?, 1, ?, ?)
        `).run(userId, id, sellAmount, holding.quantity, stock.current_price, user.balance, user.balance + sellAmount);
      }

      const positions = db.prepare("SELECT * FROM stock_positions WHERE user_id = ? AND stock_id = ? AND status = 'open'").all(userId, id);
      for (const pos of positions) {
        const pnl = Math.floor(pos.quantity * (stock.current_price - pos.entry_price));
        const payout = Math.max(0, pos.margin_amount + pnl);
        clearedAmount += payout;
        
        db.prepare("UPDATE stock_positions SET status = 'closed', closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), close_price = ?, realized_pnl = ?, payout_amount = ? WHERE id = ?")
          .run(stock.current_price, pnl, payout, pos.id);

        db.prepare(`
          INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id)
          VALUES (?, 'stock_auto_close_acquire', ?, ?, ?, ?)
        `).run(userId, payout, user.balance, user.balance + payout, id);
      }
      
      if (clearedAmount > 0) {
        user.balance += clearedAmount; // Update local user balance for the next check
        db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(user.balance, userId);
      }

      const cost = acquisitionPrice;
      if (user.balance < cost) {
        throw new Error(
          `인수 비용 ${formatWon(cost)}을 현금으로 보유해야 해요.`,
        );
      }
      const balanceAfter = user.balance - cost;
      
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, userId);
      const ownerAsset = Math.max(
        calculateUserTotalEvaluatedAsset(db, userId).totalEvaluatedAsset,
        1,
      );
      
      db.prepare(`
        UPDATE stocks 
        SET status = 'acquired', is_etf = 1, etf_tracking_type = 'owner_asset', 
            owner_user_id = ?, owner_nickname_snapshot = ?,
            etf_base_price = current_price,
            etf_base_owner_asset = ?, etf_last_tracked_owner_asset = ?,
            etf_acquisition_cost = ?
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
            etf_acquisition_cost = NULL
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
      if (attacker.balance < requiredBalance) {
        throw new Error(
          `적대적 M&A를 하려면 인수 비용의 ${STOCK_MARKET_POLICY.companyAcquisitionBalanceMultiplier}배(${formatWon(requiredBalance)})를 보유해야 해요.`,
        );
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

      const attackerAsset = Math.max(
        calculateUserTotalEvaluatedAsset(db, attackerId).totalEvaluatedAsset,
        1,
      );

      // Transfer ETF ownership
      db.prepare(`
        UPDATE stocks 
        SET owner_user_id = ?, owner_nickname_snapshot = ?,
            etf_base_price = current_price,
            etf_base_owner_asset = ?, etf_last_tracked_owner_asset = ?,
            etf_acquisition_cost = ?
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
