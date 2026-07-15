CREATE TYPE "public"."stock_asset_type" AS ENUM('common', 'user_etf', 'etf_leverage', 'etf_derivative');--> statement-breakpoint
CREATE TYPE "public"."valuation_cycle_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "etf_products" (
	"stock_id" uuid PRIMARY KEY NOT NULL,
	"tracked_user_id" uuid NOT NULL,
	"base_eligible_asset_value" bigint NOT NULL,
	"base_price" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "etf_products_base_valid" CHECK ("etf_products"."base_eligible_asset_value" > 0 AND "etf_products"."base_price" > 0)
);
--> statement-breakpoint
CREATE TABLE "etf_valuations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"source_cycle_id" uuid NOT NULL,
	"stock_id" uuid NOT NULL,
	"tracked_user_id" uuid NOT NULL,
	"source_eligible_asset_value" bigint NOT NULL,
	"calculated_price" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "etf_valuations_values_valid" CHECK ("etf_valuations"."source_eligible_asset_value" >= 0 AND "etf_valuations"."calculated_price" > 0 AND "etf_valuations"."cycle_id" <> "etf_valuations"."source_cycle_id")
);
--> statement-breakpoint
CREATE TABLE "user_valuation_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"cash" bigint NOT NULL,
	"eligible_asset_value" bigint NOT NULL,
	"total_asset_value" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_valuation_snapshots_values_valid" CHECK ("user_valuation_snapshots"."cash" >= 0 AND "user_valuation_snapshots"."eligible_asset_value" >= 0 AND "user_valuation_snapshots"."total_asset_value" >= 0 AND "user_valuation_snapshots"."eligible_asset_value" <= "user_valuation_snapshots"."total_asset_value")
);
--> statement-breakpoint
CREATE TABLE "valuation_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "valuation_cycle_status" DEFAULT 'running' NOT NULL,
	"source_cycle_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "stocks" ADD COLUMN "asset_type" "stock_asset_type" DEFAULT 'common' NOT NULL;--> statement-breakpoint
ALTER TABLE "etf_products" ADD CONSTRAINT "etf_products_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etf_products" ADD CONSTRAINT "etf_products_tracked_user_id_users_id_fk" FOREIGN KEY ("tracked_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etf_valuations" ADD CONSTRAINT "etf_valuations_cycle_id_valuation_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."valuation_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etf_valuations" ADD CONSTRAINT "etf_valuations_source_cycle_id_valuation_cycles_id_fk" FOREIGN KEY ("source_cycle_id") REFERENCES "public"."valuation_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etf_valuations" ADD CONSTRAINT "etf_valuations_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etf_valuations" ADD CONSTRAINT "etf_valuations_tracked_user_id_users_id_fk" FOREIGN KEY ("tracked_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_valuation_snapshots" ADD CONSTRAINT "user_valuation_snapshots_cycle_id_valuation_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."valuation_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_valuation_snapshots" ADD CONSTRAINT "user_valuation_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "etf_products_tracked_user_unique" ON "etf_products" USING btree ("tracked_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "etf_valuations_cycle_stock_unique" ON "etf_valuations" USING btree ("cycle_id","stock_id");--> statement-breakpoint
CREATE INDEX "etf_valuations_stock_created_idx" ON "etf_valuations" USING btree ("stock_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_valuation_snapshots_cycle_user_unique" ON "user_valuation_snapshots" USING btree ("cycle_id","user_id");--> statement-breakpoint
CREATE INDEX "user_valuation_snapshots_user_created_idx" ON "user_valuation_snapshots" USING btree ("user_id","created_at");