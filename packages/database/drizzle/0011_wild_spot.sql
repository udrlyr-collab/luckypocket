CREATE TABLE "liquidity_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stock_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"best_bid" bigint,
	"best_ask" bigint,
	"bid_depth" bigint DEFAULT 0 NOT NULL,
	"ask_depth" bigint DEFAULT 0 NOT NULL,
	"imbalance_bps" integer DEFAULT 0 NOT NULL,
	"spread_bps" integer,
	CONSTRAINT "liquidity_snapshots_values_valid" CHECK (("liquidity_snapshots"."best_bid" IS NULL OR "liquidity_snapshots"."best_bid" > 0) AND ("liquidity_snapshots"."best_ask" IS NULL OR "liquidity_snapshots"."best_ask" > 0) AND "liquidity_snapshots"."bid_depth" >= 0 AND "liquidity_snapshots"."ask_depth" >= 0 AND "liquidity_snapshots"."imbalance_bps" BETWEEN -10000 AND 10000 AND ("liquidity_snapshots"."spread_bps" IS NULL OR "liquidity_snapshots"."spread_bps" >= 0))
);
--> statement-breakpoint
ALTER TABLE "liquidity_snapshots" ADD CONSTRAINT "liquidity_snapshots_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "liquidity_snapshots_stock_captured_unique" ON "liquidity_snapshots" USING btree ("stock_id","captured_at");--> statement-breakpoint
CREATE INDEX "liquidity_snapshots_captured_idx" ON "liquidity_snapshots" USING btree ("captured_at");