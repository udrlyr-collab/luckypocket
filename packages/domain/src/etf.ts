export type StockAssetType = "common" | "user_etf" | "etf_leverage" | "etf_derivative";

export function isEligibleEtfUnderlying(assetType: StockAssetType): boolean {
  return assetType === "common";
}

export function calculateTrackedEtfPrice(input: {
  currentCycleId: string;
  sourceCycleId: string;
  sourceEligibleAssetValue: bigint;
  baseEligibleAssetValue: bigint;
  basePrice: bigint;
}): bigint {
  if (input.currentCycleId === input.sourceCycleId) throw new Error("ETF_VALUATION_CYCLE_REFERENCE");
  if (input.sourceEligibleAssetValue < 0n || input.baseEligibleAssetValue <= 0n || input.basePrice <= 0n) throw new Error("ETF_VALUATION_INPUT_INVALID");
  return max(1n, input.sourceEligibleAssetValue * input.basePrice / input.baseEligibleAssetValue);
}

function max(left: bigint, right: bigint): bigint { return left > right ? left : right; }
