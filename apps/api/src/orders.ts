import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  Param,
  ParseUUIDPipe,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { Queue } from "bullmq";
import { z } from "zod";
import { AccessTokenGuard, CurrentUser, type AccessPrincipal } from "./auth.guard.js";
import { DatabaseService } from "./database.service.js";

const submitOrderSchema = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,9}$/),
  idempotencyKey: z.uuid(),
  side: z.enum(["buy", "sell"]),
  type: z.enum(["market", "limit", "stop"]),
  timeInForce: z.enum(["GTC", "IOC"]).optional(),
  limitPrice: z.coerce.bigint().positive().optional(),
  stopPrice: z.coerce.bigint().positive().optional(),
  maxSpend: z.coerce.bigint().positive().optional(),
  quantity: z.coerce.bigint().positive().max(1_000_000_000n),
}).superRefine((value, context) => {
  if (value.type === "limit" && value.limitPrice === undefined) context.addIssue({ code: "custom", message: "지정가 주문에는 limitPrice가 필요합니다." });
  if (value.type === "market" && (value.limitPrice !== undefined || value.stopPrice !== undefined)) context.addIssue({ code: "custom", message: "시장가 주문에는 limitPrice/stopPrice를 사용할 수 없습니다." });
  if (value.type === "stop" && value.stopPrice === undefined) context.addIssue({ code: "custom", message: "스톱 주문에는 stopPrice가 필요합니다." });
  if (value.type === "stop" && value.side === "buy" && value.limitPrice === undefined && value.maxSpend === undefined) context.addIssue({ code: "custom", message: "스톱 시장가 매수에는 maxSpend가 필요합니다." });
});

type OrderRow = {
  id: string;
  user_id: string;
  stock_id: string;
  idempotency_key: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop";
  time_in_force: "GTC" | "IOC";
  status: string;
  limit_price: string | null;
  stop_price: string | null;
  quantity: string;
  filled_quantity: string;
  reserved_amount: string;
  sequence: string;
  rejected_reason: string | null;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class OrderQueue implements OnModuleDestroy {
  readonly queue: Queue;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("REDIS_URL is required");
    this.queue = new Queue("market-orders", { connection: { url: redisUrl } });
  }

  async enqueue(orderId: string, stockId: string): Promise<void> {
    await this.queue.add("match", { orderId, stockId }, {
      jobId: orderId,
      attempts: 10,
      backoff: { type: "exponential", delay: 250 },
      removeOnComplete: true,
      removeOnFail: 10_000,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}

@Injectable()
export class OrderService {
  constructor(private readonly database: DatabaseService, private readonly orderQueue: OrderQueue) {}

  async submit(userId: string, input: unknown) {
    const value = parseInput(submitOrderSchema, input);
    const client = await this.database.pool.connect();
    let order: OrderRow;
    try {
      await client.query("BEGIN");
      const existing = await client.query<OrderRow>(
        "SELECT * FROM orders WHERE user_id = $1 AND idempotency_key = $2 FOR UPDATE",
        [userId, value.idempotencyKey],
      );
      if (existing.rows[0]) {
        order = existing.rows[0];
        await client.query("COMMIT");
      } else {
        const stockResult = await client.query<{ id: string; tick_size: string; current_price: string; is_trading_halted: boolean }>(
          "SELECT id, tick_size, current_price, is_trading_halted FROM stocks WHERE symbol = $1 FOR SHARE",
          [value.symbol],
        );
        const stock = stockResult.rows[0];
        if (!stock) throw new NotFoundException("종목을 찾을 수 없습니다.");
        if (stock.is_trading_halted) throw new BadRequestException("거래가 정지된 종목입니다.");
        if (value.limitPrice !== undefined && value.limitPrice % BigInt(stock.tick_size) !== 0n) throw new BadRequestException("지정가가 호가 단위에 맞지 않습니다.");
        if (value.stopPrice !== undefined && value.stopPrice % BigInt(stock.tick_size) !== 0n) throw new BadRequestException("스톱 가격이 호가 단위에 맞지 않습니다.");
        const feeBps = await spotFeeBps(client);

        const timeInForce = value.type === "market" || (value.type === "stop" && value.limitPrice === undefined)
          ? "IOC"
          : value.timeInForce ?? "GTC";
        let reserveAmount = 0n;
        if (value.side === "buy") {
          if (value.limitPrice !== undefined) reserveAmount = value.limitPrice * value.quantity * (10_000n + feeBps) / 10_000n;
          else if (value.type === "stop") reserveAmount = required(value.maxSpend, "Stop market buy maxSpend missing");
          else reserveAmount = await calculateMarketBuyReserve(client, stock.id, value.quantity, feeBps);
          if (reserveAmount <= 0n) throw new BadRequestException("현재 체결 가능한 매도호가가 없습니다.");
        }
        if (value.side === "buy") {
          const reserved = await client.query(
            `UPDATE users SET reserved_cash = reserved_cash + $2, updated_at = now()
             WHERE id = $1 AND is_active = true AND cash - reserved_cash >= $2
             RETURNING id`,
            [userId, reserveAmount.toString()],
          );
          if (reserved.rowCount !== 1) throw new BadRequestException("주문 가능한 현금이 부족합니다.");
        } else {
          const reserved = await client.query(
            `UPDATE holdings SET reserved_quantity = reserved_quantity + $3, updated_at = now()
             WHERE user_id = $1 AND stock_id = $2 AND quantity - reserved_quantity >= $3
             RETURNING id`,
            [userId, stock.id, value.quantity.toString()],
          );
          if (reserved.rowCount !== 1) throw new BadRequestException("주문 가능한 주식 수량이 부족합니다.");
        }

        const inserted = await client.query<OrderRow>(
          `INSERT INTO orders (user_id, stock_id, idempotency_key, side, type, time_in_force, status, limit_price, stop_price, quantity, reserved_amount)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10)
           RETURNING *`,
          [
            userId,
            stock.id,
            value.idempotencyKey,
            value.side,
            value.type,
            timeInForce,
            value.limitPrice?.toString() ?? null,
            value.stopPrice?.toString() ?? null,
            value.quantity.toString(),
            reserveAmount.toString(),
          ],
        );
        order = required(inserted.rows[0], "Order insert returned no row");
        await client.query(
          `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata)
           VALUES ($1, 'order.submit', 'order', $2, jsonb_build_object('symbol', $3::text, 'side', $4::text, 'quantity', $5::text, 'limitPrice', $6::text))`,
          [userId, order.id, value.symbol, value.side, value.quantity.toString(), value.limitPrice?.toString() ?? "market"],
        );
        await client.query("COMMIT");
      }
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) {
        const existing = await client.query<OrderRow>(
          "SELECT * FROM orders WHERE user_id = $1 AND idempotency_key = $2",
          [userId, value.idempotencyKey],
        );
        order = required(existing.rows[0], "Idempotent order disappeared after unique conflict");
      } else {
        throw error;
      }
    } finally {
      client.release();
    }

    if (["pending", "open", "partially_filled"].includes(order.status)) {
      try {
        await this.orderQueue.enqueue(order.id, order.stock_id);
      } catch {
        throw new ServiceUnavailableException({ message: "주문은 저장됐지만 매칭 queue 등록이 지연됐습니다. 같은 idempotency key로 재시도하세요.", order: serializeOrder(order) });
      }
    }
    return serializeOrder(order);
  }

  async cancel(userId: string, orderId: string) {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<OrderRow>("SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE", [orderId, userId]);
      const order = result.rows[0];
      if (!order) throw new NotFoundException("주문을 찾을 수 없습니다.");
      if (!["pending", "open", "partially_filled"].includes(order.status)) throw new BadRequestException("취소할 수 없는 주문 상태입니다.");
      const remaining = BigInt(order.quantity) - BigInt(order.filled_quantity);
      if (order.side === "buy") {
        await client.query("UPDATE users SET reserved_cash = reserved_cash - $2, updated_at = now() WHERE id = $1", [userId, order.reserved_amount]);
      } else {
        await client.query("UPDATE holdings SET reserved_quantity = reserved_quantity - $3, updated_at = now() WHERE user_id = $1 AND stock_id = $2", [userId, order.stock_id, remaining.toString()]);
      }
      const updated = await client.query<OrderRow>(
        "UPDATE orders SET status = 'cancelled', reserved_amount = 0, updated_at = now() WHERE id = $1 RETURNING *",
        [orderId],
      );
      await client.query("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id) VALUES ($1, 'order.cancel', 'order', $2)", [userId, orderId]);
      await client.query("COMMIT");
      return serializeOrder(required(updated.rows[0], "Order update returned no row"));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async list(userId: string) {
    const result = await this.database.pool.query<OrderRow>(
      "SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200",
      [userId],
    );
    return result.rows.map(serializeOrder);
  }
}

@Controller("orders")
@UseGuards(AccessTokenGuard)
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Post() submit(@CurrentUser() user: AccessPrincipal, @Body() body: unknown) { return this.orders.submit(user.userId, body); }
  @Post(":id/cancel") cancel(@CurrentUser() user: AccessPrincipal, @Param("id", new ParseUUIDPipe()) id: string) { return this.orders.cancel(user.userId, id); }
  @Get() list(@CurrentUser() user: AccessPrincipal) { return this.orders.list(user.userId); }
}

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException({ message: "주문 입력값이 올바르지 않습니다.", issues: result.error.issues });
  return result.data;
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function serializeOrder(order: OrderRow) {
  return {
    id: order.id,
    stockId: order.stock_id,
    side: order.side,
    type: order.type,
    timeInForce: order.time_in_force,
    status: order.status,
    limitPrice: order.limit_price,
    quantity: order.quantity,
    filledQuantity: order.filled_quantity,
    sequence: order.sequence,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
  };
}

async function calculateMarketBuyReserve(client: { query: <T>(text: string, values?: unknown[]) => Promise<{ rows: T[] }> }, stockId: string, requestedQuantity: bigint, feeBps: bigint): Promise<bigint> {
  const levels = await client.query<{ limit_price: string; remaining: string }>(
    `SELECT limit_price, quantity - filled_quantity AS remaining
     FROM orders
     WHERE stock_id = $1 AND side = 'sell' AND type = 'limit'
       AND status IN ('pending', 'open', 'partially_filled')
     ORDER BY limit_price ASC, sequence ASC
     LIMIT 10000`,
    [stockId],
  );
  let remaining = requestedQuantity;
  let reserve = 0n;
  for (const level of levels.rows) {
    if (remaining <= 0n) break;
    const available = BigInt(level.remaining);
    const take = available < remaining ? available : remaining;
    reserve += BigInt(level.limit_price) * take;
    remaining -= take;
  }
  return reserve * (10_000n + feeBps) / 10_000n;
}

async function spotFeeBps(client: { query: <T>(text: string, values?: unknown[]) => Promise<{ rows: T[] }> }): Promise<bigint> {
  const result = await client.query<{ value: { value?: number } }>("SELECT value FROM system_settings WHERE key='spot_fee_bps'");
  const value = BigInt(result.rows[0]?.value?.value ?? 0);
  if (value < 0n || value > 1_000n) throw new Error("SPOT_FEE_BPS_INVALID");
  return value;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
