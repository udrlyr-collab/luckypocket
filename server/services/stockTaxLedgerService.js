import {
  calculateProgressiveCapitalGainsTax,
} from "./stockFeeService.js";

function activeSeasonId(database) {
  try {
    return database
      .prepare("SELECT id FROM seasons WHERE status = 'active' ORDER BY season_number DESC LIMIT 1")
      .get()?.id ?? null;
  } catch {
    return null;
  }
}

function blankLedger(userId, seasonId) {
  return {
    user_id: userId,
    season_id: seasonId,
    cumulative_realized_profit: 0,
    cumulative_realized_loss: 0,
    cumulative_net_taxable_profit: 0,
    cumulative_tax_assessed: 0,
    cumulative_tax_paid: 0,
    tax_credit_balance: 0,
  };
}

export function getUserStockTaxLedger(database, userId, seasonId = activeSeasonId(database)) {
  if (!seasonId) return blankLedger(userId, null);
  try {
    return database
      .prepare("SELECT * FROM user_stock_tax_ledgers WHERE user_id = ? AND season_id = ?")
      .get(userId, seasonId) || blankLedger(userId, seasonId);
  } catch {
    return blankLedger(userId, seasonId);
  }
}

export function calculateStockTaxLedgerImpact(ledger, realizedProfitBeforeTax) {
  const realized = Math.floor(Number(realizedProfitBeforeTax) || 0);
  const previousProfit = Math.max(0, Math.floor(Number(ledger.cumulative_realized_profit) || 0));
  const previousLoss = Math.max(0, Math.floor(Number(ledger.cumulative_realized_loss) || 0));
  const previousPaid = Math.max(0, Math.floor(Number(ledger.cumulative_tax_paid) || 0));
  const previousNet = Math.max(0, previousProfit - previousLoss);
  const nextProfit = previousProfit + Math.max(0, realized);
  const nextLoss = previousLoss + Math.max(0, -realized);
  const nextNet = Math.max(0, nextProfit - nextLoss);
  const previousTax = calculateProgressiveCapitalGainsTax(previousNet);
  const nextTax = calculateProgressiveCapitalGainsTax(nextNet);
  const incrementalTax = Math.max(0, nextTax.tax - previousPaid);
  const nextPaid = previousPaid + incrementalTax;

  return {
    realizedProfitBeforeTax: realized,
    previousCumulativeTaxableProfit: previousNet,
    newCumulativeTaxableProfit: nextNet,
    previousCumulativeTaxPaid: previousPaid,
    newCumulativeTaxAssessed: nextTax.tax,
    newCumulativeTaxPaid: nextPaid,
    cumulativeRealizedProfit: nextProfit,
    cumulativeRealizedLoss: nextLoss,
    incrementalTax,
    taxCreditBalance: Math.max(0, nextPaid - nextTax.tax),
    bracketsApplied: nextTax.bracketsApplied,
    taxType: "progressive_season_cumulative",
    previousTax: previousTax.tax,
  };
}

export function previewStockTaxLedgerImpact(database, userId, realizedProfitBeforeTax, seasonId = activeSeasonId(database)) {
  const ledger = getUserStockTaxLedger(database, userId, seasonId);
  return {
    seasonId,
    ledger,
    ...calculateStockTaxLedgerImpact(ledger, realizedProfitBeforeTax),
  };
}

export function applyStockTaxLedgerImpact(database, userId, realizedProfitBeforeTax, seasonId = activeSeasonId(database)) {
  if (!seasonId) throw new Error("진행 중인 시즌을 찾을 수 없어 세금을 정산할 수 없어요.");
  const ledger = getUserStockTaxLedger(database, userId, seasonId);
  const impact = calculateStockTaxLedgerImpact(ledger, realizedProfitBeforeTax);
  database.prepare(`
    INSERT INTO user_stock_tax_ledgers
      (user_id, season_id, cumulative_realized_profit, cumulative_realized_loss,
       cumulative_net_taxable_profit, cumulative_tax_assessed, cumulative_tax_paid, tax_credit_balance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, season_id) DO UPDATE SET
      cumulative_realized_profit = excluded.cumulative_realized_profit,
      cumulative_realized_loss = excluded.cumulative_realized_loss,
      cumulative_net_taxable_profit = excluded.cumulative_net_taxable_profit,
      cumulative_tax_assessed = excluded.cumulative_tax_assessed,
      cumulative_tax_paid = excluded.cumulative_tax_paid,
      tax_credit_balance = excluded.tax_credit_balance,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).run(
    userId,
    seasonId,
    impact.cumulativeRealizedProfit,
    impact.cumulativeRealizedLoss,
    impact.newCumulativeTaxableProfit,
    impact.newCumulativeTaxAssessed,
    impact.newCumulativeTaxPaid,
    impact.taxCreditBalance,
  );
  return { seasonId, ledger, ...impact };
}
