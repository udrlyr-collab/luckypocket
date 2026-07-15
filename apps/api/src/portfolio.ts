import { Controller, Get, Injectable, NotFoundException, UseGuards } from "@nestjs/common";
import { estimateLeveragedPosition, estimateSpotLiquidation, type BidLevel, type PositionSide } from "@market-dominion/domain";
import { AccessTokenGuard, CurrentUser, type AccessPrincipal } from "./auth.guard.js";
import { DatabaseService } from "./database.service.js";

type HoldingRow = {
  stock_id: string;
  symbol: string;
  name: string;
  quantity: string;
  reserved_quantity: string;
  cost_basis: string;
  realized_pnl: string;
  current_price: string;
};

@Injectable()
export class PortfolioService {
  constructor(private readonly database: DatabaseService) {}

  async get(userId: string) {
    const userResult = await this.database.pool.query<{ cash: string; reserved_cash: string }>(
      "SELECT cash, reserved_cash FROM users WHERE id = $1 AND is_active = true",
      [userId],
    );
    const user = userResult.rows[0];
    if (!user) throw new NotFoundException("사용자를 찾을 수 없습니다.");
    const holdingsResult = await this.database.pool.query<HoldingRow>(
      `SELECT h.stock_id, s.symbol, c.name, h.quantity, h.reserved_quantity,
              h.cost_basis, h.realized_pnl, s.current_price
       FROM holdings h JOIN stocks s ON s.id = h.stock_id JOIN companies c ON c.id = s.company_id
       WHERE h.user_id = $1 AND h.quantity > 0
       ORDER BY s.symbol`,
      [userId],
    );
    const bidResult = await this.database.pool.query<{ stock_id: string; price: string; quantity: string }>(
      `SELECT stock_id, limit_price AS price, sum(quantity - filled_quantity)::bigint AS quantity
       FROM orders
       WHERE side = 'buy' AND type = 'limit' AND status IN ('pending', 'open', 'partially_filled') AND user_id <> $1
       GROUP BY stock_id, limit_price
       ORDER BY stock_id, limit_price DESC`,
      [userId],
    );
    const bidsByStock = new Map<string, BidLevel[]>();
    for (const row of bidResult.rows) {
      const levels = bidsByStock.get(row.stock_id) ?? [];
      levels.push({ price: BigInt(row.price), quantity: BigInt(row.quantity) });
      bidsByStock.set(row.stock_id, levels);
    }
    const sellFeeBps = rate("SELL_FEE_BPS", 10n);
    const positivePnlTaxBps = rate("POSITIVE_PNL_TAX_BPS", 500n);
    let spotNetLiquidationValue = 0n;
    const holdings = holdingsResult.rows.map((holding) => {
      const estimate = estimateSpotLiquidation({
        quantity: BigInt(holding.quantity),
        costBasis: BigInt(holding.cost_basis),
        currentPrice: BigInt(holding.current_price),
        bids: bidsByStock.get(holding.stock_id) ?? [],
        sellFeeBps,
        positivePnlTaxBps,
      });
      spotNetLiquidationValue += estimate.netProceeds;
      return {
        stockId: holding.stock_id,
        symbol: holding.symbol,
        name: holding.name,
        quantity: holding.quantity,
        reservedQuantity: holding.reserved_quantity,
        costBasis: holding.cost_basis,
        realizedPnl: holding.realized_pnl,
        currentPrice: holding.current_price,
        averageCost: BigInt(holding.quantity) > 0n ? (BigInt(holding.cost_basis) / BigInt(holding.quantity)).toString() : null,
        liquidation: serializeEstimate(estimate),
      };
    });
    const positionResult = await this.database.pool.query<{
      id: string; stock_id: string; symbol: string; side: PositionSide; leverage: number; quantity: string; margin: string;
      entry_price: string; current_price: string; maintenance_margin_bps: number; accrued_borrow_fee: string;
    }>(
      `SELECT p.id, p.stock_id, s.symbol, p.side, p.leverage, p.quantity, p.margin, p.entry_price,
              s.current_price, p.maintenance_margin_bps, p.accrued_borrow_fee
       FROM leverage_positions p JOIN stocks s ON s.id = p.stock_id
       WHERE p.user_id = $1 AND p.status = 'open' ORDER BY s.symbol, p.side, p.leverage`,
      [userId],
    );
    let leverageNetSettlementValue = 0n;
    const positions = positionResult.rows.map((position) => {
      const estimate = estimateLeveragedPosition({
        side: position.side,
        quantity: BigInt(position.quantity),
        margin: BigInt(position.margin),
        entryPrice: BigInt(position.entry_price),
        currentPrice: BigInt(position.current_price),
        maintenanceMarginBps: BigInt(position.maintenance_margin_bps),
        closeFeeBps: rate("LEVERAGE_CLOSE_FEE_BPS", 10n),
        accruedBorrowFee: BigInt(position.accrued_borrow_fee),
      });
      leverageNetSettlementValue += estimate.netSettlementValue;
      return {
        id: position.id, stockId: position.stock_id, symbol: position.symbol, side: position.side, leverage: position.leverage,
        quantity: position.quantity, margin: position.margin, entryPrice: position.entry_price, currentPrice: position.current_price,
        estimate: {
          pnl: estimate.pnl.toString(), maintenanceRequirement: estimate.maintenanceRequirement.toString(),
          estimatedCloseFee: estimate.estimatedCloseFee.toString(), accruedBorrowFee: estimate.accruedBorrowFee.toString(),
          netSettlementValue: estimate.netSettlementValue.toString(), shouldLiquidate: estimate.shouldLiquidate,
        },
      };
    });
    const cash = BigInt(user.cash);
    const totalEvaluatedAsset = cash + spotNetLiquidationValue + leverageNetSettlementValue;
    return {
      cash: user.cash,
      reservedCash: user.reserved_cash,
      availableCash: (cash - BigInt(user.reserved_cash)).toString(),
      spotNetLiquidationValue: spotNetLiquidationValue.toString(),
      leverageNetSettlementValue: leverageNetSettlementValue.toString(),
      otherRecognizedAssets: "0",
      totalEvaluatedAsset: totalEvaluatedAsset.toString(),
      assumptions: { sellFeeBps: sellFeeBps.toString(), positivePnlTaxBps: positivePnlTaxBps.toString() },
      holdings,
      positions,
    };
  }
}

@Controller("portfolio")
@UseGuards(AccessTokenGuard)
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}
  @Get() get(@CurrentUser() user: AccessPrincipal) { return this.portfolio.get(user.userId); }
}

function rate(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : BigInt(raw);
  if (value < 0n || value > 10_000n) throw new Error(`${name} must be between 0 and 10000`);
  return value;
}

function serializeEstimate(estimate: ReturnType<typeof estimateSpotLiquidation>) {
  return {
    requestedQuantity: estimate.requestedQuantity.toString(),
    filledQuantity: estimate.filledQuantity.toString(),
    unfilledQuantity: estimate.unfilledQuantity.toString(),
    grossProceeds: estimate.grossProceeds.toString(),
    estimatedFee: estimate.estimatedFee.toString(),
    estimatedTax: estimate.estimatedTax.toString(),
    netProceeds: estimate.netProceeds.toString(),
    estimatedRealizedPnl: estimate.estimatedRealizedPnl.toString(),
    averagePrice: estimate.averagePrice?.toString() ?? null,
    lastPrice: estimate.lastPrice?.toString() ?? null,
    slippageBps: estimate.slippageBps?.toString() ?? null,
  };
}
