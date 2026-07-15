import { calculateLeveragedPositionOutcome } from "./leverageRiskService.js";
import {
  calculateLeverageCloseSettlement,
  calculateSpotSellSettlement,
} from "./stockFeeService.js";
import {
  calculateStockTaxLedgerImpact,
  getUserStockTaxLedger,
} from "./stockTaxLedgerService.js";
import { getHoldingTotalCostBasis } from "./stockSettlementService.js";

function numeric(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function stockExcluded(stockId, excluded) {
  return excluded.has(Number(stockId));
}

function ownerAssetEtf(row) {
  return row.is_etf === 1 && (
    row.etf_tracking_type === "owner_asset" ||
    (row.etf_tracking_type == null && row.owner_user_id !== null && row.owner_user_id !== undefined)
  );
}

function resolveValuationPrice(database, row) {
  if (row.status === "delisted") {
    return { price: 0, source: "delisted" };
  }
  const currentPrice = Math.floor(numeric(row.current_price));
  if (currentPrice > 0) {
    return { price: currentPrice, source: "current_price" };
  }

  const recentTrade = database.prepare(`
    SELECT price
    FROM stock_trades
    WHERE stock_id = ?
      AND price > 0
      AND trade_type IN ('buy', 'sell')
    ORDER BY id DESC
    LIMIT 1
  `).get(row.stock_id);
  if (Number(recentTrade?.price) > 0) {
    return { price: Math.floor(Number(recentTrade.price)), source: "recent_normal_trade" };
  }

  const recentHistory = database.prepare(`
    SELECT price
    FROM stock_price_history
    WHERE stock_id = ?
      AND price > 0
      AND COALESCE(event_type, '') NOT IN ('final_crash', 'delisted')
    ORDER BY id DESC
    LIMIT 1
  `).get(row.stock_id);
  if (Number(recentHistory?.price) > 0) {
    return { price: Math.floor(Number(recentHistory.price)), source: "recent_normal_history" };
  }

  const snapshotPrice = Math.floor(numeric(row.daily_anchor_price));
  if (snapshotPrice > 0) {
    return { price: snapshotPrice, source: "last_normal_snapshot" };
  }

  return {
    price: null,
    source: "unavailable",
    error: {
      code: "STOCK_VALUATION_PRICE_UNAVAILABLE",
      stockId: Number(row.stock_id),
      symbol: row.symbol || null,
      message: `${row.name || row.symbol || `#${row.stock_id}`}의 정상 평가 가격을 찾을 수 없습니다.`,
    },
  };
}

function allocateEstimatedTaxes(items, totalTax) {
  const taxable = items.filter((item) => item.taxableProfit > 0);
  const totalProfit = taxable.reduce((sum, item) => sum + item.taxableProfit, 0);
  if (totalTax <= 0 || totalProfit <= 0) {
    for (const item of items) item.estimatedCapitalGainsTax = 0;
    return;
  }
  let assigned = 0;
  taxable.forEach((item, index) => {
    const tax = index === taxable.length - 1
      ? totalTax - assigned
      : Math.floor(totalTax * (item.taxableProfit / totalProfit));
    item.estimatedCapitalGainsTax = Math.max(0, tax);
    assigned += item.estimatedCapitalGainsTax;
  });
  for (const item of items) {
    if (item.taxableProfit <= 0) item.estimatedCapitalGainsTax = 0;
  }
}

export function calculateUserTotalEvaluatedAsset(database, userId, options = {}) {
  const user = database.prepare("SELECT balance FROM users WHERE id = ?").get(userId);
  if (!user) {
    return {
      cashBalance: 0,
      grossStockMarketValue: 0,
      estimatedStockSellFees: 0,
      estimatedStockTaxes: 0,
      stockNetLiquidationValue: 0,
      leverageGrossSettlementValue: 0,
      estimatedLeverageCloseFees: 0,
      estimatedLeverageTaxes: 0,
      leverageNetSettlementValue: 0,
      otherEligibleAssetValue: 0,
      stockValue: 0,
      positionValue: 0,
      unrealizedPnl: 0,
      totalEvaluatedAsset: 0,
      valuationComplete: false,
      valuationErrors: [{ code: "USER_NOT_FOUND", userId: Number(userId) }],
      holdings: [],
      positions: [],
    };
  }

  const excludedStockIds = new Set((options.excludeStockIds || []).map(Number));
  const excludedPositionStockIds = new Set(
    (options.excludePositionsForStockIds || options.excludeStockIds || []).map(Number),
  );
  const excludeOwnEtfs = options.excludeOwnEtfs !== false;
  const excludeOwnerAssetEtfs = options.excludeOwnerAssetEtfs === true;
  const stockColumns = new Set(
    database.prepare("PRAGMA table_info(stocks)").all().map((column) => column.name),
  );
  const stockField = (name, fallback = "NULL") => (
    stockColumns.has(name) ? `s.${name}` : `${fallback} AS ${name}`
  );

  const holdingRows = database.prepare(`
    SELECT h.*, ${stockField("name")}, ${stockField("symbol")}, s.current_price,
           s.status, s.is_etf, s.owner_user_id, ${stockField("etf_tracking_type")},
           ${stockField("daily_anchor_price")}
    FROM stock_holdings h
    JOIN stocks s ON s.id = h.stock_id
    WHERE h.user_id = ? AND h.quantity > 0
  `).all(userId).filter((row) =>
    !stockExcluded(row.stock_id, excludedStockIds) &&
    !(excludeOwnEtfs && row.is_etf === 1 && row.owner_user_id === userId) &&
    !(excludeOwnerAssetEtfs && ownerAssetEtf(row)),
  );

  const positionRows = options.excludeAllPositions === true ? [] : database.prepare(`
    SELECT p.*, s.current_price, s.status, s.delist_risk_status, s.market_cap,
           s.is_bluechip, s.is_etf, s.owner_user_id, ${stockField("etf_tracking_type")},
           ${stockField("name")}, ${stockField("symbol")}, ${stockField("daily_anchor_price")}
    FROM stock_positions p
    JOIN stocks s ON s.id = p.stock_id
    WHERE p.user_id = ? AND p.status = 'open'
  `).all(userId).filter((row) =>
    !stockExcluded(row.stock_id, excludedPositionStockIds) &&
    !(excludeOwnEtfs && row.is_etf === 1 && row.owner_user_id === userId) &&
    !(excludeOwnerAssetEtfs && ownerAssetEtf(row)),
  );

  const valuationErrors = [];

  const holdings = holdingRows.map((holding) => {
    const quantity = numeric(holding.quantity);
    const resolvedPrice = resolveValuationPrice(database, holding);
    if (resolvedPrice.error) valuationErrors.push(resolvedPrice.error);
    const currentPrice = resolvedPrice.price ?? 0;
    const totalCostBasis = getHoldingTotalCostBasis(holding);
    const beforeTax = calculateSpotSellSettlement({
      sellQuantity: quantity,
      sellPrice: currentPrice,
      averagePrice: holding.average_price,
      costBasis: totalCostBasis,
      capitalGainsTax: 0,
    });
    return {
      stockId: holding.stock_id,
      name: holding.name || null,
      symbol: holding.symbol || null,
      quantity,
      averagePrice: numeric(holding.average_price),
      totalCostBasis,
      currentPrice,
      valuationPriceSource: resolvedPrice.source,
      grossMarketValue: beforeTax.grossSellAmount,
      estimatedSellFee: beforeTax.sellFee,
      proceedsAfterFee: beforeTax.proceedsAfterFee,
      unrealizedProfitBeforeTax: beforeTax.realizedProfitBeforeTax,
      taxableProfit: Math.max(0, beforeTax.realizedProfitBeforeTax),
      estimatedCapitalGainsTax: 0,
      netLiquidationValue: beforeTax.proceedsAfterFee,
    };
  });

  const positions = positionRows.map((position) => {
    const resolvedPrice = resolveValuationPrice(database, position);
    if (resolvedPrice.error) valuationErrors.push(resolvedPrice.error);
    const closePrice = resolvedPrice.price ?? 0;
    const outcome = calculateLeveragedPositionOutcome(position, position, closePrice);
    const beforeTax = outcome.liquidated
      ? {
        closeFee: 0,
        realizedPnlBeforeTax: -numeric(position.margin_amount),
        finalPayout: 0,
      }
      : calculateLeverageCloseSettlement({
        cappedPnl: outcome.cappedPnl,
        positionSize: Number(position.position_size || (Number(position.margin_amount || 0) * Number(position.leverage || 1))),
        marginAmount: position.margin_amount,
        capitalGainsTax: 0,
      });
    return {
      positionId: position.id,
      stockId: position.stock_id,
      name: position.name || null,
      symbol: position.symbol || null,
      side: position.side,
      leverage: numeric(position.leverage),
      marginAmount: numeric(position.margin_amount),
      currentPrice: closePrice,
      valuationPriceSource: resolvedPrice.source,
      grossSettlementValue: Math.max(0, Math.floor(beforeTax.finalPayout || 0)),
      estimatedCloseFee: Math.max(0, Math.floor(beforeTax.closeFee || 0)),
      unrealizedProfitBeforeTax: Math.floor(beforeTax.realizedPnlBeforeTax || 0),
      taxableProfit: Math.max(0, Math.floor(beforeTax.realizedPnlBeforeTax || 0)),
      estimatedCapitalGainsTax: 0,
      netSettlementValue: Math.max(0, Math.floor(beforeTax.finalPayout || 0)),
      liquidated: outcome.liquidated,
      outcome,
    };
  });

  const taxableItems = [...holdings, ...positions];
  const totalPositiveUnrealizedProfit = taxableItems.reduce(
    (sum, item) => sum + item.taxableProfit,
    0,
  );
  const totalUnrealizedProfitBeforeTax = taxableItems.reduce(
    (sum, item) => sum + item.unrealizedProfitBeforeTax,
    0,
  );
  const ledger = getUserStockTaxLedger(database, userId);
  const taxImpact = calculateStockTaxLedgerImpact(ledger, totalUnrealizedProfitBeforeTax);
  allocateEstimatedTaxes(taxableItems, taxImpact.incrementalTax);

  for (const holding of holdings) {
    holding.netLiquidationValue = Math.max(0, holding.proceedsAfterFee - holding.estimatedCapitalGainsTax);
    holding.unrealizedProfitAfterEstimatedTax = holding.netLiquidationValue - holding.totalCostBasis;
  }
  for (const position of positions) {
    position.netSettlementValue = Math.max(0, position.grossSettlementValue - position.estimatedCapitalGainsTax);
  }

  const cashBalance = Math.floor(numeric(user.balance));
  const grossStockMarketValue = Math.floor(holdings.reduce((sum, holding) => sum + holding.grossMarketValue, 0));
  const estimatedStockSellFees = Math.floor(holdings.reduce((sum, holding) => sum + holding.estimatedSellFee, 0));
  const estimatedStockTaxes = Math.floor(holdings.reduce((sum, holding) => sum + holding.estimatedCapitalGainsTax, 0));
  const stockNetLiquidationValue = Math.floor(holdings.reduce((sum, holding) => sum + holding.netLiquidationValue, 0));
  const leverageGrossSettlementValue = Math.floor(positions.reduce((sum, position) => sum + position.grossSettlementValue, 0));
  const estimatedLeverageCloseFees = Math.floor(positions.reduce((sum, position) => sum + position.estimatedCloseFee, 0));
  const estimatedLeverageTaxes = Math.floor(positions.reduce((sum, position) => sum + position.estimatedCapitalGainsTax, 0));
  const leverageNetSettlementValue = Math.floor(positions.reduce((sum, position) => sum + position.netSettlementValue, 0));
  const unrealizedPnl = Math.floor(taxableItems.reduce((sum, item) => sum + item.unrealizedProfitBeforeTax, 0));
  const otherEligibleAssetValue = Math.max(0, Math.floor(numeric(options.otherEligibleAssetValue)));
  const totalEvaluatedAsset = Math.max(
    0,
    cashBalance + stockNetLiquidationValue + leverageNetSettlementValue + otherEligibleAssetValue,
  );
  const valuationComplete = valuationErrors.length === 0;

  if (!valuationComplete && options.throwOnIncomplete === true) {
    const error = new Error("총평가금액을 완전하게 계산할 수 없습니다.");
    error.code = "INCOMPLETE_ASSET_VALUATION";
    error.valuationErrors = valuationErrors;
    throw error;
  }

  return {
    cashBalance,
    grossStockMarketValue,
    estimatedStockSellFees,
    estimatedStockTaxes,
    stockNetLiquidationValue,
    leverageGrossSettlementValue,
    estimatedLeverageCloseFees,
    estimatedLeverageTaxes,
    leverageNetSettlementValue,
    otherEligibleAssetValue,
    totalPositiveUnrealizedProfit,
    estimatedIncrementalTax: taxImpact.incrementalTax,
    taxLedger: ledger,
    stockValue: stockNetLiquidationValue,
    positionValue: leverageNetSettlementValue,
    unrealizedPnl,
    totalEvaluatedAsset,
    valuationComplete,
    valuationErrors,
    holdings,
    positions,
  };
}

export function calculateOwnerEtfTrackingAsset(database, ownerUserId, excludedStockId = null) {
  const excludedStockIds = excludedStockId === null || excludedStockId === undefined
    ? []
    : [excludedStockId];
  const valuation = calculateUserTotalEvaluatedAsset(database, ownerUserId, {
    excludeStockIds: excludedStockIds,
    excludePositionsForStockIds: excludedStockIds,
    excludeOwnEtfs: true,
    // Every owner-asset ETF is excluded. This prevents A owning B's ETF and
    // B owning A's ETF from feeding either ETF's next tracking value.
    excludeOwnerAssetEtfs: true,
    excludeAllPositions: true,
  });
  return Math.max(1, valuation.totalEvaluatedAsset);
}

// Kept for existing callers while the ETF-specific name is adopted.
export const calculateOwnerTrackingAsset = calculateOwnerEtfTrackingAsset;

export function getPortfolioSnapshot(database, userId, options = {}) {
  return calculateUserTotalEvaluatedAsset(database, userId, options);
}
