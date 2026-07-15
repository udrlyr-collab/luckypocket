ALTER TABLE "strategies" DROP CONSTRAINT "strategies_paper_ledger_valid";--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "daily_equity_date" text;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "daily_start_equity" bigint;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_paper_ledger_valid" CHECK ("strategies"."paper_initial_cash" > 0 AND "strategies"."paper_cash" >= 0 AND "strategies"."paper_quantity" >= 0 AND "strategies"."paper_cost_basis" >= 0 AND ("strategies"."daily_start_equity" IS NULL OR "strategies"."daily_start_equity" >= 0));