import { createServerNotification } from "./serverNotificationService.js";

export const TREND_DURATION_MINUTES = Object.freeze({ min: 30, max: 120 });
export const TREND_DRIFT_PER_TICK = Object.freeze({
  bull: { min: 0.00001, max: 0.00005 },
  sideways: { min: -0.000005, max: 0.000005 },
  bear: { min: -0.00005, max: -0.00001 },
});

export const TREND_REGIME_PROBABILITIES = Object.freeze({
  danger_micro: { bull: 0.44, sideways: 0.20, bear: 0.36 },
  micro: { bull: 0.46, sideways: 0.20, bear: 0.34 },
  small: { bull: 0.49, sideways: 0.20, bear: 0.31 },
  small_mid: { bull: 0.52, sideways: 0.19, bear: 0.29 },
  mid: { bull: 0.54, sideways: 0.19, bear: 0.27 },
  large: { bull: 0.56, sideways: 0.19, bear: 0.25 },
  mega: { bull: 0.58, sideways: 0.19, bear: 0.23 },
  giant: { bull: 0.60, sideways: 0.18, bear: 0.22 },
});

const MARKET_REGIME_OPTIONS = [
  { marketRegime: "strong_bull", weight: 0.10, strength: 1.0 },
  { marketRegime: "bull", weight: 0.24, strength: 0.55 },
  { marketRegime: "sideways", weight: 0.32, strength: 0 },
  { marketRegime: "bear", weight: 0.23, strength: -0.55 },
  { marketRegime: "panic", weight: 0.11, strength: -1.0 },
];

const TIER_VOLATILITY_MULTIPLIER = Object.freeze({
  danger_micro: 1.85,
  micro: 1.55,
  small: 1.3,
  small_mid: 1.1,
  mid: 0.9,
  large: 0.72,
  mega: 0.55,
  giant: 0.42,
});

const EVENT_DRIFT = Object.freeze({
  earnings_beat: 0.00016,
  earnings_inline: 0.00001,
  earnings_miss: -0.00016,
  share_buyback: 0.00012,
  rights_offering: -0.00014,
  short_squeeze: 0.00024,
});

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function pickWeighted(items) {
  let cursor = Math.random() * items.reduce((sum, item) => sum + item.weight, 0);
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return items.at(-1);
}

function pickRegime(probabilities) {
  let cursor = Math.random();
  for (const [regime, probability] of Object.entries(probabilities)) {
    cursor -= probability;
    if (cursor <= 0) return regime;
  }
  return "sideways";
}

function nowIso(nowMs = Date.now()) {
  return new Date(nowMs).toISOString();
}

function toMs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function marketCapTrendTier(marketCap) {
  const cap = Math.max(0, Number(marketCap) || 0);
  if (cap < 5_000_000_000) return "danger_micro";
  if (cap < 10_000_000_000) return "micro";
  if (cap < 30_000_000_000) return "small";
  if (cap < 100_000_000_000) return "small_mid";
  if (cap < 500_000_000_000) return "mid";
  if (cap < 2_000_000_000_000) return "large";
  if (cap < 50_000_000_000_000) return "mega";
  return "giant";
}

export function getMarketRegime(db, nowMs = Date.now()) {
  return db.prepare(`
    SELECT * FROM market_regimes
    WHERE ends_at > ?
    ORDER BY id DESC
    LIMIT 1
  `).get(nowIso(nowMs)) || null;
}

export function ensureMarketRegime(db, nowMs = Date.now()) {
  const active = getMarketRegime(db, nowMs);
  if (active) return active;
  const picked = pickWeighted(MARKET_REGIME_OPTIONS);
  const minutes = Math.floor(randomBetween(60, 360));
  const startedAt = nowIso(nowMs);
  const endsAt = nowIso(nowMs + minutes * 60_000);
  const result = db.prepare(`
    INSERT INTO market_regimes (market_regime, strength, started_at, ends_at)
    VALUES (?, ?, ?, ?)
  `).run(picked.marketRegime, picked.strength, startedAt, endsAt);
  return db.prepare("SELECT * FROM market_regimes WHERE id = ?").get(result.lastInsertRowid);
}

export function getMarketRegimeModifier(marketRegime) {
  const regime = marketRegime?.market_regime || marketRegime?.marketRegime || "sideways";
  if (regime === "strong_bull") return 0.000025;
  if (regime === "bull") return 0.000012;
  if (regime === "bear") return -0.000012;
  if (regime === "panic") return -0.000025;
  return 0;
}

function shouldSkipTrend(stock) {
  return stock?.is_etf === 1 ||
    stock?.status === "ipo_subscription" ||
    stock?.delist_risk_status === "final_crash" ||
    stock?.admin_price_target_active === 1 ||
    stock?.blue_chip_ramp_active === 1;
}

export function ensureStockTrendRegime(db, stock, nowMs = Date.now()) {
  if (shouldSkipTrend(stock)) return null;
  const currentCap = Math.max(1, Math.floor(Number(stock.market_cap) || 1));
  const previousEma = Math.max(1, Math.floor(Number(stock.market_cap_ema_24h) || currentCap));
  const nextEma = Math.max(1, Math.floor(previousEma * 0.95 + currentCap * 0.05));
  const effectiveCap = Math.max(1, Math.floor(currentCap * 0.3 + nextEma * 0.7));
  const isCurrent = stock.trend_regime && toMs(stock.trend_regime_ends_at) > nowMs;

  if (isCurrent) {
    db.prepare(`
      UPDATE stocks
      SET market_cap_ema_24h = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(nextEma, stock.id);
    return {
      regime: stock.trend_regime,
      driftPerTick: Number(stock.trend_drift_per_tick || 0),
      volatility: Number(stock.trend_volatility || stock.volatility || 0),
      marketCapBasis: Number(stock.trend_market_cap_basis || effectiveCap),
      marketCapEma24h: nextEma,
    };
  }

  const tier = marketCapTrendTier(effectiveCap);
  const regime = pickRegime(TREND_REGIME_PROBABILITIES[tier]);
  const range = TREND_DRIFT_PER_TICK[regime];
  const driftPerTick = randomBetween(range.min, range.max);
  const baseVolatility = Math.max(0.00002, Math.min(0.004, Number(stock.volatility || 0.02) * 0.06));
  const volatility = Math.max(
    0.00002,
    Math.min(0.004, baseVolatility * (TIER_VOLATILITY_MULTIPLIER[tier] || 1)),
  );
  const durationMinutes = Math.floor(randomBetween(
    TREND_DURATION_MINUTES.min,
    TREND_DURATION_MINUTES.max + 1,
  ));
  const startedAt = nowIso(nowMs);
  const endsAt = nowIso(nowMs + durationMinutes * 60_000);

  db.prepare(`
    UPDATE stocks
    SET market_cap_ema_24h = ?, trend_regime = ?, trend_regime_started_at = ?,
        trend_regime_ends_at = ?, trend_market_cap_basis = ?, trend_drift_per_tick = ?,
        trend_volatility = ?, market_cap_tier_started_at = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(nextEma, regime, startedAt, endsAt, effectiveCap, driftPerTick, volatility, startedAt, stock.id);

  return { regime, driftPerTick, volatility, marketCapBasis: effectiveCap, marketCapEma24h: nextEma };
}

export function getActiveCorporateEventModifier(db, stockId, nowMs = Date.now()) {
  const now = nowIso(nowMs);
  const events = db.prepare(`
    SELECT event_type FROM stock_corporate_events
    WHERE stock_id = ? AND status = 'active'
      AND (ends_at IS NULL OR ends_at > ?)
  `).all(stockId, now);
  return events.reduce((sum, event) => sum + (EVENT_DRIFT[event.event_type] || 0), 0);
}

export function calculateTrendMoveRate(db, stock, { marketRegime, sectorModifier = 0, nowMs = Date.now() } = {}) {
  const trend = ensureStockTrendRegime(db, stock, nowMs);
  if (!trend) return null;
  const noise = randomBetween(-trend.volatility, trend.volatility);
  const eventModifier = getActiveCorporateEventModifier(db, stock.id, nowMs);
  const marketModifier = getMarketRegimeModifier(marketRegime);
  const panicMultiplier = (marketRegime?.market_regime || marketRegime?.marketRegime) === "panic"
    ? (marketCapTrendTier(trend.marketCapBasis) === "danger_micro" || marketCapTrendTier(trend.marketCapBasis) === "micro" ? 1.7 : 1.15)
    : 1;
  return (trend.driftPerTick + noise * panicMultiplier + sectorModifier + marketModifier + eventModifier);
}

function eventDurationMs() {
  return Math.floor(randomBetween(30, 121)) * 60_000;
}

function emitCorporateNews(db, stock, eventType, title, message, metadata = {}) {
  db.prepare(`
    INSERT INTO stock_events (stock_id, event_type, title, message, metadata_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(stock.id, eventType, title, message, JSON.stringify(metadata));
  createServerNotification(db, {
    type: eventType,
    title,
    message,
    gameType: "stock",
    gameName: "주식",
    metadata: { stockId: stock.id, symbol: stock.symbol, ...metadata },
  });
}

function scheduleOneCorporateEvent(db, nowMs = Date.now()) {
  const last = Number(db.prepare("SELECT value FROM system_config WHERE key = 'stock_corporate_event_last_at'").get()?.value || 0);
  if (nowMs - last < 20 * 60_000 || Math.random() > 0.22) return null;
  db.prepare(`
    INSERT INTO system_config (key, value) VALUES ('stock_corporate_event_last_at', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(nowMs));

  const candidates = db.prepare(`
    SELECT * FROM stocks
    WHERE status IN ('listed', 'newly_listed') AND is_etf = 0
      AND is_trading_suspended = 0
    ORDER BY RANDOM() LIMIT 1
  `).all();
  const stock = candidates[0];
  if (!stock) return null;
  const roll = Math.random();
  const now = nowIso(nowMs);

  if (roll < 0.42) {
    const surprise = randomBetween(-0.35, 0.45);
    const expectedProfit = Math.max(1, Math.floor(stock.market_cap * randomBetween(0.003, 0.015)));
    const actualProfit = Math.max(0, Math.floor(expectedProfit * (1 + surprise)));
    const eventType = surprise >= 0.08 ? "earnings_beat" : surprise <= -0.08 ? "earnings_miss" : "earnings_inline";
    const title = eventType === "earnings_beat" ? "어닝 서프라이즈" : eventType === "earnings_miss" ? "실적 부진" : "실적 발표";
    const result = db.prepare(`
      INSERT INTO stock_corporate_events
        (stock_id, event_type, status, expected_revenue, actual_revenue, expected_profit, actual_profit, surprise_rate, starts_at, ends_at, applied_at)
      VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(stock.id, eventType, expectedProfit * 8, actualProfit * 8, expectedProfit, actualProfit, surprise, now, nowIso(nowMs + eventDurationMs()), now);
    emitCorporateNews(db, stock, eventType, title, `${stock.name}의 실적 발표가 반영됐어요. 시장 예상 대비 ${(surprise * 100).toFixed(1)}%입니다.`, { corporateEventId: result.lastInsertRowid, surpriseRate: surprise });
    return result.lastInsertRowid;
  }

  if (roll < 0.62) {
    const dividendRate = randomBetween(0.002, 0.015);
    const recordAt = nowIso(nowMs + 20 * 60_000);
    const payAt = nowIso(nowMs + 40 * 60_000);
    const result = db.prepare(`
      INSERT INTO stock_corporate_events
        (stock_id, event_type, status, dividend_rate, record_at, pay_at)
      VALUES (?, 'dividend', 'scheduled', ?, ?, ?)
    `).run(stock.id, dividendRate, recordAt, payAt);
    emitCorporateNews(db, stock, "dividend", "배당 예정", `${stock.name}이 배당 기준일과 예상 배당률을 공지했어요.`, { corporateEventId: result.lastInsertRowid, dividendRate, recordAt, payAt });
    return result.lastInsertRowid;
  }

  const eventType = roll < 0.82 ? "share_buyback" : "rights_offering";
  const title = eventType === "share_buyback" ? "자사주 매입" : "유상증자";
  const result = db.prepare(`
    INSERT INTO stock_corporate_events (stock_id, event_type, status, starts_at, ends_at, applied_at)
    VALUES (?, ?, 'active', ?, ?, ?)
  `).run(stock.id, eventType, now, nowIso(nowMs + eventDurationMs()), now);
  emitCorporateNews(db, stock, eventType, title,
    eventType === "share_buyback" ? `${stock.name}이 자사주 매입 계획을 발표했어요.` : `${stock.name}이 자금 확보를 위해 유상증자를 결정했어요.`,
    { corporateEventId: result.lastInsertRowid });
  return result.lastInsertRowid;
}

function recordDueDividends(db, nowMs) {
  const now = nowIso(nowMs);
  const events = db.prepare(`
    SELECT e.*, s.current_price, s.name, s.symbol
    FROM stock_corporate_events e JOIN stocks s ON s.id = e.stock_id
    WHERE e.event_type = 'dividend' AND e.status = 'scheduled' AND e.record_at <= ?
  `).all(now);
  for (const event of events) {
    const holdings = db.prepare(`
      SELECT user_id, quantity FROM stock_holdings WHERE stock_id = ? AND quantity > 0
    `).all(event.stock_id);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO stock_dividend_entitlements
        (corporate_event_id, user_id, stock_id, quantity, record_price, payout_amount)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const holding of holdings) {
      const payout = Math.max(0, Math.floor(Number(holding.quantity) * Number(event.current_price) * Number(event.dividend_rate || 0)));
      if (payout > 0) insert.run(event.id, holding.user_id, event.stock_id, holding.quantity, event.current_price, payout);
    }
    db.prepare("UPDATE stock_corporate_events SET status = 'recorded', updated_at = ? WHERE id = ?").run(now, event.id);
  }
}

function payDueDividends(db, nowMs) {
  const now = nowIso(nowMs);
  const events = db.prepare(`
    SELECT * FROM stock_corporate_events
    WHERE event_type = 'dividend' AND status = 'recorded' AND pay_at <= ?
  `).all(now);
  for (const event of events) {
    const rows = db.prepare(`
      SELECT d.*, u.balance FROM stock_dividend_entitlements d
      JOIN users u ON u.id = d.user_id
      WHERE d.corporate_event_id = ? AND d.paid_at IS NULL
    `).all(event.id);
    for (const row of rows) {
      const amount = Math.max(0, Math.floor(Number(row.payout_amount || 0)));
      if (amount <= 0) continue;
      const balanceAfter = Number(row.balance) + amount;
      db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(balanceAfter, row.user_id);
      db.prepare(`
        INSERT OR IGNORE INTO asset_events
          (user_id, event_type, amount, balance_before, balance_after, source_type, source_id, detail_json)
        VALUES (?, 'stock_dividend', ?, ?, ?, 'stock_dividend', ?, ?)
      `).run(row.user_id, amount, row.balance, balanceAfter, `${event.id}:${row.user_id}`, JSON.stringify({ corporateEventId: event.id, stockId: event.stock_id }));
      db.prepare("UPDATE stock_dividend_entitlements SET paid_at = ? WHERE id = ?").run(now, row.id);
    }
    db.prepare("UPDATE stock_corporate_events SET status = 'paid', updated_at = ? WHERE id = ?").run(now, event.id);
  }
}

function closeExpiredCorporateEvents(db, nowMs) {
  const now = nowIso(nowMs);
  db.prepare(`
    UPDATE stock_corporate_events
    SET status = 'completed', updated_at = ?
    WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= ?
  `).run(now, now);
}

export function processCorporateEvents(db, nowMs = Date.now()) {
  recordDueDividends(db, nowMs);
  payDueDividends(db, nowMs);
  closeExpiredCorporateEvents(db, nowMs);
  return scheduleOneCorporateEvent(db, nowMs);
}

export function releaseExpiredTradingHalts(db, nowMs = Date.now()) {
  const now = nowIso(nowMs);
  const released = db.prepare(`
    SELECT * FROM stocks
    WHERE is_trading_suspended = 1 AND trading_halted_until IS NOT NULL AND trading_halted_until <= ?
  `).all(now);
  for (const stock of released) {
    db.prepare(`
      UPDATE stocks SET is_trading_suspended = 0, trading_halted_until = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
    `).run(stock.id);
    emitCorporateNews(db, stock, "volatility_halt_released", "거래 재개", `${stock.name}의 변동성 완화장치가 해제됐어요.`);
  }
  return released.length;
}

export function maybeTriggerVolatilityHalt(db, stock, nowMs = Date.now()) {
  if (!stock || stock.is_trading_suspended || stock.is_etf === 1 || stock.status === "ipo_subscription") return false;
  const now = nowIso(nowMs);
  const reference = db.prepare(`
    SELECT price FROM stock_price_history
    WHERE stock_id = ? AND created_at >= datetime(?, '-5 minutes')
    ORDER BY created_at ASC LIMIT 1
  `).get(stock.id, now);
  if (!reference || Number(reference.price) <= 0) return false;
  const changeRate = Math.abs((Number(stock.current_price) - Number(reference.price)) / Number(reference.price));
  if (changeRate < 0.50) return false; // 변동성 완화장치 발동 기준을 30%에서 50%로 완화
  const haltSeconds = Math.floor(randomBetween(30, 121));
  const haltUntil = nowIso(nowMs + haltSeconds * 1000);
  db.prepare(`
    UPDATE stocks SET is_trading_suspended = 1, trading_halted_until = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
  `).run(haltUntil, stock.id);
  emitCorporateNews(db, stock, "volatility_halt", "변동성 완화장치 발동", `${stock.name}이 5분 동안 ${(changeRate * 100).toFixed(1)}% 움직여 거래를 잠시 멈췄어요.`, { haltUntil, changeRate });
  return true;
}

export function maybeTriggerShortSqueeze(db, stock, nowMs = Date.now()) {
  if (!stock || stock.is_etf === 1 || stock.is_trading_suspended) return false;
  const existing = db.prepare(`
    SELECT 1 FROM stock_corporate_events
    WHERE stock_id = ? AND event_type = 'short_squeeze' AND status = 'active'
      AND ends_at > ? LIMIT 1
  `).get(stock.id, nowIso(nowMs));
  if (existing) return false;
  const shortValue = db.prepare(`
    SELECT COALESCE(SUM(position_size), 0) AS value
    FROM stock_positions WHERE stock_id = ? AND side = 'short' AND status = 'open'
  `).get(stock.id)?.value || 0;
  const shortInterestRatio = Number(shortValue) / Math.max(1, Number(stock.market_cap || 1));
  const reference = db.prepare(`
    SELECT price FROM stock_price_history
    WHERE stock_id = ? AND created_at >= datetime(?, '-5 minutes')
    ORDER BY created_at ASC LIMIT 1
  `).get(stock.id, nowIso(nowMs));
  const gainRate = reference?.price > 0 ? (Number(stock.current_price) - Number(reference.price)) / Number(reference.price) : 0;
  const increasedVolume = db.prepare(`
    SELECT COUNT(*) AS count FROM stock_trades
    WHERE stock_id = ? AND created_at >= datetime(?, '-5 minutes')
  `).get(stock.id, nowIso(nowMs))?.count >= 3;
  if (shortInterestRatio < 0.20 || gainRate < 0.10 || !increasedVolume || Math.random() > 0.18) return false;
  const endsAt = nowIso(nowMs + Math.floor(randomBetween(5, 16)) * 60_000);
  const result = db.prepare(`
    INSERT INTO stock_corporate_events (stock_id, event_type, status, starts_at, ends_at, applied_at, metadata_json)
    VALUES (?, 'short_squeeze', 'active', ?, ?, ?, ?)
  `).run(stock.id, nowIso(nowMs), endsAt, nowIso(nowMs), JSON.stringify({ shortInterestRatio, gainRate }));
  emitCorporateNews(db, stock, "short_squeeze", "숏스퀴즈 발생", `${stock.name}에 숏스퀴즈가 발생했어요. 공매도 포지션의 연쇄 정산 위험이 커지고 있어요.`, { corporateEventId: result.lastInsertRowid, shortInterestRatio, gainRate, endsAt });
  return true;
}
