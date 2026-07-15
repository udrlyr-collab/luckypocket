CREATE TYPE "public"."position_side" AS ENUM('long', 'short');--> statement-breakpoint
CREATE TYPE "public"."position_status" AS ENUM('open', 'closing', 'closed', 'liquidated');--> statement-breakpoint
CREATE TABLE "borrow_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stock_id" uuid NOT NULL,
	"borrowable_quantity" bigint NOT NULL,
	"borrowed_quantity" bigint DEFAULT 0 NOT NULL,
	"base_borrow_fee_bps" integer DEFAULT 100 NOT NULL,
	"max_borrow_fee_bps" integer DEFAULT 5000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "borrow_pools_quantities_valid" CHECK ("borrow_pools"."borrowable_quantity" >= 0 AND "borrow_pools"."borrowed_quantity" >= 0 AND "borrow_pools"."borrowed_quantity" <= "borrow_pools"."borrowable_quantity"),
	CONSTRAINT "borrow_pools_fees_valid" CHECK ("borrow_pools"."base_borrow_fee_bps" >= 0 AND "borrow_pools"."max_borrow_fee_bps" >= "borrow_pools"."base_borrow_fee_bps" AND "borrow_pools"."max_borrow_fee_bps" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "leverage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"price" bigint NOT NULL,
	"quantity" bigint NOT NULL,
	"cash_delta" bigint DEFAULT 0 NOT NULL,
	"fee" bigint DEFAULT 0 NOT NULL,
	"realized_pnl" bigint DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leverage_events_values_valid" CHECK ("leverage_events"."price" > 0 AND "leverage_events"."quantity" > 0 AND "leverage_events"."fee" >= 0)
);
--> statement-breakpoint
CREATE TABLE "leverage_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stock_id" uuid NOT NULL,
	"side" "position_side" NOT NULL,
	"status" "position_status" DEFAULT 'open' NOT NULL,
	"leverage" integer NOT NULL,
	"quantity" bigint NOT NULL,
	"margin" bigint NOT NULL,
	"position_size" bigint NOT NULL,
	"entry_price" bigint NOT NULL,
	"liquidation_price" bigint NOT NULL,
	"maintenance_margin_bps" integer DEFAULT 500 NOT NULL,
	"open_fee" bigint DEFAULT 0 NOT NULL,
	"accrued_borrow_fee" bigint DEFAULT 0 NOT NULL,
	"last_borrow_fee_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leverage_positions_values_valid" CHECK ("leverage_positions"."leverage" IN (1,2,3,5,10,20,50,100) AND "leverage_positions"."quantity" > 0 AND "leverage_positions"."margin" > 0 AND "leverage_positions"."position_size" > 0 AND "leverage_positions"."entry_price" > 0 AND "leverage_positions"."liquidation_price" > 0 AND "leverage_positions"."maintenance_margin_bps" BETWEEN 0 AND 9999 AND "leverage_positions"."open_fee" >= 0 AND "leverage_positions"."accrued_borrow_fee" >= 0)
);
--> statement-breakpoint
ALTER TABLE "borrow_pools" ADD CONSTRAINT "borrow_pools_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leverage_events" ADD CONSTRAINT "leverage_events_position_id_leverage_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."leverage_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leverage_positions" ADD CONSTRAINT "leverage_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leverage_positions" ADD CONSTRAINT "leverage_positions_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "borrow_pools_stock_unique" ON "borrow_pools" USING btree ("stock_id");--> statement-breakpoint
CREATE INDEX "leverage_events_position_created_idx" ON "leverage_events" USING btree ("position_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leverage_positions_open_bucket_unique" ON "leverage_positions" USING btree ("user_id","stock_id","side","leverage") WHERE "leverage_positions"."status" = 'open';--> statement-breakpoint
CREATE INDEX "leverage_positions_liquidation_idx" ON "leverage_positions" USING btree ("status","stock_id","liquidation_price");