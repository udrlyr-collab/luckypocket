export const EOK = 100_000_000n;
export const JO = 1_000_000_000_000n;
export const DELIST_REVIEW_MARKET_CAP = 50n * EOK;
export const DAY_MS = 86_400_000;

export type StabilityTier = "BLUE_CHIP" | "GIANT" | "MEGA" | "LARGE" | "MID" | "SMALL" | "DELIST_RISK";
export type TrendRegime = "BULL" | "SIDEWAYS" | "BEAR";
export type ListingRiskState = "normal" | "warning" | "distress_review" | "delisting_review" | "halted" | "delisted";

export const NORMAL_TREND_PROBABILITIES = Object.freeze({
  BLUE_CHIP: { bull: 0.62, sideways: 0.28, bear: 0.10 },
  GIANT: { bull: 0.58, sideways: 0.24, bear: 0.18 },
  MEGA: { bull: 0.55, sideways: 0.24, bear: 0.21 },
  LARGE: { bull: 0.52, sideways: 0.23, bear: 0.25 },
  MID: { bull: 0.49, sideways: 0.22, bear: 0.29 },
  SMALL: { bull: 0.46, sideways: 0.20, bear: 0.34 },
  DELIST_RISK: { bull: 0.38, sideways: 0.17, bear: 0.45 },
} satisfies Record<StabilityTier, { bull: number; sideways: number; bear: number }>);

export const DAILY_BASE_DRIFT = Object.freeze({
  BLUE_CHIP: 0.0020, GIANT: 0.0025, MEGA: 0.0018, LARGE: 0.0012,
  MID: 0.0006, SMALL: 0, DELIST_RISK: -0.002,
} satisfies Record<StabilityTier, number>);

export const TARGET_DAILY_VOLATILITY = Object.freeze({
  BLUE_CHIP: 0.03, GIANT: 0.05, MEGA: 0.07, LARGE: 0.10,
  MID: 0.14, SMALL: 0.20, DELIST_RISK: 0.28,
} satisfies Record<StabilityTier, number>);

export const NORMAL_DAILY_MOVE_BANDS = Object.freeze({
  BLUE_CHIP: { maxDown: -0.06, maxUp: 0.08 },
  GIANT: { maxDown: -0.12, maxUp: 0.15 },
  MEGA: { maxDown: -0.15, maxUp: 0.20 },
  LARGE: { maxDown: -0.20, maxUp: 0.28 },
  MID: { maxDown: -0.28, maxUp: 0.38 },
  SMALL: { maxDown: -0.35, maxUp: 0.50 },
  DELIST_RISK: { maxDown: -0.45, maxUp: 0.65 },
} satisfies Record<StabilityTier, { maxDown: number; maxUp: number }>);

export const MARKET_MAKER_DEPTH_MULTIPLIER = Object.freeze({
  BLUE_CHIP: 3.0, GIANT: 2.2, MEGA: 1.7, LARGE: 1.25,
  MID: 0.9, SMALL: 0.55, DELIST_RISK: 0.35,
} satisfies Record<StabilityTier, number>);

export const MARKET_MAKER_REFRESH_MS = Object.freeze({
  BLUE_CHIP: 1_000, GIANT: 1_200, MEGA: 1_500, LARGE: 2_000,
  MID: 2_500, SMALL: 3_500, DELIST_RISK: 5_000,
} satisfies Record<StabilityTier, number>);

const TIER_ORDER: StabilityTier[] = ["DELIST_RISK", "SMALL", "MID", "LARGE", "MEGA", "GIANT", "BLUE_CHIP"];
const TIER_FLOOR: Record<Exclude<StabilityTier, "BLUE_CHIP">, bigint> = {
  DELIST_RISK: 0n, SMALL: DELIST_REVIEW_MARKET_CAP, MID: 500n * EOK,
  LARGE: 1_500n * EOK, MEGA: 5_000n * EOK, GIANT: JO,
};

export function currentMarketCap(price: bigint, totalShares: bigint): bigint {
  if (price <= 0n || totalShares <= 0n) throw new Error("MARKET_CAP_INPUT_INVALID");
  return price * totalShares;
}

export function classifyStabilityTier(cap: bigint, blueChip = false): StabilityTier {
  if (cap < 0n) throw new Error("MARKET_CAP_NEGATIVE");
  if (blueChip) return "BLUE_CHIP";
  if (cap >= JO) return "GIANT";
  if (cap >= 5_000n * EOK) return "MEGA";
  if (cap >= 1_500n * EOK) return "LARGE";
  if (cap >= 500n * EOK) return "MID";
  if (cap >= DELIST_REVIEW_MARKET_CAP) return "SMALL";
  return "DELIST_RISK";
}

export function updateTimeWeightedEma(previous: bigint, current: bigint, elapsedMs: number, windowMs: number): bigint {
  if (previous <= 0n || current <= 0n || !Number.isFinite(elapsedMs) || elapsedMs < 0 || !Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("EMA_INPUT_INVALID");
  }
  const alpha = 1 - Math.exp(-Math.min(elapsedMs, windowMs * 10) / windowMs);
  const scale = 1_000_000n;
  const scaledAlpha = BigInt(Math.round(alpha * Number(scale)));
  return (previous * (scale - scaledAlpha) + current * scaledAlpha) / scale;
}

export function calculateStabilityMarketCap(input: {
  ema24h: bigint; ema7d: bigint; initialMarketCap?: bigint; listedAgeMs?: number;
}): bigint {
  if (input.ema24h <= 0n || input.ema7d <= 0n) throw new Error("STABILITY_CAP_INPUT_INVALID");
  const emaBlend = (input.ema24h * 6n + input.ema7d * 4n) / 10n;
  if (!input.initialMarketCap || input.initialMarketCap <= 0n || input.listedAgeMs === undefined || input.listedAgeMs >= 7 * DAY_MS) return emaBlend;
  const age = Math.max(0, input.listedAgeMs);
  const initialWeightBps = BigInt(Math.round((1 - age / (7 * DAY_MS)) * 5_000));
  return (emaBlend * (10_000n - initialWeightBps) + input.initialMarketCap * initialWeightBps) / 10_000n;
}

export function evaluateTierTransition(input: {
  currentTier: StabilityTier; stabilityMarketCap: bigint; blueChip?: boolean;
  candidateTier?: StabilityTier | null; candidateSince?: Date | null; now: Date; distressed?: boolean;
}): { tier: StabilityTier; candidateTier: StabilityTier | null; candidateSince: Date | null; changed: boolean } {
  if (input.blueChip) return { tier: "BLUE_CHIP", candidateTier: null, candidateSince: null, changed: input.currentTier !== "BLUE_CHIP" };
  const currentTier = input.currentTier === "BLUE_CHIP" ? classifyStabilityTier(input.stabilityMarketCap) : input.currentTier;
  const rawTarget = classifyStabilityTier(input.stabilityMarketCap);
  const currentIndex = TIER_ORDER.indexOf(currentTier);
  const targetIndex = TIER_ORDER.indexOf(rawTarget);
  if (targetIndex === currentIndex || insideHysteresis(currentTier, input.stabilityMarketCap, targetIndex < currentIndex)) {
    return { tier: currentTier, candidateTier: null, candidateSince: null, changed: false };
  }
  const candidateTier = rawTarget;
  const candidateSince = input.candidateTier === candidateTier && input.candidateSince ? input.candidateSince : input.now;
  const movingDown = targetIndex < currentIndex;
  const requiredMs = movingDown ? (input.distressed ? 12 : 24) * 3_600_000 : 12 * 3_600_000;
  if (input.now.getTime() - candidateSince.getTime() < requiredMs) {
    return { tier: currentTier, candidateTier, candidateSince, changed: false };
  }
  return { tier: candidateTier, candidateTier: null, candidateSince: null, changed: true };
}

function insideHysteresis(tier: StabilityTier, cap: bigint, movingDown: boolean): boolean {
  if (tier === "BLUE_CHIP") return false;
  const index = TIER_ORDER.indexOf(tier);
  const boundary = movingDown ? TIER_FLOOR[tier] : floorForIndex(index + 1);
  if (boundary === null) return false;
  const low = boundary * 95n / 100n;
  const high = boundary * 105n / 100n;
  return cap >= low && cap <= high;
}

function floorForIndex(index: number): bigint | null {
  const tier = TIER_ORDER[index];
  return tier && tier !== "BLUE_CHIP" ? TIER_FLOOR[tier] : null;
}

export function chooseTrendRegime(tier: StabilityTier, random: number): TrendRegime {
  if (!Number.isFinite(random) || random < 0 || random >= 1) throw new Error("TREND_RANDOM_INVALID");
  const probabilities = NORMAL_TREND_PROBABILITIES[tier];
  if (random < probabilities.bull) return "BULL";
  if (random < probabilities.bull + probabilities.sideways) return "SIDEWAYS";
  return "BEAR";
}

export function trendDurationMs(random: number): number {
  if (!Number.isFinite(random) || random < 0 || random >= 1) throw new Error("TREND_RANDOM_INVALID");
  return 30 * 60_000 + Math.floor(random * (150 * 60_000 + 1));
}

export function tickCountPerDay(tickSeconds: number): number {
  if (!Number.isFinite(tickSeconds) || tickSeconds <= 0) throw new Error("TICK_SECONDS_INVALID");
  return 86_400 / tickSeconds;
}

export function tickSigma(tier: StabilityTier, tickSeconds: number): number {
  return TARGET_DAILY_VOLATILITY[tier] / Math.sqrt(tickCountPerDay(tickSeconds));
}

export function dailyDriftPerTick(tier: StabilityTier, tickSeconds: number): number {
  return Math.expm1(Math.log1p(DAILY_BASE_DRIFT[tier]) / tickCountPerDay(tickSeconds));
}

export function meanReversionSignal(currentPrice: bigint, fairValue: bigint, maxReversion = 0.08): number {
  if (currentPrice <= 0n || fairValue <= 0n || !Number.isFinite(maxReversion) || maxReversion <= 0) throw new Error("MEAN_REVERSION_INPUT_INVALID");
  return clampNumber(Math.log(Number(fairValue) / Number(currentPrice)), -maxReversion, maxReversion);
}

export function combineNegativeModifiers(input: Record<"macro" | "sector" | "company" | "distress" | "liquidity" | "userOrderFlow", number>, floor: number): number {
  if (!Number.isFinite(floor) || floor >= 0) throw new Error("MODIFIER_FLOOR_INVALID");
  const values = Object.values(input);
  if (values.some((value) => !Number.isFinite(value))) throw new Error("MODIFIER_INVALID");
  return clampNumber(values.reduce((sum, value) => sum + Math.min(0, value), 0), floor, 0);
}

export function dailyMoveBand(tier: StabilityTier, state: ListingRiskState): { maxDown: number; maxUp: number } {
  if (state === "distress_review") {
    if (tier === "BLUE_CHIP") return { maxDown: -0.14, maxUp: 0.14 };
    if (tier === "GIANT") return { maxDown: -0.20, maxUp: 0.18 };
    const normal = NORMAL_DAILY_MOVE_BANDS[tier];
    return { maxDown: Math.max(-0.45, normal.maxDown * 1.35), maxUp: Math.min(0.60, normal.maxUp * 1.2) };
  }
  return NORMAL_DAILY_MOVE_BANDS[tier];
}

export function clampPriceToDailyBand(input: { proposedPrice: bigint; anchorPrice: bigint; tier: StabilityTier; state: ListingRiskState }): bigint {
  if (input.proposedPrice <= 0n || input.anchorPrice <= 0n) throw new Error("DAILY_BAND_PRICE_INVALID");
  const band = dailyMoveBand(input.tier, input.state);
  const lowBps = BigInt(Math.round((1 + band.maxDown) * 10_000));
  const highBps = BigInt(Math.round((1 + band.maxUp) * 10_000));
  const low = maxBigInt(1n, input.anchorPrice * lowBps / 10_000n);
  const high = maxBigInt(low, input.anchorPrice * highBps / 10_000n);
  return maxBigInt(low, minBigInt(high, input.proposedPrice));
}

export function circuitBreakerTriggered(input: { tier: StabilityTier; change5m: number; change30m: number }): boolean {
  const thresholds = input.tier === "BLUE_CHIP" ? { five: -0.04, thirty: -0.07 }
    : input.tier === "GIANT" ? { five: -0.06, thirty: -0.10 } : null;
  return thresholds ? input.change5m <= thresholds.five || input.change30m <= thresholds.thirty : false;
}

export type DistressComponents = {
  operatingLoss: number; debt: number; cashRunway: number; governance: number;
  regulatory: number; event: number; prolongedDrawdown: number;
};

export function effectiveDistressScore(components: DistressComponents, tier: StabilityTier, catastrophic = false): number {
  const raw = Object.values(components).reduce((sum, value) => sum + clampNumber(value, 0, 100), 0);
  if (catastrophic) return Math.round(clampNumber(raw, 0, 700));
  const protection: Record<StabilityTier, number> = { BLUE_CHIP: 120, GIANT: 90, MEGA: 65, LARGE: 40, MID: 20, SMALL: 5, DELIST_RISK: 0 };
  return Math.round(clampNumber(raw - protection[tier], 0, 700));
}

export function canEnterDelistingReview(marketCap: bigint, assetType = "common", ownerEtfDrawdownBps?: number): boolean {
  if (assetType === "user_etf" && ownerEtfDrawdownBps !== undefined && ownerEtfDrawdownBps <= -8_500) return true;
  return marketCap < DELIST_REVIEW_MARKET_CAP;
}

export function canEnterFinalCrash(input: { marketCap: bigint; state: ListingRiskState; catastrophic?: boolean; adminOverride?: boolean }): boolean {
  if (input.catastrophic || input.adminOverride) return true;
  return input.marketCap < DELIST_REVIEW_MARKET_CAP && input.state === "delisting_review";
}

export function orderFlowImpactBps(orderNotional: bigint, effectiveLiquidityDepth: bigint, maxImpactBps: number): number {
  if (orderNotional < 0n || effectiveLiquidityDepth <= 0n || !Number.isInteger(maxImpactBps) || maxImpactBps < 0) throw new Error("ORDER_IMPACT_INPUT_INVALID");
  const impact = Number(orderNotional * 10_000n / effectiveLiquidityDepth);
  return Math.min(maxImpactBps, Math.max(0, impact));
}

function clampNumber(value: number, low: number, high: number): number { return Math.max(low, Math.min(high, value)); }
function minBigInt(left: bigint, right: bigint): bigint { return left < right ? left : right; }
function maxBigInt(left: bigint, right: bigint): bigint { return left > right ? left : right; }
