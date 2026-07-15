CREATE TYPE "public"."squeeze_status" AS ENUM('active', 'ended');--> statement-breakpoint
CREATE TABLE "short_squeeze_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stock_id" uuid NOT NULL,
	"status" "squeeze_status" DEFAULT 'active' NOT NULL,
	"utilization_bps" integer NOT NULL,
	"price_change_bps" integer NOT NULL,
	"buy_volume" bigint NOT NULL,
	"sell_volume" bigint NOT NULL,
	"ask_depth" bigint NOT NULL,
	"liquidation_count" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "short_squeeze_metrics_valid" CHECK ("short_squeeze_events"."utilization_bps" BETWEEN 0 AND 10000 AND "short_squeeze_events"."buy_volume" >= 0 AND "short_squeeze_events"."sell_volume" >= 0 AND "short_squeeze_events"."ask_depth" >= 0 AND "short_squeeze_events"."liquidation_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "taker_side" "order_side" NOT NULL;--> statement-breakpoint
ALTER TABLE "short_squeeze_events" ADD CONSTRAINT "short_squeeze_events_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "short_squeeze_one_active_stock" ON "short_squeeze_events" USING btree ("stock_id") WHERE "short_squeeze_events"."status" = 'active';--> statement-breakpoint
CREATE INDEX "short_squeeze_stock_started_idx" ON "short_squeeze_events" USING btree ("stock_id","started_at");