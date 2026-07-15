ALTER TABLE "stocks" ADD COLUMN "initial_market_cap" bigint DEFAULT 0;
ALTER TABLE "stocks" ADD COLUMN "market_cap_ema_24h" bigint DEFAULT 0;
ALTER TABLE "stocks" ADD COLUMN "market_cap_ema_7d" bigint DEFAULT 0;
ALTER TABLE "stocks" ADD COLUMN "stability_market_cap" bigint DEFAULT 0;
ALTER TABLE "stocks" ADD COLUMN "stability_tier" text DEFAULT 'SMALL';
ALTER TABLE "stocks" ADD COLUMN "stability_tier_entered_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "stocks" ADD COLUMN "stability_tier_candidate" text;
ALTER TABLE "stocks" ADD COLUMN "stability_tier_candidate_since" timestamp with time zone;
ALTER TABLE "stocks" ADD COLUMN "last_stability_update_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "stocks" ADD COLUMN "is_blue_chip" boolean DEFAULT false NOT NULL;
ALTER TABLE "stocks" ADD COLUMN "trend_regime" text DEFAULT 'SIDEWAYS' NOT NULL;
ALTER TABLE "stocks" ADD COLUMN "trend_started_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "stocks" ADD COLUMN "trend_ends_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "stocks" ADD COLUMN "trend_strength_bps" integer DEFAULT 0 NOT NULL;
ALTER TABLE "stocks" ADD COLUMN "trend_source" text DEFAULT 'tier_probability' NOT NULL;
ALTER TABLE "stocks" ADD COLUMN "trend_stability_tier" text DEFAULT 'SMALL';
ALTER TABLE "stocks" ADD COLUMN "fundamental_fair_value" bigint DEFAULT 0;
ALTER TABLE "stocks" ADD COLUMN "fair_value_updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "stocks" ADD COLUMN "fair_value_confidence_bps" integer DEFAULT 5000 NOT NULL;
ALTER TABLE "stocks" ADD COLUMN "daily_anchor_price" bigint DEFAULT 0;
ALTER TABLE "stocks" ADD COLUMN "daily_anchor_at" timestamp with time zone DEFAULT date_trunc('day', now()) NOT NULL;
ALTER TABLE "stocks" ADD COLUMN "daily_change_bps" integer DEFAULT 0 NOT NULL;
ALTER TABLE "stocks" ADD COLUMN "target_daily_volatility_bps" integer DEFAULT 2000 NOT NULL;
ALTER TABLE "stocks" ADD COLUMN "distress_score" integer DEFAULT 0 NOT NULL;
ALTER TABLE "stocks" ADD COLUMN "distress_components" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "stocks" ADD COLUMN "circuit_breaker_until" timestamp with time zone;
ALTER TABLE "stocks" ADD COLUMN "circuit_breaker_reason" text;
ALTER TABLE "stocks" ADD COLUMN "circuit_breaker_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "stocks" ADD COLUMN "post_halt_cooling_until" timestamp with time zone;

UPDATE "stocks" SET
  "initial_market_cap" = "current_price" * "total_shares",
  "market_cap_ema_24h" = "current_price" * "total_shares",
  "market_cap_ema_7d" = "current_price" * "total_shares",
  "stability_market_cap" = "current_price" * "total_shares",
  "fundamental_fair_value" = "reference_price",
  "daily_anchor_price" = "current_price",
  "stability_tier" = CASE
    WHEN "current_price" * "total_shares" >= 1000000000000 THEN 'GIANT'
    WHEN "current_price" * "total_shares" >= 500000000000 THEN 'MEGA'
    WHEN "current_price" * "total_shares" >= 150000000000 THEN 'LARGE'
    WHEN "current_price" * "total_shares" >= 50000000000 THEN 'MID'
    WHEN "current_price" * "total_shares" >= 5000000000 THEN 'SMALL'
    ELSE 'DELIST_RISK' END,
  "trend_stability_tier" = CASE
    WHEN "current_price" * "total_shares" >= 1000000000000 THEN 'GIANT'
    WHEN "current_price" * "total_shares" >= 500000000000 THEN 'MEGA'
    WHEN "current_price" * "total_shares" >= 150000000000 THEN 'LARGE'
    WHEN "current_price" * "total_shares" >= 50000000000 THEN 'MID'
    WHEN "current_price" * "total_shares" >= 5000000000 THEN 'SMALL'
    ELSE 'DELIST_RISK' END,
  "target_daily_volatility_bps" = CASE
    WHEN "current_price" * "total_shares" >= 1000000000000 THEN 500
    WHEN "current_price" * "total_shares" >= 500000000000 THEN 700
    WHEN "current_price" * "total_shares" >= 150000000000 THEN 1000
    WHEN "current_price" * "total_shares" >= 50000000000 THEN 1400
    WHEN "current_price" * "total_shares" >= 5000000000 THEN 2000
    ELSE 2800 END;

ALTER TABLE "stocks" ALTER COLUMN "initial_market_cap" SET NOT NULL;
ALTER TABLE "stocks" ALTER COLUMN "market_cap_ema_24h" SET NOT NULL;
ALTER TABLE "stocks" ALTER COLUMN "market_cap_ema_7d" SET NOT NULL;
ALTER TABLE "stocks" ALTER COLUMN "stability_market_cap" SET NOT NULL;
ALTER TABLE "stocks" ALTER COLUMN "stability_tier" SET NOT NULL;
ALTER TABLE "stocks" ALTER COLUMN "trend_stability_tier" SET NOT NULL;
ALTER TABLE "stocks" ALTER COLUMN "fundamental_fair_value" SET NOT NULL;
ALTER TABLE "stocks" ALTER COLUMN "daily_anchor_price" SET NOT NULL;

ALTER TABLE "stocks" ADD CONSTRAINT "stocks_stability_caps_positive" CHECK ("initial_market_cap" > 0 AND "market_cap_ema_24h" > 0 AND "market_cap_ema_7d" > 0 AND "stability_market_cap" > 0 AND "fundamental_fair_value" > 0 AND "daily_anchor_price" > 0);
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_stability_tiers_valid" CHECK ("stability_tier" IN ('BLUE_CHIP','GIANT','MEGA','LARGE','MID','SMALL','DELIST_RISK') AND "trend_stability_tier" IN ('BLUE_CHIP','GIANT','MEGA','LARGE','MID','SMALL','DELIST_RISK') AND ("stability_tier_candidate" IS NULL OR "stability_tier_candidate" IN ('BLUE_CHIP','GIANT','MEGA','LARGE','MID','SMALL','DELIST_RISK')));
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_trend_regime_valid" CHECK ("trend_regime" IN ('BULL','SIDEWAYS','BEAR') AND "trend_ends_at" >= "trend_started_at");
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_stability_metrics_valid" CHECK ("fair_value_confidence_bps" BETWEEN 0 AND 10000 AND "target_daily_volatility_bps" BETWEEN 0 AND 10000 AND "distress_score" BETWEEN 0 AND 700 AND "circuit_breaker_count" >= 0);

CREATE FUNCTION initialize_stock_stability_fields() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cap bigint;
DECLARE tier text;
BEGIN
  cap := NEW.current_price * NEW.total_shares;
  tier := CASE
    WHEN NEW.is_blue_chip THEN 'BLUE_CHIP'
    WHEN cap >= 1000000000000 THEN 'GIANT'
    WHEN cap >= 500000000000 THEN 'MEGA'
    WHEN cap >= 150000000000 THEN 'LARGE'
    WHEN cap >= 50000000000 THEN 'MID'
    WHEN cap >= 5000000000 THEN 'SMALL'
    ELSE 'DELIST_RISK' END;
  IF NEW.initial_market_cap <= 0 THEN NEW.initial_market_cap := cap; END IF;
  IF NEW.market_cap_ema_24h <= 0 THEN NEW.market_cap_ema_24h := cap; END IF;
  IF NEW.market_cap_ema_7d <= 0 THEN NEW.market_cap_ema_7d := cap; END IF;
  IF NEW.stability_market_cap <= 0 THEN NEW.stability_market_cap := cap; NEW.stability_tier := tier; END IF;
  IF NEW.fundamental_fair_value <= 0 THEN NEW.fundamental_fair_value := NEW.reference_price; END IF;
  IF NEW.daily_anchor_price <= 0 THEN NEW.daily_anchor_price := NEW.current_price; END IF;
  IF NEW.trend_stability_tier IS NULL OR NEW.trend_stability_tier = 'SMALL' AND cap < 5000000000 OR cap >= 50000000000 THEN NEW.trend_stability_tier := tier; END IF;
  NEW.target_daily_volatility_bps := CASE tier WHEN 'BLUE_CHIP' THEN 300 WHEN 'GIANT' THEN 500 WHEN 'MEGA' THEN 700 WHEN 'LARGE' THEN 1000 WHEN 'MID' THEN 1400 WHEN 'SMALL' THEN 2000 ELSE 2800 END;
  RETURN NEW;
END $$;
CREATE TRIGGER stocks_initialize_stability_fields BEFORE INSERT ON "stocks" FOR EACH ROW EXECUTE FUNCTION initialize_stock_stability_fields();

CREATE TABLE "price_guard_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "stock_id" uuid NOT NULL REFERENCES "stocks"("id"),
  "event_type" text NOT NULL,
  "triggered_by" text DEFAULT 'system' NOT NULL,
  "reference_price" bigint NOT NULL,
  "observed_price" bigint NOT NULL,
  "protected_price" bigint NOT NULL,
  "change_5m_bps" integer,
  "change_30m_bps" integer,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ended_at" timestamp with time zone,
  CONSTRAINT "price_guard_event_prices_positive" CHECK ("reference_price" > 0 AND "observed_price" > 0 AND "protected_price" > 0)
);
CREATE INDEX "price_guard_events_stock_started_idx" ON "price_guard_events" USING btree ("stock_id", "started_at");
CREATE INDEX "stocks_stability_tier_idx" ON "stocks" USING btree ("stability_tier", "listing_status");
CREATE INDEX "stocks_circuit_breaker_idx" ON "stocks" USING btree ("circuit_breaker_until") WHERE "circuit_breaker_until" IS NOT NULL;
