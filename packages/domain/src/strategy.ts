export type StrategyIndicator =
  | "current_price" | "change_bps" | "volume" | "sma" | "ema" | "rsi" | "macd"
  | "bollinger_upper" | "bollinger_lower" | "rolling_high" | "rolling_low"
  | "orderbook_imbalance_bps" | "position_quantity" | "holding_return_bps" | "market_regime_strength" | "sector_strength";

export type StrategyOperand =
  | { kind: "indicator"; indicator: StrategyIndicator; period?: number; fastPeriod?: number; slowPeriod?: number }
  | { kind: "constant"; value: string };
export type StrategyCondition = { left: StrategyOperand; operator: "gt" | "gte" | "lt" | "lte" | "eq" | "neq"; right: StrategyOperand };
export type StrategyConditionGroup = { mode: "all" | "any"; conditions: Array<StrategyCondition | StrategyConditionGroup> };
export type StrategyAction =
  | { type: "buy"; sizing: "percent_available_cash"; valueBps: number }
  | { type: "sell"; sizing: "percent_position"; valueBps: number };
export type StrategyDefinition = { version: 1; when: StrategyConditionGroup; then: StrategyAction };

export interface StrategyCandle {
  openedAt: Date;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  volume: bigint;
  orderbookImbalanceBps?: bigint;
  marketRegimeStrength?: bigint;
  sectorStrength?: bigint;
}

export interface BacktestSafety {
  initialCash: bigint;
  feeBps: bigint;
  slippageBps: bigint;
  maxOrderAmount: bigint;
  maxHoldingBps: number;
  dailyMaxLossBps: number;
  cooldownBars: number;
  stopLossBps?: number;
  takeProfitBps?: number;
}

export interface BacktestResult {
  initialCash: bigint;
  finalEquity: bigint;
  totalReturnBps: bigint;
  maxDrawdownBps: bigint;
  winRateBps: bigint;
  profitFactorBps: bigint | null;
  tradeCount: number;
  totalFees: bigint;
  totalSlippage: bigint;
  sharpeLikeBps: bigint;
  equityCurve: Array<{ openedAt: Date; equity: bigint }>;
}

export type StrategyPositionState = { cash: bigint; quantity: bigint; costBasis: bigint };

export function runBacktest(definition: StrategyDefinition, candles: readonly StrategyCandle[], safety: BacktestSafety): BacktestResult {
  validateBacktest(definition, candles, safety);
  const state: StrategyPositionState = { cash: safety.initialCash, quantity: 0n, costBasis: 0n };
  const equityCurve: BacktestResult["equityCurve"] = [];
  let totalFees = 0n;
  let totalSlippage = 0n;
  let peak = safety.initialCash;
  let maxDrawdownBps = 0n;
  let lastTradeIndex = -safety.cooldownBars - 1;
  let wins = 0;
  let closedTrades = 0;
  let grossWins = 0n;
  let grossLosses = 0n;
  let dayStartEquity = safety.initialCash;
  let currentDay = dayKey(candles[0]!.openedAt);

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]!;
    const day = dayKey(candle.openedAt);
    const equityAtClose = state.cash + state.quantity * candle.close;
    if (day !== currentDay) { currentDay = day; dayStartEquity = equityAtClose; }
    const dailyLossBps = dayStartEquity > 0n ? (dayStartEquity - equityAtClose) * 10_000n / dayStartEquity : 0n;
    equityCurve.push({ openedAt: candle.openedAt, equity: equityAtClose });
    peak = max(peak, equityAtClose);
    if (peak > 0n) maxDrawdownBps = max(maxDrawdownBps, (peak - equityAtClose) * 10_000n / peak);
    const next = candles[index + 1];
    const canTrade = next !== undefined && index - lastTradeIndex >= safety.cooldownBars && dailyLossBps < BigInt(safety.dailyMaxLossBps);

    let action: StrategyAction | null = null;
    if (canTrade && evaluateGroup(definition.when, candles, index, state)) action = definition.then;
    if (canTrade && state.quantity > 0n) {
      const averageCost = state.costBasis / state.quantity;
      const returnBps = (candle.close - averageCost) * 10_000n / averageCost;
      if (safety.stopLossBps !== undefined && returnBps <= -BigInt(safety.stopLossBps)) action = { type: "sell", sizing: "percent_position", valueBps: 10_000 };
      if (safety.takeProfitBps !== undefined && returnBps >= BigInt(safety.takeProfitBps)) action = { type: "sell", sizing: "percent_position", valueBps: 10_000 };
    }

    if (action && next) {
      if (action.type === "buy") {
        const marketValue = state.quantity * next.open;
        const totalEquity = state.cash + marketValue;
        const maxHoldingValue = totalEquity * BigInt(safety.maxHoldingBps) / 10_000n;
        const capacity = max(0n, maxHoldingValue - marketValue);
        const desired = min(min(state.cash * BigInt(action.valueBps) / 10_000n, safety.maxOrderAmount), capacity);
        const executionPrice = next.open * (10_000n + safety.slippageBps) / 10_000n;
        const quantity = executionPrice > 0n ? desired * 10_000n / (executionPrice * (10_000n + safety.feeBps)) : 0n;
        if (quantity > 0n) {
          const gross = executionPrice * quantity;
          const fee = gross * safety.feeBps / 10_000n;
          state.cash -= gross + fee;
          state.quantity += quantity;
          state.costBasis += gross + fee;
          totalFees += fee;
          totalSlippage += max(0n, executionPrice - next.open) * quantity;
          lastTradeIndex = index + 1;
        }
      } else if (state.quantity > 0n) {
        const quantity = max(1n, state.quantity * BigInt(action.valueBps) / 10_000n);
        const sellQuantity = min(quantity, state.quantity);
        const executionPrice = max(1n, next.open * (10_000n - safety.slippageBps) / 10_000n);
        const gross = executionPrice * sellQuantity;
        const fee = gross * safety.feeBps / 10_000n;
        const allocatedCost = state.costBasis * sellQuantity / state.quantity;
        const pnl = gross - fee - allocatedCost;
        state.cash += gross - fee;
        state.quantity -= sellQuantity;
        state.costBasis -= allocatedCost;
        totalFees += fee;
        totalSlippage += max(0n, next.open - executionPrice) * sellQuantity;
        closedTrades += 1;
        if (pnl > 0n) { wins += 1; grossWins += pnl; } else grossLosses += -pnl;
        lastTradeIndex = index + 1;
      }
    }
  }
  const finalEquity = state.cash + state.quantity * candles[candles.length - 1]!.close;
  return {
    initialCash: safety.initialCash,
    finalEquity,
    totalReturnBps: (finalEquity - safety.initialCash) * 10_000n / safety.initialCash,
    maxDrawdownBps,
    winRateBps: closedTrades > 0 ? BigInt(wins * 10_000 / closedTrades) : 0n,
    profitFactorBps: grossLosses > 0n ? grossWins * 10_000n / grossLosses : grossWins > 0n ? null : 0n,
    tradeCount: closedTrades + (state.quantity > 0n ? 1 : 0),
    totalFees,
    totalSlippage,
    sharpeLikeBps: sharpeLike(equityCurve),
    equityCurve,
  };
}

export function evaluateGroup(group: StrategyConditionGroup, candles: readonly StrategyCandle[], index: number, state: StrategyPositionState): boolean {
  const values = group.conditions.map((condition) => "conditions" in condition
    ? evaluateGroup(condition, candles, index, state)
    : compare(operand(condition.left, candles, index, state), condition.operator, operand(condition.right, candles, index, state)));
  return group.mode === "all" ? values.every(Boolean) : values.some(Boolean);
}

function operand(spec: StrategyOperand, candles: readonly StrategyCandle[], index: number, state: StrategyPositionState): bigint {
  if (spec.kind === "constant") return BigInt(spec.value);
  const candle = candles[index]!;
  const period = spec.period ?? 14;
  switch (spec.indicator) {
    case "current_price": return candle.close;
    case "change_bps": return index === 0 ? 0n : (candle.close - candles[index - 1]!.close) * 10_000n / candles[index - 1]!.close;
    case "volume": return candle.volume;
    case "sma": return sma(candles, index, period);
    case "ema": return ema(candles, index, period);
    case "rsi": return rsi(candles, index, period);
    case "macd": return ema(candles, index, spec.fastPeriod ?? 12) - ema(candles, index, spec.slowPeriod ?? 26);
    case "bollinger_upper": return bollinger(candles, index, period, true);
    case "bollinger_lower": return bollinger(candles, index, period, false);
    case "rolling_high": return rolling(candles, index, period, true);
    case "rolling_low": return rolling(candles, index, period, false);
    case "orderbook_imbalance_bps": return candle.orderbookImbalanceBps ?? 0n;
    case "position_quantity": return state.quantity;
    case "holding_return_bps": {
      const averageCost = state.quantity > 0n ? state.costBasis / state.quantity : 0n;
      return averageCost > 0n ? (candle.close - averageCost) * 10_000n / averageCost : 0n;
    }
    case "market_regime_strength": return candle.marketRegimeStrength ?? 0n;
    case "sector_strength": return candle.sectorStrength ?? 0n;
  }
}

function sma(candles: readonly StrategyCandle[], index: number, period: number): bigint {
  const start = Math.max(0, index - period + 1); let sum = 0n;
  for (let i = start; i <= index; i += 1) sum += candles[i]!.close;
  return sum / BigInt(index - start + 1);
}
function ema(candles: readonly StrategyCandle[], index: number, period: number): bigint {
  const start = Math.max(0, index - period * 4); let value = candles[start]!.close; const denominator = BigInt(period + 1);
  for (let i = start + 1; i <= index; i += 1) value = (candles[i]!.close * 2n + value * BigInt(period - 1)) / denominator;
  return value;
}
function rsi(candles: readonly StrategyCandle[], index: number, period: number): bigint {
  const start = Math.max(1, index - period + 1); let gains = 0n; let losses = 0n;
  for (let i = start; i <= index; i += 1) { const change = candles[i]!.close - candles[i - 1]!.close; if (change > 0n) gains += change; else losses -= change; }
  return gains + losses === 0n ? 5_000n : gains * 10_000n / (gains + losses);
}
function bollinger(candles: readonly StrategyCandle[], index: number, period: number, upper: boolean): bigint {
  const mean = sma(candles, index, period); const start = Math.max(0, index - period + 1); let variance = 0n;
  for (let i = start; i <= index; i += 1) { const delta = candles[i]!.close - mean; variance += delta * delta; }
  const deviation = sqrt(variance / BigInt(index - start + 1)); return upper ? mean + deviation * 2n : max(1n, mean - deviation * 2n);
}
function rolling(candles: readonly StrategyCandle[], index: number, period: number, high: boolean): bigint {
  const start = Math.max(0, index - period + 1); let value = high ? candles[start]!.high : candles[start]!.low;
  for (let i = start + 1; i <= index; i += 1) value = high ? max(value, candles[i]!.high) : min(value, candles[i]!.low);
  return value;
}
function compare(left: bigint, operator: StrategyCondition["operator"], right: bigint): boolean {
  if (operator === "gt") return left > right; if (operator === "gte") return left >= right; if (operator === "lt") return left < right;
  if (operator === "lte") return left <= right; if (operator === "eq") return left === right; return left !== right;
}
function sharpeLike(curve: BacktestResult["equityCurve"]): bigint {
  if (curve.length < 2) return 0n; const returns: bigint[] = [];
  for (let i = 1; i < curve.length; i += 1) { const prior = curve[i - 1]!.equity; returns.push(prior > 0n ? (curve[i]!.equity - prior) * 10_000n / prior : 0n); }
  const mean = returns.reduce((sum, value) => sum + value, 0n) / BigInt(returns.length);
  const variance = returns.reduce((sum, value) => { const delta = value - mean; return sum + delta * delta; }, 0n) / BigInt(returns.length);
  const deviation = sqrt(variance); return deviation > 0n ? mean * 10_000n / deviation : 0n;
}
function sqrt(value: bigint): bigint { if (value < 0n) throw new Error("SQRT_NEGATIVE"); if (value < 2n) return value; let x = value; let y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + value / x) / 2n; } return x; }
function validateBacktest(definition: StrategyDefinition, candles: readonly StrategyCandle[], safety: BacktestSafety) {
  if (definition.version !== 1 || candles.length < 2) throw new Error("BACKTEST_INPUT_INVALID");
  if (definition.then.valueBps <= 0 || definition.then.valueBps > 10_000) throw new Error("BACKTEST_ACTION_INVALID");
  if (safety.initialCash <= 0n || safety.feeBps < 0n || safety.slippageBps < 0n || safety.slippageBps >= 10_000n || safety.maxOrderAmount <= 0n || safety.maxHoldingBps < 0 || safety.maxHoldingBps > 10_000 || safety.dailyMaxLossBps < 0 || safety.cooldownBars < 0) throw new Error("BACKTEST_SAFETY_INVALID");
}
function dayKey(date: Date): string { return date.toISOString().slice(0, 10); }
function min(left: bigint, right: bigint): bigint { return left < right ? left : right; }
function max(left: bigint, right: bigint): bigint { return left > right ? left : right; }
