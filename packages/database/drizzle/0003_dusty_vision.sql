CREATE TABLE "market_maker_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_maker_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"cash_delta" bigint DEFAULT 0 NOT NULL,
	"inventory_delta" bigint DEFAULT 0 NOT NULL,
	"cash_after" bigint NOT NULL,
	"inventory_after" bigint NOT NULL,
	"reference_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_maker_ledger_after_valid" CHECK ("market_maker_ledger"."cash_after" >= 0 AND "market_maker_ledger"."inventory_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "market_makers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stock_id" uuid NOT NULL,
	"cash_balance" bigint DEFAULT 0 NOT NULL,
	"inventory" bigint DEFAULT 0 NOT NULL,
	"target_inventory" bigint DEFAULT 0 NOT NULL,
	"max_inventory" bigint NOT NULL,
	"base_spread_bps" integer DEFAULT 100 NOT NULL,
	"order_depth" integer DEFAULT 5 NOT NULL,
	"refresh_interval_ms" integer DEFAULT 10000 NOT NULL,
	"risk_aversion_bps" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_makers_balances_valid" CHECK ("market_makers"."cash_balance" >= 0 AND "market_makers"."inventory" >= 0 AND "market_makers"."target_inventory" >= 0 AND "market_makers"."max_inventory" > 0 AND "market_makers"."inventory" <= "market_makers"."max_inventory"),
	CONSTRAINT "market_makers_config_valid" CHECK ("market_makers"."base_spread_bps" > 0 AND "market_makers"."base_spread_bps" < 5000 AND "market_makers"."order_depth" BETWEEN 1 AND 20 AND "market_makers"."refresh_interval_ms" BETWEEN 1000 AND 3600000 AND "market_makers"."risk_aversion_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "market_maker_ledger" ADD CONSTRAINT "market_maker_ledger_market_maker_id_market_makers_id_fk" FOREIGN KEY ("market_maker_id") REFERENCES "public"."market_makers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_makers" ADD CONSTRAINT "market_makers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_makers" ADD CONSTRAINT "market_makers_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_maker_ledger_maker_created_idx" ON "market_maker_ledger" USING btree ("market_maker_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_makers_stock_unique" ON "market_makers" USING btree ("stock_id");--> statement-breakpoint
CREATE INDEX "market_makers_refresh_idx" ON "market_makers" USING btree ("is_active","last_refreshed_at");