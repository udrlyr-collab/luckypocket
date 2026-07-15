CREATE TYPE "public"."management_action_type" AS ENUM('set_dividend', 'invest_rd', 'invest_marketing', 'invest_capex', 'repay_debt', 'borrow', 'buyback_proposal', 'rights_issue_proposal', 'sell_division', 'enter_business', 'replace_ceo', 'cost_cutting');--> statement-breakpoint
CREATE TYPE "public"."market_regime_type" AS ENUM('strong_bull', 'bull', 'sideways', 'bear', 'fear', 'recovery');--> statement-breakpoint
CREATE TABLE "corporate_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"fair_value_impact_bps" integer DEFAULT 0 NOT NULL,
	"demand_impact_bps" integer DEFAULT 0 NOT NULL,
	"liquidity_impact_bps" integer DEFAULT 0 NOT NULL,
	"volatility_impact_bps" integer DEFAULT 0 NOT NULL,
	"credit_risk_impact" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"revenue" bigint NOT NULL,
	"operating_profit" bigint NOT NULL,
	"net_profit" bigint NOT NULL,
	"cash" bigint NOT NULL,
	"debt" bigint NOT NULL,
	"book_value" bigint NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "management_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"executed_by_user_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"action_type" "management_action_type" NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_actions_amount_nonnegative" CHECK ("management_actions"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "market_regimes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"regime" "market_regime_type" NOT NULL,
	"strength" integer NOT NULL,
	"breadth_bps" integer NOT NULL,
	"average_return_bps" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "market_regimes_strength_valid" CHECK ("market_regimes"."strength" BETWEEN -100 AND 100 AND "market_regimes"."breadth_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "sector_states" (
	"sector_id" uuid PRIMARY KEY NOT NULL,
	"strength" integer DEFAULT 0 NOT NULL,
	"average_return_bps" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sector_states_strength_valid" CHECK ("sector_states"."strength" BETWEEN -100 AND 100)
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "growth_rate_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "brand_value" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "technology_score" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "risk_score" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "dividend_rate_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "controlled_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "controlled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "corporate_events" ADD CONSTRAINT "corporate_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_events" ADD CONSTRAINT "corporate_events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_reports" ADD CONSTRAINT "financial_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_actions" ADD CONSTRAINT "management_actions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_actions" ADD CONSTRAINT "management_actions_executed_by_user_id_users_id_fk" FOREIGN KEY ("executed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_states" ADD CONSTRAINT "sector_states_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corporate_events_company_starts_idx" ON "corporate_events" USING btree ("company_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_reports_company_period_unique" ON "financial_reports" USING btree ("company_id","period_key");--> statement-breakpoint
CREATE INDEX "financial_reports_company_published_idx" ON "financial_reports" USING btree ("company_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "management_actions_user_idempotency_unique" ON "management_actions" USING btree ("executed_by_user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "management_actions_company_created_idx" ON "management_actions" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_regimes_one_active" ON "market_regimes" USING btree (((1))) WHERE "market_regimes"."ended_at" IS NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_controlled_by_user_id_users_id_fk" FOREIGN KEY ("controlled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_scores_valid" CHECK ("companies"."growth_rate_bps" BETWEEN -10000 AND 100000 AND "companies"."brand_value" >= 0 AND "companies"."technology_score" BETWEEN 0 AND 1000 AND "companies"."risk_score" BETWEEN 0 AND 1000 AND "companies"."dividend_rate_bps" BETWEEN 0 AND 10000);