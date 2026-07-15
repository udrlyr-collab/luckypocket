import { describe, expect, it } from "vitest";
import { runBacktest, type BacktestSafety, type StrategyCandle, type StrategyDefinition } from "../src/strategy.js";

const alwaysBuy: StrategyDefinition = {
  version: 1,
  when: {
    mode: "all",
    conditions: [{
      left: { kind: "indicator", indicator: "current_price" },
      operator: "gt",
      right: { kind: "constant", value: "0" },
    }],
  },
  then: { type: "buy", sizing: "percent_available_cash", valueBps: 10_000 },
};

const safety: BacktestSafety = {
  initialCash: 1_000n,
  feeBps: 0n,
  slippageBps: 0n,
  maxOrderAmount: 1_000n,
  maxHoldingBps: 10_000,
  dailyMaxLossBps: 10_000,
  cooldownBars: 0,
};

function candles(values: Array<[number, number]>): StrategyCandle[] {
  return values.map(([open, close], index) => ({
    openedAt: new Date(`2026-01-01T00:0${index}:00.000Z`),
    open: BigInt(open),
    high: BigInt(Math.max(open, close)),
    low: BigInt(Math.min(open, close)),
    close: BigInt(close),
    volume: 100n,
  }));
}

describe("strategy backtest", () => {
  it("evaluates on the current close and fills at the next open without rewriting current equity", () => {
    const result = runBacktest(alwaysBuy, candles([[10, 10], [20, 20], [30, 30]]), safety);

    expect(result.equityCurve.map(({ equity }) => equity)).toEqual([1_000n, 1_000n, 1_500n]);
    expect(result.finalEquity).toBe(1_500n);
    expect(result.totalReturnBps).toBe(5_000n);
  });

  it("applies take-profit at the following bar open and records realized performance", () => {
    const result = runBacktest(
      alwaysBuy,
      candles([[100, 100], [100, 120], [110, 110]]),
      { ...safety, takeProfitBps: 1_000 },
    );

    expect(result.equityCurve.map(({ equity }) => equity)).toEqual([1_000n, 1_200n, 1_100n]);
    expect(result.finalEquity).toBe(1_100n);
    expect(result.tradeCount).toBe(1);
    expect(result.winRateBps).toBe(10_000n);
  });

  it("rejects zero-sized actions", () => {
    const invalid = { ...alwaysBuy, then: { ...alwaysBuy.then, valueBps: 0 } } as StrategyDefinition;
    expect(() => runBacktest(invalid, candles([[10, 10], [10, 10]]), safety)).toThrow("BACKTEST_ACTION_INVALID");
  });
});
