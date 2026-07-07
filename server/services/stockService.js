import { createServerNotification } from "./serverNotificationService.js";
import { isStockMarketOpen } from "./marketStateService.js";
import { calculateUserTotalEvaluatedAsset } from "./portfolioValuationService.js";
import { formatSignedWon } from "../utils/formatWon.js";

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
  normal: 0.98,
  surge: 0.01,
  crash: 0.01
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
      INSERT INTO stocks (symbol, name, status, current_price, previous_price, initial_price, total_shares, market_cap, volatility)
      VALUES (?, ?, 'listed', ?, ?, ?, ?, ?, ?)
    `);
    
    db.transaction(() => {
      const usedSymbols = new Set();
      for (let i = 0; i < missing; i++) {
        const st = pickRandomStockIdentity(db, usedSymbols);
        const { currentPrice, totalShares, marketCap } = createStockIdentityAndCap(false);
        const volatility = 0.01 + Math.random() * 0.04;
        insert.run(st.symbol, st.name, currentPrice, currentPrice, currentPrice, totalShares, marketCap, volatility);
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

export function tickStockMarket(db) {
  try {
    nextTickAt = Date.now() + STOCK_TICK_INTERVAL_MS;
    if (!isStockMarketOpen(db)) return;
    db.transaction(() => {
      const stocks = db
        .prepare("SELECT * FROM stocks WHERE status != 'delisted' ORDER BY id ASC")
        .all();
      const usedSymbols = new Set();
      for (const stock of stocks) {
        if (stock.is_trading_suspended) continue;
        if (
          ["delist_review", "recovery", "final_crash"].includes(
            stock.delist_risk_status,
          )
        ) {
          processDelistingLifecycleTick(db, stock, usedSymbols);
          continue;
        }
        if (stock.is_etf) {
          processEtfTick(db, stock);
        } else {
          processNormalTick(db, stock, usedSymbols);
        }
      }

      const now = Date.now();
      if (now - lastDelistCandidateEventAt >= 300_000) {
        lastDelistCandidateEventAt = now;
        const candidates = stocks.filter(s => s.status === 'listed' && s.is_etf === 0 && !["delist_review", "caution", "final_crash"].includes(s.delist_risk_status));
        if (candidates.length > 0) {
          const weights = candidates.map(stock => {
            const cap = stock.market_cap;
            if (stock.is_bluechip === 1) return 0.005;
            if (cap < 10_000_000_000) return 2.5;
            if (cap < 50_000_000_000) return 1.5;
            if (cap < 300_000_000_000) return 0.8;
            if (cap < 2_000_000_000_000) return 0.3;
            if (cap < 20_000_000_000_000) return 0.1;
            return 0.02;
          });
          const totalWeight = weights.reduce((a,b) => a+b, 0);
          let r = Math.random() * totalWeight;
          let selected = candidates[0];
          for (let i = 0; i < candidates.length; i++) {
            if (r < weights[i]) {
              selected = candidates[i];
              break;
            }
            r -= weights[i];
          }
          enterDelistReview(db, selected, "상장폐지 논의 종목으로 지정되었어요. 시가총액이 낮은 종목일수록 위험해요.");
        }
      }

      liquidatePositionsIfNeeded(db);
    })();
  } catch (error) {
    console.error("[CRITICAL] Error in tickStockMarket:", error);
  }
}

function processNormalTick(
  db,
  stock,
  usedSymbols,
  { manageDelistRisk = true } = {},
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
      const event = getRandomEvent(EVENT_PROBABILITIES);
      if (event === "surge") {
        newPrice = Math.floor(newPrice * (1 + 0.05 + Math.random() * 0.10)); // +5% ~ +15%
        eventType = "surge";
        eventMsg = `${stock.name} 주가가 반등했어요!`;
        isSurgeOrCrash = true;
      } else if (event === "crash") {
        newPrice = Math.floor(newPrice * (1 - 0.07 - Math.random() * 0.13)); // -7% ~ -20%
        eventType = "crash";
        eventMsg = `${stock.name} 주가가 급락했어요!`;
        isSurgeOrCrash = true;
      }

      if (!isSurgeOrCrash) {
        const maxChange = Math.min(stock.volatility, STOCK_MARKET_POLICY.regularMaxTickVolatility);
        const trend = Math.max(-0.0002, Math.min(0.0002, stock.trend || 0));
        const change = (Math.random() * 2 - 1) * maxChange + trend;
        newPrice = Math.floor(newPrice * (1 + change));
      }
    }
  }

  // Remove arbitrary minCap logic for bluechips so it doesn't jump to 50T
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

export function recalculateOwnerEtfs(db) {
  const etfs = db.prepare("SELECT * FROM stocks WHERE is_etf = 1 AND status = 'acquired'").all();
  for (const stock of etfs) {
    if (["normal", "caution"].includes(stock.delist_risk_status || "normal")) {
      processEtfTick(db, stock, { manageDelistRisk: false });
    }
  }
}

function processEtfTick(
  db,
  stock,
  { manageDelistRisk = true } = {},
) {
  const ownerUser = db.prepare("SELECT * FROM users WHERE id = ?").get(stock.owner_user_id);
  if (!ownerUser) return;

  const ownerValuation = calculateUserTotalEvaluatedAsset(db, ownerUser.id);
  const currentOwnerAsset = Math.max(ownerValuation.totalEvaluatedAsset, 1);
  
  if (!stock.etf_base_price || !stock.etf_base_owner_asset) {
    db.prepare("UPDATE stocks SET etf_base_price = ?, etf_base_owner_asset = ?, etf_last_tracked_owner_asset = ? WHERE id = ?")
      .run(stock.current_price, currentOwnerAsset, currentOwnerAsset, stock.id);
    if (manageDelistRisk) updateDelistRiskAfterPrice(db, stock);
    return;
  }

  if (shouldDelistOwnerEtf(stock.etf_base_price, stock.current_price)) {
    delistStock(db, stock, { reason: "owner_etf_drawdown" });
    return;
  }

  if (currentOwnerAsset !== stock.etf_last_tracked_owner_asset) {
    const safeOwnerAsset = Math.max(currentOwnerAsset, 1);
    const ratio = safeOwnerAsset / Math.max(stock.etf_base_owner_asset, 1);
    let newPrice = Math.floor(stock.etf_base_price * ratio);
    newPrice = Math.max(1, newPrice); // minimum 1 won

    if (shouldDelistOwnerEtf(stock.etf_base_price, newPrice)) {
      updateStockPrice(
        db,
        stock,
        newPrice,
        stock.status,
        "etf_delist_threshold",
        `${stock.name}이(가) 인수 기준가 대비 85% 이상 하락해 자동 상장폐지됩니다.`,
        "etf_base_price",
        { manageDelistRisk: false },
      );
      delistStock(
        db,
        { ...stock, current_price: newPrice },
        { reason: "owner_etf_drawdown" },
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
      { manageDelistRisk },
    );
    db.prepare("UPDATE stocks SET etf_last_tracked_owner_asset = ? WHERE id = ?").run(currentOwnerAsset, stock.id);
  } else if (manageDelistRisk) {
    updateDelistRiskAfterPrice(db, stock);
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
}

function openIpoStock(db, stock, usedSymbols = new Set(), now = Date.now()) {
  const current = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stock.id);
  if (!current || current.status !== "ipo_subscription") return null;

  const newStatus = "newly_listed";
  const newlyListedUntil = new Date(
    now + STOCK_MARKET_POLICY.newlyListedDurationMs,
  ).toISOString();
  const identity = pickRandomStockIdentity(db, usedSymbols);
  const listedStock = {
    ...current,
    name: identity.name,
    symbol: identity.symbol,
    status: newStatus,
    newly_listed_until: newlyListedUntil,
  };
  const opening = buildIpoOpeningMove(listedStock);
  const newPrice = clampIpoFirstFiveMinutePrice(
    current,
    Math.floor(current.offering_price * (1 + opening.changeRate)),
  );
  const priceBasisStock = {
    ...listedStock,
    ipo_opening_event_done: 1,
    ipo_opening_event_type: opening.openingEventType,
    ipo_opening_change_rate: opening.changeRate,
  };

  db.prepare(
    `UPDATE stocks
     SET newly_listed_until = ?,
         name = ?,
         symbol = ?,
         ipo_opening_event_done = 1,
         ipo_opening_event_type = ?,
         ipo_opening_change_rate = ?
     WHERE id = ?`,
  ).run(
    newlyListedUntil,
    identity.name,
    identity.symbol,
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
  { adminUserId, stockId, mode, direction, value, reason = "" },
) {
  const normalizedMode = String(mode || "").trim();
  const normalizedDirection = String(direction || "").trim();
  const numericValue = Number(value);
  const cleanReason = String(reason || "").trim().slice(0, 120);

  if (!["percent", "amount"].includes(normalizedMode)) {
    throw new Error("조정 방식은 percent 또는 amount만 사용할 수 있어요.");
  }
  if (!["up", "down"].includes(normalizedDirection)) {
    throw new Error("조정 방향은 up 또는 down만 사용할 수 있어요.");
  }
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new Error("조정값은 0보다 큰 숫자로 입력해 주세요.");
  }

  return database.transaction(() => {
    const stock = database
      .prepare("SELECT * FROM stocks WHERE id = ?")
      .get(stockId);
    if (!stock || stock.status === "delisted") {
      throw new Error("조정할 수 있는 종목을 찾을 수 없어요.");
    }

    const oldPrice = Math.max(1, Math.floor(Number(stock.current_price) || 1));
    const rawDelta =
      normalizedMode === "percent"
        ? Math.floor(oldPrice * (numericValue / 100))
        : Math.floor(numericValue);
    const delta = Math.max(1, rawDelta);
    const newPrice = Math.max(
      1,
      normalizedDirection === "up" ? oldPrice + delta : oldPrice - delta,
    );
    const changeAmount = newPrice - oldPrice;
    const signedValue =
      normalizedMode === "percent"
        ? `${normalizedDirection === "up" ? "+" : "-"}${numericValue}%`
        : formatSignedWon(changeAmount);
    const message = `관리자 조정: ${stock.name} 주가가 ${signedValue} 조정되었어요.${
      cleanReason ? ` 사유: ${cleanReason}` : ""
    }`;

    updateStockPrice(
      database,
      stock,
      newPrice,
      stock.status,
      "admin_stock_adjustment",
      message,
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
          reason: cleanReason,
        }),
      );

    return database.prepare("SELECT * FROM stocks WHERE id = ?").get(stock.id);
  })();
}

export function delistStock(db, stock, { reason = "market_crash" } = {}) {
  const currentStock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stock.id);
  if (!currentStock || currentStock.status === "delisted") return false;

  const isOwnerEtfDrawdown = reason === "owner_etf_drawdown";
  const notificationMessage = isOwnerEtfDrawdown
      ? `${currentStock.name}이(가) 인수 기준가 대비 85% 이상 하락해 자동 상장폐지되었어요.`
      : `${currentStock.name}이(가) 급등락을 반복하다가 최종 대폭락 후 상장폐지되었어요.`;
  const eventMessage = isOwnerEtfDrawdown
      ? `${currentStock.name} 종목이 인수 기준가 대비 85% 이상 하락해 자동 상장폐지되었습니다.`
      : `${currentStock.name} 종목이 상장폐지되었습니다.`;

  // 1. Update stock status to delisted, price to 0, set delisted_at
  db.prepare("UPDATE stocks SET status = 'delisted', current_price = 0, previous_price = current_price, market_cap = 0, is_market_cap_warning = 0, delist_risk_status = 'delisted', delisted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(currentStock.id);
  
  // 2. Liquidate all positions for this stock
  const openPositions = db.prepare("SELECT * FROM stock_positions WHERE stock_id = ? AND status = 'open'").all(currentStock.id);
  for (const pos of openPositions) {
    liquidatePosition(db, pos, 0);
  }

  // 3. Mark holdings as worthless (no active deletion needed, just price is 0, but we can log)
  // 4. Create server notification
  createServerNotification(db, {
    nickname: "행운시장",
    type: "stock_delisted",
    title: "상장폐지 발생",
    message: notificationMessage,
    gameType: "stock",
    gameName: "주식",
    metadata: { stockId: currentStock.id, symbol: currentStock.symbol, reason }
  });

  db.prepare(`
    INSERT INTO stock_events (stock_id, event_type, title, message)
    VALUES (?, ?, ?, ?)
  `).run(currentStock.id, "delisted", "상장폐지", eventMessage);

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

  const identity = pickRandomStockIdentity(db);
  const symbol = identity.symbol;
  const name = identity.name;
  
  const { currentPrice, totalShares, marketCap } = createStockIdentityAndCap(true);

  const volatility =
    STOCK_MARKET_POLICY.ipoMinVolatility +
    Math.random() * (
      STOCK_MARKET_POLICY.ipoMaxVolatility - STOCK_MARKET_POLICY.ipoMinVolatility
    );

  const insert = db.prepare(`
    INSERT INTO stocks (symbol, name, status, current_price, previous_price, initial_price, total_shares, market_cap, volatility, ipo_subscription_started_at, ipo_subscription_ends_at, offering_price)
    VALUES (?, ?, 'ipo_subscription', ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), datetime('now', '+3 minutes'), ?)
  `);
  
  const stockId = insert.run(symbol, name, currentPrice, currentPrice, currentPrice, totalShares, marketCap, volatility, currentPrice).lastInsertRowid;

  createServerNotification(db, {
    type: "stock_ipo",
    title: "신규 공모주 청약",
    message: `새 공모주가 등장했어요. 3분 동안 공모가로 구매할 수 있어요.`,
    gameType: "stock",
    gameName: "주식",
    metadata: { stockId, symbol, name }
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

function enterDelistReview(db, stock, customMessage = null) {
  const current = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stock.id);
  if (!current || current.status === "delisted") return;
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
    current.delist_risk_status === "final_crash"
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
  if (
    !["normal", "caution"].includes(current.delist_risk_status || "normal")
  ) {
    return;
  }

  const band = getMarketCapPolicyState(current.market_cap);
  if (band === "final_crash") {
    triggerFinalCrash(db, current, "market_cap_under_1b");
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
      shouldWarn ? "caution" : "normal",
      shouldWarn ? 1 : 0,
      current.id,
    );
    if (
      shouldWarn &&
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
  const newPrice = Math.max(
    1,
    Math.floor(current.current_price * (1 + changeRate)),
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
  const migrationKey = "stock_delisting_lifecycle_v2";
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
      if (stock.status === "final_crash") {
        baseStatus = stock.is_etf === 1 ? "acquired" : "listed";
        riskStatus = "final_crash";
      } else if (stock.status === "delist_warning") {
        baseStatus = stock.is_etf === 1 ? "acquired" : "listed";
        riskStatus = "delist_review";
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

function liquidatePosition(db, position, closingPrice) {
  db.prepare(`
    UPDATE stock_positions 
    SET status = 'liquidated', liquidated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), unrealized_pnl = 0, realized_pnl = ?
    WHERE id = ?
  `).run(-position.margin_amount, position.id);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(position.user_id);
  
  db.prepare(`
    INSERT INTO stock_trades (user_id, stock_id, trade_type, amount, quantity, price, leverage, realized_pnl, balance_before, balance_after)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(position.user_id, position.stock_id, `liquidation_${position.side || "long"}`, position.margin_amount, position.quantity, closingPrice, position.leverage, -position.margin_amount, user.balance, user.balance);

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
