export const EOK = 100_000_000;
export const JO = 1_000_000_000_000;

export const LEVERAGE_BLOCKED_STATUSES = new Set([
  "caution",
  "distress_review",
  "delist_review",
  "recovery",
  "final_crash",
  "delisted",
  "ipo_subscription",
]);

export const MAX_LEVERAGE_PROFIT_MULTIPLIER = {
  normal: 10,
  highRisk: 3,
  delistRisk: 1.5,
};

function stockStatusValues(stock = {}) {
  return [stock.status, stock.delist_risk_status].filter(Boolean);
}

export function getLeverageRiskLevel(stock = {}) {
  const statuses = stockStatusValues(stock);
  if (statuses.some((status) => ["delist_review", "final_crash", "delisted"].includes(status))) {
    return "delistRisk";
  }
  if (
    statuses.some((status) => ["caution", "recovery"].includes(status)) ||
    Number(stock.market_cap || 0) < 60 * EOK ||
    stock.market_cap_tier === "danger_micro"
  ) {
    return "highRisk";
  }
  return "normal";
}

export function getMaxAllowedLeverage(stock = {}) {
  if (LEVERAGE_BLOCKED_STATUSES.has(stock.status) || LEVERAGE_BLOCKED_STATUSES.has(stock.delist_risk_status)) {
    return 1;
  }
  if (Number(stock.market_cap || 0) < 60 * EOK) return 1;
  if (stock.market_cap_tier === "danger_micro") return 1;
  if (stock.is_bluechip === 1 || stock.isBlueChip === true || stock.is_blue_chip === 1) return 100;

  const marketCap = Number(stock.market_cap || 0);
  if (marketCap >= 1 * JO) return 50;
  if (marketCap >= 5_000 * EOK) return 20;
  if (marketCap >= 1_000 * EOK) return 10;
  if (marketCap >= 300 * EOK) return 5;
  if (marketCap >= 100 * EOK) return 2;
  return 1;
}

export function assertCanOpenLeveragePosition(stock, requestedLeverage) {
  if (LEVERAGE_BLOCKED_STATUSES.has(stock.status) || LEVERAGE_BLOCKED_STATUSES.has(stock.delist_risk_status)) {
    throw new Error("상장폐지 위험 종목은 레버리지 포지션을 열 수 없어요. 현물 거래만 이용해 주세요.");
  }
  if (Number(stock.market_cap || 0) < 60 * EOK) {
    throw new Error("시가총액 60억 미만 종목은 레버리지 포지션을 열 수 없어요.");
  }
  if (stock.market_cap_tier === "danger_micro") {
    throw new Error("위험 소형주는 레버리지 포지션을 열 수 없어요.");
  }

  const maxLeverage = getMaxAllowedLeverage(stock);
  if (requestedLeverage > maxLeverage) {
    throw new Error(`이 종목은 최대 ${maxLeverage}배까지만 레버리지를 사용할 수 있어요.`);
  }
}

export function shouldLiquidate(position, currentPrice) {
  const price = Number(currentPrice || 0);
  if (position.side === "short") {
    return price >= Number(position.liquidation_price || 0);
  }
  return price <= Number(position.liquidation_price || 0);
}

export function calculateRawLeveragedPnl(position, currentPrice) {
  const price = Number(currentPrice || 0);
  const entryPrice = Number(position.entry_price || 0);
  const quantity = Number(position.quantity || 0);
  const rawPnl =
    position.side === "short"
      ? quantity * (entryPrice - price)
      : quantity * (price - entryPrice);
  return Math.floor(rawPnl);
}

export function capLeveragedPnl({ rawPnl, marginAmount, riskLevel }) {
  const margin = Math.floor(Number(marginAmount || 0));
  const pnl = Math.floor(Number(rawPnl || 0));
  if (pnl <= 0) return Math.max(pnl, -margin);

  const multiplier =
    riskLevel === "delistRisk"
      ? MAX_LEVERAGE_PROFIT_MULTIPLIER.delistRisk
      : riskLevel === "highRisk"
        ? MAX_LEVERAGE_PROFIT_MULTIPLIER.highRisk
        : MAX_LEVERAGE_PROFIT_MULTIPLIER.normal;

  return Math.min(pnl, Math.floor(margin * multiplier));
}

export function calculateLeveragedPositionOutcome(position, stock, closePrice = stock?.current_price) {
  const price = Math.max(0, Math.floor(Number(closePrice || 0)));
  const riskLevel = getLeverageRiskLevel(stock);
  const marginAmount = Math.floor(Number(position.margin_amount || 0));
  const rawPnl = calculateRawLeveragedPnl(position, price);
  const liquidated = shouldLiquidate(position, price);
  const cappedPnl = liquidated
    ? -marginAmount
    : capLeveragedPnl({ rawPnl, marginAmount, riskLevel });

  return {
    side: position.side === "short" ? "short" : "long",
    entryPrice: Number(position.entry_price || 0),
    closePrice: price,
    marginAmount,
    leverage: Number(position.leverage || 1),
    liquidationPrice: Number(position.liquidation_price || 0),
    rawPnl,
    cappedPnl,
    riskLevel,
    profitCapApplied: !liquidated && rawPnl > cappedPnl,
    liquidated,
    payoutBeforeTax: Math.max(0, marginAmount + cappedPnl),
    profitRate: marginAmount > 0 ? cappedPnl / marginAmount : 0,
  };
}
