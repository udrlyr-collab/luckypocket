import {
  calculateLeverageCloseSettlement,
  calculateSpotSellSettlement,
} from "./stockFeeService.js";
import {
  applyStockTaxLedgerImpact,
  previewStockTaxLedgerImpact,
} from "./stockTaxLedgerService.js";

export function getHoldingTotalCostBasis(holding) {
  const stored = Number(holding?.total_cost_basis);
  if (Number.isFinite(stored) && stored >= 0) return Math.floor(stored);
  const averagePrice = Number(holding?.average_price);
  const fallbackPrice = Number.isFinite(averagePrice) && averagePrice >= 0
    ? averagePrice
    : Number(holding?.current_price || 0);
  return Math.max(0, Math.floor(Number(holding?.quantity || 0) * fallbackPrice));
}

export function calculateSoldCostBasis(holding, sellQuantity) {
  const quantity = Number(holding?.quantity || 0);
  const sold = Number(sellQuantity || 0);
  const totalCostBasis = getHoldingTotalCostBasis(holding);
  if (quantity <= 0 || sold <= 0) return 0;
  if (sold >= quantity) return totalCostBasis;
  return Math.max(0, Math.floor(totalCostBasis * (sold / quantity)));
}

export function calculateSpotSettlement(database, {
  userId,
  holding,
  sellQuantity,
  sellPrice,
}) {
  const costBasis = calculateSoldCostBasis(holding, sellQuantity);
  const beforeTax = calculateSpotSellSettlement({
    sellQuantity,
    sellPrice,
    averagePrice: holding.average_price,
    costBasis,
    capitalGainsTax: 0,
  });
  const taxLedger = previewStockTaxLedgerImpact(
    database,
    userId,
    beforeTax.realizedProfitBeforeTax,
  );
  return {
    ...calculateSpotSellSettlement({
      sellQuantity,
      sellPrice,
      averagePrice: holding.average_price,
      costBasis,
      capitalGainsTax: taxLedger.incrementalTax,
    }),
    totalCostBasis: getHoldingTotalCostBasis(holding),
    soldCostBasis: costBasis,
    taxLedger,
  };
}

export function calculateLeverageSettlement(database, {
  userId,
  position,
  cappedPnl,
}) {
  const beforeTax = calculateLeverageCloseSettlement({
    cappedPnl,
    positionSize: position.position_size,
    marginAmount: position.margin_amount,
    capitalGainsTax: 0,
  });
  const taxLedger = previewStockTaxLedgerImpact(
    database,
    userId,
    beforeTax.realizedPnlBeforeTax,
  );
  return {
    ...calculateLeverageCloseSettlement({
      cappedPnl,
      positionSize: position.position_size,
      marginAmount: position.margin_amount,
      capitalGainsTax: taxLedger.incrementalTax,
    }),
    taxLedger,
  };
}

export function applySpotSettlementTax(database, userId, settlement) {
  return applyStockTaxLedgerImpact(database, userId, settlement.realizedProfitBeforeTax);
}

export function applyLeverageSettlementTax(database, userId, settlement) {
  return applyStockTaxLedgerImpact(database, userId, settlement.realizedPnlBeforeTax);
}
