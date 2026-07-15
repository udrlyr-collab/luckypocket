import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { calculateLiquidationPrice, estimateLeveragedPosition, type PositionSide } from "@market-dominion/domain";
import { submitLeverageCloseOrder } from "@market-dominion/database";
import { z } from "zod";
import { AccessTokenGuard, CurrentUser, type AccessPrincipal } from "./auth.guard.js";
import { DatabaseService } from "./database.service.js";
import { OrderQueue } from "./orders.js";

const openSchema = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,9}$/),
  side: z.enum(["long", "short"]),
  leverage: z.number().int(),
  margin: z.coerce.bigint().positive(),
});

type PositionRow = {
  id: string;
  user_id: string;
  stock_id: string;
  symbol: string;
  side: PositionSide;
  status: "open" | "closing" | "closed" | "liquidated";
  leverage: number;
  quantity: string;
  margin: string;
  position_size: string;
  entry_price: string;
  liquidation_price: string;
  maintenance_margin_bps: number;
  open_fee: string;
  accrued_borrow_fee: string;
  current_price: string;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class LeverageService {
  constructor(private readonly database: DatabaseService, private readonly orderQueue: OrderQueue) {}

  async open(userId: string, input: unknown) {
    const value = parse(openSchema, input);
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const setting = await client.query<{ value: { value?: number } }>("SELECT value FROM system_settings WHERE key='leverage_limit'");
      const defaultLimit = process.env.ENABLE_EXTREME_LEVERAGE === "true" ? 100 : 20;
      const limit = setting.rows[0]?.value?.value ?? defaultLimit;
      if (![1, 2, 3, 5, 10, 20, 50, 100].includes(value.leverage) || value.leverage > limit) throw new BadRequestException("허용되지 않은 레버리지 배율입니다.");
      const stockResult = await client.query<{ id: string; current_price: string; is_trading_halted: boolean }>(
        "SELECT id, current_price, is_trading_halted FROM stocks WHERE symbol = $1 FOR SHARE",
        [value.symbol],
      );
      const stock = stockResult.rows[0];
      if (!stock) throw new NotFoundException("종목을 찾을 수 없습니다.");
      if (stock.is_trading_halted) throw new BadRequestException("거래 정지 종목에는 진입할 수 없습니다.");
      const entryPrice = BigInt(stock.current_price);
      const positionSize = value.margin * BigInt(value.leverage);
      const quantity = positionSize / entryPrice;
      if (quantity <= 0n) throw new BadRequestException("증거금으로 최소 1주 포지션을 만들 수 없습니다.");
      const openFeeBps = envBps("LEVERAGE_OPEN_FEE_BPS", 10n);
      const openFee = positionSize * openFeeBps / 10_000n;
      const charged = await client.query(
        `UPDATE users SET cash = cash - $2, updated_at = now()
         WHERE id = $1 AND is_active = true AND cash - reserved_cash >= $2 RETURNING id`,
        [userId, (value.margin + openFee).toString()],
      );
      if (charged.rowCount !== 1) throw new BadRequestException("사용 가능한 증거금이 부족합니다.");
      const clearinghouse = await client.query<{ user_id: string }>("SELECT user_id FROM system_accounts WHERE key = 'derivatives_clearinghouse'", []);
      const clearinghouseId = required(clearinghouse.rows[0], "Clearinghouse account missing").user_id;
      await client.query("UPDATE users SET cash = cash + $2, updated_at = now() WHERE id = $1", [clearinghouseId, (value.margin + openFee).toString()]);
      if (value.side === "short") {
        const borrowed = await client.query(
          `UPDATE borrow_pools SET borrowed_quantity = borrowed_quantity + $2, updated_at = now()
           WHERE stock_id = $1 AND borrowable_quantity - borrowed_quantity >= $2 RETURNING id`,
          [stock.id, quantity.toString()],
        );
        if (borrowed.rowCount !== 1) throw new BadRequestException("대차 가능 수량이 부족합니다.");
      }
      const maintenanceMarginBps = envBps("MAINTENANCE_MARGIN_BPS", 500n);
      const existing = await client.query<PositionRow>(
        `SELECT p.*, s.symbol, s.current_price FROM leverage_positions p JOIN stocks s ON s.id = p.stock_id
         WHERE p.user_id = $1 AND p.stock_id = $2 AND p.side = $3 AND p.leverage = $4 AND p.status = 'open' FOR UPDATE OF p`,
        [userId, stock.id, value.side, value.leverage],
      );
      let position: PositionRow;
      const prior = existing.rows[0];
      if (prior) {
        const combinedQuantity = BigInt(prior.quantity) + quantity;
        const combinedMargin = BigInt(prior.margin) + value.margin;
        const combinedSize = BigInt(prior.position_size) + positionSize;
        const combinedEntry = (BigInt(prior.entry_price) * BigInt(prior.quantity) + entryPrice * quantity) / combinedQuantity;
        const liquidation = calculateLiquidationPrice({ side: value.side, entryPrice: combinedEntry, leverage: value.leverage, maintenanceMarginBps });
        const updated = await client.query<PositionRow>(
          `UPDATE leverage_positions SET quantity = $2, margin = $3, position_size = $4, entry_price = $5,
             liquidation_price = $6, open_fee = open_fee + $7, updated_at = now() WHERE id = $1
           RETURNING *, $8::text AS symbol, $9::bigint AS current_price`,
          [prior.id, combinedQuantity.toString(), combinedMargin.toString(), combinedSize.toString(), combinedEntry.toString(), liquidation.toString(), openFee.toString(), value.symbol, entryPrice.toString()],
        );
        position = required(updated.rows[0], "Position update returned no row");
      } else {
        const liquidation = calculateLiquidationPrice({ side: value.side, entryPrice, leverage: value.leverage, maintenanceMarginBps });
        const inserted = await client.query<PositionRow>(
          `INSERT INTO leverage_positions
             (user_id, stock_id, side, leverage, quantity, margin, position_size, entry_price, liquidation_price, maintenance_margin_bps, open_fee, last_borrow_fee_at)
           VALUES ($1, $2, $3::position_side, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $3::position_side = 'short'::position_side THEN now() ELSE NULL END)
           RETURNING *, $12::text AS symbol, $8::bigint AS current_price`,
          [userId, stock.id, value.side, value.leverage, quantity.toString(), value.margin.toString(), positionSize.toString(), entryPrice.toString(), liquidation.toString(), maintenanceMarginBps.toString(), openFee.toString(), value.symbol],
        );
        position = required(inserted.rows[0], "Position insert returned no row");
      }
      await client.query(
        `INSERT INTO leverage_events (position_id, event_type, price, quantity, cash_delta, fee, metadata)
         VALUES ($1, 'open', $2, $3, $4, $5, jsonb_build_object('leverage', $6::int, 'side', $7::text))`,
        [position.id, entryPrice.toString(), quantity.toString(), (-(value.margin + openFee)).toString(), openFee.toString(), value.leverage, value.side],
      );
      await client.query("COMMIT");
      return serialize(position);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(userId: string, positionId: string) {
    try {
      const order = await submitLeverageCloseOrder(this.database.pool, positionId, "manual", userId);
      await this.orderQueue.enqueue(order.orderId, order.stockId);
      return { positionId, orderId: order.orderId, status: "closing" };
    } catch (error) {
      if (error instanceof Error && error.message === "POSITION_NOT_FOUND") throw new NotFoundException("열린 포지션을 찾을 수 없습니다.");
      if (error instanceof Error && error.message === "NO_COVER_LIQUIDITY") throw new BadRequestException("공매도 청산을 위한 매도호가가 없습니다.");
      throw error;
    }
  }

  async list(userId: string) {
    const result = await this.database.pool.query<PositionRow>(
      `SELECT p.*, s.symbol, s.current_price FROM leverage_positions p JOIN stocks s ON s.id = p.stock_id
       WHERE p.user_id = $1 ORDER BY p.created_at DESC LIMIT 500`,
      [userId],
    );
    return result.rows.map((position) => ({ ...serialize(position), estimate: serializeEstimate(estimate(position)) }));
  }
}

@Controller("leverage/positions")
@UseGuards(AccessTokenGuard)
export class LeverageController {
  constructor(private readonly leverage: LeverageService) {}
  @Post() open(@CurrentUser() user: AccessPrincipal, @Body() body: unknown) { return this.leverage.open(user.userId, body); }
  @Post(":id/close") close(@CurrentUser() user: AccessPrincipal, @Param("id", new ParseUUIDPipe()) id: string) { return this.leverage.close(user.userId, id); }
  @Get() list(@CurrentUser() user: AccessPrincipal) { return this.leverage.list(user.userId); }
}

function estimate(position: PositionRow) {
  return estimateLeveragedPosition({
    side: position.side,
    quantity: BigInt(position.quantity),
    margin: BigInt(position.margin),
    entryPrice: BigInt(position.entry_price),
    currentPrice: BigInt(position.current_price),
    maintenanceMarginBps: BigInt(position.maintenance_margin_bps),
    closeFeeBps: envBps("LEVERAGE_CLOSE_FEE_BPS", 10n),
    accruedBorrowFee: BigInt(position.accrued_borrow_fee),
  });
}

function serialize(position: PositionRow) {
  return {
    id: position.id, stockId: position.stock_id, symbol: position.symbol, side: position.side, status: position.status,
    leverage: position.leverage, quantity: position.quantity, margin: position.margin, positionSize: position.position_size,
    entryPrice: position.entry_price, currentPrice: position.current_price, liquidationPrice: position.liquidation_price,
    maintenanceMarginBps: position.maintenance_margin_bps, openFee: position.open_fee, accruedBorrowFee: position.accrued_borrow_fee,
    createdAt: position.created_at, updatedAt: position.updated_at,
  };
}

function serializeEstimate(value: ReturnType<typeof estimateLeveragedPosition>) {
  return {
    pnl: value.pnl.toString(), positionValue: value.positionValue.toString(), maintenanceRequirement: value.maintenanceRequirement.toString(),
    estimatedCloseFee: value.estimatedCloseFee.toString(), accruedBorrowFee: value.accruedBorrowFee.toString(),
    netSettlementValue: value.netSettlementValue.toString(), shouldLiquidate: value.shouldLiquidate,
  };
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException({ message: "포지션 입력값이 올바르지 않습니다.", issues: result.error.issues });
  return result.data;
}
function envBps(name: string, fallback: bigint): bigint { const value = process.env[name] ? BigInt(process.env[name]!) : fallback; if (value < 0n || value > 10_000n) throw new Error(`${name} invalid`); return value; }
function required<T>(value: T | undefined, message: string): T { if (value === undefined) throw new Error(message); return value; }
