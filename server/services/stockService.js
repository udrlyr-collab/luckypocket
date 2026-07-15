import { createServerNotification } from "./serverNotificationService.js";
import { isStockMarketOpen } from "./marketStateService.js";
import {
  calculateOwnerEtfTrackingAsset,
  calculateUserTotalEvaluatedAsset,
} from "./portfolioValuationService.js";
import { addJackpotContribution } from "./economyRtpService.js";
import {
  calculateLeveragedPositionOutcome,
} from "./leverageRiskService.js";
import { formatSignedWon } from "../utils/formatWon.js";
import {
  STOCK_SECTORS,
  inferStockSector,
  randomStockSector,
} from "../constants/stockSectors.js";
import {
  clampTickMoveRate,
  getLiquidityModifier,
} from "./stockFeeService.js";
import {
  applyLeverageSettlementTax,
  calculateLeverageSettlement,
} from "./stockSettlementService.js";
import { applyStockTaxLedgerImpact } from "./stockTaxLedgerService.js";
import {
  incrementUserStockStat,
  STOCK_STAT_TYPES,
} from "./stockTradeStatsService.js";
import {
  calculateTrendMoveRate,
  ensureMarketRegime,
  maybeTriggerShortSqueeze,
  maybeTriggerVolatilityHalt,
  processCorporateEvents,
  refreshLegacyStabilityState,
  releaseExpiredTradingHalts,
} from "./marketDynamicsService.js";
import { runDailyUnluckyScheduler } from "./dailyUnluckyService.js";

const STOCK_TICK_INTERVAL_MS = 10_000;
export const STOCK_TICK_INTERVAL_SECONDS = STOCK_TICK_INTERVAL_MS / 1000;
const DAY_SECONDS = 24 * 60 * 60;
const TICKS_PER_DAY = DAY_SECONDS / STOCK_TICK_INTERVAL_SECONDS;
export const BLUE_CHIP_DAILY_MAX_GAIN = 0.15;
export const BLUE_CHIP_DAILY_MAX_LOSS = -0.13;
export const BLUE_CHIP_TICK_MAX_GAIN =
  Math.pow(1 + BLUE_CHIP_DAILY_MAX_GAIN, 1 / TICKS_PER_DAY) - 1;
export const BLUE_CHIP_TICK_MAX_LOSS =
  Math.pow(1 + BLUE_CHIP_DAILY_MAX_LOSS, 1 / TICKS_PER_DAY) - 1;
export let nextTickAt = Date.now() + STOCK_TICK_INTERVAL_MS;

export function getStockMarketClock(now = Date.now()) {
  return {
    serverTime: new Date(now).toISOString(),
    nextTickAt: new Date(nextTickAt).toISOString(),
    tickIntervalSeconds: STOCK_TICK_INTERVAL_SECONDS,
  };
}

const EVENT_PROBABILITIES = {
  normal: 0.99997,
  surge: 0.000018,
  crash: 0.000012,
};

const SECTOR_EVENT_INTERVAL_MS = 30 * 60_000;
let lastSectorEventAt = 0;

const SECTOR_EVENT_PROBABILITIES = {
  good: { normal: 0.99994, surge: 0.00005, crash: 0.00001 },
  bad: { normal: 0.99994, surge: 0.00001, crash: 0.00005 },
  volatile: { normal: 0.99990, surge: 0.00005, crash: 0.00005 },
};

const SECTOR_EVENT_TEMPLATES = {
  good: [
    ["섹터 호재", "{sector} 섹터에 긍정적인 수급이 들어왔어요."],
    ["정책 기대감", "{sector} 섹터 기대감이 커졌어요."],
  ],
  bad: [
    ["섹터 악재", "{sector} 섹터에 부담 요인이 생겼어요."],
    ["투심 약화", "{sector} 섹터 투자심리가 약해졌어요."],
  ],
  volatile: [
    ["섹터 급등락", "{sector} 섹터가 큰 폭으로 흔들리고 있어요."],
    ["변동성 확대", "{sector} 섹터 변동성이 커졌어요."],
  ],
};

const IPO_MAX_GAIN_FIRST_5_MIN = 3.0;
const IPO_FIRST_5_MIN_MAX_PRICE_MULTIPLIER = 1 + IPO_MAX_GAIN_FIRST_5_MIN;
const IPO_FIRST_5_MIN_MIN_PRICE_MULTIPLIER = 0.4;
const IPO_OVERHEAT_RATE = 1.5;
const IPO_LIMIT_NEAR_RATE = 2.7;

const IPO_OPENING_EVENT_PROBABILITIES = {
  surge: 0.55,
  normal: 0.30,
  crash: 0.15,
};

const IPO_SURGE_TIER_PROBABILITIES = {
  normalSurge: 0.70,
  strongSurge: 0.22,
  megaSurge: 0.08,
};

const IPO_SURGE_MOVE_RANGES = {
  normalSurge: [0.20, 0.80],
  strongSurge: [0.80, 1.50],
  megaSurge: [1.50, 3.00],
};

const IPO_OPENING_MOVE_RANGES = {
  normal: [-0.10, 0.25],
  crash: [-0.35, -0.15],
};

const NEW_LISTING_TICK_PROBABILITIES = {
  rise: 0.42,
  flat: 0.25,
  drop: 0.33,
};

const NEW_LISTING_TICK_MOVE_RANGES = {
  rise: [0.003, 0.025],
  flat: [-0.004, 0.004],
  drop: [-0.035, -0.006],
};

const IPO_OVERHEATED_MOVE_PROBABILITIES = {
  rise: 0.15,
  flat: 0.30,
  drop: 0.55,
};

const IPO_OVERHEATED_MOVE_RANGES = {
  rise: [0.001, 0.008],
  flat: [-0.004, 0.004],
  drop: [-0.045, -0.008],
};

const IPO_LIMIT_NEAR_MOVE_PROBABILITIES = {
  rise: 0.05,
  flat: 0.25,
  drop: 0.70,
};

const BLUE_CHIP_MOVE_PROBABILITIES = {
  steadyRise: 0.58,
  smallRise: 0.22,
  flat: 0.12,
  smallDrop: 0.08
};

export const EOK = 100_000_000;
export const JO = 1_000_000_000_000;

export const STOCK_GENERATION_TIERS = [
  { key: "micro", label: "초소형주", min: 62 * EOK, max: 95 * EOK, weight: 38 },
  { key: "small", label: "소형주", min: 95 * EOK, max: 180 * EOK, weight: 30 },
  { key: "small_mid", label: "중소형주", min: 180 * EOK, max: 500 * EOK, weight: 18 },
  { key: "mid", label: "중형주", min: 500 * EOK, max: 1_500 * EOK, weight: 9 },
  { key: "large", label: "대형주", min: 1_500 * EOK, max: 5_000 * EOK, weight: 4 },
  { key: "mega", label: "초대형주", min: 5_000 * EOK, max: 2 * JO, weight: 1 },
];

export const IPO_GENERATION_TIERS = [
  { key: "ipo_micro", label: "초소형 공모주", min: 60 * EOK, max: 85 * EOK, weight: 48 },
  { key: "ipo_small", label: "소형 공모주", min: 85 * EOK, max: 160 * EOK, weight: 32 },
  { key: "ipo_small_mid", label: "중소형 공모주", min: 160 * EOK, max: 350 * EOK, weight: 14 },
  { key: "ipo_mid", label: "중형 공모주", min: 350 * EOK, max: 900 * EOK, weight: 5 },
  { key: "ipo_large_rare", label: "대형 공모주", min: 900 * EOK, max: 3_000 * EOK, weight: 1 },
];

function pickWeightedTier(tiers) {
  const totalWeight = tiers.reduce((sum, tier) => sum + tier.weight, 0);
  let random = Math.random() * totalWeight;
  for (const tier of tiers) {
    random -= tier.weight;
    if (random <= 0) return tier;
  }
  return tiers[0];
}

function randomBetweenInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function pickProbabilityKey(probabilities) {
  const r = Math.random();
  let cursor = 0;
  for (const [key, probability] of Object.entries(probabilities)) {
    cursor += probability;
    if (r < cursor) return key;
  }
  return Object.keys(probabilities).at(-1);
}

function clampIpoFirstFiveMinutePrice(stock, nextPrice) {
  if (!stock.offering_price) return Math.max(1, Math.floor(nextPrice));
  const maxPrice = Math.floor(stock.offering_price * IPO_FIRST_5_MIN_MAX_PRICE_MULTIPLIER);
  const minPrice = Math.max(1, Math.floor(stock.offering_price * IPO_FIRST_5_MIN_MIN_PRICE_MULTIPLIER));
  return Math.max(minPrice, Math.min(Math.floor(nextPrice), maxPrice));
}

function buildIpoOpeningMove(stock) {
  const event = pickProbabilityKey(IPO_OPENING_EVENT_PROBABILITIES);
  if (event === "surge") {
    const tier = pickProbabilityKey(IPO_SURGE_TIER_PROBABILITIES);
    const [min, max] = IPO_SURGE_MOVE_RANGES[tier];
    const changeRate = randomBetween(min, max);
    const eventType = tier === "megaSurge" ? "ipo_mega_surge" : tier === "strongSurge" ? "ipo_strong_surge" : "ipo_surge";
    return {
      eventType,
      openingEventType: tier,
      changeRate,
      message:
        tier === "megaSurge"
          ? `${stock.name}이(가) 신규 상장 초대박 급등을 기록했어요.`
          : tier === "strongSurge"
            ? `${stock.name}이(가) 신규 상장 후 강하게 상승했어요.`
            : `${stock.name}이(가) 신규 상장 후 상승했어요.`,
    };
  }

  const [min, max] = IPO_OPENING_MOVE_RANGES[event];
  const changeRate = randomBetween(min, max);
  return {
    eventType: event === "crash" ? "ipo_crash" : "ipo_normal_open",
    openingEventType: event,
    changeRate,
    message:
      event === "crash"
        ? `${stock.name}이(가) 신규 상장 직후 약세로 출발했어요.`
        : `${stock.name}이(가) 신규 상장 후 차분하게 거래를 시작했어요.`,
  };
}

function getIpoOfferingChangeRate(stock, price = stock.current_price) {
  const offeringPrice = Number(stock.offering_price || 0);
  if (offeringPrice <= 0) return 0;
  return (Number(price || 0) - offeringPrice) / offeringPrice;
}

function buildNewListingTickMove(stock) {
  const offeringRate = getIpoOfferingChangeRate(stock);
  const probabilities =
    offeringRate >= IPO_LIMIT_NEAR_RATE
      ? IPO_LIMIT_NEAR_MOVE_PROBABILITIES
      : offeringRate >= IPO_OVERHEAT_RATE
        ? IPO_OVERHEATED_MOVE_PROBABILITIES
        : NEW_LISTING_TICK_PROBABILITIES;
  const ranges =
    offeringRate >= IPO_LIMIT_NEAR_RATE
      ? IPO_OVERHEATED_MOVE_RANGES
      : offeringRate >= IPO_OVERHEAT_RATE
        ? IPO_OVERHEATED_MOVE_RANGES
        : NEW_LISTING_TICK_MOVE_RANGES;
  const direction = pickProbabilityKey(probabilities);
  const [min, max] = ranges[direction];
  return randomBetween(min, max);
}

function getIpoThresholdEvent(stock, nextPrice) {
  const previousRate = getIpoOfferingChangeRate(stock, stock.current_price);
  const nextRate = getIpoOfferingChangeRate(stock, nextPrice);
  if (previousRate < IPO_LIMIT_NEAR_RATE && nextRate >= IPO_LIMIT_NEAR_RATE) {
    return {
      eventType: "ipo_limit_near",
      message: `${stock.name}이(가) 공모주 상한 근접 상태가 되었어요.`,
    };
  }
  if (previousRate < IPO_OVERHEAT_RATE && nextRate >= IPO_OVERHEAT_RATE) {
    return {
      eventType: "ipo_overheated",
      message: `${stock.name}이(가) 공모주 과열 상태가 되었어요.`,
    };
  }
  return null;
}

export function getBlueChipChangeRate() {
  const r = Math.random();

  if (r < BLUE_CHIP_MOVE_PROBABILITIES.steadyRise) {
    return randomBetween(
      BLUE_CHIP_TICK_MAX_GAIN * 0.45,
      BLUE_CHIP_TICK_MAX_GAIN,
    );
  }

  if (
    r <
    BLUE_CHIP_MOVE_PROBABILITIES.steadyRise +
      BLUE_CHIP_MOVE_PROBABILITIES.smallRise
  ) {
    return randomBetween(
      BLUE_CHIP_TICK_MAX_GAIN * 0.10,
      BLUE_CHIP_TICK_MAX_GAIN * 0.45,
    );
  }

  if (
    r <
    BLUE_CHIP_MOVE_PROBABILITIES.steadyRise +
      BLUE_CHIP_MOVE_PROBABILITIES.smallRise +
      BLUE_CHIP_MOVE_PROBABILITIES.flat
  ) {
    return randomBetween(
      BLUE_CHIP_TICK_MAX_LOSS * 0.10,
      BLUE_CHIP_TICK_MAX_GAIN * 0.10,
    );
  }

  return randomBetween(
    BLUE_CHIP_TICK_MAX_LOSS,
    BLUE_CHIP_TICK_MAX_LOSS * 0.35,
  );
}

export function calculateBlueChipDailyLimits(openPrice) {
  const safeOpenPrice = Math.max(1, Math.floor(Number(openPrice) || 1));
  return {
    openPrice: safeOpenPrice,
    highLimitPrice: Math.floor(safeOpenPrice * (1 + BLUE_CHIP_DAILY_MAX_GAIN)),
    lowLimitPrice: Math.max(
      1,
      Math.floor(safeOpenPrice * (1 + BLUE_CHIP_DAILY_MAX_LOSS)),
    ),
  };
}

function pickInitialStockPriceByTier(tier) {
  const ranges = {
    ipo_micro: [100, 1_000],
    ipo_small: [300, 2_000],
    ipo_small_mid: [500, 5_000],
    ipo_mid: [1_000, 10_000],
    ipo_large_rare: [2_000, 20_000],
    micro: [100, 1_500],
    small: [300, 3_000],
    small_mid: [500, 8_000],
    mid: [1_000, 20_000],
    large: [3_000, 50_000],
    mega: [5_000, 100_000],
  };
  const [min, max] = ranges[tier.key] || [500, 5_000];
  return randomBetweenInt(min, max);
}

function createStockIdentityAndCap(isIpo = false) {
  const tier = pickWeightedTier(isIpo ? IPO_GENERATION_TIERS : STOCK_GENERATION_TIERS);
  const targetMarketCap = randomBetweenInt(Math.floor(tier.min), Math.floor(tier.max));
  const currentPrice = pickInitialStockPriceByTier(tier);
  const totalShares = Math.max(1_000, Math.floor(targetMarketCap / currentPrice));
  const marketCap = currentPrice * totalShares;
  return { currentPrice, totalShares, marketCap, targetMarketCap, tier };
}

export const STOCK_MARKET_POLICY = {
  maxActiveStocks: 16,
  targetActiveTradableStockCount: 16,
  companyAcquisitionBalanceMultiplier: 5,
  minimumMarketCap: 5_000_000_000,
  marketCapWarningThreshold: 6_000_000_000,
  finalCrashMarketCap: 1_000_000_000,
  cautionRequiredTicks: 3,
  recoveryRequiredTicks: 6,
  delistReviewMaxTicks: 180,
  newlyListedDurationMs: 300_000,
  ownerEtfDelistPriceRatio: 0.15,
  stockTickIntervalSeconds: STOCK_TICK_INTERVAL_SECONDS,
  ipoMaxGainFirstFiveMinutes: IPO_MAX_GAIN_FIRST_5_MIN,
  ipoOverheatRate: IPO_OVERHEAT_RATE,
  ipoLimitNearRate: IPO_LIMIT_NEAR_RATE,
  bluechipDailyMaxGain: BLUE_CHIP_DAILY_MAX_GAIN,
  bluechipDailyMaxLoss: BLUE_CHIP_DAILY_MAX_LOSS,
  bluechipTicksPerDay: TICKS_PER_DAY,
  bluechipTickMaxGain: BLUE_CHIP_TICK_MAX_GAIN,
  bluechipTickMaxLoss: BLUE_CHIP_TICK_MAX_LOSS,
  bluechipMaxTickVolatility: BLUE_CHIP_TICK_MAX_GAIN,
  regularMaxTickVolatility: 0.015,
  ipoMinVolatility: 0.01,
  ipoMaxVolatility: 0.025,
};

export const COMPANY_SIZE_PROTECTION = Object.freeze({
  SMALL: 0,
  MID: 8,
  LARGE: 15,
  MEGA: 22,
  GIANT: 30,
  BLUE_CHIP: 38,
  DELIST_RISK: 0,
});

export const DISTRESS_MIN_OBSERVATION_HOURS = Object.freeze({
  SMALL: 6,
  MID: 12,
  LARGE: 24,
  MEGA: 36,
  GIANT: 48,
  BLUE_CHIP: 72,
  DELIST_RISK: 6,
});

export function requiredCompanyAcquisitionBalance(acquisitionCost) {
  const cost = Number(acquisitionCost);
  if (!Number.isFinite(cost) || cost < 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.ceil(cost * STOCK_MARKET_POLICY.companyAcquisitionBalanceMultiplier);
}

export function getMarketCapPolicyState(marketCap) {
  const value = Number(marketCap);
  if (!Number.isFinite(value) || value < STOCK_MARKET_POLICY.finalCrashMarketCap) {
    return "final_crash";
  }
  if (value < STOCK_MARKET_POLICY.minimumMarketCap) {
    return "delist_review";
  }
  if (value < STOCK_MARKET_POLICY.marketCapWarningThreshold) {
    return "caution";
  }
  return "normal";
}

export function minimumSharesForTradableMarketCap(price) {
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.ceil(
    (STOCK_MARKET_POLICY.marketCapWarningThreshold + 1) / numericPrice,
  );
}

export function shouldDelistOwnerEtf(basePrice, currentPrice) {
  return (
    Number.isFinite(basePrice) &&
    Number.isFinite(currentPrice) &&
    basePrice > 0 &&
    currentPrice / basePrice <= STOCK_MARKET_POLICY.ownerEtfDelistPriceRatio
  );
}

function isOwnerAssetEtf(stock) {
  return stock?.is_etf === 1 && stock?.etf_tracking_type === "owner_asset" && stock?.status === "acquired";
}

function ownerEtfDelistReference(stock) {
  return Math.max(1, Math.floor(Number(stock.etf_delist_reference_price || stock.etf_base_price || stock.current_price || 1)));
}

function ownerEtfDelistTrigger(stock) {
  return Math.max(1, Math.floor(Number(stock.etf_delist_trigger_price || ownerEtfDelistReference(stock) * STOCK_MARKET_POLICY.ownerEtfDelistPriceRatio)));
}

export const ACTIVE_TRADABLE_STOCK_STATUSES = [
  "listed",
  "caution",
  "delist_review",
  "recovery",
  "newly_listed",
  "acquired",
];

function statusPlaceholders(statuses) {
  return statuses.map(() => "?").join(", ");
}

export function activeTradableStockCount(database) {
  return database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM stocks
       WHERE status IN (${statusPlaceholders(ACTIVE_TRADABLE_STOCK_STATUSES)})
         AND COALESCE(delist_risk_status, 'normal') != 'final_crash'`,
    )
    .get(...ACTIVE_TRADABLE_STOCK_STATUSES).count;
}

export function stockMarketDistributionSnapshot(database) {
  const rows = database
    .prepare(
      `SELECT market_cap
       FROM stocks
       WHERE status IN (${statusPlaceholders(ACTIVE_TRADABLE_STOCK_STATUSES)})
         AND COALESCE(delist_risk_status, 'normal') != 'final_crash'`,
    )
    .all(...ACTIVE_TRADABLE_STOCK_STATUSES);
  const snapshot = {
    dangerMicro: 0,
    micro: 0,
    small: 0,
    smallMid: 0,
    mid: 0,
    large: 0,
    mega: 0,
    giant: 0,
    averageMarketCap: 0,
  };
  let total = 0;
  for (const row of rows) {
    const cap = Number(row.market_cap || 0);
    total += cap;
    if (cap < 60 * EOK) snapshot.dangerMicro += 1;
    else if (cap < 100 * EOK) snapshot.micro += 1;
    else if (cap < 300 * EOK) snapshot.small += 1;
    else if (cap < 1_000 * EOK) snapshot.smallMid += 1;
    else if (cap < 5_000 * EOK) snapshot.mid += 1;
    else if (cap < 2 * JO) snapshot.large += 1;
    else if (cap < 10 * JO) snapshot.mega += 1;
    else snapshot.giant += 1;
  }
  snapshot.averageMarketCap = rows.length ? Math.floor(total / rows.length) : 0;
  return snapshot;
}

import { STOCK_NAME_POOL } from "../constants/stockNamePool.js";

export function pickRandomStockIdentity(db, usedSymbols = new Set()) {
  const allStocks = db.prepare("SELECT name, symbol, status FROM stocks").all();
  const recentDelisted = db.prepare("SELECT name FROM stocks WHERE status = 'delisted' ORDER BY delisted_at DESC LIMIT 5").all();
  
  const activeNames = new Set(
    allStocks.filter((stock) => stock.status !== "delisted").map((stock) => stock.name),
  );
  const existingSymbols = new Set(allStocks.map((stock) => stock.symbol));
  const recentDelistedNames = new Set(recentDelisted.map(s => s.name));

  const candidates = STOCK_NAME_POOL.filter(item => {
    return (
      !activeNames.has(item.name) &&
      !existingSymbols.has(item.symbol) &&
      !recentDelistedNames.has(item.name) &&
      !usedSymbols.has(item.symbol)
    );
  });

  let identity;
  if (candidates.length > 0) {
    identity = candidates[Math.floor(Math.random() * candidates.length)];
  } else {
    const fallback = STOCK_NAME_POOL[Math.floor(Math.random() * STOCK_NAME_POOL.length)];
    let symbol;
    let suffix;
    do {
      suffix = Math.random().toString(36).substring(2, 8).toUpperCase();
      symbol = `${fallback.symbol}${suffix}`;
    } while (existingSymbols.has(symbol) || usedSymbols.has(symbol));
    identity = {
      name: `${fallback.name}${suffix}`,
      symbol,
    };
  }

  usedSymbols.add(identity.symbol);
  return identity;
}

export function initStockMarket(db) {
  const missing = Math.max(
    0,
    STOCK_MARKET_POLICY.targetActiveTradableStockCount -
      activeTradableStockCount(db),
  );
  if (missing > 0) {
    const insert = db.prepare(`
      INSERT INTO stocks (symbol, name, status, current_price, previous_price, initial_price, total_shares, market_cap, volatility, sector, listed_at)
      VALUES (?, ?, 'listed', ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `);
    
    db.transaction(() => {
      const usedSymbols = new Set();
      for (let i = 0; i < missing; i++) {
        const st = pickRandomStockIdentity(db, usedSymbols);
        const { currentPrice, totalShares, marketCap } = createStockIdentityAndCap(false);
        const volatility = 0.01 + Math.random() * 0.04;
        insert.run(
          st.symbol,
          st.name,
          currentPrice,
          currentPrice,
          currentPrice,
          totalShares,
          marketCap,
          volatility,
          inferStockSector(st.name, st.symbol),
        );
      }
    })();
  }
}

export function enforceStockMarketLimit(database) {
  return database.transaction(() => {
    const rows = database.prepare(`
      SELECT
        s.id,
        s.symbol,
        s.name,
        s.status,
        s.market_cap,
        s.is_bluechip,
        s.is_etf,
        s.owner_user_id,
        EXISTS(
          SELECT 1 FROM stock_holdings h
          WHERE h.stock_id = s.id AND h.quantity > 0
        ) AS has_holders,
        EXISTS(
          SELECT 1 FROM stock_positions p
          WHERE p.stock_id = s.id AND p.status = 'open'
        ) AS has_positions
      FROM stocks s
      WHERE s.status IN (${statusPlaceholders(ACTIVE_TRADABLE_STOCK_STATUSES)})
        AND COALESCE(s.delist_risk_status, 'normal') != 'final_crash'
      ORDER BY
        (
          s.is_bluechip = 1 OR
          s.is_etf = 1 OR
          s.owner_user_id IS NOT NULL OR
          EXISTS(SELECT 1 FROM stock_holdings h WHERE h.stock_id = s.id AND h.quantity > 0) OR
          EXISTS(SELECT 1 FROM stock_positions p WHERE p.stock_id = s.id AND p.status = 'open')
        ) DESC,
        s.market_cap DESC,
        s.id ASC
    `).all(...ACTIVE_TRADABLE_STOCK_STATUSES);

    let activeCount = rows.length;
    const retiredIds = [];
    const retire = database.prepare(`
      UPDATE stocks
      SET previous_price = current_price,
          current_price = 0,
          market_cap = 0,
          status = 'delisted',
          delisted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `);
    const record = database.prepare(`
      INSERT INTO stock_events (stock_id, event_type, title, message)
      VALUES (?, 'market_capacity_retired', '시장 종목 정리', ?)
    `);

    for (const stock of rows.slice(STOCK_MARKET_POLICY.targetActiveTradableStockCount)) {
      if (activeCount <= STOCK_MARKET_POLICY.targetActiveTradableStockCount) break;
      const protectedStock =
        stock.is_bluechip === 1 ||
        stock.is_etf === 1 ||
        stock.owner_user_id !== null ||
        stock.has_holders === 1 ||
        stock.has_positions === 1;
      if (protectedStock) continue;
      retire.run(stock.id);
      record.run(
        stock.id,
        `${stock.name} 종목이 시장 최대 종목 수 조정으로 거래 목록에서 정리되었어요.`,
      );
      retiredIds.push(stock.id);
      activeCount -= 1;
    }

    return { activeCount, retiredIds };
  })();
}

let lastDelistCandidateEventAt = Date.now();

function getRandomEvent(probs) {
  const r = Math.random();
  let cumulative = 0;
  for (const [event, prob] of Object.entries(probs)) {
    cumulative += prob;
    if (r <= cumulative) return event;
  }
  return "normal"; // fallback
}

function getActiveSectorEvent(db, sector) {
  if (!sector) return null;
  return db
    .prepare(
      `SELECT *
       FROM sector_events
       WHERE sector = ?
         AND effect_until > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(sector);
}

function getSectorAdjustedEventProbabilities(sectorEvent) {
  if (!sectorEvent) return EVENT_PROBABILITIES;
  return SECTOR_EVENT_PROBABILITIES[sectorEvent.sentiment] || EVENT_PROBABILITIES;
}

function getSectorTrendBoost(sectorEvent) {
  if (!sectorEvent) return 0;
  if (sectorEvent.sentiment === "good") return 0.00015;
  if (sectorEvent.sentiment === "bad") return -0.00015;
  return 0;
}

function getSectorVolatilityMultiplier(sectorEvent) {
  return sectorEvent?.sentiment === "volatile" ? 1.8 : 1;
}

function getTodayStockTradeValue(db, stockId) {
  const row = db
    .prepare(
      `SELECT COALESCE(TOTAL(ABS(CAST(amount AS REAL))), 0) AS value
       FROM stock_trades
       WHERE stock_id = ?
         AND date(created_at, '+9 hours') = date('now', '+9 hours')`,
    )
    .get(stockId);
  return Number(row?.value || 0);
}

function clampStockTickPrice(db, stock, nextPrice, override = {}) {
  if (!stock || Number(stock.current_price || 0) <= 0) return Math.max(1, Math.floor(nextPrice));
  if (stock.admin_price_target_active === 1 || stock.blue_chip_ramp_active === 1) {
    return Math.max(1, Math.floor(nextPrice));
  }
  if (stock.is_bluechip === 1) {
    return Math.max(1, Math.floor(nextPrice));
  }

  const stableStock = refreshLegacyStabilityState(db, stock);
  const liquidityStock = {
    ...stableStock,
    ...override,
    today_trade_value: getTodayStockTradeValue(db, stock.id),
  };
  const rawMoveRate =
    (Number(nextPrice || 0) - Number(stock.current_price || 0)) /
    Number(stock.current_price || 1);
  const adjustedRawMoveRate = rawMoveRate * getLiquidityModifier(liquidityStock);
  const moveRate = clampTickMoveRate(liquidityStock, adjustedRawMoveRate);
  const tickPrice = Math.max(1, Math.floor(stock.current_price * (1 + moveRate)));
  const nowMs = Date.now();
  const anchorMs = Date.parse(stableStock.daily_anchor_at || "");
  const resetAnchor = !Number.isFinite(anchorMs) || nowMs - anchorMs >= DAY_SECONDS * 1000 || Number(stableStock.daily_anchor_price) <= 0;
  const anchor = resetAnchor ? Number(stock.current_price) : Number(stableStock.daily_anchor_price);
  if (resetAnchor) db.prepare("UPDATE stocks SET daily_anchor_price=?,daily_anchor_at=? WHERE id=?").run(anchor, new Date(nowMs).toISOString(), stock.id);
  const bands = {
    BLUE_CHIP: [-0.06, 0.08], GIANT: [-0.12, 0.15], MEGA: [-0.15, 0.20], LARGE: [-0.20, 0.28],
    MID: [-0.28, 0.38], SMALL: [-0.35, 0.50], DELIST_RISK: [-0.45, 0.65],
  };
  let [maxDown, maxUp] = bands[stableStock.stability_tier] || bands.SMALL;
  if (stableStock.delist_risk_status === "distress_review") {
    if (stableStock.stability_tier === "BLUE_CHIP") [maxDown, maxUp] = [-0.14, 0.14];
    else if (stableStock.stability_tier === "GIANT") [maxDown, maxUp] = [-0.20, 0.18];
    else { maxDown = Math.max(-0.45, maxDown * 1.35); maxUp = Math.min(0.60, maxUp * 1.2); }
  }
  const protectedPrice = Math.max(1, Math.min(Math.floor(anchor * (1 + maxUp)), Math.max(Math.ceil(anchor * (1 + maxDown)), tickPrice)));
  if (protectedPrice !== tickPrice) db.prepare(`INSERT INTO stock_price_guard_events(stock_id,event_type,reference_price,observed_price,protected_price,reason)
    VALUES(?,'daily_band',?,?,?,'stability_tier_daily_band')`).run(stock.id, anchor, tickPrice, protectedPrice);
  return protectedPrice;
}

function maybeCreateSectorEvent(db, nowMs = Date.now()) {
  if (nowMs - lastSectorEventAt < SECTOR_EVENT_INTERVAL_MS) return null;
  lastSectorEventAt = nowMs;
  if (Math.random() > 0.45) return null;

  const sector = STOCK_SECTORS[Math.floor(Math.random() * STOCK_SECTORS.length)];
  const sentimentRoll = Math.random();
  const sentiment =
    sentimentRoll < 0.4 ? "good" : sentimentRoll < 0.8 ? "bad" : "volatile";
  const templates = SECTOR_EVENT_TEMPLATES[sentiment];
  const [title, contentTemplate] = templates[Math.floor(Math.random() * templates.length)];
  const content = contentTemplate.replace("{sector}", sector);
  const effectUntil = new Date(nowMs + randomBetweenInt(30, 180) * 60_000).toISOString();

  const result = db
    .prepare(
      `INSERT INTO sector_events (sector, sentiment, title, content, effect_until)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(sector, sentiment, title, content, effectUntil);

  createServerNotification(db, {
    type: "sector_event",
    title,
    message: content,
    gameType: "stock",
    gameName: "주식",
    metadata: {
      sector,
      sentiment,
      sectorEventId: result.lastInsertRowid,
      effectUntil,
    },
  });

  return { id: result.lastInsertRowid, sector, sentiment, title, content, effectUntil };
}

function ensureBlueChipDailyBase(db, stock, nowMs = Date.now()) {
  const startedMs = Date.parse(stock.blue_chip_day_started_at || "");
  const openPrice = Number(stock.blue_chip_day_open_price);
  const highLimitPrice = Number(stock.blue_chip_daily_high_limit_price);
  const lowLimitPrice = Number(stock.blue_chip_daily_low_limit_price);
  const needsReset =
    !Number.isFinite(startedMs) ||
    nowMs - startedMs >= DAY_SECONDS * 1000 ||
    !Number.isFinite(openPrice) ||
    openPrice <= 0 ||
    !Number.isFinite(highLimitPrice) ||
    !Number.isFinite(lowLimitPrice) ||
    highLimitPrice <= 0 ||
    lowLimitPrice <= 0;

  if (!needsReset) {
    return {
      ...stock,
      blue_chip_day_open_price: Math.floor(openPrice),
      blue_chip_daily_high_limit_price: Math.floor(highLimitPrice),
      blue_chip_daily_low_limit_price: Math.floor(lowLimitPrice),
    };
  }

  const startedAt = new Date(nowMs).toISOString();
  const limits = calculateBlueChipDailyLimits(stock.current_price);
  db.prepare(
    `UPDATE stocks
     SET blue_chip_day_open_price = ?,
         blue_chip_day_started_at = ?,
         blue_chip_daily_high_limit_price = ?,
         blue_chip_daily_low_limit_price = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(
    limits.openPrice,
    startedAt,
    limits.highLimitPrice,
    limits.lowLimitPrice,
    stock.id,
  );

  return {
    ...stock,
    blue_chip_day_open_price: limits.openPrice,
    blue_chip_day_started_at: startedAt,
    blue_chip_daily_high_limit_price: limits.highLimitPrice,
    blue_chip_daily_low_limit_price: limits.lowLimitPrice,
  };
}

function applyBlueChipPriceMove(db, stock) {
  const baseStock = ensureBlueChipDailyBase(db, stock);
  const changeRate = getBlueChipChangeRate();
  const currentPrice = Math.max(1, Number(baseStock.current_price) || 1);
  let nextPrice = Math.floor(currentPrice * (1 + changeRate));

  nextPrice = Math.min(
    nextPrice,
    Number(baseStock.blue_chip_daily_high_limit_price),
  );
  nextPrice = Math.max(
    nextPrice,
    Number(baseStock.blue_chip_daily_low_limit_price),
  );
  nextPrice = Math.max(1, nextPrice);

  return { stock: baseStock, newPrice: nextPrice, changeRate };
}

function hasBlueChipDailyNews(db, stockId, eventType, dayStartedAt) {
  return Boolean(
    db
      .prepare(
        `SELECT 1
         FROM stock_events
         WHERE stock_id = ?
           AND event_type = ?
           AND created_at >= ?
         LIMIT 1`,
      )
      .get(stockId, eventType, dayStartedAt || new Date(0).toISOString()),
  );
}

function recordBlueChipDailyNews(db, stock, eventType, title, message) {
  if (
    hasBlueChipDailyNews(
      db,
      stock.id,
      eventType,
      stock.blue_chip_day_started_at,
    )
  ) {
    return;
  }
  db.prepare(
    `INSERT INTO stock_events (stock_id, event_type, title, message)
     VALUES (?, ?, ?, ?)`,
  ).run(stock.id, eventType, title, message);
}

function maybeRecordBlueChipDailyNews(db, stock) {
  if (stock.is_bluechip !== 1) return;
  const current = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stock.id);
  if (!current || current.status === "delisted") return;

  const openPrice = Number(current.blue_chip_day_open_price);
  const highLimit = Number(current.blue_chip_daily_high_limit_price);
  const lowLimit = Number(current.blue_chip_daily_low_limit_price);
  if (!Number.isFinite(openPrice) || openPrice <= 0) return;

  const dailyChangeRate = (current.current_price - openPrice) / openPrice;
  const percent = (dailyChangeRate * 100).toFixed(2);
  if (dailyChangeRate >= 0.05) {
    recordBlueChipDailyNews(
      db,
      current,
      "blue_chip_gain_5",
      "우량주 상승",
      `${current.name}이 오늘 기준가 대비 +5%를 돌파했어요. 현재 등락률 +${percent}%`,
    );
  }
  if (dailyChangeRate >= 0.10) {
    recordBlueChipDailyNews(
      db,
      current,
      "blue_chip_gain_10",
      "우량주 강세",
      `${current.name}이 오늘 기준가 대비 +10%를 돌파했어요. 현재 등락률 +${percent}%`,
    );
  }
  if (Number.isFinite(highLimit) && current.current_price >= highLimit * 0.99) {
    recordBlueChipDailyNews(
      db,
      current,
      "blue_chip_near_high_limit",
      "우량주 상한 근접",
      `${current.name}이 우량주 24시간 상한가에 가까워졌어요.`,
    );
  }
  if (Number.isFinite(lowLimit) && current.current_price <= lowLimit * 1.01) {
    recordBlueChipDailyNews(
      db,
      current,
      "blue_chip_near_low_limit",
      "우량주 하한 근접",
      `${current.name}이 우량주 24시간 하한가에 가까워졌어요.`,
    );
  }
}

export function applyBlueChipRampTick(db, stock) {
  if (!stock.blue_chip_ramp_active) return false;

  const currentPrice = Number(stock.current_price);
  const targetPrice = Number(stock.blue_chip_target_price);
  const percentPerTick = Number(stock.blue_chip_ramp_percent_per_tick);

  if (!targetPrice || !percentPerTick || percentPerTick <= 0) {
    db.prepare(`
      UPDATE stocks
      SET blue_chip_ramp_active = 0,
          blue_chip_ramp_ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(stock.id);
    stock.blue_chip_ramp_active = 0;
    return false;
  }

  if (currentPrice >= targetPrice) {
    db.prepare(`
      UPDATE stocks
      SET blue_chip_ramp_active = 0,
          blue_chip_ramp_ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(stock.id);
    stock.blue_chip_ramp_active = 0;
    return false;
  }

  const nextPriceByPercent = Math.floor(currentPrice * (1 + percentPerTick / 100));
  const nextPrice = Math.min(nextPriceByPercent, targetPrice);
  const finalPrice = Math.max(1, nextPrice);
  const reached = finalPrice >= targetPrice;
  const nowStr = new Date().toISOString();
  const newCap = finalPrice * stock.total_shares;

  if (reached) {
    const highLimit = Math.floor(targetPrice * 1.15);
    const lowLimit = Math.max(1, Math.floor(targetPrice * 0.87));

    db.prepare(`
      UPDATE stocks
      SET previous_price = ?,
          current_price = ?,
          market_cap = ?,
          blue_chip_ramp_active = 0,
          blue_chip_ramp_ended_at = ?,
          blue_chip_day_open_price = ?,
          blue_chip_day_started_at = ?,
          blue_chip_daily_high_limit_price = ?,
          blue_chip_daily_low_limit_price = ?,
          updated_at = ?
      WHERE id = ?
    `).run(currentPrice, targetPrice, newCap, nowStr, targetPrice, nowStr, highLimit, lowLimit, nowStr, stock.id);

    db.prepare(`
      INSERT INTO stock_price_history (stock_id, price, market_cap, event_type)
      VALUES (?, ?, ?, 'blue_chip_ramp_reached')
    `).run(stock.id, targetPrice, newCap);

    const changeAmount = targetPrice - currentPrice;
    const changeRate = currentPrice > 0 ? changeAmount / currentPrice : 0;
    
    // Blue chip target price reached notification removed per user request

    // 메모리 객체 동기화
    stock.previous_price = currentPrice;
    stock.current_price = targetPrice;
    stock.market_cap = newCap;
    stock.blue_chip_ramp_active = 0;
    stock.blue_chip_ramp_ended_at = nowStr;
    stock.blue_chip_day_open_price = targetPrice;
    stock.blue_chip_day_started_at = nowStr;
    stock.blue_chip_daily_high_limit_price = highLimit;
    stock.blue_chip_daily_low_limit_price = lowLimit;

  } else {
    db.prepare(`
      UPDATE stocks
      SET previous_price = ?,
          current_price = ?,
          market_cap = ?,
          updated_at = ?
      WHERE id = ?
    `).run(currentPrice, finalPrice, newCap, nowStr, stock.id);

    db.prepare(`
      INSERT INTO stock_price_history (stock_id, price, market_cap, event_type)
      VALUES (?, ?, ?, 'blue_chip_ramp_started')
    `).run(stock.id, finalPrice, newCap);

    // 메모리 객체 동기화
    stock.previous_price = currentPrice;
    stock.current_price = finalPrice;
    stock.market_cap = newCap;
  }

  console.log("[BLUE_CHIP_RAMP_TICK]", {
    stockId: stock.id,
    name: stock.name,
    oldPrice: currentPrice,
    newPrice: stock.current_price,
    targetPrice,
    percentPerTick,
    active: stock.blue_chip_ramp_active === 1 || stock.blue_chip_ramp_active === true
  });

  return true;
}

export function applyAdminTargetPriceTick(db, stock) {
  if (!stock.admin_price_target_active) return false;

  const currentPrice = Number(stock.current_price);
  const targetPrice = Number(stock.admin_price_target);
  const percentPerTick = Number(stock.admin_price_target_percent_per_tick);

  if (!targetPrice || !percentPerTick || percentPerTick <= 0) {
    db.prepare(`
      UPDATE stocks
      SET admin_price_target_active = 0,
          admin_price_target_ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(stock.id);
    stock.admin_price_target_active = 0;
    return false;
  }

  if (currentPrice === targetPrice) {
    db.prepare(`
      UPDATE stocks
      SET admin_price_target_active = 0,
          admin_price_target_ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(stock.id);
    stock.admin_price_target_active = 0;
    return false;
  }

  let nextPrice;
  if (targetPrice > currentPrice) {
    nextPrice = Math.floor(currentPrice * (1 + percentPerTick / 100));
    nextPrice = Math.min(nextPrice, targetPrice);
  } else {
    nextPrice = Math.floor(currentPrice * (1 - percentPerTick / 100));
    nextPrice = Math.max(nextPrice, targetPrice);
  }
  const finalPrice = Math.max(1, nextPrice);
  const reached = finalPrice === targetPrice;
  const nowStr = new Date().toISOString();
  const newCap = finalPrice * stock.total_shares;

  if (reached) {
    db.prepare(`
      UPDATE stocks
      SET previous_price = ?,
          current_price = ?,
          market_cap = ?,
          admin_price_target_active = 0,
          admin_price_target_ended_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(currentPrice, targetPrice, newCap, nowStr, nowStr, stock.id);

    db.prepare(`
      INSERT INTO stock_price_history (stock_id, price, market_cap, event_type)
      VALUES (?, ?, ?, 'admin_stock_target_price_reached')
    `).run(stock.id, targetPrice, newCap);

    const changeAmount = targetPrice - currentPrice;
    const changeRate = currentPrice > 0 ? changeAmount / currentPrice : 0;

    // Target price reached notification removed per user request

    // 메모리 객체 동기화
    stock.previous_price = currentPrice;
    stock.current_price = targetPrice;
    stock.market_cap = newCap;
    stock.admin_price_target_active = 0;
    stock.admin_price_target_ended_at = nowStr;

  } else {
    db.prepare(`
      UPDATE stocks
      SET previous_price = ?,
          current_price = ?,
          market_cap = ?,
          updated_at = ?
      WHERE id = ?
    `).run(currentPrice, finalPrice, newCap, nowStr, stock.id);

    db.prepare(`
      INSERT INTO stock_price_history (stock_id, price, market_cap, event_type)
      VALUES (?, ?, ?, 'admin_stock_target_price_started')
    `).run(stock.id, finalPrice, newCap);

    // 메모리 객체 동기화
    stock.previous_price = currentPrice;
    stock.current_price = finalPrice;
    stock.market_cap = newCap;
  }

  console.log("[ADMIN_TARGET_PRICE_TICK]", {
    stockId: stock.id,
    name: stock.name,
    oldPrice: currentPrice,
    newPrice: stock.current_price,
    targetPrice,
    percentPerTick,
    active: stock.admin_price_target_active === 1 || stock.admin_price_target_active === true
  });

  return true;
}

function triggerStockPriceAlerts(database) {
  const alerts = database
    .prepare(
      `SELECT
         a.id,
         a.user_id,
         a.stock_id,
         a.target_price,
         a.direction,
         s.name,
         s.symbol,
         s.current_price,
         s.status
       FROM stock_price_alerts a
       JOIN stocks s ON s.id = a.stock_id
       WHERE a.triggered_at IS NULL
         AND s.status != 'delisted'`,
    )
    .all();

  const markTriggered = database.prepare(
    "UPDATE stock_price_alerts SET triggered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND triggered_at IS NULL",
  );

  for (const alert of alerts) {
    const currentPrice = Number(alert.current_price || 0);
    const targetPrice = Number(alert.target_price || 0);
    const reached =
      alert.direction === "above"
        ? currentPrice >= targetPrice
        : currentPrice <= targetPrice;

    if (!reached) continue;

    const result = markTriggered.run(alert.id);
    if (result.changes === 0) continue;

    createServerNotification(database, {
      userId: alert.user_id,
      type: "stock_price_alert",
      title: "가격 알림",
      message: `${alert.name}이(가) 목표가 ${formatSignedWon(targetPrice).replace(/^\+/, "")}에 도달했어요.`,
      gameType: "stock",
      gameName: "주식",
      metadata: {
        stockId: alert.stock_id,
        symbol: alert.symbol,
        targetPrice,
        currentPrice,
        direction: alert.direction,
      },
    });
  }
}

function resolveDueHostileTakeoversLegacy(db, nowMs = Date.now()) {
  const now = new Date(nowMs).toISOString();
  const events = db.prepare(`
    SELECT * FROM hostile_takeover_events
    WHERE status IN ('declared', 'defended') AND ends_at <= ?
    ORDER BY id ASC
  `).all(now);
  for (const event of events) {
    const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(event.stock_id);
    const attacker = db.prepare("SELECT * FROM users WHERE id = ?").get(event.attacker_user_id);
    const defender = db.prepare("SELECT * FROM users WHERE id = ?").get(event.defender_user_id);
    if (!stock || !attacker || !defender || stock.owner_user_id !== defender.id || stock.status !== "acquired") {
      if (attacker) {
        const refunded = Number(event.attack_cash || 0);
        const balanceAfter = Number(attacker.balance) + refunded;
        db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, attacker.id);
        db.prepare(`
          INSERT OR IGNORE INTO asset_events
            (user_id, event_type, amount, balance_before, balance_after, source_type, source_id)
          VALUES (?, 'hostile_takeover_refund', ?, ?, ?, 'hostile_takeover', ?)
        `).run(attacker.id, refunded, attacker.balance, balanceAfter, `refund:${event.id}`);
      }
      db.prepare("UPDATE hostile_takeover_events SET status = 'cancelled', resolved_at = ? WHERE id = ?")
        .run(now, event.id);
      continue;
    }

    const attackStrength = Number(event.attack_cash || 0) + Math.floor(Number(event.attacker_asset_snapshot || 0) * 0.05);
    const defenseStrength = Number(event.defense_cash || 0) + Math.floor(Number(event.defender_asset_snapshot || 0) * 0.05);
    const attackWins = attackStrength > defenseStrength;
    const defenderBalanceAfter = Number(defender.balance) + Number(event.attack_cash || 0);
    db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(defenderBalanceAfter, defender.id);
    db.prepare(`
      INSERT OR IGNORE INTO asset_events
        (user_id, event_type, amount, balance_before, balance_after, source_type, source_id, detail_json)
      VALUES (?, 'hostile_takeover_receive', ?, ?, ?, 'hostile_takeover', ?, ?)
    `).run(
      defender.id, event.attack_cash, defender.balance, defenderBalanceAfter, `receive:${event.id}`,
      JSON.stringify({ hostileTakeoverEventId: event.id, attackStrength, defenseStrength }),
    );

    if (attackWins) {
      const attackerTrackingAsset = calculateOwnerEtfTrackingAsset(db, attacker.id, stock.id);
      db.prepare(`
        UPDATE stocks
        SET owner_user_id = ?, owner_nickname_snapshot = ?, etf_base_price = current_price,
            etf_base_owner_asset = ?, etf_last_tracked_owner_asset = ?, etf_acquisition_cost = ?,
            etf_delist_reference_price = current_price,
            etf_delist_reference_set_at = ?,
            etf_delist_trigger_price = MAX(1, CAST(current_price * ? AS INTEGER)),
            etf_delist_triggered_at = NULL, etf_delist_reason = NULL,
            delist_risk_status = 'normal', is_market_cap_warning = 0,
            caution_tick_count = 0, recovery_tick_count = 0, delist_review_tick_count = 0
        WHERE id = ?
      `).run(
        attacker.id, attacker.nickname, attackerTrackingAsset, attackerTrackingAsset,
        event.attack_cash, now, STOCK_MARKET_POLICY.ownerEtfDelistPriceRatio, stock.id,
      );
      createServerNotification(db, {
        type: "hostile_takeover_success",
        title: "적대적 M&A 성공",
        message: `${attacker.nickname}님이 ${defender.nickname}님의 ${stock.name}을(를) 공개 입찰 끝에 인수했어요.`,
        gameType: "stock",
        gameName: "주식",
        metadata: { hostileTakeoverEventId: event.id, stockId: stock.id, attackStrength, defenseStrength },
      });
    } else {
      createServerNotification(db, {
        type: "hostile_takeover_defended",
        title: "적대적 M&A 방어 성공",
        message: `${defender.nickname}님이 ${stock.name}의 인수 방어에 성공했어요.`,
        gameType: "stock",
        gameName: "주식",
        metadata: { hostileTakeoverEventId: event.id, stockId: stock.id, attackStrength, defenseStrength },
      });
    }
    db.prepare("UPDATE hostile_takeover_events SET status = ?, resolved_at = ? WHERE id = ?")
      .run(attackWins ? "resolved_attack" : "resolved_defense", now, event.id);
  }
  return events.length;
}

export function calculateHostileTakeoverStrength({
  escrowCash = 0,
  holderQuantity = 0,
  sharePrice = 0,
  supportCash = 0,
  delegatedShareQuantity = 0,
  treasuryShares = 0,
} = {}) {
  const price = Math.max(0, Number(sharePrice || 0));
  return Math.max(0, Math.floor(
    Math.max(0, Number(escrowCash || 0)) +
    Math.max(0, Number(holderQuantity || 0)) * price +
    Math.max(0, Number(supportCash || 0)) +
    Math.max(0, Number(delegatedShareQuantity || 0)) * price +
    Math.max(0, Number(treasuryShares || 0)) * price
  ));
}

export function resolveDueHostileTakeovers(db, nowMs = Date.now()) {
  const now = new Date(nowMs).toISOString();
  const events = db.prepare(`
    SELECT * FROM hostile_takeover_events
    WHERE status IN ('declared', 'defended') AND ends_at <= ?
    ORDER BY id ASC
  `).all(now);

  const creditEscrow = (user, amount, eventType, sourceId, detail) => {
    const safeAmount = Math.max(0, Math.floor(Number(amount || 0)));
    if (!user || safeAmount <= 0) return;
    const current = db.prepare("SELECT balance FROM users WHERE id = ?").get(user.id);
    if (!current) return;
    const balanceBefore = Math.floor(Number(current.balance || 0));
    const balanceAfter = balanceBefore + safeAmount;
    db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, user.id);
    db.prepare(`
      INSERT OR IGNORE INTO asset_events
        (user_id, event_type, amount, balance_before, balance_after,
         source_type, source_id, detail_json)
      VALUES (?, ?, ?, ?, ?, 'hostile_takeover', ?, ?)
    `).run(user.id, eventType, safeAmount, balanceBefore, balanceAfter, sourceId, JSON.stringify(detail));
  };

  for (const event of events) {
    db.transaction(() => {
      const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(event.stock_id);
      const attacker = db.prepare("SELECT * FROM users WHERE id = ?").get(event.attacker_user_id);
      const defender = db.prepare("SELECT * FROM users WHERE id = ?").get(event.defender_user_id);
      const anotherOwnedEtf = attacker && db.prepare(`
        SELECT id FROM stocks
        WHERE owner_user_id = ? AND is_etf = 1 AND status = 'acquired' AND id != ?
      `).get(attacker.id, event.stock_id);
      const valid = stock && attacker && defender && !anotherOwnedEtf &&
        Number(stock.owner_user_id) === Number(event.defender_user_id) &&
        stock.status === "acquired";

      if (!valid) {
        creditEscrow(attacker, event.attack_cash, "hostile_takeover_refund", `refund:${event.id}`, {
          hostileTakeoverEventId: event.id,
          reason: anotherOwnedEtf ? "attacker_already_owns_active_etf" : "target_changed",
        });
        creditEscrow(defender, event.defense_cash, "hostile_takeover_defense_refund", `defense-refund:${event.id}`, {
          hostileTakeoverEventId: event.id,
          reason: "takeover_cancelled",
        });
        db.prepare("UPDATE hostile_takeover_events SET status = 'cancelled', resolved_at = ? WHERE id = ?")
          .run(now, event.id);
        return;
      }

      const snapshotPrice = Math.max(1, Math.floor(Number(event.target_price_snapshot || stock.current_price || 1)));
      const holdingQuantity = (userId) => Math.max(0, Number(db.prepare(`
        SELECT COALESCE(quantity, 0) AS quantity
        FROM stock_holdings WHERE user_id = ? AND stock_id = ?
      `).get(userId, event.stock_id)?.quantity || 0));
      const support = (side, excludedUserId) => db.prepare(`
        SELECT COALESCE(SUM(cash_amount), 0) AS cash_amount,
               COALESCE(SUM(delegated_share_quantity), 0) AS delegated_shares
        FROM hostile_takeover_supports
        WHERE hostile_takeover_event_id = ? AND side = ? AND user_id != ?
      `).get(event.id, side, excludedUserId);
      const attackSupport = support("attack", attacker.id);
      const defenseSupport = support("defense", defender.id);
      const attackStrength = calculateHostileTakeoverStrength({
        escrowCash: event.attack_cash,
        holderQuantity: holdingQuantity(attacker.id),
        sharePrice: snapshotPrice,
        supportCash: attackSupport.cash_amount,
        delegatedShareQuantity: attackSupport.delegated_shares,
      });
      const defenseStrength = calculateHostileTakeoverStrength({
        escrowCash: event.defense_cash,
        holderQuantity: holdingQuantity(defender.id),
        sharePrice: snapshotPrice,
        supportCash: defenseSupport.cash_amount,
        delegatedShareQuantity: defenseSupport.delegated_shares,
        treasuryShares: stock.treasury_shares,
      });
      const attackWins = attackStrength > defenseStrength;

      creditEscrow(defender, event.defense_cash, "hostile_takeover_defense_refund", `defense-refund:${event.id}`, {
        hostileTakeoverEventId: event.id,
        attackStrength,
        defenseStrength,
      });

      if (attackWins) {
        creditEscrow(defender, event.attack_cash, "hostile_takeover_receive", `receive:${event.id}`, {
          hostileTakeoverEventId: event.id,
          targetMarketCapSnapshot: event.target_market_cap_snapshot,
          attackStrength,
          defenseStrength,
        });
        const attackerTrackingAsset = calculateOwnerEtfTrackingAsset(db, attacker.id, stock.id);
        db.prepare(`
          UPDATE stocks
          SET owner_user_id = ?, owner_nickname_snapshot = ?,
              etf_base_price = current_price,
              etf_base_owner_asset = ?, etf_last_tracked_owner_asset = ?,
              etf_acquisition_cost = ?,
              etf_delist_reference_price = current_price,
              etf_delist_reference_set_at = ?,
              etf_delist_trigger_price = MAX(1, CAST(current_price * ? AS INTEGER)),
              etf_delist_triggered_at = NULL, etf_delist_reason = NULL,
              delist_risk_status = 'normal', is_market_cap_warning = 0,
              caution_tick_count = 0, recovery_tick_count = 0,
              delist_review_tick_count = 0
          WHERE id = ?
        `).run(
          attacker.id,
          attacker.nickname,
          attackerTrackingAsset,
          attackerTrackingAsset,
          Number(event.acquisition_cost_snapshot || event.attack_cash),
          now,
          STOCK_MARKET_POLICY.ownerEtfDelistPriceRatio,
          stock.id,
        );
      } else {
        creditEscrow(attacker, event.attack_cash, "hostile_takeover_refund", `refund:${event.id}`, {
          hostileTakeoverEventId: event.id,
          attackStrength,
          defenseStrength,
          reason: "defended",
        });
      }

      db.prepare(`
        UPDATE hostile_takeover_events
        SET status = ?, resolved_at = ?, attack_strength = ?, defense_strength = ?
        WHERE id = ?
      `).run(attackWins ? "resolved_attack" : "resolved_defense", now, attackStrength, defenseStrength, event.id);
      createServerNotification(db, {
        type: attackWins ? "hostile_takeover_success" : "hostile_takeover_defended",
        title: attackWins ? "적대적 M&A 성공" : "적대적 M&A 방어 성공",
        message: attackWins
          ? `${attacker.nickname}님이 ${stock.name} 인수에 성공했어요.`
          : `${defender.nickname}님이 ${stock.name} 인수를 방어했어요.`,
        gameType: "stock",
        gameName: "주식",
        metadata: {
          hostileTakeoverEventId: event.id,
          stockId: stock.id,
          attackStrength,
          defenseStrength,
          policy: "invested_target_resources_only_v1",
        },
      });
    })();
  }
  return events.length;
}

export function tickStockMarket(db) {
  try {
    nextTickAt = Date.now() + STOCK_TICK_INTERVAL_MS;
    db.transaction(() => {
      const now = Date.now();
      runDailyUnluckyScheduler(db, now);
      resolveDueHostileTakeovers(db, now);
      if (!isStockMarketOpen(db)) return;
      const marketRegime = ensureMarketRegime(db, now);
      releaseExpiredTradingHalts(db, now);
      processCorporateEvents(db, now);
      maybeCreateSectorEvent(db, now);
      const stocks = db
        .prepare("SELECT * FROM stocks WHERE status != 'delisted' ORDER BY id ASC")
        .all();
      const usedSymbols = new Set();
      for (const stock of stocks) {
        if (stock.is_trading_suspended) continue;
        if (isOwnerAssetEtf(stock)) {
          continue;
        }
        if (
          ["delist_review", "recovery", "final_crash"].includes(
            stock.delist_risk_status,
          )
        ) {
          processDelistingLifecycleTick(db, stock, usedSymbols);
          continue;
        }
        if (stock.status === "ipo_subscription") {
          processNormalTick(db, stock, usedSymbols);
          continue;
        }
        if (stock.is_bluechip === 1 && stock.blue_chip_ramp_active === 1) {
          applyBlueChipRampTick(db, stock);
          continue;
        }
        if (stock.admin_price_target_active === 1) {
          applyAdminTargetPriceTick(db, stock);
          continue;
        }
        if (stock.is_etf) {
          processEtfTick(db, stock);
        } else {
          processNormalTick(db, stock, usedSymbols, { marketRegime });
        }
      }

      // Owner ETF prices are calculated only after every non-ETF price is
      // settled. The cycle reads the previous completed owner snapshots, so
      // ETF cross-holdings cannot recursively inflate one another.
      runOwnerEtfValuationCycle(db, { nowMs: now });

      if (now - lastDelistCandidateEventAt >= 300_000) {
        lastDelistCandidateEventAt = now;
        for (const candidate of stocks) evaluateCompanyDistressRisk(db, candidate, now);
      }

      liquidatePositionsIfNeeded(db);
      triggerStockPriceAlerts(db);
    })();
  } catch (error) {
    console.error("[CRITICAL] Error in tickStockMarket:", error);
  }
}

function processNormalTick(
  db,
  stock,
  usedSymbols,
  { manageDelistRisk = true, marketRegime = null } = {},
) {
  let priceBasisStock = stock;
  let newPrice = stock.current_price;
  let eventType = null;
  let eventMsg = null;
  let newStatus = stock.status;
  const now = Date.now();

  // Determine if active event expires
  let currentEventType = stock.event_type;
  if (stock.event_until && stock.event_until < now) {
    currentEventType = null;
    db.prepare("UPDATE stocks SET event_type = NULL, event_until = NULL WHERE id = ?").run(stock.id);
  }

  if (stock.status === "ipo_subscription") {
    const endsAt = new Date(stock.ipo_subscription_ends_at).getTime();
    if (now >= endsAt) {
      openIpoStock(db, stock, usedSymbols, now);
    }
    return; // In subscription period, price is locked, or opening was handled above.
  } else if (stock.status === "newly_listed") {
    const newlyListedUntil = new Date(stock.newly_listed_until).getTime();

    if (now >= newlyListedUntil) {
      newStatus = "listed";
      db.prepare("UPDATE stocks SET newly_listed_until = NULL WHERE id = ?").run(stock.id);
      
      const change = (Math.random() - 0.5) * 0.10; // -5% ~ +5%
      newPrice = Math.floor(stock.current_price * (1 + change));
    } else {
      if (stock.ipo_opening_event_done !== 1) {
        const opening = buildIpoOpeningMove(stock);
        newPrice = clampIpoFirstFiveMinutePrice(
          stock,
          Math.floor(stock.offering_price * (1 + opening.changeRate)),
        );
        eventType = opening.eventType;
        eventMsg = opening.message;
        db.prepare(`
          UPDATE stocks
          SET ipo_opening_event_done = 1,
              ipo_opening_event_type = ?,
              ipo_opening_change_rate = ?
          WHERE id = ?
        `).run(opening.openingEventType, opening.changeRate, stock.id);
      } else {
        const change = buildNewListingTickMove(stock);
        newPrice = clampIpoFirstFiveMinutePrice(stock, stock.current_price * (1 + change));
        const thresholdEvent = getIpoThresholdEvent(stock, newPrice);
        if (thresholdEvent) {
          eventType = thresholdEvent.eventType;
          eventMsg = thresholdEvent.message;
        }
      }
    }
  } else {
    // Normal listed stock
    let isSurgeOrCrash = false;
    if (stock.is_bluechip === 1) {
      const blueChipMove = applyBlueChipPriceMove(db, stock);
      priceBasisStock = blueChipMove.stock;
      newPrice = blueChipMove.newPrice;
    } else {
      const sectorEvent = getActiveSectorEvent(db, stock.sector);
      const isDistressReview = stock.delist_risk_status === "distress_review";
      const event = getRandomEvent(getSectorAdjustedEventProbabilities(sectorEvent));
      if (event === "surge") {
        const upper = sectorEvent?.sentiment === "good" || sectorEvent?.sentiment === "volatile" ? 0.15 : 0.10;
        newPrice = Math.floor(newPrice * (1 + 0.05 + Math.random() * upper)); // +5% ~ +20%
        eventType = "surge";
        eventMsg = sectorEvent
          ? `${stock.name} 주가가 ${stock.sector} 섹터 이벤트 영향으로 반등했어요!`
          : `${stock.name} 주가가 반등했어요!`;
        isSurgeOrCrash = true;
      } else if (event === "crash") {
        const upper = sectorEvent?.sentiment === "bad" || sectorEvent?.sentiment === "volatile" ? 0.16 : 0.13;
        newPrice = Math.floor(newPrice * (1 - 0.07 - Math.random() * upper)); // -7% ~ -23%
        eventType = "crash";
        eventMsg = sectorEvent
          ? `${stock.name} 주가가 ${stock.sector} 섹터 이벤트 영향으로 급락했어요!`
          : `${stock.name} 주가가 급락했어요!`;
        isSurgeOrCrash = true;
      }

      if (!isSurgeOrCrash) {
        const trendChange = calculateTrendMoveRate(db, stock, {
          marketRegime,
          sectorModifier: getSectorTrendBoost(sectorEvent),
          nowMs: now,
        });
        const fallbackVolatility = Math.min(
          stock.volatility * getSectorVolatilityMultiplier(sectorEvent) * (isDistressReview ? 1.8 : 1),
          STOCK_MARKET_POLICY.regularMaxTickVolatility,
        );
        const change = trendChange === null
          ? (Math.random() * 2 - 1) * fallbackVolatility
          : trendChange * (isDistressReview ? 1.8 : 1);
        newPrice = Math.floor(newPrice * (1 + change));
      }
    }
  }

  // Remove arbitrary minCap logic for bluechips so it doesn't jump to 50T
  newPrice = clampStockTickPrice(db, stock, newPrice, { status: newStatus });
  newPrice = Math.max(1, newPrice);

  if (newPrice !== stock.current_price || newStatus !== stock.status) {
    const basis = eventType?.startsWith("ipo_") ? "offering_price"
      : eventType === "final_crash" ? "delist_final_crash" 
      : "previous_tick";
    updateStockPrice(
      db,
      priceBasisStock,
      newPrice,
      newStatus,
      eventType,
      eventMsg,
      basis,
      { manageDelistRisk },
    );
    if (priceBasisStock.is_bluechip === 1) {
      maybeRecordBlueChipDailyNews(db, priceBasisStock);
    }
  } else if (manageDelistRisk) {
    updateDelistRiskAfterPrice(db, priceBasisStock);
  }
}

export function runOwnerEtfValuationCycle(db, { nowMs = Date.now() } = {}) {
  const etfs = db.prepare(`
    SELECT * FROM stocks
    WHERE is_etf = 1 AND etf_tracking_type = 'owner_asset' AND status = 'acquired'
    ORDER BY id ASC
  `).all();
  if (etfs.length === 0) return { valuationCycleId: null, updated: 0 };

  const ownerIds = [...new Set(etfs.map((stock) => Number(stock.owner_user_id)).filter(Number.isSafeInteger))];
  const currentTrackingAssets = new Map(
    ownerIds.map((ownerId) => [ownerId, calculateOwnerEtfTrackingAsset(db, ownerId)]),
  );
  const previousSnapshot = db.prepare(`
    SELECT tracking_asset FROM owner_etf_tracking_snapshots
    WHERE user_id = ? ORDER BY id DESC LIMIT 1
  `);
  const valuationCycleId = `owner-etf-${nowMs}`;
  const now = new Date(nowMs).toISOString();
  let updated = 0;

  for (const stock of etfs) {
    const ownerId = Number(stock.owner_user_id);
    const currentTrackingAsset = Math.max(1, Math.floor(currentTrackingAssets.get(ownerId) || 1));
    const previousTrackingAsset = Math.max(
      1,
      Math.floor(Number(previousSnapshot.get(ownerId)?.tracking_asset || stock.etf_base_owner_asset || currentTrackingAsset)),
    );
    const basePrice = Math.max(1, Math.floor(Number(stock.etf_base_price || stock.current_price || 1)));
    const baseTrackingAsset = Math.max(1, Math.floor(Number(stock.etf_base_owner_asset || currentTrackingAsset)));
    const targetPrice = Math.floor(basePrice * (previousTrackingAsset / baseTrackingAsset));
    if (!Number.isFinite(targetPrice) || targetPrice < 1 || targetPrice > Number.MAX_SAFE_INTEGER) {
      db.prepare(`
        INSERT INTO stock_events (stock_id, event_type, title, message, metadata_json)
        VALUES (?, 'owner_etf_invalid_snapshot', 'ETF 추종 보정', '유효하지 않은 ETF 추종 기준값을 차단했어요.', ?)
      `).run(stock.id, JSON.stringify({ valuationCycleId, targetPrice, previousTrackingAsset, baseTrackingAsset }));
      continue;
    }

    const currentPrice = Math.max(1, Math.floor(Number(stock.current_price || 1)));
    const ownerChangeRate = Math.abs(
      (currentTrackingAsset - Math.max(1, Number(stock.etf_last_tracked_owner_asset || currentTrackingAsset))) /
      Math.max(1, Number(stock.etf_last_tracked_owner_asset || currentTrackingAsset)),
    );
    const maxMoveRate = ownerChangeRate >= 0.25 ? 0.08 : 0.03;
    const smoothedPrice = currentPrice + (targetPrice - currentPrice) * 0.20;
    const boundedPrice = Math.max(
      Math.floor(currentPrice * (1 - maxMoveRate)),
      Math.min(Math.floor(currentPrice * (1 + maxMoveRate)), Math.floor(smoothedPrice)),
    );
    const nextPrice = Math.max(1, boundedPrice);

    if (!stock.etf_base_price || !stock.etf_base_owner_asset) {
      db.prepare(`
        UPDATE stocks
        SET etf_base_price = ?, etf_base_owner_asset = ?, etf_last_tracked_owner_asset = ?,
            etf_delist_reference_price = COALESCE(etf_delist_reference_price, ?),
            etf_delist_trigger_price = COALESCE(etf_delist_trigger_price, ?),
            updated_at = ?
        WHERE id = ?
      `).run(currentPrice, currentTrackingAsset, currentTrackingAsset, currentPrice,
        Math.max(1, Math.floor(currentPrice * STOCK_MARKET_POLICY.ownerEtfDelistPriceRatio)), now, stock.id);
      continue;
    }

    const triggerPrice = ownerEtfDelistTrigger(stock);
    if (nextPrice <= triggerPrice) {
      updateStockPrice(
        db,
        stock,
        nextPrice,
        stock.status,
        "owner_etf_drawdown",
        `${stock.name} ETF가 인수 기준가 대비 큰 폭으로 하락했어요.`,
        "previous_tick",
        { manageDelistRisk: false },
      );
      delistStock(db, { ...stock, current_price: nextPrice }, { reason: "owner_asset_etf_85_percent_drop" });
      continue;
    }

    if (nextPrice !== currentPrice) {
      db.prepare(`
        UPDATE stocks
        SET previous_price = current_price, current_price = ?, market_cap = ?,
            etf_last_tracked_owner_asset = ?, updated_at = ?
        WHERE id = ?
      `).run(nextPrice, nextPrice * Number(stock.total_shares || 0), currentTrackingAsset, now, stock.id);
      db.prepare(`
        INSERT INTO stock_price_history (stock_id, price, market_cap, event_type)
        VALUES (?, ?, ?, 'owner_etf_price_updated')
      `).run(stock.id, nextPrice, nextPrice * Number(stock.total_shares || 0));
      db.prepare(`
        INSERT INTO stock_events (stock_id, event_type, title, message, metadata_json)
        VALUES (?, 'owner_etf_price_updated', '인수자 ETF 추종', ?, ?)
      `).run(stock.id, `${stock.name} ETF가 이전 완료 추종 스냅샷을 반영했어요.`, JSON.stringify({ valuationCycleId, previousTrackingAsset, currentTrackingAsset, targetPrice, nextPrice, maxMoveRate }));
      updated += 1;
    } else {
      db.prepare("UPDATE stocks SET etf_last_tracked_owner_asset = ?, updated_at = ? WHERE id = ?")
        .run(currentTrackingAsset, now, stock.id);
    }
  }

  const insertSnapshot = db.prepare(`
    INSERT INTO owner_etf_tracking_snapshots (valuation_cycle_id, user_id, tracking_asset, calculated_at)
    VALUES (?, ?, ?, ?)
  `);
  for (const [ownerId, trackingAsset] of currentTrackingAssets) {
    insertSnapshot.run(valuationCycleId, ownerId, Math.max(1, Math.floor(trackingAsset)), now);
  }
  return { valuationCycleId, updated };
}

export function recalculateOwnerEtfs(db) {
  return runOwnerEtfValuationCycle(db);
}

function processEtfTick(
  db,
  stock,
  { manageDelistRisk = true } = {},
) {
  if (!isOwnerAssetEtf(stock)) return;
  const ownerUser = db.prepare("SELECT * FROM users WHERE id = ?").get(stock.owner_user_id);
  if (!ownerUser) return;

  const currentOwnerAsset = calculateOwnerEtfTrackingAsset(db, ownerUser.id, stock.id);
  
  const referencePrice = ownerEtfDelistReference(stock);
  const triggerPrice = ownerEtfDelistTrigger(stock);
  if (!stock.etf_base_price || !stock.etf_base_owner_asset || !stock.etf_delist_reference_price) {
    db.prepare(`
      UPDATE stocks
      SET etf_base_price = ?, etf_base_owner_asset = ?, etf_last_tracked_owner_asset = ?,
          etf_delist_reference_price = ?,
          etf_delist_reference_set_at = COALESCE(etf_delist_reference_set_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          etf_delist_trigger_price = ?,
          delist_risk_status = 'normal', is_market_cap_warning = 0,
          caution_tick_count = 0, recovery_tick_count = 0, delist_review_tick_count = 0
      WHERE id = ?
    `).run(stock.current_price, currentOwnerAsset, currentOwnerAsset, referencePrice, triggerPrice, stock.id);
    return;
  }

  if (Number(stock.current_price) <= triggerPrice) {
    delistStock(db, stock, { reason: "owner_asset_etf_85_percent_drop" });
    return;
  }

  if (currentOwnerAsset !== stock.etf_last_tracked_owner_asset) {
    const safeOwnerAsset = Math.max(currentOwnerAsset, 1);
    const ratio = safeOwnerAsset / Math.max(stock.etf_base_owner_asset, 1);
    let newPrice = Math.floor(stock.etf_base_price * ratio);
    newPrice = Math.max(1, newPrice); // minimum 1 won

    if (newPrice <= triggerPrice) {
      updateStockPrice(
        db,
        stock,
        newPrice,
        stock.status,
        "etf_delist_threshold",
        `${stock.name}이(가) 인수 기준가 대비 85% 이상 하락해 자동 상장폐지됩니다.`,
        "etf_delist_reference_price",
        { manageDelistRisk: false },
      );
      delistStock(
        db,
        { ...stock, current_price: newPrice },
        { reason: "owner_asset_etf_85_percent_drop" },
      );
      return;
    }

    updateStockPrice(
      db,
      stock,
      newPrice,
      stock.status,
      "etf_update",
      null,
      "previous_tick",
      { manageDelistRisk: false },
    );
    db.prepare(`
      UPDATE stocks
      SET etf_last_tracked_owner_asset = ?, delist_risk_status = 'normal',
          is_market_cap_warning = 0, caution_tick_count = 0,
          recovery_tick_count = 0, delist_review_tick_count = 0
      WHERE id = ?
    `).run(currentOwnerAsset, stock.id);
  } else {
    db.prepare(`
      UPDATE stocks
      SET delist_risk_status = 'normal', is_market_cap_warning = 0,
          caution_tick_count = 0, recovery_tick_count = 0, delist_review_tick_count = 0
      WHERE id = ?
    `).run(stock.id);
  }
}

function updateStockPrice(
  db,
  stock,
  newPrice,
  newStatus,
  eventType,
  eventMsg,
  basis = "previous_tick",
  { manageDelistRisk = true } = {},
) {
  const newCap = newPrice * stock.total_shares;
  
  db.prepare(`
    UPDATE stocks 
    SET previous_price = current_price, current_price = ?, market_cap = ?, status = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(newPrice, newCap, newStatus, stock.id);

  db.prepare(`
    INSERT INTO stock_price_history (stock_id, price, market_cap, event_type)
    VALUES (?, ?, ?, ?)
  `).run(stock.id, newPrice, newCap, eventType);

  if (eventType && eventMsg) {
    const priceBefore = stock.current_price;
    const priceAfter = newPrice;
    const changeAmount = priceAfter - priceBefore;
    const changeRate = priceBefore > 0 ? changeAmount / priceBefore : 0;
    
    let finalMsg = eventMsg;
    const formatRate = (rate) => {
      const percent = rate * 100;
      if (percent > 0) return `+${percent.toFixed(1)}%`;
      if (percent < 0) return `${percent.toFixed(1)}%`;
      return "0.0%";
    };
    const formatAmount = (amt) => {
      return formatSignedWon(amt);
    };

    if (basis === "previous_tick" || basis === "delist_final_crash") {
      finalMsg += ` 전 tick 대비 ${formatAmount(changeAmount)} · ${formatRate(changeRate)}`;
    } else if (basis === "offering_price" && stock.offering_price) {
      const offAmt = priceAfter - stock.offering_price;
      const offRate = stock.offering_price > 0 ? offAmt / stock.offering_price : 0;
      finalMsg += ` 공모가 대비 ${formatAmount(offAmt)} · ${formatRate(offRate)}`;
    }

    const eventTitle =
      eventType === "surge" || eventType === "ipo_surge" || eventType === "ipo_strong_surge" || eventType === "ipo_mega_surge"
        ? "급등"
        : eventType === "crash" || eventType === "ipo_crash"
          ? "급락"
          : eventType === "ipo_overheated"
            ? "공모주 과열"
            : eventType === "ipo_limit_near"
              ? "상한 근접"
              : eventType === "ipo_normal_open"
                ? "신규 상장"
                : eventType === "admin_stock_adjustment"
                  ? "관리자 조정"
                  : "위기";

    db.prepare(`
      INSERT INTO stock_events (stock_id, event_type, title, message, price_before, price_after, change_amount, change_rate, basis)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(stock.id, eventType, eventTitle, finalMsg, priceBefore, priceAfter, changeAmount, changeRate, basis);
  }

  if (manageDelistRisk) {
    updateDelistRiskAfterPrice(db, {
      ...stock,
      current_price: newPrice,
      market_cap: newCap,
      status: newStatus,
    });
  }

  const updatedStock = {
    ...stock,
    current_price: newPrice,
    previous_price: stock.current_price,
    market_cap: newCap,
    status: newStatus,
  };
  maybeTriggerVolatilityHalt(db, updatedStock);
  maybeTriggerShortSqueeze(db, updatedStock);
}

function openIpoStock(db, stock, usedSymbols = new Set(), now = Date.now()) {
  const current = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stock.id);
  if (!current || current.status !== "ipo_subscription") return null;

  const newStatus = "newly_listed";
  const newlyListedUntil = new Date(
    now + STOCK_MARKET_POLICY.newlyListedDurationMs,
  ).toISOString();
  const listedAt = new Date(now).toISOString();
  const identity = pickRandomStockIdentity(db, usedSymbols);
  const sector = inferStockSector(identity.name, identity.symbol);
  const listedStock = {
    ...current,
    name: identity.name,
    symbol: identity.symbol,
    sector,
    status: newStatus,
    newly_listed_until: newlyListedUntil,
    listed_at: listedAt,
  };
  const opening = buildIpoOpeningMove(listedStock);
  let newPrice = clampIpoFirstFiveMinutePrice(
    current,
    Math.floor(current.offering_price * (1 + opening.changeRate)),
  );
  newPrice = clampStockTickPrice(db, current, newPrice, {
    status: newStatus,
    sector,
  });
  const priceBasisStock = {
    ...listedStock,
    ipo_opening_event_done: 1,
    ipo_opening_event_type: opening.openingEventType,
    ipo_opening_change_rate: opening.changeRate,
  };

  db.prepare(
    `UPDATE stocks
     SET newly_listed_until = ?,
         listed_at = ?,
         name = ?,
         symbol = ?,
         sector = ?,
         ipo_opening_event_done = 1,
         ipo_opening_event_type = ?,
         ipo_opening_change_rate = ?
     WHERE id = ?`,
  ).run(
    newlyListedUntil,
    listedAt,
    identity.name,
    identity.symbol,
    sector,
    opening.openingEventType,
    opening.changeRate,
    current.id,
  );

  updateStockPrice(
    db,
    priceBasisStock,
    newPrice,
    newStatus,
    opening.eventType,
    opening.message,
    "offering_price",
  );

  createServerNotification(db, {
    type: "stock_newly_listed",
    title: "신규 상장",
    message: `공모주가 '${identity.name}'(으)로 신규 상장했어요. 첫 반응은 공모가 대비 ${opening.changeRate >= 0 ? "+" : ""}${(opening.changeRate * 100).toFixed(1)}%예요!`,
    gameType: "stock",
    gameName: "주식",
    metadata: {
      stockId: current.id,
      symbol: identity.symbol,
      openingEventType: opening.openingEventType,
      openingChangeRate: opening.changeRate,
    },
  });
  db.prepare(
    `INSERT INTO stock_events (stock_id, event_type, title, message)
     VALUES (?, ?, ?, ?)`,
  ).run(
    current.id,
    "newly_listed",
    "신규 상장",
    `공모주가 '${identity.name}' 종목으로 신규 상장되어 거래가 시작되었습니다.`,
  );

  return db.prepare("SELECT * FROM stocks WHERE id = ?").get(current.id);
}

export function settleDueIpoSubscriptions(database, now = Date.now()) {
  const dueStocks = database
    .prepare("SELECT * FROM stocks WHERE status = 'ipo_subscription'")
    .all()
    .filter((stock) => {
      const endsAt = Date.parse(stock.ipo_subscription_ends_at || "");
      return Number.isFinite(endsAt) && now >= endsAt;
    });

  if (dueStocks.length === 0) return { opened: 0 };

  return database.transaction(() => {
    const usedSymbols = new Set();
    let opened = 0;
    for (const stock of dueStocks) {
      if (openIpoStock(database, stock, usedSymbols, now)) opened += 1;
    }
    return { opened };
  })();
}

export function manuallyAdjustStockPrice(
  database,
  { adminUserId, stockId, mode, direction, value, targetPrice, reason = "", newsTitle, newsContent, publishNews = true },
) {
  const normalizedMode = String(mode || "").trim();
  const normalizedDirection = String(direction || "").trim();
  const numericValue = Number(value);
  const cleanReason = String(reason || "").trim().slice(0, 120);

  if (!["percent", "amount", "set_price"].includes(normalizedMode)) {
    throw new Error("조정 방식은 percent, amount 또는 set_price만 사용할 수 있어요.");
  }
  if (normalizedMode !== "set_price") {
    if (!["up", "down"].includes(normalizedDirection)) {
      throw new Error("조정 방향은 up 또는 down만 사용할 수 있어요.");
    }
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      throw new Error("조정값은 0보다 큰 숫자로 입력해 주세요.");
    }
  } else {
    if (!Number.isSafeInteger(targetPrice) || targetPrice <= 0) {
      throw new Error("목표가는 0보다 큰 정수로 입력해 주세요.");
    }
  }

  const adjust = database.transaction(() => {
    const stock = database
      .prepare("SELECT * FROM stocks WHERE id = ?")
      .get(stockId);
    if (!stock || stock.status === "delisted") {
      throw new Error("조정할 수 있는 종목을 찾을 수 없어요.");
    }

    const oldPrice = Math.max(1, Math.floor(Number(stock.current_price) || 1));
    let newPrice;
    let signedValue;

    if (normalizedMode === "set_price") {
      newPrice = targetPrice;
      signedValue = `직접 설정 ${newPrice.toLocaleString("ko-KR")}원`;
    } else {
      const rawDelta =
        normalizedMode === "percent"
          ? Math.floor(oldPrice * (numericValue / 100))
          : Math.floor(numericValue);
      const delta = Math.max(1, rawDelta);
      newPrice = Math.max(
        1,
        normalizedDirection === "up" ? oldPrice + delta : oldPrice - delta,
      );
      const changeAmount = newPrice - oldPrice;
      signedValue =
        normalizedMode === "percent"
          ? `${normalizedDirection === "up" ? "+" : "-"}${numericValue}%`
          : formatSignedWon(changeAmount);
    }

    const changeAmount = newPrice - oldPrice;
    const message = `관리자 조정: ${stock.name} 주가가 ${signedValue} 조정되었어요.${
      cleanReason ? ` 사유: ${cleanReason}` : ""
    }`;

    updateStockPrice(
      database,
      stock,
      newPrice,
      stock.status,
      "admin_stock_adjustment",
      null, // Pass null to skip default duplicate stock_events insert
      "admin_manual",
    );

    database
      .prepare(
        `INSERT INTO admin_logs
         (admin_user_id, target_user_id, action_type, before_value, after_value)
         VALUES (?, ?, 'admin_stock_adjustment', ?, ?)`,
      )
      .run(
        adminUserId,
        adminUserId,
        String(oldPrice),
        JSON.stringify({
          stockId: stock.id,
          stockName: stock.name,
          oldPrice,
          newPrice,
          changeAmount,
          mode: normalizedMode,
          direction: normalizedDirection,
          value: numericValue,
          targetPrice,
          reason: cleanReason,
          newsTitle,
          newsContent,
          publishNews,
        }),
      );

    const isUp = newPrice > oldPrice;
    const changeRate = oldPrice > 0 ? (newPrice - oldPrice) / oldPrice : 0;
    const changeRateText = `${isUp ? "+" : ""}${(changeRate * 100).toFixed(1)}%`;

    let finalTitle = String(newsTitle || "").trim();
    let finalContent = String(newsContent || "").trim();

    if (isUp) {
      if (!finalTitle) finalTitle = "호재 발생";
      if (!finalContent) finalContent = `${stock.name}이(가) 관리자 이벤트로 ${changeRateText} 상승했어요.`;
    } else {
      if (!finalTitle) finalTitle = "악재 발생";
      if (!finalContent) finalContent = `${stock.name}이(g) 관리자 이벤트로 ${changeRateText} 하락했어요.`;
    }

    const eventType = publishNews
      ? (isUp ? "admin_good_news" : "admin_bad_news")
      : "admin_stock_manual_adjust";

    const sentiment = isUp ? "good" : "bad";

    database.prepare(`
      INSERT INTO stock_events (
        stock_id, stock_name_snapshot, symbol_snapshot, event_type, sentiment, 
        title, message, price_before, price_after, change_amount, change_rate, 
        created_by_user_id, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stock.id, stock.name, stock.symbol, eventType, sentiment,
      finalTitle, finalContent, oldPrice, newPrice, changeAmount, changeRate,
      adminUserId, JSON.stringify({ reason: cleanReason })
    );

    // Only publish to server notifications if publishNews is true and change rate is >= 10% or <= -10%
    if (publishNews && Math.abs(changeRate) >= 0.1) {
      database.prepare(`
        INSERT OR IGNORE INTO server_notifications (nickname_snapshot, type, title, message, amount, source_type, source_id)
        VALUES ('시스템', ?, ?, ?, 0, 'stock', ?)
      `).run(eventType, finalTitle, finalContent, String(stock.id));
    }

    return database.prepare("SELECT * FROM stocks WHERE id = ?").get(stock.id);
  });

  return adjust();
}

export function delistStock(db, stock, { reason = "market_crash" } = {}) {
  const currentStock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stock.id);
  if (!currentStock || currentStock.status === "delisted") return false;

  const isOwnerEtfDrawdown = ["owner_etf_drawdown", "owner_asset_etf_85_percent_drop"].includes(reason);
  const notificationMessage = isOwnerEtfDrawdown
      ? `${currentStock.name}이(가) 인수 기준가 대비 85% 이상 하락해 자동 상장폐지되었어요.`
      : `${currentStock.name}이(가) 급등락을 반복하다가 최종 대폭락 후 상장폐지되었어요.`;
  const eventMessage = isOwnerEtfDrawdown
      ? `${currentStock.name} 종목이 인수 기준가 대비 85% 이상 하락해 자동 상장폐지되었습니다.`
      : `${currentStock.name} 종목이 상장폐지되었습니다.`;

  // 1. Update stock status to delisted, price to 0, set delisted_at
  db.prepare(`
    UPDATE stocks
    SET status = 'delisted', current_price = 0, previous_price = current_price, market_cap = 0,
        is_market_cap_warning = 0, delist_risk_status = 'delisted',
        delisted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        etf_delist_triggered_at = CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE etf_delist_triggered_at END,
        etf_delist_reason = CASE WHEN ? THEN ? ELSE etf_delist_reason END
    WHERE id = ?
  `).run(isOwnerEtfDrawdown ? 1 : 0, isOwnerEtfDrawdown ? 1 : 0, reason, currentStock.id);
  
  // 2. Liquidate all positions for this stock
  const openPositions = db.prepare("SELECT * FROM stock_positions WHERE stock_id = ? AND status = 'open'").all(currentStock.id);
  for (const pos of openPositions) {
    liquidatePosition(db, pos, 0);
  }

  // 3. Mark holdings as worthless (no active deletion needed, just price is 0, but we can log)
  // 4. Create server notification
  createServerNotification(db, {
    nickname: "행운시장",
    type: isOwnerEtfDrawdown ? "owner_asset_etf_delisted_85_percent_drop" : "stock_delisted",
    title: "상장폐지 발생",
    message: notificationMessage,
    gameType: "stock",
    gameName: "주식",
    metadata: { stockId: currentStock.id, symbol: currentStock.symbol, reason }
  });

  db.prepare(`
    INSERT INTO stock_events (stock_id, event_type, title, message)
    VALUES (?, ?, ?, ?)
  `).run(
    currentStock.id,
    isOwnerEtfDrawdown ? "owner_asset_etf_delisted_85_percent_drop" : "delisted",
    "상장폐지",
    eventMessage,
  );

  // 5. Create new IPO
  createIpoStock(db);
  initStockMarket(db);
  return true;
}

export function createIpoStock(db) {
  const ipoCount = db
    .prepare("SELECT COUNT(*) AS count FROM stocks WHERE status = 'ipo_subscription'")
    .get().count;
  if (ipoCount >= 3) {
    return null;
  }

  // Generate sequential IPO number
  let ipoNumber = 1;
  const config = db.prepare("SELECT value FROM system_config WHERE key = 'next_ipo_number'").get();
  if (config) {
    ipoNumber = Number(config.value);
    db.prepare("UPDATE system_config SET value = ? WHERE key = 'next_ipo_number'").run(String(ipoNumber + 1));
  } else {
    // If not exists, insert 2 and use 1
    db.prepare("INSERT INTO system_config (key, value) VALUES ('next_ipo_number', '2')").run();
  }

  const name = `공모주 ${ipoNumber}`;
  const symbol = `IPO-${ipoNumber}`;
  const sector = randomStockSector();
  
  const { currentPrice, totalShares, marketCap } = createStockIdentityAndCap(true);

  const volatility =
    STOCK_MARKET_POLICY.ipoMinVolatility +
    Math.random() * (
      STOCK_MARKET_POLICY.ipoMaxVolatility - STOCK_MARKET_POLICY.ipoMinVolatility
    );

  const insert = db.prepare(`
    INSERT INTO stocks (symbol, name, status, current_price, previous_price, initial_price, total_shares, market_cap, volatility, sector, ipo_subscription_started_at, ipo_subscription_ends_at, offering_price)
    VALUES (?, ?, 'ipo_subscription', ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+5 minutes'), ?)
  `);
  
  const stockId = insert.run(symbol, name, currentPrice, currentPrice, currentPrice, totalShares, marketCap, volatility, sector, currentPrice).lastInsertRowid;

  createServerNotification(db, {
    type: "stock_ipo",
    title: "신규 공모주 청약",
    message: `새 공모주가 등장했어요. 5분 동안 공모가로 구매할 수 있어요.`,
    gameType: "stock",
    gameName: "주식",
    metadata: { stockId, symbol, name, sector }
  });

  db.prepare(`
    INSERT INTO stock_events (stock_id, event_type, title, message)
    VALUES (?, ?, ?, ?)
  `).run(stockId, "ipo_created", "신규 상장", `새 공모주 청약이 시작되었습니다.`);

  return stockId;
}

function recordDelistLifecycleEvent(db, stockId, eventType, title, message) {
  db.prepare(
    `INSERT INTO stock_events (stock_id, event_type, title, message)
     VALUES (?, ?, ?, ?)`,
  ).run(stockId, eventType, title, message);
}

export function evaluateCompanyDistressRisk(db, stock, nowMs = Date.now()) {
  const current = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stock.id);
  if (
    !current ||
    current.status === "delisted" ||
    current.status === "ipo_subscription" ||
    isOwnerAssetEtf(current) ||
    ["delist_review", "recovery", "final_crash"].includes(current.delist_risk_status)
  ) {
    return null;
  }

  const tier = current.is_bluechip === 1 ? "BLUE_CHIP" : (current.stability_tier || "SMALL");
  const normalizedTier = COMPANY_SIZE_PROTECTION[tier] === undefined ? "SMALL" : tier;
  const protection = COMPANY_SIZE_PROTECTION[normalizedTier];
  const marketCap = Math.max(1, Number(current.market_cap || 1));
  const stabilityCap = Math.max(1, Number(current.stability_market_cap || current.initial_market_cap || marketCap));
  const anchorPrice = Math.max(1, Number(current.daily_anchor_price || current.initial_price || current.current_price || 1));
  const currentPrice = Math.max(1, Number(current.current_price || 1));
  const capDrawdown = Math.max(0, 1 - marketCap / stabilityCap);
  const priceDrawdown = Math.max(0, 1 - currentPrice / anchorPrice);
  const belowCautionPressure = marketCap < STOCK_MARKET_POLICY.marketCapWarningThreshold ? 30 : 0;
  const negativeTrendPressure = current.trend_regime === "bear" ? 8 : 0;
  const volatilityPressure = Math.min(18, Math.max(0, Number(current.trend_volatility || 0)) * 2_500);
  // Randomness can only add a small risk increment; it never changes lifecycle state directly.
  const randomRiskIncrement = Math.random() < 0.02 ? Math.random() * 4 : 0;
  const observedPressure =
    capDrawdown * 42 + priceDrawdown * 28 + belowCautionPressure +
    negativeTrendPressure + volatilityPressure + randomRiskIncrement - protection;
  const previousScore = Math.max(0, Number(current.distress_risk_score || 0));
  const score = Math.max(0, Math.min(100, previousScore * 0.82 + Math.max(0, observedPressure) * 0.18));
  const threshold = 55;
  let observationStartedAt = current.distress_observation_started_at || null;
  if (score >= threshold && !observationStartedAt) observationStartedAt = new Date(nowMs).toISOString();
  if (score < threshold * 0.75) observationStartedAt = null;

  db.prepare(`
    UPDATE stocks
    SET distress_risk_score = ?,
        distress_risk_started_at = CASE WHEN ? >= ? THEN COALESCE(distress_risk_started_at, ?) ELSE NULL END,
        distress_observation_started_at = ?,
        distress_last_evaluated_at = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(
    score,
    score,
    threshold,
    new Date(nowMs).toISOString(),
    observationStartedAt,
    new Date(nowMs).toISOString(),
    current.id,
  );

  const minimumHours = DISTRESS_MIN_OBSERVATION_HOURS[normalizedTier];
  const observedMs = observationStartedAt ? nowMs - Date.parse(observationStartedAt) : 0;
  if (score >= threshold && observedMs >= minimumHours * 3_600_000) {
    enterDistressReview(db, { ...current, distress_risk_score: score, stability_tier: normalizedTier });
  }
  return { score, tier: normalizedTier, protection, minimumHours, observationStartedAt };
}

function enterDistressReview(db, stock) {
  const current = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stock.id);
  if (!current || current.status === "delisted" || isOwnerAssetEtf(current)) return;
  if (Number(current.market_cap) < STOCK_MARKET_POLICY.minimumMarketCap) {
    enterDelistReview(db, current);
    return;
  }
  if (current.delist_risk_status === "distress_review") return;

  const message = `${current.name}이(가) 부실기업 심사 대상으로 지정되었어요. 재무 불안 우려로 변동성이 커질 수 있어요.`;
  db.prepare(`
    UPDATE stocks
    SET delist_risk_status = 'distress_review', event_type = 'distress_review',
        event_until = ?, is_market_cap_warning = 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(
    Date.now() + (DISTRESS_MIN_OBSERVATION_HOURS[
      current.is_bluechip === 1 ? "BLUE_CHIP" : (current.stability_tier || "SMALL")
    ] || 6) * 3_600_000,
    current.id,
  );
  recordDelistLifecycleEvent(db, current.id, "distress_review", "부실기업 심사", message);
  createServerNotification(db, {
    nickname: "행운시장",
    type: "stock_distress_review",
    title: "부실기업 심사",
    message,
    gameType: "stock",
    gameName: "주식",
    metadata: { stockId: current.id, symbol: current.symbol },
  });
}

function enterDelistReview(db, stock, customMessage = null) {
  const current = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stock.id);
  if (!current || current.status === "delisted" || Number(current.market_cap) >= STOCK_MARKET_POLICY.minimumMarketCap) return;
  const wasInReview = ["delist_review", "recovery"].includes(
    current.delist_risk_status,
  );
  db.prepare(
    `UPDATE stocks
     SET delist_risk_status = 'delist_review',
         is_market_cap_warning = 1,
         caution_tick_count = MAX(caution_tick_count, ?),
         recovery_started_at = NULL,
         recovery_tick_count = 0,
         delist_review_started_at = COALESCE(
           delist_review_started_at,
           strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         ),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(STOCK_MARKET_POLICY.cautionRequiredTicks, current.id);

  if (!wasInReview) {
    forceClosePositionsOnDelistRisk(
      db,
      { ...current, delist_risk_status: "delist_review" },
      "delist_risk_force_close",
    );
    const message = customMessage ? `${current.name}이(가) ${customMessage}` : `${current.name}의 시가총액이 50억원 미만으로 내려가 상장폐지 심사에 들어갔어요.`;
    recordDelistLifecycleEvent(
      db,
      current.id,
      "delist_review",
      "상장폐지 심사",
      message,
    );
    createServerNotification(db, {
      nickname: "행운시장",
      type: "stock_delist_review",
      title: "상장폐지 심사",
      message,
      gameType: "stock",
      gameName: "주식",
      metadata: { stockId: current.id, symbol: current.symbol },
    });
  }
}

function enterRecovery(db, stock, reviewTickCount, recoveryTickCount = 1) {
  const current = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stock.id);
  if (!current || current.status === "delisted") return;
  const wasRecovery = current.delist_risk_status === "recovery";
  db.prepare(
    `UPDATE stocks
     SET delist_risk_status = 'recovery',
         is_market_cap_warning = 1,
         recovery_started_at = CASE
           WHEN delist_risk_status = 'recovery' AND recovery_started_at IS NOT NULL
             THEN recovery_started_at
           ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         END,
         recovery_tick_count = ?,
         delist_review_tick_count = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(recoveryTickCount, reviewTickCount, current.id);

  if (!wasRecovery) {
    const message = `${current.name}이 60억원 이상으로 회복해 회생 조건을 채우는 중이에요. 1/6`;
    recordDelistLifecycleEvent(
      db,
      current.id,
      "recovery_started",
      "회생 시작",
      message,
    );
  }
}

function recoverStock(db, stock) {
  const current = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stock.id);
  if (!current || current.status === "delisted") return;
  db.prepare(
    `UPDATE stocks
     SET delist_risk_status = 'normal',
         is_market_cap_warning = 0,
         caution_tick_count = 0,
         recovery_started_at = NULL,
         recovery_tick_count = 0,
         delist_review_started_at = NULL,
         delist_review_tick_count = 0,
         final_crash_at = NULL,
         final_crash_reason = NULL,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(current.id);

  const message = `${current.name}이 60억원 이상을 1분 동안 유지해 정상 거래로 복귀했어요.`;
  recordDelistLifecycleEvent(
    db,
    current.id,
    "recovery_success",
    "회생 성공",
    message,
  );
  createServerNotification(db, {
    nickname: "행운시장",
    type: "stock_recovery",
    title: "주식 회생 성공",
    message,
    gameType: "stock",
    gameName: "주식",
    metadata: { stockId: current.id, symbol: current.symbol },
  });
}

function triggerFinalCrash(db, stock, reason) {
  const current = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stock.id);
  if (
    !current ||
    current.status === "delisted" ||
    current.delist_risk_status === "final_crash" ||
    Number(current.market_cap) >= STOCK_MARKET_POLICY.minimumMarketCap ||
    !["delist_review", "recovery"].includes(current.delist_risk_status)
  ) {
    return;
  }

  const crashRate = -(0.85 + Math.random() * 0.1);
  const newPrice = Math.max(1, Math.floor(current.current_price * (1 + crashRate)));
  const reasonMessage =
    reason === "market_cap_under_1b"
      ? "시가총액이 10억원 미만으로 내려가"
      : "상장폐지 심사 30분 안에 회생하지 못해";
  const message = `${current.name}의 ${reasonMessage} 최종 폭락이 발생했어요. 다음 갱신에서 상장폐지됩니다.`;

  updateStockPrice(
    db,
    current,
    newPrice,
    current.status,
    "final_crash",
    message,
    "delist_final_crash",
    { manageDelistRisk: false },
  );
  db.prepare(
    `UPDATE stocks
     SET delist_risk_status = 'final_crash',
         is_market_cap_warning = 1,
         final_crash_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         final_crash_reason = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(reason, current.id);
  forceClosePositionsOnDelistRisk(
    db,
    {
      ...current,
      current_price: newPrice,
      market_cap: newPrice * current.total_shares,
      delist_risk_status: "final_crash",
    },
    reason || "final_crash_force_close",
  );
  createServerNotification(db, {
    nickname: "행운시장",
    type: "stock_final_crash",
    title: "최종 폭락",
    message,
    gameType: "stock",
    gameName: "주식",
    metadata: { stockId: current.id, symbol: current.symbol, reason },
  });
}

function updateDelistRiskAfterPrice(db, stock) {
  const current = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stock.id);
  if (!current || current.status === "delisted") return;
  if (isOwnerAssetEtf(current)) {
    const triggerPrice = ownerEtfDelistTrigger(current);
    if (Number(current.current_price) <= triggerPrice) {
      delistStock(db, current, { reason: "owner_asset_etf_85_percent_drop" });
      return;
    }
    db.prepare(`
      UPDATE stocks
      SET delist_risk_status = 'normal', is_market_cap_warning = 0,
          caution_tick_count = 0, recovery_tick_count = 0, delist_review_tick_count = 0
      WHERE id = ?
    `).run(current.id);
    return;
  }
  if (!["normal", "caution", "distress_review"].includes(current.delist_risk_status || "normal")) {
    return;
  }

  if (
    current.delist_risk_status === "distress_review" &&
    Number(current.event_until || 0) <= Date.now() &&
    Number(current.market_cap) >= STOCK_MARKET_POLICY.minimumMarketCap
  ) {
    db.prepare(`
      UPDATE stocks
      SET delist_risk_status = 'normal', event_type = NULL, event_until = NULL,
          is_market_cap_warning = 0, caution_tick_count = 0,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(current.id);
    recordDelistLifecycleEvent(db, current.id, "distress_review_resolved", "부실기업 심사 종료", `${current.name}의 부실기업 심사가 종료되어 정상 거래로 돌아왔어요.`);
    return;
  }

  const band = getMarketCapPolicyState(current.market_cap);
  if (band === "final_crash") {
    if (["delist_review", "recovery"].includes(current.delist_risk_status)) triggerFinalCrash(db, current, "market_cap_under_1b");
    else enterDelistReview(db, current);
    return;
  }
  if (band === "delist_review") {
    enterDelistReview(db, current);
    return;
  }
  if (band === "caution") {
    const cautionTicks = Number(current.caution_tick_count || 0) + 1;
    const shouldWarn = cautionTicks >= STOCK_MARKET_POLICY.cautionRequiredTicks;
    db.prepare(
      `UPDATE stocks
       SET caution_tick_count = ?,
           delist_risk_status = ?,
           is_market_cap_warning = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    ).run(
      cautionTicks,
      current.delist_risk_status === "distress_review" ? "distress_review" : (shouldWarn ? "caution" : "normal"),
      shouldWarn ? 1 : 0,
      current.id,
    );
    if (
      shouldWarn && current.delist_risk_status !== "distress_review" &&
      current.delist_risk_status !== "caution"
    ) {
      recordDelistLifecycleEvent(
        db,
        current.id,
        "market_cap_caution",
        "거래주의",
        `${current.name}의 시가총액이 3틱 연속 60억원 미만으로 내려갔어요.`,
      );
    }
    return;
  }

  if (current.delist_risk_status === "distress_review") return;

  if (
    current.delist_risk_status === "caution" ||
    Number(current.caution_tick_count || 0) > 0
  ) {
    db.prepare(
      `UPDATE stocks
       SET caution_tick_count = 0,
           delist_risk_status = 'normal',
           is_market_cap_warning = 0,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    ).run(current.id);
  }
}

function processDelistingLifecycleTick(db, stock, usedSymbols) {
  const current = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stock.id);
  if (!current || current.status === "delisted") return;
  if (isOwnerAssetEtf(current)) {
    processEtfTick(db, current, { manageDelistRisk: false });
    return;
  }

  if (current.delist_risk_status === "final_crash") {
    delistStock(db, current, {
      reason: current.final_crash_reason || "recovery_failed",
    });
    return;
  }

  if (
    current.is_etf === 1 &&
    shouldDelistOwnerEtf(current.etf_base_price, current.current_price)
  ) {
    delistStock(db, current, { reason: "owner_etf_drawdown" });
    return;
  }

  let reviewTicks = Number(current.delist_review_tick_count || 0) + 1;

  if (current.delist_risk_status === "recovery") {
    if (current.is_etf === 1) {
      processEtfTick(db, current, { manageDelistRisk: false });
    } else {
      processNormalTick(db, current, usedSymbols, { manageDelistRisk: false });
    }
    const updated = db.prepare("SELECT * FROM stocks WHERE id = ?").get(current.id);
    if (!updated || updated.status === "delisted") return;
    if (
      updated.is_etf === 1 &&
      shouldDelistOwnerEtf(updated.etf_base_price, updated.current_price)
    ) {
      delistStock(db, updated, { reason: "owner_etf_drawdown" });
      return;
    }
    if (updated.market_cap < STOCK_MARKET_POLICY.finalCrashMarketCap) {
      triggerFinalCrash(db, updated, "market_cap_under_1b");
      return;
    }

    if (updated.market_cap >= STOCK_MARKET_POLICY.marketCapWarningThreshold) {
      const recoveryTicks = Number(current.recovery_tick_count || 0) + 1;
      if (recoveryTicks >= STOCK_MARKET_POLICY.recoveryRequiredTicks) {
        recoverStock(db, updated);
        return;
      }
      if (reviewTicks >= STOCK_MARKET_POLICY.delistReviewMaxTicks) {
        triggerFinalCrash(db, updated, "recovery_failed");
        return;
      }
      enterRecovery(db, updated, reviewTicks, recoveryTicks);
      return;
    }
    if (reviewTicks >= STOCK_MARKET_POLICY.delistReviewMaxTicks) {
      triggerFinalCrash(db, updated, "recovery_failed");
      return;
    }

    db.prepare(
      `UPDATE stocks
       SET delist_risk_status = 'delist_review',
           is_market_cap_warning = 1,
           recovery_started_at = NULL,
           recovery_tick_count = 0,
           delist_review_tick_count = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    ).run(reviewTicks, updated.id);
    recordDelistLifecycleEvent(
      db,
      updated.id,
      "recovery_interrupted",
      "회생 중단",
      `${updated.name}의 시가총액이 다시 60억원 미만으로 내려가 회생 유지 시간이 초기화됐어요.`,
    );
    return;
  }

  if (current.market_cap < STOCK_MARKET_POLICY.finalCrashMarketCap) {
    triggerFinalCrash(db, current, "market_cap_under_1b");
    return;
  }
  if (current.market_cap >= STOCK_MARKET_POLICY.marketCapWarningThreshold) {
    enterRecovery(db, current, reviewTicks, 1);
    return;
  }
  if (reviewTicks >= STOCK_MARKET_POLICY.delistReviewMaxTicks) {
    triggerFinalCrash(db, current, "recovery_failed");
    return;
  }

  const isSurge = Math.random() < 0.45;
  const changeRate = isSurge
    ? 0.2 + Math.random() * 0.6
    : -(0.25 + Math.random() * 0.45);
  const newPrice = clampStockTickPrice(
    db,
    current,
    Math.floor(current.current_price * (1 + changeRate)),
    { delist_risk_status: "delist_review" },
  );
  const eventType = isSurge ? "unstable_surge" : "unstable_crash";
  const eventMessage = isSurge
    ? `${current.name}이 상장폐지 심사 중 급반등했어요.`
    : `${current.name}이 상장폐지 심사 중 급락했어요.`;
  updateStockPrice(
    db,
    current,
    newPrice,
    current.status,
    eventType,
    eventMessage,
    "previous_tick",
    { manageDelistRisk: false },
  );

  const updated = db.prepare("SELECT * FROM stocks WHERE id = ?").get(current.id);
  if (
    updated.is_etf === 1 &&
    shouldDelistOwnerEtf(updated.etf_base_price, updated.current_price)
  ) {
    delistStock(db, updated, { reason: "owner_etf_drawdown" });
    return;
  }
  if (updated.market_cap < STOCK_MARKET_POLICY.finalCrashMarketCap) {
    triggerFinalCrash(db, updated, "market_cap_under_1b");
    return;
  }
  if (updated.market_cap >= STOCK_MARKET_POLICY.marketCapWarningThreshold) {
    enterRecovery(db, updated, reviewTicks, 1);
    return;
  }

  db.prepare(
    `UPDATE stocks
     SET delist_risk_status = 'delist_review',
         is_market_cap_warning = 1,
         recovery_started_at = NULL,
         recovery_tick_count = 0,
         delist_review_tick_count = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(reviewTicks, updated.id);
}

export function initializeStockDelistingLifecycle(database) {
  const migrationKey = "stock_delisting_lifecycle_v3_distress_review";
  if (
    database.prepare("SELECT 1 FROM system_config WHERE key = ?").get(migrationKey)
  ) {
    return { initialized: false };
  }

  return database.transaction(() => {
    const stocks = database
      .prepare("SELECT * FROM stocks WHERE status != 'delisted' ORDER BY id ASC")
      .all();
    for (const stock of stocks) {
      let baseStatus = stock.status;
      let riskStatus = "normal";
      if (isOwnerAssetEtf(stock)) {
        baseStatus = "acquired";
        riskStatus = "normal";
      } else if (stock.status === "final_crash") {
        baseStatus = stock.is_etf === 1 ? "acquired" : "listed";
        riskStatus = "final_crash";
      } else if (stock.status === "delist_warning") {
        baseStatus = stock.is_etf === 1 ? "acquired" : "listed";
        riskStatus = Number(stock.market_cap) < STOCK_MARKET_POLICY.minimumMarketCap
          ? "delist_review"
          : "distress_review";
      } else if (
        stock.delist_risk_status === "delist_review" &&
        Number(stock.market_cap) >= STOCK_MARKET_POLICY.minimumMarketCap
      ) {
        riskStatus = "distress_review";
      } else {
        const band = getMarketCapPolicyState(stock.market_cap);
        if (band === "final_crash" || band === "delist_review") {
          riskStatus = "delist_review";
        }
      }

      database.prepare(
        `UPDATE stocks
         SET status = ?,
             delist_risk_status = ?,
             is_market_cap_warning = ?,
             caution_tick_count = 0,
             recovery_tick_count = 0,
             delist_review_started_at = CASE
               WHEN ? = 'delist_review'
                 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
               ELSE NULL
             END,
             final_crash_at = CASE
               WHEN ? = 'final_crash'
                 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
               ELSE NULL
             END
         WHERE id = ?`,
      ).run(
        baseStatus,
        riskStatus,
        riskStatus === "normal" ? 0 : 1,
        riskStatus,
        riskStatus,
        stock.id,
      );
    }
    database
      .prepare("INSERT INTO system_config (key, value) VALUES (?, 'complete')")
      .run(migrationKey);
    return { initialized: true, stockCount: stocks.length };
  })();
}

export function liquidatePositionsIfNeeded(db) {
  // Find all open positions where current stock price hits or exceeds liquidation price
  const positions = db.prepare(`
    SELECT p.*, s.current_price as stock_current_price
    FROM stock_positions p
    JOIN stocks s ON p.stock_id = s.id
    WHERE p.status = 'open' AND (
      (p.side = 'long' AND s.current_price <= p.liquidation_price) OR
      (p.side = 'short' AND s.current_price >= p.liquidation_price)
    )
  `).all();

  for (const pos of positions) {
    liquidatePosition(db, pos, pos.stock_current_price);
  }
}

function positionDetail(outcome, forceCloseReason = null) {
  return {
    side: outcome.side,
    entryPrice: outcome.entryPrice,
    closePrice: outcome.closePrice,
    marginAmount: outcome.marginAmount,
    leverage: outcome.leverage,
    rawPnl: outcome.rawPnl,
    cappedPnl: outcome.cappedPnl,
    riskLevel: outcome.riskLevel,
    profitCapApplied: outcome.profitCapApplied,
    liquidated: outcome.liquidated,
    forceCloseReason,
    liquidationPrice: outcome.liquidationPrice,
  };
}

export function closePositionWithRiskCap(db, position, stock, reason = "risk_force_close") {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(position.user_id);
  if (!user) return null;

  const closePrice = stock.status === "delisted" ? 0 : Math.max(0, Math.floor(Number(stock.current_price || 0)));
  const outcome = calculateLeveragedPositionOutcome(position, stock, closePrice);
  if (outcome.liquidated) {
    liquidatePosition(db, position, closePrice, reason);
    return { ...outcome, finalPayout: 0, realizedPnl: -position.margin_amount };
  }

  const grossRealizedPnl = outcome.cappedPnl;
  const settlement = calculateLeverageSettlement(db, {
    userId: user.id,
    position,
    cappedPnl: outcome.cappedPnl,
  });
  const {
    closeFee,
    realizedPnlBeforeTax,
    capitalGainsTax,
    jackpotContribution,
    finalProfit,
    finalPayout,
  } = settlement;
  const realizedPnl = finalProfit;
  const balanceAfter = user.balance + finalPayout;
  const detail = {
    ...positionDetail(outcome, reason),
    grossPayout: outcome.payoutBeforeTax,
    grossRealizedPnl,
    closeFee,
    realizedPnlBeforeTax,
    capitalGainsTax,
    taxBracketsApplied: settlement.bracketsApplied,
    jackpotPoolContribution: jackpotContribution,
    finalProfit,
    finalPayout,
    taxType: settlement.taxType,
  };

  db.prepare(`
    UPDATE stock_positions
    SET status = 'closed',
        closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        close_price = ?,
        payout_amount = ?,
        unrealized_pnl = 0,
        realized_pnl = ?,
        detail_json = ?
    WHERE id = ?
  `).run(closePrice, finalPayout, realizedPnl, JSON.stringify(detail), position.id);

  db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, user.id);

  const afterGrossPayout = user.balance + Math.max(0, outcome.payoutBeforeTax);
  const afterCloseFee = afterGrossPayout - closeFee;
  const afterTax = afterCloseFee - capitalGainsTax;

  db.prepare(`
    INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id, detail_json)
    VALUES (?, 'stock_position_close', ?, ?, ?, ?, ?)
  `).run(
    user.id,
    Math.max(0, outcome.payoutBeforeTax),
    user.balance,
    afterGrossPayout,
    position.stock_id,
    JSON.stringify(detail),
  );
  if (closeFee > 0) {
    db.prepare(`
      INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id, detail_json)
      VALUES (?, 'stock_fee', ?, ?, ?, ?, ?)
    `).run(user.id, -closeFee, afterGrossPayout, afterCloseFee, position.stock_id, JSON.stringify(detail));
  }
  if (capitalGainsTax > 0) {
    db.prepare(`
      INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id, detail_json)
      VALUES (?, 'capital_gains_tax', ?, ?, ?, ?, ?)
    `).run(user.id, -capitalGainsTax, afterCloseFee, afterTax, position.stock_id, JSON.stringify(detail));
  }
  if (realizedPnl > 0) {
    db.prepare(`
      INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id, detail_json)
      VALUES (?, 'stock_realized_profit', ?, ?, ?, ?, ?)
    `).run(user.id, 0, afterTax, afterTax, position.stock_id, JSON.stringify(detail));
  }

  const trade = db.prepare(`
    INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, realized_pnl, balance_before, balance_after, detail_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id,
    position.stock_id,
    `close_${position.side || "long"}`,
    finalPayout,
    position.quantity,
    closePrice,
    position.leverage,
    realizedPnl,
    user.balance,
    balanceAfter,
    JSON.stringify(detail),
  );
  applyLeverageSettlementTax(db, user.id, settlement);
  incrementUserStockStat(db, {
    userId: user.id,
    stat: STOCK_STAT_TYPES.leverageRoundTripCount,
    sourceType: "leverage_round_trip",
    sourceId: position.id,
  });

  if (capitalGainsTax > 0) {
    addJackpotContribution(db, capitalGainsTax, {
      sourceType: "stock_position_capital_gains_tax",
      sourceId: trade.lastInsertRowid,
      userId: user.id,
      metadata: {
        stockId: position.stock_id,
        positionId: position.id,
        reason,
        realizedPnlBeforeTax,
        capitalGainsTax,
      },
    });
  }

  return { ...outcome, finalPayout, realizedPnl };
}

export function forceClosePositionsOnDelistRisk(db, stock, reason = "delist_risk_force_close") {
  const openPositions = db
    .prepare("SELECT * FROM stock_positions WHERE stock_id = ? AND status = 'open'")
    .all(stock.id);

  for (const position of openPositions) {
    closePositionWithRiskCap(db, position, stock, reason);
  }

  return openPositions.length;
}

export function liquidatePosition(db, position, closingPrice, reason = "liquidation") {
  const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(position.stock_id) || {};
  const outcome = {
    ...calculateLeveragedPositionOutcome(position, stock, closingPrice),
    liquidated: true,
    cappedPnl: -Math.floor(Number(position.margin_amount || 0)),
    profitCapApplied: false,
  };

  db.prepare(`
    UPDATE stock_positions 
    SET status = 'liquidated',
        liquidated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        close_price = ?,
        payout_amount = 0,
        unrealized_pnl = 0,
        realized_pnl = ?
    WHERE id = ?
  `).run(closingPrice, -position.margin_amount, position.id);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(position.user_id);
  if (!user) return;
  applyStockTaxLedgerImpact(db, position.user_id, -Math.floor(Number(position.margin_amount || 0)));
  
  db.prepare(`
    INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, realized_pnl, balance_before, balance_after)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(position.user_id, position.stock_id, `liquidation_${position.side || "long"}`, 0, position.quantity, closingPrice, position.leverage, -position.margin_amount, user.balance, user.balance);
  incrementUserStockStat(db, {
    userId: position.user_id,
    stat: STOCK_STAT_TYPES.leverageLiquidationCount,
    sourceType: "leverage_liquidation",
    sourceId: position.id,
  });
  incrementUserStockStat(db, {
    userId: position.user_id,
    stat: STOCK_STAT_TYPES.leverageRoundTripCount,
    sourceType: "leverage_round_trip",
    sourceId: position.id,
  });

  db.prepare(`
    INSERT INTO asset_events (user_id, event_type, amount, balance_before, balance_after, source_id, detail_json)
    VALUES (?, 'stock_liquidation', 0, ?, ?, ?, ?)
  `).run(
    position.user_id,
    user.balance,
    user.balance,
    position.stock_id,
    JSON.stringify(positionDetail(outcome, reason)),
  );

  // Big liquidations get notification
  if (position.leverage >= 50 || position.margin_amount >= 500000) {
    createServerNotification(db, {
      userId: user.id,
      nickname: user.nickname,
      type: "stock_liquidation",
      title: "강제 청산",
      message: `${user.nickname}님이 ${position.leverage}배 레버리지 포지션에서 강제 청산당했습니다.`,
      amount: -position.margin_amount,
      gameType: "stock",
      gameName: "주식",
      metadata: { positionId: position.id, margin: position.margin_amount },
      sourceType: "stock_liquidation",
      sourceId: position.id,
    });
  }
}
