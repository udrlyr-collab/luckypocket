CREATE TABLE "market_state_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sector_id" uuid,
	"strength" integer NOT NULL,
	"average_return_bps" integer NOT NULL,
	"breadth_bps" integer,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_state_snapshots_values_valid" CHECK ("market_state_snapshots"."strength" BETWEEN -100 AND 100 AND ("market_state_snapshots"."breadth_bps" IS NULL OR "market_state_snapshots"."breadth_bps" BETWEEN 0 AND 10000))
);
--> statement-breakpoint
ALTER TABLE "market_state_snapshots" ADD CONSTRAINT "market_state_snapshots_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_state_snapshots_market_idx" ON "market_state_snapshots" USING btree ("captured_at") WHERE "market_state_snapshots"."sector_id" IS NULL;--> statement-breakpoint
CREATE INDEX "market_state_snapshots_sector_idx" ON "market_state_snapshots" USING btree ("sector_id","captured_at");