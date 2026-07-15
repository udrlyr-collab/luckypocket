// Stock fee, progressive capital-gains tax, and dynamic stock tick limits.
// All monetary values are integer KRW.

export const STOCK_FEE_CONFIG = {
  spotBuyFeeRate: 0.001,
  spotSellFeeRate: 0.001,
  leverageOpenFeeRate: 0.0005,
  leverageCloseFeeRate: 0.0005,
};

export const CAPITAL_GAINS_TAX_BRACKETS = [
  { upTo: 100_000, rate: 0.05 },
  { upTo: 1_000_000, rate: 0.10 },
  { upTo: 10_000_000, rate: 0.15 },
  { upTo: 100_000_000, rate: 0.22 },
  { upTo: 1_000_000_000, rate: 0.30 },
  { upTo: 10_000_000_000, rate: 0.38 },
  { upTo: Infinity, rate: 0.45 },
];

export function calculateFee(amount, feeRate) {
  if (!Number.isFinite(amount) || !Number.isFinite(feeRate) || amount <= 0 || feeRate <= 0) return 0;
  return Math.floor(amount * feeRate);
}

export function getMaxAffordableQuantity({
  availableBalance,
  currentPrice,
  buyFeeRate = STOCK_FEE_CONFIG.spotBuyFeeRate,
}) {
  const budget = Math.max(0, Math.floor(Number(availableBalance) || 0));
  const price = Math.max(0, Math.floor(Number(currentPrice) || 0));
  if (budget <= 0 || price <= 0) return 0;

  let low = 0;
  let high = Math.floor(budget / price);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const tradeValue = middle * price;
    const totalCost = tradeValue + calculateFee(tradeValue, buyFeeRate);
    if (totalCost <= budget) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function getMaxAffordableTradeValue({
  availableBalance,
  buyFeeRate = STOCK_FEE_CONFIG.spotBuyFeeRate,
}) {
  const budget = Math.max(0, Math.floor(Number(availableBalance) || 0));
  if (budget <= 0) return 0;

  let low = 0;
  let high = budget;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (middle + calculateFee(middle, buyFeeRate) <= budget) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function getMaxAffordableLeverageMargin({
  availableBalance,
  leverage,
  openFeeRate = STOCK_FEE_CONFIG.leverageOpenFeeRate,
}) {
  const budget = Math.max(0, Math.floor(Number(availableBalance) || 0));
  const multiplier = Math.max(1, Number(leverage) || 1);
  if (budget <= 0) return 0;

  let low = 0;
  let high = budget;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const totalCost = middle + calculateFee(middle * multiplier, openFeeRate);
    if (totalCost <= budget) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function calculateProgressiveCapitalGainsTax(netProfit) {
  if (!Number.isFinite(netProfit) || netProfit <= 0) {
    return { tax: 0, bracketsApplied: [], taxType: "progressive" };
  }

  let remaining = Math.floor(netProfit);
  let previousLimit = 0;
  let tax = 0;
  const bracketsApplied = [];

  for (const bracket of CAPITAL_GAINS_TAX_BRACKETS) {
    const bracketSize = bracket.upTo === Infinity
      ? remaining
      : Math.max(0, bracket.upTo - previousLimit);
    const taxableAmount = Math.min(remaining, bracketSize);
    if (taxableAmount <= 0) break;

    const bracketTax = Math.floor(taxableAmount * bracket.rate);
    tax += bracketTax;
    bracketsApplied.push({
      from: previousLimit,
      to: bracket.upTo === Infinity ? null : previousLimit + taxableAmount,
      rate: bracket.rate,
      taxableAmount,
      tax: bracketTax,
    });

    remaining -= taxableAmount;
    previousLimit = bracket.upTo;
    if (remaining <= 0) break;
  }

  return {
    tax: Math.floor(tax),
    bracketsApplied,
    taxType: "progressive",
  };
}

export function calculateIncrementalCapitalGainsTax({
  previousTaxableProfit = 0,
  newRealizedProfit = 0,
  previouslyPaidTax = null,
}) {
  const previous = Math.max(0, Math.floor(Number(previousTaxableProfit) || 0));
  const realized = Math.max(0, Math.floor(Number(newRealizedProfit) || 0));
  const previousTax = calculateProgressiveCapitalGainsTax(previous);
  const nextTaxableProfit = previous + realized;
  const nextTax = calculateProgressiveCapitalGainsTax(nextTaxableProfit);
  const paid = previouslyPaidTax === null
    ? previousTax.tax
    : Math.max(0, Math.floor(Number(previouslyPaidTax) || 0));
  return {
    previousTaxableProfit: previous,
    newRealizedProfit: realized,
    newCumulativeTaxableProfit: nextTaxableProfit,
    previousTax: previousTax.tax,
    newTotalTax: nextTax.tax,
    incrementalTax: Math.max(0, nextTax.tax - paid),
    taxCreditBalance: Math.max(0, paid - nextTax.tax),
    bracketsApplied: nextTax.bracketsApplied,
    taxType: "progressive_season_cumulative",
  };
}

export function calculateSpotSellSettlement({
  sellQuantity,
  sellPrice,
  averagePrice,
  costBasis: suppliedCostBasis,
  capitalGainsTax: suppliedCapitalGainsTax,
}) {
  const grossSellAmount = Math.floor(sellQuantity * sellPrice);
  const sellFee = calculateFee(grossSellAmount, STOCK_FEE_CONFIG.spotSellFeeRate);
  const proceedsAfterFee = grossSellAmount - sellFee;
  const costBasis = suppliedCostBasis === undefined
    ? Math.floor(sellQuantity * averagePrice)
    : Math.max(0, Math.floor(Number(suppliedCostBasis) || 0));
  const realizedProfitBeforeTax = proceedsAfterFee - costBasis;

  let capitalGainsTax = 0;
  let bracketsApplied = [];
  let finalProfit = realizedProfitBeforeTax;

  if (suppliedCapitalGainsTax !== undefined) {
    capitalGainsTax = Math.max(0, Math.floor(Number(suppliedCapitalGainsTax) || 0));
    finalProfit = realizedProfitBeforeTax - capitalGainsTax;
  } else if (realizedProfitBeforeTax > 0) {
    const taxResult = calculateProgressiveCapitalGainsTax(realizedProfitBeforeTax);
    capitalGainsTax = taxResult.tax;
    bracketsApplied = taxResult.bracketsApplied;

    finalProfit = realizedProfitBeforeTax - capitalGainsTax;
  }

  const finalReceiveAmount = realizedProfitBeforeTax > 0
    ? costBasis + finalProfit
    : proceedsAfterFee;

  return {
    grossSellAmount,
    sellFee,
    proceedsAfterFee,
    costBasis,
    realizedProfitBeforeTax,
    capitalGainsTax,
    bracketsApplied,
    jackpotContribution: capitalGainsTax,
    profitAfterTax: finalProfit,
    finalProfit,
    finalReceiveAmount,
    taxType: "progressive",
  };
}

export function calculateLeverageCloseSettlement({
  cappedPnl,
  positionSize,
  marginAmount,
  capitalGainsTax: suppliedCapitalGainsTax,
}) {
  const closeFee = calculateFee(positionSize, STOCK_FEE_CONFIG.leverageCloseFeeRate);
  const realizedPnlBeforeTax = cappedPnl - closeFee;

  let capitalGainsTax = 0;
  let bracketsApplied = [];
  let finalProfit = realizedPnlBeforeTax;

  if (suppliedCapitalGainsTax !== undefined) {
    capitalGainsTax = Math.max(0, Math.floor(Number(suppliedCapitalGainsTax) || 0));
    finalProfit = realizedPnlBeforeTax - capitalGainsTax;
  } else if (realizedPnlBeforeTax > 0) {
    const taxResult = calculateProgressiveCapitalGainsTax(realizedPnlBeforeTax);
    capitalGainsTax = taxResult.tax;
    bracketsApplied = taxResult.bracketsApplied;

    finalProfit = realizedPnlBeforeTax - capitalGainsTax;
  }

  const finalPayout = Math.max(0, marginAmount + finalProfit);

  return {
    closeFee,
    realizedPnlBeforeTax,
    capitalGainsTax,
    bracketsApplied,
    jackpotContribution: capitalGainsTax,
    profitAfterTax: finalProfit,
    finalProfit,
    finalPayout,
    finalReceiveAmount: finalPayout,
    taxType: "progressive",
  };
}

const TIER_TICK_LIMITS = {
  danger_micro: { maxUp: 0.20, maxDown: 0.25 },
  micro: { maxUp: 0.14, maxDown: 0.18 },
  small: { maxUp: 0.10, maxDown: 0.12 },
  small_mid: { maxUp: 0.07, maxDown: 0.08 },
  mid: { maxUp: 0.045, maxDown: 0.05 },
  large: { maxUp: 0.025, maxDown: 0.03 },
  blue_chip_candidate: { maxUp: 0.018, maxDown: 0.02 },
  mega: { maxUp: 0.012, maxDown: 0.015 },
  giant: { maxUp: 0.008, maxDown: 0.01 },
};

const STABILITY_DAILY_VOLATILITY = Object.freeze({
  BLUE_CHIP: 0.03, GIANT: 0.05, MEGA: 0.07, LARGE: 0.10,
  MID: 0.14, SMALL: 0.20, DELIST_RISK: 0.28,
});

export function getMarketCapTierName(marketCap) {
  if (marketCap < 5_000_000_000) return "danger_micro";
  if (marketCap < 10_000_000_000) return "micro";
  if (marketCap < 30_000_000_000) return "small";
  if (marketCap < 100_000_000_000) return "small_mid";
  if (marketCap < 500_000_000_000) return "mid";
  if (marketCap < 2_000_000_000_000) return "large";
  if (marketCap < 10_000_000_000_000) return "blue_chip_candidate";
  if (marketCap < 50_000_000_000_000) return "mega";
  return "giant";
}

export function getDynamicTickMoveLimit(stock) {
  if (stock.admin_price_target_active === 1) {
    return { maxUp: Infinity, maxDown: Infinity, reason: "admin_target_price_event" };
  }

  if (stock.blue_chip_ramp_active === 1) {
    return { maxUp: Infinity, maxDown: 0, reason: "blue_chip_target_ramp" };
  }

  if (stock.status === "ipo_subscription") {
    return { maxUp: 0, maxDown: 0, reason: "ipo_subscription_no_tick" };
  }

  if (stock.status === "newly_listed") {
    return { maxUp: 0.30, maxDown: 0.25, reason: "newly_listed_high_volatility" };
  }

  if (stock.delist_risk_status === "final_crash") {
    return { maxUp: 0, maxDown: 0.95, reason: "final_crash" };
  }
  const tier = stock.is_bluechip === 1 ? "BLUE_CHIP" : (stock.stability_tier || "SMALL");
  const targetVolatility = STABILITY_DAILY_VOLATILITY[tier] ?? STABILITY_DAILY_VOLATILITY.SMALL;
  const distressMultiplier = ["distress_review", "delist_review"].includes(stock.delist_risk_status) ? 1.5 : 1;
  const fourSigmaTick = targetVolatility / Math.sqrt(8_640) * 4 * distressMultiplier;
  return { maxUp: fourSigmaTick, maxDown: fourSigmaTick, reason: "stability_tier_volatility_target", tier };
}

export function clampTickMoveRate(stock, rawMoveRate) {
  const limit = getDynamicTickMoveLimit(stock);

  if (rawMoveRate > 0) {
    return limit.maxUp === Infinity ? rawMoveRate : Math.min(rawMoveRate, limit.maxUp);
  }

  if (rawMoveRate < 0) {
    return limit.maxDown === Infinity ? rawMoveRate : Math.max(rawMoveRate, -limit.maxDown);
  }

  return 0;
}

export function getLiquidityModifier(stock) {
  const volume = stock.today_trade_value ?? 0;

  if (volume >= 1_000_000_000) return 0.75;
  if (volume >= 100_000_000) return 0.9;
  if (volume <= 1_000_000) return 1.2;

  return 1.0;
}

export function getFeeConfig() {
  return {
    fees: { ...STOCK_FEE_CONFIG },
    taxBrackets: CAPITAL_GAINS_TAX_BRACKETS.map((bracket, index, brackets) => {
      const previous = index === 0 ? 0 : brackets[index - 1].upTo;
      return {
        from: previous === Infinity ? null : previous,
        upTo: bracket.upTo === Infinity ? null : bracket.upTo,
        rate: bracket.rate,
        label: bracket.upTo === Infinity
          ? `${formatBracketAmount(previous)} 초과`
          : `${formatBracketAmount(previous)} 초과 ~ ${formatBracketAmount(bracket.upTo)} 이하`,
      };
    }),
    jackpotProfitContributionRate: 0,
    jackpotTaxContributionRate: 1,
    taxType: "progressive",
  };
}

function formatBracketAmount(value) {
  if (value >= 100_000_000) return `${Math.floor(value / 100_000_000).toLocaleString("ko-KR")}억`;
  if (value >= 10_000) return `${Math.floor(value / 10_000).toLocaleString("ko-KR")}만`;
  return `${value.toLocaleString("ko-KR")}원`;
}
