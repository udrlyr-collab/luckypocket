import { describe, expect, test } from "vitest";
import {
  DELIST_REVIEW_MARKET_CAP, NORMAL_TREND_PROBABILITIES, TARGET_DAILY_VOLATILITY,
  calculateStabilityMarketCap, canEnterDelistingReview, canEnterFinalCrash,
  chooseTrendRegime, circuitBreakerTriggered, clampPriceToDailyBand,
  combineNegativeModifiers, currentMarketCap, dailyDriftPerTick,
  effectiveDistressScore, evaluateTierTransition, meanReversionSignal,
  orderFlowImpactBps, tickSigma, updateTimeWeightedEma,
} from "../src/market-stability.js";

describe("large-cap market stability", () => {
  test("calculates current market cap using compounded price", () => {
    expect(currentMarketCap(150_000n, 10_000_000n)).toBe(1_500_000_000_000n);
  });

  test("updates 24h and 7d EMA without replacing them with the current tick", () => {
    const current = 900_000_000_000n, prior = 1_500_000_000_000n;
    const ema24 = updateTimeWeightedEma(prior, current, 10_000, 86_400_000);
    const ema7 = updateTimeWeightedEma(prior, current, 10_000, 7 * 86_400_000);
    expect(ema24).toBeGreaterThan(current);
    expect(ema7).toBeGreaterThan(ema24);
    expect(calculateStabilityMarketCap({ ema24h: ema24, ema7d: ema7 })).toBeGreaterThan(current);
  });

  test("delays a GIANT downgrade for 24 hours and keeps the ±5% buffer", () => {
    const now = new Date("2026-07-13T00:00:00Z");
    const buffered = evaluateTierTransition({ currentTier: "GIANT", stabilityMarketCap: 990_000_000_000n, now });
    expect(buffered.tier).toBe("GIANT");
    expect(buffered.candidateTier).toBeNull();
    const pending = evaluateTierTransition({ currentTier: "GIANT", stabilityMarketCap: 900_000_000_000n, now });
    expect(pending.candidateTier).toBe("MEGA");
    const changed = evaluateTierTransition({ ...pending, currentTier: "GIANT", stabilityMarketCap: 900_000_000_000n, now: new Date(now.getTime() + 24 * 3_600_000) });
    expect(changed).toMatchObject({ tier: "MEGA", changed: true });
  });

  test("uses regime probabilities, not per-tick direction probabilities", () => {
    expect(chooseTrendRegime("GIANT", 0.57)).toBe("BULL");
    expect(chooseTrendRegime("GIANT", 0.60)).toBe("SIDEWAYS");
    expect(chooseTrendRegime("GIANT", 0.90)).toBe("BEAR");
    expect(NORMAL_TREND_PROBABILITIES.GIANT.bear).toBeGreaterThan(NORMAL_TREND_PROBABILITIES.BLUE_CHIP.bear);
  });

  test("scales daily volatility down to a 10-second tick", () => {
    expect(tickSigma("GIANT", 10)).toBeCloseTo(0.05 / Math.sqrt(8_640), 12);
    expect(tickSigma("BLUE_CHIP", 10)).toBeLessThan(tickSigma("GIANT", 10));
    expect(TARGET_DAILY_VOLATILITY.GIANT).toBeLessThan(TARGET_DAILY_VOLATILITY.LARGE);
    expect(dailyDriftPerTick("GIANT", 10)).toBeGreaterThan(0);
  });

  test("caps fair-value reversion and negative modifier stacking", () => {
    expect(meanReversionSignal(60n, 100n)).toBeCloseTo(0.08);
    expect(combineNegativeModifiers({ macro: -0.02, sector: -0.03, company: -0.04, distress: -0.05, liquidity: -0.02, userOrderFlow: -0.01 }, -0.08)).toBe(-0.08);
  });

  test("normal GIANT cannot lose more than 12% per day", () => {
    const anchor = 150_000n;
    expect(clampPriceToDailyBand({ proposedPrice: 1n, anchorPrice: anchor, tier: "GIANT", state: "normal" })).toBe(132_000n);
    const dayTwo = clampPriceToDailyBand({ proposedPrice: 1n, anchorPrice: 132_000n, tier: "GIANT", state: "normal" });
    expect(dayTwo).toBe(116_160n);
    expect(currentMarketCap(dayTwo, 10_000_000n)).toBe(1_161_600_000_000n);
  });

  test("scores financial distress while preserving size protection", () => {
    const components = { operatingLoss: 80, debt: 80, cashRunway: 70, governance: 50, regulatory: 0, event: 0, prolongedDrawdown: 20 };
    expect(effectiveDistressScore(components, "GIANT")).toBeLessThan(effectiveDistressScore(components, "SMALL"));
    expect(effectiveDistressScore(components, "GIANT", true)).toBeGreaterThan(effectiveDistressScore(components, "GIANT"));
  });

  test("enters delisting review only below 50억원, except owner ETF rule", () => {
    expect(DELIST_REVIEW_MARKET_CAP).toBe(5_000_000_000n);
    expect(canEnterDelistingReview(5_000_000_000n)).toBe(false);
    expect(canEnterDelistingReview(4_999_999_999n)).toBe(true);
    expect(canEnterDelistingReview(100_000_000_000n, "user_etf", -8_500)).toBe(true);
    expect(canEnterFinalCrash({ marketCap: 4_000_000_000n, state: "normal" })).toBe(false);
    expect(canEnterFinalCrash({ marketCap: 4_000_000_000n, state: "delisting_review" })).toBe(true);
  });

  test("triggers large-cap circuit breakers and bounds order impact", () => {
    expect(circuitBreakerTriggered({ tier: "GIANT", change5m: -0.061, change30m: -0.08 })).toBe(true);
    expect(circuitBreakerTriggered({ tier: "BLUE_CHIP", change5m: -0.03, change30m: -0.071 })).toBe(true);
    expect(orderFlowImpactBps(10_000n, 1_000_000n, 500)).toBe(100);
    expect(orderFlowImpactBps(10_000_000n, 1_000_000n, 500)).toBe(500);
  });
});
