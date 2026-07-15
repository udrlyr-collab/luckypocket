import { describe, expect, it } from "vitest";
import { calculateTrackedEtfPrice, isEligibleEtfUnderlying } from "../src/etf.js";

describe("ETF cycle prevention", () => {
  it("excludes every ETF and ETF-derived asset from tracked underlyings", () => {
    expect(isEligibleEtfUnderlying("common")).toBe(true);
    expect(isEligibleEtfUnderlying("user_etf")).toBe(false);
    expect(isEligibleEtfUnderlying("etf_leverage")).toBe(false);
    expect(isEligibleEtfUnderlying("etf_derivative")).toBe(false);
  });

  it("prices only from a different completed-cycle snapshot", () => {
    expect(calculateTrackedEtfPrice({ currentCycleId: "new", sourceCycleId: "prior", sourceEligibleAssetValue: 1_500n, baseEligibleAssetValue: 1_000n, basePrice: 100n })).toBe(150n);
    expect(() => calculateTrackedEtfPrice({ currentCycleId: "same", sourceCycleId: "same", sourceEligibleAssetValue: 1_000n, baseEligibleAssetValue: 1_000n, basePrice: 100n })).toThrow("ETF_VALUATION_CYCLE_REFERENCE");
  });
});
