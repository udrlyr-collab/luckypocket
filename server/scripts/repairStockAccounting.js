import { db } from "../db.js";
import { calculateStockTaxLedgerImpact } from "../services/stockTaxLedgerService.js";

const apply = process.argv.includes("--apply");
const activeSeason = db.prepare(
  "SELECT id, season_number FROM seasons WHERE status = 'active' ORDER BY season_number DESC LIMIT 1",
).get();

function detailValue(row) {
  try {
    const detail = JSON.parse(row.detail_json || "{}");
    const value = detail.realizedProfitBeforeTax ?? detail.realizedPnlBeforeTax;
    return Number.isFinite(Number(value)) ? Math.floor(Number(value)) : null;
  } catch {
    return null;
  }
}

const invalidHoldings = db.prepare(`
  SELECT COUNT(*) AS count
  FROM stock_holdings
  WHERE quantity > 0 AND (total_cost_basis IS NULL OR total_cost_basis < 0 OR average_price IS NULL)
`).get().count;
const duplicateBuckets = db.prepare(`
  SELECT COUNT(*) AS count FROM (
    SELECT user_id, stock_id, side, leverage
    FROM stock_positions
    WHERE status = 'open'
    GROUP BY user_id, stock_id, side, leverage
    HAVING COUNT(*) > 1
  )
`).get().count;

const report = {
  activeSeasonId: activeSeason?.id ?? null,
  invalidHoldings: Number(invalidHoldings || 0),
  duplicateOpenLeverageBuckets: Number(duplicateBuckets || 0),
  holdingsBackfilled: 0,
  taxLedgersRebuilt: 0,
  skippedTradesWithoutPretaxDetail: 0,
};

if (activeSeason) {
  const skipped = db.prepare(`
    SELECT detail_json
    FROM stock_trades
    WHERE season_id = ?
      AND trade_type IN ('sell', 'close_long', 'close_short', 'season_end_settlement')
  `).all(activeSeason.id);
  report.skippedTradesWithoutPretaxDetail = skipped.reduce((count, trade) => {
    return count + (detailValue(trade) === null ? 1 : 0);
  }, 0);
}

if (apply) {
  db.transaction(() => {
    const updated = db.prepare(`
      UPDATE stock_holdings
      SET total_cost_basis = MAX(0, CAST(ROUND(quantity * average_price) AS INTEGER)),
          total_buy_fees = COALESCE(total_buy_fees, 0),
          realized_profit = COALESCE(realized_profit, 0)
      WHERE quantity > 0 AND (total_cost_basis IS NULL OR total_cost_basis <= 0)
    `).run();
    report.holdingsBackfilled = updated.changes;

    if (!activeSeason) return;
    const users = db.prepare(`
      SELECT DISTINCT user_id
      FROM stock_trades
      WHERE season_id = ?
        AND trade_type IN ('sell', 'close_long', 'close_short', 'season_end_settlement')
      ORDER BY user_id ASC
    `).all(activeSeason.id);
    const upsert = db.prepare(`
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
    `);
    for (const user of users) {
      let ledger = {
        cumulative_realized_profit: 0,
        cumulative_realized_loss: 0,
        cumulative_tax_paid: 0,
      };
      const trades = db.prepare(`
        SELECT * FROM stock_trades
        WHERE user_id = ? AND season_id = ?
          AND trade_type IN ('sell', 'close_long', 'close_short', 'season_end_settlement')
        ORDER BY datetime(created_at) ASC, id ASC
      `).all(user.user_id, activeSeason.id);
      for (const trade of trades) {
        const realized = detailValue(trade);
        if (realized === null) {
          continue;
        }
        const impact = calculateStockTaxLedgerImpact(ledger, realized);
        ledger = {
          cumulative_realized_profit: impact.cumulativeRealizedProfit,
          cumulative_realized_loss: impact.cumulativeRealizedLoss,
          cumulative_tax_paid: impact.newCumulativeTaxPaid,
        };
        upsert.run(
          user.user_id, activeSeason.id,
          impact.cumulativeRealizedProfit, impact.cumulativeRealizedLoss,
          impact.newCumulativeTaxableProfit, impact.newCumulativeTaxAssessed,
          impact.newCumulativeTaxPaid, impact.taxCreditBalance,
        );
      }
      report.taxLedgersRebuilt += 1;
    }
  })();
}

console.log(JSON.stringify({ mode: apply ? "apply" : "report", ...report }, null, 2));
