import test from "node:test";
import assert from "node:assert/strict";
import { calculateProgressiveCapitalGainsTax } from "../server/services/stockFeeService.js";
import { calculateSoldCostBasis } from "../server/services/stockSettlementService.js";
import { calculateStockTaxLedgerImpact } from "../server/services/stockTaxLedgerService.js";

const blankLedger = {
  cumulative_realized_profit: 0,
  cumulative_realized_loss: 0,
  cumulative_tax_paid: 0,
};

test("partial spot sale removes proportional cost basis", () => {
  const holding = { quantity: 200, total_cost_basis: 300_000, average_price: 1_500 };
  assert.equal(calculateSoldCostBasis(holding, 50), 75_000);
  assert.equal(calculateSoldCostBasis(holding, 200), 300_000);
});

test("season tax ledger charges the same progressive tax for split profits", () => {
  const oneTrade = calculateStockTaxLedgerImpact(blankLedger, 300_000);
  const first = calculateStockTaxLedgerImpact(blankLedger, 150_000);
  const second = calculateStockTaxLedgerImpact({
    cumulative_realized_profit: first.cumulativeRealizedProfit,
    cumulative_realized_loss: first.cumulativeRealizedLoss,
    cumulative_tax_paid: first.newCumulativeTaxPaid,
  }, 150_000);
  assert.equal(
    first.incrementalTax + second.incrementalTax,
    calculateProgressiveCapitalGainsTax(300_000).tax,
  );
  assert.equal(oneTrade.incrementalTax, first.incrementalTax + second.incrementalTax);
});

test("season tax ledger carries losses forward without an immediate refund", () => {
  const loss = calculateStockTaxLedgerImpact(blankLedger, -100_000);
  const recovery = calculateStockTaxLedgerImpact({
    cumulative_realized_profit: loss.cumulativeRealizedProfit,
    cumulative_realized_loss: loss.cumulativeRealizedLoss,
    cumulative_tax_paid: loss.newCumulativeTaxPaid,
  }, 100_000);
  assert.equal(loss.incrementalTax, 0);
  assert.equal(recovery.incrementalTax, 0);
  assert.equal(recovery.newCumulativeTaxableProfit, 0);
});
