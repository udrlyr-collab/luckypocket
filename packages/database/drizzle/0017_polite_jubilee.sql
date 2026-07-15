CREATE TYPE "public"."dividend_status" AS ENUM('declared', 'paid', 'cancelled');--> statement-breakpoint
CREATE TABLE "dividend_distributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"stock_id" uuid NOT NULL,
	"financial_report_id" uuid NOT NULL,
	"status" "dividend_status" DEFAULT 'declared' NOT NULL,
	"per_share" bigint NOT NULL,
	"total_amount" bigint NOT NULL,
	"record_date" timestamp with time zone NOT NULL,
	"payable_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dividend_distributions_values_valid" CHECK ("dividend_distributions"."per_share" > 0 AND "dividend_distributions"."total_amount" >= 0 AND "dividend_distributions"."payable_at" >= "dividend_distributions"."record_date")
);
--> statement-breakpoint
CREATE TABLE "dividend_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"distribution_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"quantity_snapshot" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "dividend_entitlements_values_valid" CHECK ("dividend_entitlements"."quantity_snapshot" > 0 AND "dividend_entitlements"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "dividend_distributions" ADD CONSTRAINT "dividend_distributions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dividend_distributions" ADD CONSTRAINT "dividend_distributions_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dividend_distributions" ADD CONSTRAINT "dividend_distributions_financial_report_id_financial_reports_id_fk" FOREIGN KEY ("financial_report_id") REFERENCES "public"."financial_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dividend_entitlements" ADD CONSTRAINT "dividend_entitlements_distribution_id_dividend_distributions_id_fk" FOREIGN KEY ("distribution_id") REFERENCES "public"."dividend_distributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dividend_entitlements" ADD CONSTRAINT "dividend_entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dividend_distributions_status_payable_idx" ON "dividend_distributions" USING btree ("status","payable_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dividend_entitlements_distribution_user_unique" ON "dividend_entitlements" USING btree ("distribution_id","user_id");