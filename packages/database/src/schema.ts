import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const userRole = pgEnum("user_role", ["user", "admin"]);
export const companyStatus = pgEnum("company_status", ["private", "ipo", "listed", "suspended", "delisted"]);
export const orderSide = pgEnum("order_side", ["buy", "sell"]);
export const orderType = pgEnum("order_type", ["market", "limit", "stop"]);
export const orderStatus = pgEnum("order_status", ["pending", "open", "partially_filled", "filled", "cancelled", "rejected"]);
export const timeInForce = pgEnum("time_in_force", ["GTC", "IOC"]);
export const positionSide = pgEnum("position_side", ["long", "short"]);
export const positionStatus = pgEnum("position_status", ["open", "closing", "closed", "liquidated"]);
export const orderPurpose = pgEnum("order_purpose", ["spot", "leverage_close", "liquidation"]);
export const squeezeStatus = pgEnum("squeeze_status", ["active", "ended"]);
export const marketRegimeType = pgEnum("market_regime_type", ["strong_bull", "bull", "sideways", "bear", "fear", "recovery"]);
export const managementActionType = pgEnum("management_action_type", [
  "set_dividend", "invest_rd", "invest_marketing", "invest_capex", "repay_debt", "borrow",
  "buyback_proposal", "rights_issue_proposal", "sell_division", "enter_business", "replace_ceo", "cost_cutting",
]);
export const mnaCampaignStatus = pgEnum("mna_campaign_status", ["tendering", "proxy_vote", "resolved", "failed", "cancelled"]);
export const mnaSide = pgEnum("mna_side", ["attacker", "defender"]);
export const strategyStatus = pgEnum("strategy_status", ["DRAFT", "BACKTEST", "PAPER", "LIVE_VIRTUAL", "PAUSED"]);
export const strategyExecutionMode = pgEnum("strategy_execution_mode", ["PAPER", "LIVE_VIRTUAL"]);
export const strategyExecutionStatus = pgEnum("strategy_execution_status", ["skipped", "submitted", "filled", "failed"]);
export const stockAssetType = pgEnum("stock_asset_type", ["common", "user_etf", "etf_leverage", "etf_derivative"]);
export const valuationCycleStatus = pgEnum("valuation_cycle_status", ["running", "completed", "failed"]);
export const listingStatus = pgEnum("listing_status", ["normal", "warning", "distress_review", "delisting_review", "halted", "delisted"]);
export const ipoStatus = pgEnum("ipo_status", ["announced", "subscription", "allocated", "listed", "cancelled"]);
export const dividendStatus = pgEnum("dividend_status", ["declared", "paid", "cancelled"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  username: text("username").notNull(),
  nickname: text("nickname").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull().default("user"),
  cash: bigint("cash", { mode: "bigint" }).notNull().default(sql`100000000`),
  reservedCash: bigint("reserved_cash", { mode: "bigint" }).notNull().default(sql`0`),
  isActive: boolean("is_active").notNull().default(true),
  isSystem: boolean("is_system").notNull().default(false),
  ...timestamps,
}, (table) => [
  uniqueIndex("users_email_unique").on(table.email),
  uniqueIndex("users_username_unique").on(table.username),
  uniqueIndex("users_nickname_unique").on(table.nickname),
  check("users_cash_nonnegative", sql`${table.cash} >= 0`),
  check("users_reserved_cash_valid", sql`${table.reservedCash} >= 0 AND ${table.reservedCash} <= ${table.cash}`),
]);

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  priceColorMode: text("price_color_mode").notNull().default("korean"),
  locale: text("locale").notNull().default("ko-KR"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("user_preferences_values_valid", sql`${table.priceColorMode} IN ('korean','global') AND ${table.locale} IN ('ko-KR','en-US')`)]);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("notifications_user_read_created_idx").on(table.userId, table.readAt, table.createdAt)]);

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  familyId: uuid("family_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  replacedById: uuid("replaced_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("refresh_tokens_hash_unique").on(table.tokenHash),
  index("refresh_tokens_user_idx").on(table.userId),
  index("refresh_tokens_family_idx").on(table.familyId),
]);

export const loginEvents = pgTable("login_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  email: text("email").notNull(),
  succeeded: boolean("succeeded").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("login_events_email_created_idx").on(table.email, table.createdAt), index("login_events_user_created_idx").on(table.userId, table.createdAt)]);

export const securityEvents = pgTable("security_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  eventType: text("event_type").notNull(),
  severity: text("severity").notNull().default("info"),
  ipAddress: text("ip_address"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("security_events_type_created_idx").on(table.eventType, table.createdAt),
  check("security_events_severity_valid", sql`${table.severity} IN ('info','warning','critical')`),
]);

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const seasons = pgTable("seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(false),
  startedByUserId: uuid("started_by_user_id").notNull().references(() => users.id),
  endedByUserId: uuid("ended_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("seasons_one_active").on(sql`((1))`).where(sql`${table.isActive}=true`),
  check("seasons_dates_valid", sql`${table.endsAt} IS NULL OR ${table.endsAt} >= ${table.startsAt}`),
]);

export const sectors = pgTable("sectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
}, (table) => [uniqueIndex("sectors_slug_unique").on(table.slug)]);

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  sectorId: uuid("sector_id").notNull().references(() => sectors.id),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: companyStatus("status").notNull().default("private"),
  cash: bigint("cash", { mode: "bigint" }).notNull().default(sql`0`),
  debt: bigint("debt", { mode: "bigint" }).notNull().default(sql`0`),
  revenue: bigint("revenue", { mode: "bigint" }).notNull().default(sql`0`),
  operatingProfit: bigint("operating_profit", { mode: "bigint" }).notNull().default(sql`0`),
  netProfit: bigint("net_profit", { mode: "bigint" }).notNull().default(sql`0`),
  bookValue: bigint("book_value", { mode: "bigint" }).notNull().default(sql`0`),
  growthRateBps: integer("growth_rate_bps").notNull().default(0),
  brandValue: bigint("brand_value", { mode: "bigint" }).notNull().default(sql`0`),
  technologyScore: integer("technology_score").notNull().default(50),
  riskScore: integer("risk_score").notNull().default(50),
  dividendRateBps: integer("dividend_rate_bps").notNull().default(0),
  controlledByUserId: uuid("controlled_by_user_id").references(() => users.id),
  controlledAt: timestamp("controlled_at", { withTimezone: true }),
  management: jsonb("management").notNull().default({}),
  ...timestamps,
}, (table) => [
  check("companies_cash_nonnegative", sql`${table.cash} >= 0`),
  check("companies_debt_nonnegative", sql`${table.debt} >= 0`),
  check("companies_scores_valid", sql`${table.growthRateBps} BETWEEN -10000 AND 100000 AND ${table.brandValue} >= 0 AND ${table.technologyScore} BETWEEN 0 AND 1000 AND ${table.riskScore} BETWEEN 0 AND 1000 AND ${table.dividendRateBps} BETWEEN 0 AND 10000`),
]);

export const stocks = pgTable("stocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  symbol: text("symbol").notNull(),
  totalShares: bigint("total_shares", { mode: "bigint" }).notNull(),
  freeFloatShares: bigint("free_float_shares", { mode: "bigint" }).notNull(),
  treasuryShares: bigint("treasury_shares", { mode: "bigint" }).notNull().default(sql`0`),
  currentPrice: bigint("current_price", { mode: "bigint" }).notNull(),
  previousClose: bigint("previous_close", { mode: "bigint" }).notNull(),
  referencePrice: bigint("reference_price", { mode: "bigint" }).notNull(),
  tickSize: bigint("tick_size", { mode: "bigint" }).notNull().default(sql`1`),
  initialMarketCap: bigint("initial_market_cap", { mode: "bigint" }).notNull().default(sql`0`),
  marketCapEma24h: bigint("market_cap_ema_24h", { mode: "bigint" }).notNull().default(sql`0`),
  marketCapEma7d: bigint("market_cap_ema_7d", { mode: "bigint" }).notNull().default(sql`0`),
  stabilityMarketCap: bigint("stability_market_cap", { mode: "bigint" }).notNull().default(sql`0`),
  stabilityTier: text("stability_tier").notNull().default("SMALL"),
  stabilityTierEnteredAt: timestamp("stability_tier_entered_at", { withTimezone: true }).notNull().defaultNow(),
  stabilityTierCandidate: text("stability_tier_candidate"),
  stabilityTierCandidateSince: timestamp("stability_tier_candidate_since", { withTimezone: true }),
  lastStabilityUpdateAt: timestamp("last_stability_update_at", { withTimezone: true }).notNull().defaultNow(),
  isBlueChip: boolean("is_blue_chip").notNull().default(false),
  trendRegime: text("trend_regime").notNull().default("SIDEWAYS"),
  trendStartedAt: timestamp("trend_started_at", { withTimezone: true }).notNull().defaultNow(),
  trendEndsAt: timestamp("trend_ends_at", { withTimezone: true }).notNull().defaultNow(),
  trendStrengthBps: integer("trend_strength_bps").notNull().default(0),
  trendSource: text("trend_source").notNull().default("tier_probability"),
  trendStabilityTier: text("trend_stability_tier").notNull().default("SMALL"),
  fundamentalFairValue: bigint("fundamental_fair_value", { mode: "bigint" }).notNull().default(sql`0`),
  fairValueUpdatedAt: timestamp("fair_value_updated_at", { withTimezone: true }).notNull().defaultNow(),
  fairValueConfidenceBps: integer("fair_value_confidence_bps").notNull().default(5_000),
  dailyAnchorPrice: bigint("daily_anchor_price", { mode: "bigint" }).notNull().default(sql`0`),
  dailyAnchorAt: timestamp("daily_anchor_at", { withTimezone: true }).notNull().defaultNow(),
  dailyChangeBps: integer("daily_change_bps").notNull().default(0),
  targetDailyVolatilityBps: integer("target_daily_volatility_bps").notNull().default(2_000),
  distressScore: integer("distress_score").notNull().default(0),
  distressComponents: jsonb("distress_components").notNull().default({}),
  circuitBreakerUntil: timestamp("circuit_breaker_until", { withTimezone: true }),
  circuitBreakerReason: text("circuit_breaker_reason"),
  circuitBreakerCount: integer("circuit_breaker_count").notNull().default(0),
  postHaltCoolingUntil: timestamp("post_halt_cooling_until", { withTimezone: true }),
  assetType: stockAssetType("asset_type").notNull().default("common"),
  listingStatus: listingStatus("listing_status").notNull().default("normal"),
  listingStatusReason: text("listing_status_reason"),
  listingReviewEndsAt: timestamp("listing_review_ends_at", { withTimezone: true }),
  isTradingHalted: boolean("is_trading_halted").notNull().default(false),
  ...timestamps,
}, (table) => [
  uniqueIndex("stocks_symbol_unique").on(table.symbol),
  check("stocks_share_counts_valid", sql`${table.totalShares} > 0 AND ${table.freeFloatShares} >= 0 AND ${table.treasuryShares} >= 0 AND ${table.freeFloatShares} + ${table.treasuryShares} <= ${table.totalShares}`),
  check("stocks_prices_positive", sql`${table.currentPrice} > 0 AND ${table.previousClose} > 0 AND ${table.referencePrice} > 0 AND ${table.tickSize} > 0`),
  check("stocks_stability_caps_positive", sql`${table.initialMarketCap} > 0 AND ${table.marketCapEma24h} > 0 AND ${table.marketCapEma7d} > 0 AND ${table.stabilityMarketCap} > 0 AND ${table.fundamentalFairValue} > 0 AND ${table.dailyAnchorPrice} > 0`),
  check("stocks_stability_tiers_valid", sql`${table.stabilityTier} IN ('BLUE_CHIP','GIANT','MEGA','LARGE','MID','SMALL','DELIST_RISK') AND ${table.trendStabilityTier} IN ('BLUE_CHIP','GIANT','MEGA','LARGE','MID','SMALL','DELIST_RISK') AND (${table.stabilityTierCandidate} IS NULL OR ${table.stabilityTierCandidate} IN ('BLUE_CHIP','GIANT','MEGA','LARGE','MID','SMALL','DELIST_RISK'))`),
  check("stocks_trend_regime_valid", sql`${table.trendRegime} IN ('BULL','SIDEWAYS','BEAR') AND ${table.trendEndsAt} >= ${table.trendStartedAt}`),
  check("stocks_stability_metrics_valid", sql`${table.fairValueConfidenceBps} BETWEEN 0 AND 10000 AND ${table.targetDailyVolatilityBps} BETWEEN 0 AND 10000 AND ${table.distressScore} BETWEEN 0 AND 700 AND ${table.circuitBreakerCount} >= 0`),
]);

export const priceGuardEvents = pgTable("price_guard_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  stockId: uuid("stock_id").notNull().references(() => stocks.id),
  eventType: text("event_type").notNull(),
  triggeredBy: text("triggered_by").notNull().default("system"),
  referencePrice: bigint("reference_price", { mode: "bigint" }).notNull(),
  observedPrice: bigint("observed_price", { mode: "bigint" }).notNull(),
  protectedPrice: bigint("protected_price", { mode: "bigint" }).notNull(),
  change5mBps: integer("change_5m_bps"),
  change30mBps: integer("change_30m_bps"),
  metadata: jsonb("metadata").notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
}, (table) => [
  index("price_guard_events_stock_started_idx").on(table.stockId, table.startedAt),
  check("price_guard_event_prices_positive", sql`${table.referencePrice} > 0 AND ${table.observedPrice} > 0 AND ${table.protectedPrice} > 0`),
]);

export const ipoCampaigns = pgTable("ipo_campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  symbol: text("symbol").notNull(),
  description: text("description").notNull(),
  status: ipoStatus("status").notNull().default("announced"),
  offerPrice: bigint("offer_price", { mode: "bigint" }).notNull(),
  totalShares: bigint("total_shares", { mode: "bigint" }).notNull(),
  offeredShares: bigint("offered_shares", { mode: "bigint" }).notNull(),
  subscriptionStartsAt: timestamp("subscription_starts_at", { withTimezone: true }).notNull(),
  subscriptionEndsAt: timestamp("subscription_ends_at", { withTimezone: true }).notNull(),
  listingAt: timestamp("listing_at", { withTimezone: true }).notNull(),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ipo_campaigns_symbol_unique").on(table.symbol),
  uniqueIndex("ipo_campaigns_company_active_unique").on(table.companyId).where(sql`${table.status} <> 'cancelled'`),
  index("ipo_campaigns_status_deadline_idx").on(table.status, table.subscriptionStartsAt, table.subscriptionEndsAt, table.listingAt),
  check("ipo_campaign_values_valid", sql`${table.offerPrice} > 0 AND ${table.totalShares} > 0 AND ${table.offeredShares} > 0 AND ${table.offeredShares} <= ${table.totalShares} AND ${table.subscriptionEndsAt} > ${table.subscriptionStartsAt} AND ${table.listingAt} >= ${table.subscriptionEndsAt}`),
]);

export const ipoSubscriptions = pgTable("ipo_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => ipoCampaigns.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  requestedQuantity: bigint("requested_quantity", { mode: "bigint" }).notNull(),
  allocatedQuantity: bigint("allocated_quantity", { mode: "bigint" }).notNull().default(sql`0`),
  reservedAmount: bigint("reserved_amount", { mode: "bigint" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ipo_subscriptions_campaign_user_unique").on(table.campaignId, table.userId),
  check("ipo_subscriptions_values_valid", sql`${table.requestedQuantity} > 0 AND ${table.allocatedQuantity} >= 0 AND ${table.allocatedQuantity} <= ${table.requestedQuantity} AND ${table.reservedAmount} >= 0`),
]);

export const valuationCycles = pgTable("valuation_cycles", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: valuationCycleStatus("status").notNull().default("running"),
  sourceCycleId: uuid("source_cycle_id"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  error: text("error"),
});

export const userValuationSnapshots = pgTable("user_valuation_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  cycleId: uuid("cycle_id").notNull().references(() => valuationCycles.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  cash: bigint("cash", { mode: "bigint" }).notNull(),
  eligibleAssetValue: bigint("eligible_asset_value", { mode: "bigint" }).notNull(),
  totalAssetValue: bigint("total_asset_value", { mode: "bigint" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("user_valuation_snapshots_cycle_user_unique").on(table.cycleId, table.userId),
  index("user_valuation_snapshots_user_created_idx").on(table.userId, table.createdAt),
  check("user_valuation_snapshots_values_valid", sql`${table.cash} >= 0 AND ${table.eligibleAssetValue} >= 0 AND ${table.totalAssetValue} >= 0 AND ${table.eligibleAssetValue} <= ${table.totalAssetValue}`),
]);

export const etfProducts = pgTable("etf_products", {
  stockId: uuid("stock_id").primaryKey().references(() => stocks.id),
  trackedUserId: uuid("tracked_user_id").notNull().references(() => users.id),
  baseEligibleAssetValue: bigint("base_eligible_asset_value", { mode: "bigint" }).notNull(),
  basePrice: bigint("base_price", { mode: "bigint" }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("etf_products_tracked_user_unique").on(table.trackedUserId),
  check("etf_products_base_valid", sql`${table.baseEligibleAssetValue} > 0 AND ${table.basePrice} > 0`),
]);

export const etfValuations = pgTable("etf_valuations", {
  id: uuid("id").primaryKey().defaultRandom(),
  cycleId: uuid("cycle_id").notNull().references(() => valuationCycles.id),
  sourceCycleId: uuid("source_cycle_id").notNull().references(() => valuationCycles.id),
  stockId: uuid("stock_id").notNull().references(() => stocks.id),
  trackedUserId: uuid("tracked_user_id").notNull().references(() => users.id),
  sourceEligibleAssetValue: bigint("source_eligible_asset_value", { mode: "bigint" }).notNull(),
  calculatedPrice: bigint("calculated_price", { mode: "bigint" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("etf_valuations_cycle_stock_unique").on(table.cycleId, table.stockId),
  index("etf_valuations_stock_created_idx").on(table.stockId, table.createdAt),
  check("etf_valuations_values_valid", sql`${table.sourceEligibleAssetValue} >= 0 AND ${table.calculatedPrice} > 0 AND ${table.cycleId} <> ${table.sourceCycleId}`),
]);

export const holdings = pgTable("holdings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  stockId: uuid("stock_id").notNull().references(() => stocks.id),
  quantity: bigint("quantity", { mode: "bigint" }).notNull().default(sql`0`),
  reservedQuantity: bigint("reserved_quantity", { mode: "bigint" }).notNull().default(sql`0`),
  costBasis: bigint("cost_basis", { mode: "bigint" }).notNull().default(sql`0`),
  realizedPnl: bigint("realized_pnl", { mode: "bigint" }).notNull().default(sql`0`),
  ...timestamps,
}, (table) => [
  uniqueIndex("holdings_user_stock_unique").on(table.userId, table.stockId),
  check("holdings_quantities_valid", sql`${table.quantity} >= 0 AND ${table.reservedQuantity} >= 0 AND ${table.reservedQuantity} <= ${table.quantity}`),
  check("holdings_cost_basis_nonnegative", sql`${table.costBasis} >= 0`),
]);

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  stockId: uuid("stock_id").notNull().references(() => stocks.id),
  idempotencyKey: uuid("idempotency_key").notNull(),
  side: orderSide("side").notNull(),
  type: orderType("type").notNull(),
  purpose: orderPurpose("purpose").notNull().default("spot"),
  positionId: uuid("position_id"),
  timeInForce: timeInForce("time_in_force").notNull().default("GTC"),
  status: orderStatus("status").notNull().default("pending"),
  limitPrice: bigint("limit_price", { mode: "bigint" }),
  stopPrice: bigint("stop_price", { mode: "bigint" }),
  quantity: bigint("quantity", { mode: "bigint" }).notNull(),
  filledQuantity: bigint("filled_quantity", { mode: "bigint" }).notNull().default(sql`0`),
  reservedAmount: bigint("reserved_amount", { mode: "bigint" }).notNull().default(sql`0`),
  sequence: bigserial("sequence", { mode: "bigint" }).notNull(),
  rejectedReason: text("rejected_reason"),
  ...timestamps,
}, (table) => [
  uniqueIndex("orders_user_idempotency_unique").on(table.userId, table.idempotencyKey),
  index("orders_book_idx").on(table.stockId, table.status, table.side, table.limitPrice, table.sequence),
  index("orders_cancelled_cleanup_idx").on(table.updatedAt).where(sql`${table.status} = 'cancelled' AND ${table.filledQuantity} = 0`),
  check("orders_quantity_valid", sql`${table.quantity} > 0 AND ${table.filledQuantity} >= 0 AND ${table.filledQuantity} <= ${table.quantity}`),
  check("orders_prices_valid", sql`(${table.limitPrice} IS NULL OR ${table.limitPrice} > 0) AND (${table.stopPrice} IS NULL OR ${table.stopPrice} > 0)`),
  check("orders_reserved_amount_nonnegative", sql`${table.reservedAmount} >= 0`),
]);

export const trades = pgTable("trades", {
  id: uuid("id").primaryKey().defaultRandom(),
  stockId: uuid("stock_id").notNull().references(() => stocks.id),
  buyOrderId: uuid("buy_order_id").notNull().references(() => orders.id),
  sellOrderId: uuid("sell_order_id").notNull().references(() => orders.id),
  buyerUserId: uuid("buyer_user_id").notNull().references(() => users.id),
  sellerUserId: uuid("seller_user_id").notNull().references(() => users.id),
  takerSide: orderSide("taker_side").notNull(),
  price: bigint("price", { mode: "bigint" }).notNull(),
  quantity: bigint("quantity", { mode: "bigint" }).notNull(),
  buyerFee: bigint("buyer_fee", { mode: "bigint" }).notNull().default(sql`0`),
  sellerFee: bigint("seller_fee", { mode: "bigint" }).notNull().default(sql`0`),
  sellerTax: bigint("seller_tax", { mode: "bigint" }).notNull().default(sql`0`),
  sequence: bigserial("sequence", { mode: "bigint" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("trades_stock_sequence_idx").on(table.stockId, table.sequence),
  check("trades_price_quantity_positive", sql`${table.price} > 0 AND ${table.quantity} > 0`),
  check("trades_users_distinct", sql`${table.buyerUserId} <> ${table.sellerUserId}`),
  check("trades_fees_nonnegative", sql`${table.buyerFee} >= 0 AND ${table.sellerFee} >= 0 AND ${table.sellerTax} >= 0`),
]);

export const candles = pgTable("candles", {
  id: uuid("id").primaryKey().defaultRandom(),
  stockId: uuid("stock_id").notNull().references(() => stocks.id),
  interval: text("interval").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  open: bigint("open", { mode: "bigint" }).notNull(),
  high: bigint("high", { mode: "bigint" }).notNull(),
  low: bigint("low", { mode: "bigint" }).notNull(),
  close: bigint("close", { mode: "bigint" }).notNull(),
  volume: bigint("volume", { mode: "bigint" }).notNull(),
}, (table) => [
  uniqueIndex("candles_stock_interval_open_unique").on(table.stockId, table.interval, table.openedAt),
  check("candles_ohlc_valid", sql`${table.high} >= ${table.open} AND ${table.high} >= ${table.close} AND ${table.low} <= ${table.open} AND ${table.low} <= ${table.close} AND ${table.low} > 0 AND ${table.volume} >= 0`),
]);

export const liquiditySnapshots = pgTable("liquidity_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  stockId: uuid("stock_id").notNull().references(() => stocks.id),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  bestBid: bigint("best_bid", { mode: "bigint" }),
  bestAsk: bigint("best_ask", { mode: "bigint" }),
  bidDepth: bigint("bid_depth", { mode: "bigint" }).notNull().default(sql`0`),
  askDepth: bigint("ask_depth", { mode: "bigint" }).notNull().default(sql`0`),
  imbalanceBps: integer("imbalance_bps").notNull().default(0),
  spreadBps: integer("spread_bps"),
}, (table) => [
  uniqueIndex("liquidity_snapshots_stock_captured_unique").on(table.stockId, table.capturedAt),
  index("liquidity_snapshots_captured_idx").on(table.capturedAt),
  check("liquidity_snapshots_values_valid", sql`(${table.bestBid} IS NULL OR ${table.bestBid} > 0) AND (${table.bestAsk} IS NULL OR ${table.bestAsk} > 0) AND ${table.bidDepth} >= 0 AND ${table.askDepth} >= 0 AND ${table.imbalanceBps} BETWEEN -10000 AND 10000 AND (${table.spreadBps} IS NULL OR ${table.spreadBps} >= 0)`),
]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  requestId: text("request_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("audit_logs_actor_created_idx").on(table.actorUserId, table.createdAt)]);

export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  attempts: integer("attempts").notNull().default(0),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("outbox_events_pending_idx").on(table.processedAt, table.createdAt),
  check("outbox_events_attempts_nonnegative", sql`${table.attempts} >= 0`),
]);

export const systemAccounts = pgTable("system_accounts", {
  key: text("key").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  description: text("description").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("system_accounts_user_unique").on(table.userId)]);

export const marketMakers = pgTable("market_makers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  stockId: uuid("stock_id").notNull().references(() => stocks.id),
  cashBalance: bigint("cash_balance", { mode: "bigint" }).notNull().default(sql`0`),
  inventory: bigint("inventory", { mode: "bigint" }).notNull().default(sql`0`),
  targetInventory: bigint("target_inventory", { mode: "bigint" }).notNull().default(sql`0`),
  maxInventory: bigint("max_inventory", { mode: "bigint" }).notNull(),
  baseSpreadBps: integer("base_spread_bps").notNull().default(100),
  orderDepth: integer("order_depth").notNull().default(5),
  refreshIntervalMs: integer("refresh_interval_ms").notNull().default(10_000),
  riskAversionBps: integer("risk_aversion_bps").notNull().default(100),
  isActive: boolean("is_active").notNull().default(true),
  lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("market_makers_stock_unique").on(table.stockId),
  index("market_makers_refresh_idx").on(table.isActive, table.lastRefreshedAt),
  check("market_makers_balances_valid", sql`${table.cashBalance} >= 0 AND ${table.inventory} >= 0 AND ${table.targetInventory} >= 0 AND ${table.maxInventory} > 0 AND ${table.inventory} <= ${table.maxInventory}`),
  check("market_makers_config_valid", sql`${table.baseSpreadBps} > 0 AND ${table.baseSpreadBps} < 5000 AND ${table.orderDepth} BETWEEN 1 AND 20 AND ${table.refreshIntervalMs} BETWEEN 1000 AND 3600000 AND ${table.riskAversionBps} BETWEEN 0 AND 10000`),
]);

export const marketMakerLedger = pgTable("market_maker_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  marketMakerId: uuid("market_maker_id").notNull().references(() => marketMakers.id),
  eventType: text("event_type").notNull(),
  cashDelta: bigint("cash_delta", { mode: "bigint" }).notNull().default(sql`0`),
  inventoryDelta: bigint("inventory_delta", { mode: "bigint" }).notNull().default(sql`0`),
  cashAfter: bigint("cash_after", { mode: "bigint" }).notNull(),
  inventoryAfter: bigint("inventory_after", { mode: "bigint" }).notNull(),
  referenceId: text("reference_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("market_maker_ledger_maker_created_idx").on(table.marketMakerId, table.createdAt),
  check("market_maker_ledger_after_valid", sql`${table.cashAfter} >= 0 AND ${table.inventoryAfter} >= 0`),
]);

export const borrowPools = pgTable("borrow_pools", {
  id: uuid("id").primaryKey().defaultRandom(),
  stockId: uuid("stock_id").notNull().references(() => stocks.id),
  borrowableQuantity: bigint("borrowable_quantity", { mode: "bigint" }).notNull(),
  borrowedQuantity: bigint("borrowed_quantity", { mode: "bigint" }).notNull().default(sql`0`),
  baseBorrowFeeBps: integer("base_borrow_fee_bps").notNull().default(100),
  maxBorrowFeeBps: integer("max_borrow_fee_bps").notNull().default(5_000),
  ...timestamps,
}, (table) => [
  uniqueIndex("borrow_pools_stock_unique").on(table.stockId),
  check("borrow_pools_quantities_valid", sql`${table.borrowableQuantity} >= 0 AND ${table.borrowedQuantity} >= 0 AND ${table.borrowedQuantity} <= ${table.borrowableQuantity}`),
  check("borrow_pools_fees_valid", sql`${table.baseBorrowFeeBps} >= 0 AND ${table.maxBorrowFeeBps} >= ${table.baseBorrowFeeBps} AND ${table.maxBorrowFeeBps} <= 10000`),
]);

export const leveragePositions = pgTable("leverage_positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  stockId: uuid("stock_id").notNull().references(() => stocks.id),
  side: positionSide("side").notNull(),
  status: positionStatus("status").notNull().default("open"),
  leverage: integer("leverage").notNull(),
  quantity: bigint("quantity", { mode: "bigint" }).notNull(),
  margin: bigint("margin", { mode: "bigint" }).notNull(),
  positionSize: bigint("position_size", { mode: "bigint" }).notNull(),
  entryPrice: bigint("entry_price", { mode: "bigint" }).notNull(),
  liquidationPrice: bigint("liquidation_price", { mode: "bigint" }).notNull(),
  maintenanceMarginBps: integer("maintenance_margin_bps").notNull().default(500),
  openFee: bigint("open_fee", { mode: "bigint" }).notNull().default(sql`0`),
  accruedBorrowFee: bigint("accrued_borrow_fee", { mode: "bigint" }).notNull().default(sql`0`),
  lastBorrowFeeAt: timestamp("last_borrow_fee_at", { withTimezone: true }),
  closeOrderId: uuid("close_order_id"),
  closeReason: text("close_reason"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("leverage_positions_open_bucket_unique").on(table.userId, table.stockId, table.side, table.leverage).where(sql`${table.status} = 'open'`),
  index("leverage_positions_liquidation_idx").on(table.status, table.stockId, table.liquidationPrice),
  check("leverage_positions_values_valid", sql`${table.leverage} IN (1,2,3,5,10,20,50,100) AND ${table.quantity} > 0 AND ${table.margin} > 0 AND ${table.positionSize} > 0 AND ${table.entryPrice} > 0 AND ${table.liquidationPrice} > 0 AND ${table.maintenanceMarginBps} BETWEEN 0 AND 9999 AND ${table.openFee} >= 0 AND ${table.accruedBorrowFee} >= 0`),
]);

export const leverageEvents = pgTable("leverage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  positionId: uuid("position_id").notNull().references(() => leveragePositions.id),
  eventType: text("event_type").notNull(),
  price: bigint("price", { mode: "bigint" }).notNull(),
  quantity: bigint("quantity", { mode: "bigint" }).notNull(),
  cashDelta: bigint("cash_delta", { mode: "bigint" }).notNull().default(sql`0`),
  fee: bigint("fee", { mode: "bigint" }).notNull().default(sql`0`),
  realizedPnl: bigint("realized_pnl", { mode: "bigint" }).notNull().default(sql`0`),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("leverage_events_position_created_idx").on(table.positionId, table.createdAt),
  check("leverage_events_values_valid", sql`${table.price} > 0 AND ${table.quantity} > 0 AND ${table.fee} >= 0`),
]);

export const shortSqueezeEvents = pgTable("short_squeeze_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  stockId: uuid("stock_id").notNull().references(() => stocks.id),
  status: squeezeStatus("status").notNull().default("active"),
  utilizationBps: integer("utilization_bps").notNull(),
  priceChangeBps: integer("price_change_bps").notNull(),
  buyVolume: bigint("buy_volume", { mode: "bigint" }).notNull(),
  sellVolume: bigint("sell_volume", { mode: "bigint" }).notNull(),
  askDepth: bigint("ask_depth", { mode: "bigint" }).notNull(),
  liquidationCount: integer("liquidation_count").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}),
}, (table) => [
  uniqueIndex("short_squeeze_one_active_stock").on(table.stockId).where(sql`${table.status} = 'active'`),
  index("short_squeeze_stock_started_idx").on(table.stockId, table.startedAt),
  check("short_squeeze_metrics_valid", sql`${table.utilizationBps} BETWEEN 0 AND 10000 AND ${table.buyVolume} >= 0 AND ${table.sellVolume} >= 0 AND ${table.askDepth} >= 0 AND ${table.liquidationCount} >= 0`),
]);

export const marketRegimes = pgTable("market_regimes", {
  id: uuid("id").primaryKey().defaultRandom(),
  regime: marketRegimeType("regime").notNull(),
  strength: integer("strength").notNull(),
  breadthBps: integer("breadth_bps").notNull(),
  averageReturnBps: integer("average_return_bps").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}),
}, (table) => [
  uniqueIndex("market_regimes_one_active").on(sql`((1))`).where(sql`${table.endedAt} IS NULL`),
  check("market_regimes_strength_valid", sql`${table.strength} BETWEEN -100 AND 100 AND ${table.breadthBps} BETWEEN 0 AND 10000`),
]);

export const sectorStates = pgTable("sector_states", {
  sectorId: uuid("sector_id").primaryKey().references(() => sectors.id),
  strength: integer("strength").notNull().default(0),
  averageReturnBps: integer("average_return_bps").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("sector_states_strength_valid", sql`${table.strength} BETWEEN -100 AND 100`)]);

export const marketStateSnapshots = pgTable("market_state_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  sectorId: uuid("sector_id").references(() => sectors.id),
  strength: integer("strength").notNull(),
  averageReturnBps: integer("average_return_bps").notNull(),
  breadthBps: integer("breadth_bps"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("market_state_snapshots_market_idx").on(table.capturedAt).where(sql`${table.sectorId} IS NULL`),
  index("market_state_snapshots_sector_idx").on(table.sectorId, table.capturedAt),
  check("market_state_snapshots_values_valid", sql`${table.strength} BETWEEN -100 AND 100 AND (${table.breadthBps} IS NULL OR ${table.breadthBps} BETWEEN 0 AND 10000)`),
]);

export const corporateEvents = pgTable("corporate_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  eventType: text("event_type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  fairValueImpactBps: integer("fair_value_impact_bps").notNull().default(0),
  demandImpactBps: integer("demand_impact_bps").notNull().default(0),
  liquidityImpactBps: integer("liquidity_impact_bps").notNull().default(0),
  volatilityImpactBps: integer("volatility_impact_bps").notNull().default(0),
  creditRiskImpact: integer("credit_risk_impact").notNull().default(0),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("corporate_events_company_starts_idx").on(table.companyId, table.startsAt)]);

export const managementActions = pgTable("management_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  executedByUserId: uuid("executed_by_user_id").notNull().references(() => users.id),
  idempotencyKey: uuid("idempotency_key").notNull(),
  actionType: managementActionType("action_type").notNull(),
  amount: bigint("amount", { mode: "bigint" }).notNull().default(sql`0`),
  parameters: jsonb("parameters").notNull().default({}),
  result: jsonb("result").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("management_actions_user_idempotency_unique").on(table.executedByUserId, table.idempotencyKey),
  index("management_actions_company_created_idx").on(table.companyId, table.createdAt),
  check("management_actions_amount_nonnegative", sql`${table.amount} >= 0`),
]);

export const financialReports = pgTable("financial_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  periodKey: text("period_key").notNull(),
  revenue: bigint("revenue", { mode: "bigint" }).notNull(),
  operatingProfit: bigint("operating_profit", { mode: "bigint" }).notNull(),
  netProfit: bigint("net_profit", { mode: "bigint" }).notNull(),
  cash: bigint("cash", { mode: "bigint" }).notNull(),
  debt: bigint("debt", { mode: "bigint" }).notNull(),
  bookValue: bigint("book_value", { mode: "bigint" }).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("financial_reports_company_period_unique").on(table.companyId, table.periodKey),
  index("financial_reports_company_published_idx").on(table.companyId, table.publishedAt),
]);

export const dividendDistributions = pgTable("dividend_distributions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  stockId: uuid("stock_id").notNull().references(() => stocks.id),
  financialReportId: uuid("financial_report_id").notNull().references(() => financialReports.id),
  status: dividendStatus("status").notNull().default("declared"),
  perShare: bigint("per_share", { mode: "bigint" }).notNull(),
  totalAmount: bigint("total_amount", { mode: "bigint" }).notNull(),
  recordDate: timestamp("record_date", { withTimezone: true }).notNull(),
  payableAt: timestamp("payable_at", { withTimezone: true }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("dividend_distributions_status_payable_idx").on(table.status, table.payableAt), check("dividend_distributions_values_valid", sql`${table.perShare} > 0 AND ${table.totalAmount} >= 0 AND ${table.payableAt} >= ${table.recordDate}`)]);

export const dividendEntitlements = pgTable("dividend_entitlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  distributionId: uuid("distribution_id").notNull().references(() => dividendDistributions.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  quantitySnapshot: bigint("quantity_snapshot", { mode: "bigint" }).notNull(),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, (table) => [uniqueIndex("dividend_entitlements_distribution_user_unique").on(table.distributionId, table.userId), check("dividend_entitlements_values_valid", sql`${table.quantitySnapshot} > 0 AND ${table.amount} >= 0`)]);

export const mnaCampaigns = pgTable("mna_campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  stockId: uuid("stock_id").notNull().references(() => stocks.id),
  attackerUserId: uuid("attacker_user_id").notNull().references(() => users.id),
  idempotencyKey: uuid("idempotency_key").notNull(),
  defenderUserId: uuid("defender_user_id").references(() => users.id),
  status: mnaCampaignStatus("status").notNull().default("tendering"),
  offerPrice: bigint("offer_price", { mode: "bigint" }).notNull(),
  committedCash: bigint("committed_cash", { mode: "bigint" }).notNull(),
  spentCash: bigint("spent_cash", { mode: "bigint" }).notNull().default(sql`0`),
  attackerAssetSnapshot: bigint("attacker_asset_snapshot", { mode: "bigint" }).notNull(),
  attackerOwnershipSnapshot: bigint("attacker_ownership_snapshot", { mode: "bigint" }).notNull(),
  defenderOwnershipSnapshot: bigint("defender_ownership_snapshot", { mode: "bigint" }).notNull().default(sql`0`),
  attackerScore: bigint("attacker_score", { mode: "bigint" }).notNull().default(sql`0`),
  defenderScore: bigint("defender_score", { mode: "bigint" }).notNull().default(sql`0`),
  tenderEndsAt: timestamp("tender_ends_at", { withTimezone: true }).notNull(),
  proxyEndsAt: timestamp("proxy_ends_at", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  winnerUserId: uuid("winner_user_id").references(() => users.id),
  result: jsonb("result").notNull().default({}),
  ...timestamps,
}, (table) => [
  uniqueIndex("mna_one_active_company").on(table.companyId).where(sql`${table.status} IN ('tendering', 'proxy_vote')`),
  uniqueIndex("mna_campaign_attacker_idempotency_unique").on(table.attackerUserId, table.idempotencyKey),
  index("mna_campaigns_status_deadline_idx").on(table.status, table.tenderEndsAt, table.proxyEndsAt),
  check("mna_campaign_values_valid", sql`${table.offerPrice} > 0 AND ${table.committedCash} > 0 AND ${table.spentCash} >= 0 AND ${table.spentCash} <= ${table.committedCash} AND ${table.attackerAssetSnapshot} >= 0 AND ${table.attackerOwnershipSnapshot} >= 0 AND ${table.defenderOwnershipSnapshot} >= 0 AND ${table.attackerScore} >= 0 AND ${table.defenderScore} >= 0`),
]);

export const mnaTenderOffers = pgTable("mna_tender_offers", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => mnaCampaigns.id),
  shareholderUserId: uuid("shareholder_user_id").notNull().references(() => users.id),
  quantity: bigint("quantity", { mode: "bigint" }).notNull(),
  status: text("status").notNull().default("reserved"),
  settledAmount: bigint("settled_amount", { mode: "bigint" }).notNull().default(sql`0`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("mna_tender_campaign_shareholder_unique").on(table.campaignId, table.shareholderUserId),
  check("mna_tender_values_valid", sql`${table.quantity} > 0 AND ${table.settledAmount} >= 0 AND ${table.status} IN ('reserved','settled','released')`),
]);

export const mnaSupports = pgTable("mna_supports", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => mnaCampaigns.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  side: mnaSide("side").notNull(),
  votingRightsSnapshot: bigint("voting_rights_snapshot", { mode: "bigint" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("mna_support_campaign_user_unique").on(table.campaignId, table.userId),
  check("mna_support_rights_nonnegative", sql`${table.votingRightsSnapshot} >= 0`),
]);

export const mnaActions = pgTable("mna_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => mnaCampaigns.id),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id),
  idempotencyKey: uuid("idempotency_key").notNull(),
  side: mnaSide("side").notNull(),
  actionType: text("action_type").notNull(),
  cashAmount: bigint("cash_amount", { mode: "bigint" }).notNull().default(sql`0`),
  scoreDelta: bigint("score_delta", { mode: "bigint" }).notNull().default(sql`0`),
  parameters: jsonb("parameters").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("mna_actions_actor_idempotency_unique").on(table.actorUserId, table.idempotencyKey),
  index("mna_actions_campaign_created_idx").on(table.campaignId, table.createdAt),
  check("mna_actions_values_valid", sql`${table.cashAmount} >= 0 AND ${table.scoreDelta} >= 0`),
]);

export const strategies = pgTable("strategies", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  stockId: uuid("stock_id").notNull().references(() => stocks.id),
  name: text("name").notNull(),
  interval: text("interval").notNull().default("1m"),
  status: strategyStatus("status").notNull().default("DRAFT"),
  definition: jsonb("definition").notNull(),
  safety: jsonb("safety").notNull(),
  paperInitialCash: bigint("paper_initial_cash", { mode: "bigint" }).notNull().default(sql`100000000`),
  paperCash: bigint("paper_cash", { mode: "bigint" }).notNull().default(sql`100000000`),
  paperQuantity: bigint("paper_quantity", { mode: "bigint" }).notNull().default(sql`0`),
  paperCostBasis: bigint("paper_cost_basis", { mode: "bigint" }).notNull().default(sql`0`),
  lastEvaluatedCandleAt: timestamp("last_evaluated_candle_at", { withTimezone: true }),
  lastTradeAt: timestamp("last_trade_at", { withTimezone: true }),
  dailyEquityDate: text("daily_equity_date"),
  dailyStartEquity: bigint("daily_start_equity", { mode: "bigint" }),
  liveConfirmedAt: timestamp("live_confirmed_at", { withTimezone: true }),
  pausedFromStatus: strategyStatus("paused_from_status"),
  ...timestamps,
}, (table) => [
  index("strategies_user_status_idx").on(table.userId, table.status),
  index("strategies_active_stock_idx").on(table.status, table.stockId),
  check("strategies_name_valid", sql`char_length(${table.name}) BETWEEN 1 AND 100`),
  check("strategies_interval_valid", sql`${table.interval} IN ('1m','5m','15m','1h','1d')`),
  check("strategies_paper_ledger_valid", sql`${table.paperInitialCash} > 0 AND ${table.paperCash} >= 0 AND ${table.paperQuantity} >= 0 AND ${table.paperCostBasis} >= 0 AND (${table.dailyStartEquity} IS NULL OR ${table.dailyStartEquity} >= 0)`),
]);

export const backtestRuns = pgTable("backtest_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  strategyId: uuid("strategy_id").notNull().references(() => strategies.id, { onDelete: "cascade" }),
  definition: jsonb("definition").notNull(),
  safety: jsonb("safety").notNull(),
  candleCount: integer("candle_count").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("backtest_runs_strategy_created_idx").on(table.strategyId, table.createdAt),
  check("backtest_runs_candles_valid", sql`${table.candleCount} >= 2 AND ${table.endsAt} >= ${table.startsAt}`),
]);

export const strategyExecutions = pgTable("strategy_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  strategyId: uuid("strategy_id").notNull().references(() => strategies.id, { onDelete: "cascade" }),
  mode: strategyExecutionMode("mode").notNull(),
  status: strategyExecutionStatus("status").notNull(),
  candleOpenedAt: timestamp("candle_opened_at", { withTimezone: true }).notNull(),
  orderId: uuid("order_id").references(() => orders.id),
  action: jsonb("action").notNull(),
  signalSnapshot: jsonb("signal_snapshot").notNull().default({}),
  quantity: bigint("quantity", { mode: "bigint" }).notNull().default(sql`0`),
  executionPrice: bigint("execution_price", { mode: "bigint" }),
  fee: bigint("fee", { mode: "bigint" }).notNull().default(sql`0`),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("strategy_executions_strategy_candle_unique").on(table.strategyId, table.candleOpenedAt),
  index("strategy_executions_strategy_created_idx").on(table.strategyId, table.createdAt),
  check("strategy_executions_values_valid", sql`${table.quantity} >= 0 AND (${table.executionPrice} IS NULL OR ${table.executionPrice} > 0) AND ${table.fee} >= 0`),
]);
