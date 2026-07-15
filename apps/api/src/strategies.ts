import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { runBacktest, type BacktestSafety, type StrategyCandle, type StrategyDefinition } from "@market-dominion/domain";
import { z } from "zod";
import { AccessTokenGuard, CurrentUser, type AccessPrincipal } from "./auth.guard.js";
import { DatabaseService } from "./database.service.js";

const indicatorNames = [
  "current_price", "change_bps", "volume", "sma", "ema", "rsi", "macd", "bollinger_upper", "bollinger_lower",
  "rolling_high", "rolling_low", "orderbook_imbalance_bps", "position_quantity", "holding_return_bps", "market_regime_strength", "sector_strength",
] as const;
const indicatorOperandSchema = z.object({
  kind: z.literal("indicator"), indicator: z.enum(indicatorNames), period: z.number().int().min(1).max(500).optional(),
  fastPeriod: z.number().int().min(1).max(500).optional(), slowPeriod: z.number().int().min(2).max(500).optional(),
}).strict();
const constantOperandSchema = z.object({ kind: z.literal("constant"), value: z.string().regex(/^-?\d{1,30}$/) }).strict();
const operandSchema = z.discriminatedUnion("kind", [indicatorOperandSchema, constantOperandSchema]);
const conditionSchema = z.object({ left: operandSchema, operator: z.enum(["gt", "gte", "lt", "lte", "eq", "neq"]), right: operandSchema }).strict();
type ConditionInput = z.infer<typeof conditionSchema> | { mode: "all" | "any"; conditions: ConditionInput[] };
const groupSchema: z.ZodType<{ mode: "all" | "any"; conditions: ConditionInput[] }> = z.lazy(() => z.object({
  mode: z.enum(["all", "any"]), conditions: z.array(z.union([conditionSchema, groupSchema])).min(1).max(50),
}).strict());
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("buy"), sizing: z.literal("percent_available_cash"), valueBps: z.number().int().min(1).max(10_000) }).strict(),
  z.object({ type: z.literal("sell"), sizing: z.literal("percent_position"), valueBps: z.number().int().min(1).max(10_000) }).strict(),
]);
const definitionSchema = z.object({ version: z.literal(1), when: groupSchema, then: actionSchema }).strict().superRefine((value, context) => {
  const metrics = conditionMetrics(value.when);
  if (metrics.depth > 5) context.addIssue({ code: "custom", message: "조건 깊이는 5 이하여야 합니다." });
  if (metrics.count > 50) context.addIssue({ code: "custom", message: "조건 수는 50 이하여야 합니다." });
});
const safetySchema = z.object({
  initialCash: z.string().regex(/^\d{1,30}$/).refine((value) => BigInt(value) > 0n),
  feeBps: z.number().int().min(0).max(1_000), slippageBps: z.number().int().min(0).max(5_000),
  maxOrderAmount: z.string().regex(/^\d{1,30}$/).refine((value) => BigInt(value) > 0n),
  maxHoldingBps: z.number().int().min(1).max(10_000), dailyMaxLossBps: z.number().int().min(1).max(10_000),
  cooldownBars: z.number().int().min(0).max(10_000), stopLossBps: z.number().int().min(1).max(10_000).optional(),
  takeProfitBps: z.number().int().min(1).max(100_000).optional(),
}).strict();
const createSchema = z.object({
  name: z.string().trim().min(1).max(100), stockId: z.uuid(), interval: z.enum(["1m", "5m", "15m", "1h", "1d"]),
  definition: definitionSchema, safety: safetySchema,
}).strict();
const backtestSchema = z.object({ start: z.iso.datetime().optional(), end: z.iso.datetime().optional() }).strict();
const statusSchema = z.object({ status: z.enum(["PAPER", "LIVE_VIRTUAL", "PAUSED"]), confirmLiveVirtual: z.literal(true).optional() }).strict();

type StrategyRow = {
  id: string; user_id: string; stock_id: string; name: string; interval: string; status: "DRAFT" | "BACKTEST" | "PAPER" | "LIVE_VIRTUAL" | "PAUSED";
  definition: StrategyDefinition; safety: SafetyJson; paused_from_status: "PAPER" | "LIVE_VIRTUAL" | null;
};
type SafetyJson = z.infer<typeof safetySchema>;

@Injectable()
export class StrategyService {
  constructor(private readonly database: DatabaseService) {}

  async create(userId: string, input: unknown) {
    const value = parse(createSchema, input);
    const stock = await this.database.pool.query("SELECT id FROM stocks WHERE id = $1", [value.stockId]);
    if (!stock.rows[0]) throw new NotFoundException("종목을 찾을 수 없습니다.");
    const result = await this.database.pool.query(
      `INSERT INTO strategies (user_id, stock_id, name, interval, definition, safety, paper_initial_cash, paper_cash)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$7) RETURNING *`,
      [userId, value.stockId, value.name, value.interval, JSON.stringify(value.definition), JSON.stringify(value.safety), value.safety.initialCash],
    );
    return result.rows[0];
  }

  async list(userId: string) {
    return (await this.database.pool.query(
      `SELECT st.*, s.symbol FROM strategies st JOIN stocks s ON s.id = st.stock_id WHERE st.user_id = $1 ORDER BY st.created_at DESC`, [userId],
    )).rows;
  }

  async detail(userId: string, id: string) {
    const strategy = await this.owned(userId, id);
    const runs = await this.database.pool.query("SELECT * FROM backtest_runs WHERE strategy_id = $1 ORDER BY created_at DESC LIMIT 20", [id]);
    const executions = await this.database.pool.query("SELECT * FROM strategy_executions WHERE strategy_id = $1 ORDER BY created_at DESC LIMIT 100", [id]);
    return { ...strategy, backtests: runs.rows, executions: executions.rows };
  }

  async update(userId: string, id: string, input: unknown) {
    const value = parse(createSchema.omit({ stockId: true }).partial(), input);
    const strategy = await this.owned(userId, id);
    if (strategy.status !== "DRAFT") throw new BadRequestException("DRAFT 전략만 수정할 수 있습니다.");
    const result = await this.database.pool.query(
      `UPDATE strategies SET name = COALESCE($3,name), interval = COALESCE($4,interval), definition = COALESCE($5::jsonb,definition),
         safety = COALESCE($6::jsonb,safety), paper_initial_cash = COALESCE($7,paper_initial_cash), paper_cash = COALESCE($7,paper_cash), updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, userId, value.name ?? null, value.interval ?? null, value.definition ? JSON.stringify(value.definition) : null, value.safety ? JSON.stringify(value.safety) : null, value.safety?.initialCash ?? null],
    );
    return result.rows[0];
  }

  async backtest(userId: string, id: string, input: unknown) {
    const range = parse(backtestSchema, input);
    const strategy = await this.owned(userId, id);
    const result = await this.database.pool.query(
      `SELECT ca.opened_at, ca.open, ca.high, ca.low, ca.close, ca.volume,
              COALESCE(ls.imbalance_bps, 0) AS orderbook_imbalance_bps,
              COALESCE(ms.strength, 0) AS market_regime_strength,
              COALESCE(ss.strength, 0) AS sector_strength
       FROM candles ca JOIN stocks st ON st.id = ca.stock_id JOIN companies co ON co.id = st.company_id
       LEFT JOIN LATERAL (SELECT imbalance_bps FROM liquidity_snapshots WHERE stock_id = ca.stock_id AND captured_at <= ca.opened_at ORDER BY captured_at DESC LIMIT 1) ls ON true
       LEFT JOIN LATERAL (SELECT strength FROM market_state_snapshots WHERE sector_id IS NULL AND captured_at <= ca.opened_at ORDER BY captured_at DESC LIMIT 1) ms ON true
       LEFT JOIN LATERAL (SELECT strength FROM market_state_snapshots WHERE sector_id = co.sector_id AND captured_at <= ca.opened_at ORDER BY captured_at DESC LIMIT 1) ss ON true
       WHERE ca.stock_id = $1 AND ca.interval = $2 AND ($3::timestamptz IS NULL OR ca.opened_at >= $3) AND ($4::timestamptz IS NULL OR ca.opened_at <= $4)
       ORDER BY ca.opened_at ASC LIMIT 10000`,
      [strategy.stock_id, strategy.interval, range.start ?? null, range.end ?? null],
    );
    if (result.rows.length < 2) throw new BadRequestException("백테스트에는 최소 2개 봉이 필요합니다.");
    const candles = result.rows.map((row): StrategyCandle => ({
      openedAt: new Date(row.opened_at), open: BigInt(row.open), high: BigInt(row.high), low: BigInt(row.low), close: BigInt(row.close), volume: BigInt(row.volume),
      orderbookImbalanceBps: BigInt(row.orderbook_imbalance_bps), marketRegimeStrength: BigInt(row.market_regime_strength), sectorStrength: BigInt(row.sector_strength),
    }));
    const output = runBacktest(strategy.definition, candles, toSafety(strategy.safety));
    const serialized = serializeBacktest(output);
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const run = await client.query(
        `INSERT INTO backtest_runs (strategy_id, definition, safety, candle_count, starts_at, ends_at, result)
         VALUES ($1,$2::jsonb,$3::jsonb,$4,$5,$6,$7::jsonb) RETURNING *`,
        [id, JSON.stringify(strategy.definition), JSON.stringify(strategy.safety), candles.length, candles[0]!.openedAt, candles.at(-1)!.openedAt, JSON.stringify(serialized)],
      );
      await client.query("UPDATE strategies SET status = 'BACKTEST', updated_at = now() WHERE id = $1", [id]);
      await client.query("COMMIT");
      return run.rows[0];
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async transition(userId: string, id: string, input: unknown) {
    const value = parse(statusSchema, input);
    const strategy = await this.owned(userId, id);
    if (value.status === "PAPER" && !((strategy.status === "BACKTEST") || (strategy.status === "PAUSED" && strategy.paused_from_status === "PAPER"))) {
      throw new BadRequestException("PAPER 전환에는 완료된 백테스트가 필요합니다.");
    }
    if (value.status === "LIVE_VIRTUAL") {
      if (strategy.status !== "PAPER" && !(strategy.status === "PAUSED" && strategy.paused_from_status === "LIVE_VIRTUAL")) throw new BadRequestException("LIVE_VIRTUAL 전환 전 PAPER 단계가 필요합니다.");
      if (value.confirmLiveVirtual !== true) throw new BadRequestException("가상자산 실거래 실행을 명시적으로 확인해야 합니다.");
      const active = await this.database.pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM strategies WHERE user_id = $1 AND status = 'LIVE_VIRTUAL' AND id <> $2", [userId, id],
      );
      if ((active.rows[0]?.count ?? 0) >= maxLiveStrategies()) throw new BadRequestException("동시 LIVE_VIRTUAL 전략 수 제한을 초과했습니다.");
    }
    if (value.status === "PAUSED" && !["PAPER", "LIVE_VIRTUAL"].includes(strategy.status)) throw new BadRequestException("실행 중 전략만 일시정지할 수 있습니다.");
    const pausedFrom = value.status === "PAUSED" ? strategy.status : null;
    const result = await this.database.pool.query(
      `UPDATE strategies SET status = $3::strategy_status, paused_from_status = $4::strategy_status,
         live_confirmed_at = CASE WHEN $3 = 'LIVE_VIRTUAL' THEN now() ELSE live_confirmed_at END, updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING *`, [id, userId, value.status, pausedFrom],
    );
    return result.rows[0];
  }

  private async owned(userId: string, id: string): Promise<StrategyRow> {
    const result = await this.database.pool.query<StrategyRow>("SELECT * FROM strategies WHERE id = $1", [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException("전략을 찾을 수 없습니다.");
    if (row.user_id !== userId) throw new ForbiddenException("전략 소유자만 접근할 수 있습니다.");
    return row;
  }
}

@Controller("strategies")
@UseGuards(AccessTokenGuard)
export class StrategyController {
  constructor(private readonly strategies: StrategyService) {}
  @Post() create(@CurrentUser() user: AccessPrincipal, @Body() body: unknown) { return this.strategies.create(user.userId, body); }
  @Get() list(@CurrentUser() user: AccessPrincipal) { return this.strategies.list(user.userId); }
  @Get(":id") detail(@CurrentUser() user: AccessPrincipal, @Param("id", new ParseUUIDPipe()) id: string) { return this.strategies.detail(user.userId, id); }
  @Patch(":id") update(@CurrentUser() user: AccessPrincipal, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) { return this.strategies.update(user.userId, id, body); }
  @Post(":id/backtests") backtest(@CurrentUser() user: AccessPrincipal, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) { return this.strategies.backtest(user.userId, id, body); }
  @Post(":id/status") transition(@CurrentUser() user: AccessPrincipal, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) { return this.strategies.transition(user.userId, id, body); }
}

function conditionMetrics(group: { conditions: ConditionInput[] }, depth = 1): { count: number; depth: number } {
  let count = 0; let maximum = depth;
  for (const condition of group.conditions) {
    if ("conditions" in condition) { const nested = conditionMetrics(condition, depth + 1); count += nested.count; maximum = Math.max(maximum, nested.depth); }
    else count += 1;
  }
  return { count, depth: maximum };
}
function toSafety(value: SafetyJson): BacktestSafety {
  return {
    initialCash: BigInt(value.initialCash), maxOrderAmount: BigInt(value.maxOrderAmount), feeBps: BigInt(value.feeBps), slippageBps: BigInt(value.slippageBps),
    maxHoldingBps: value.maxHoldingBps, dailyMaxLossBps: value.dailyMaxLossBps, cooldownBars: value.cooldownBars,
    ...(value.stopLossBps === undefined ? {} : { stopLossBps: value.stopLossBps }),
    ...(value.takeProfitBps === undefined ? {} : { takeProfitBps: value.takeProfitBps }),
  };
}
function serializeBacktest(result: ReturnType<typeof runBacktest>) {
  return {
    ...result, initialCash: result.initialCash.toString(), finalEquity: result.finalEquity.toString(), totalReturnBps: result.totalReturnBps.toString(),
    maxDrawdownBps: result.maxDrawdownBps.toString(), winRateBps: result.winRateBps.toString(), profitFactorBps: result.profitFactorBps?.toString() ?? null,
    totalFees: result.totalFees.toString(), totalSlippage: result.totalSlippage.toString(), sharpeLikeBps: result.sharpeLikeBps.toString(),
    equityCurve: result.equityCurve.map((point) => ({ openedAt: point.openedAt.toISOString(), equity: point.equity.toString() })),
  };
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input); if (!result.success) throw new BadRequestException({ message: "전략 입력이 올바르지 않습니다.", issues: result.error.issues }); return result.data;
}
function maxLiveStrategies(): number {
  const value = Number(process.env.MAX_LIVE_STRATEGIES_PER_USER ?? "5");
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error("MAX_LIVE_STRATEGIES_PER_USER_INVALID");
  return value;
}
