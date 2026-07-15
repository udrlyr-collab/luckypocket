CREATE TYPE "public"."mna_campaign_status" AS ENUM('tendering', 'proxy_vote', 'resolved', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."mna_side" AS ENUM('attacker', 'defender');--> statement-breakpoint
CREATE TABLE "mna_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"side" "mna_side" NOT NULL,
	"action_type" text NOT NULL,
	"cash_amount" bigint DEFAULT 0 NOT NULL,
	"score_delta" bigint DEFAULT 0 NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mna_actions_values_valid" CHECK ("mna_actions"."cash_amount" >= 0 AND "mna_actions"."score_delta" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mna_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"stock_id" uuid NOT NULL,
	"attacker_user_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"defender_user_id" uuid,
	"status" "mna_campaign_status" DEFAULT 'tendering' NOT NULL,
	"offer_price" bigint NOT NULL,
	"committed_cash" bigint NOT NULL,
	"spent_cash" bigint DEFAULT 0 NOT NULL,
	"attacker_asset_snapshot" bigint NOT NULL,
	"attacker_ownership_snapshot" bigint NOT NULL,
	"defender_ownership_snapshot" bigint DEFAULT 0 NOT NULL,
	"attacker_score" bigint DEFAULT 0 NOT NULL,
	"defender_score" bigint DEFAULT 0 NOT NULL,
	"tender_ends_at" timestamp with time zone NOT NULL,
	"proxy_ends_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"winner_user_id" uuid,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mna_campaign_values_valid" CHECK ("mna_campaigns"."offer_price" > 0 AND "mna_campaigns"."committed_cash" > 0 AND "mna_campaigns"."spent_cash" >= 0 AND "mna_campaigns"."spent_cash" <= "mna_campaigns"."committed_cash" AND "mna_campaigns"."attacker_asset_snapshot" >= 0 AND "mna_campaigns"."attacker_ownership_snapshot" >= 0 AND "mna_campaigns"."defender_ownership_snapshot" >= 0 AND "mna_campaigns"."attacker_score" >= 0 AND "mna_campaigns"."defender_score" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mna_supports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"side" "mna_side" NOT NULL,
	"voting_rights_snapshot" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mna_support_rights_nonnegative" CHECK ("mna_supports"."voting_rights_snapshot" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mna_tender_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"shareholder_user_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"settled_amount" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mna_tender_values_valid" CHECK ("mna_tender_offers"."quantity" > 0 AND "mna_tender_offers"."settled_amount" >= 0 AND "mna_tender_offers"."status" IN ('reserved','settled','released'))
);
--> statement-breakpoint
ALTER TABLE "mna_actions" ADD CONSTRAINT "mna_actions_campaign_id_mna_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."mna_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mna_actions" ADD CONSTRAINT "mna_actions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mna_campaigns" ADD CONSTRAINT "mna_campaigns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mna_campaigns" ADD CONSTRAINT "mna_campaigns_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mna_campaigns" ADD CONSTRAINT "mna_campaigns_attacker_user_id_users_id_fk" FOREIGN KEY ("attacker_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mna_campaigns" ADD CONSTRAINT "mna_campaigns_defender_user_id_users_id_fk" FOREIGN KEY ("defender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mna_campaigns" ADD CONSTRAINT "mna_campaigns_winner_user_id_users_id_fk" FOREIGN KEY ("winner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mna_supports" ADD CONSTRAINT "mna_supports_campaign_id_mna_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."mna_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mna_supports" ADD CONSTRAINT "mna_supports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mna_tender_offers" ADD CONSTRAINT "mna_tender_offers_campaign_id_mna_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."mna_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mna_tender_offers" ADD CONSTRAINT "mna_tender_offers_shareholder_user_id_users_id_fk" FOREIGN KEY ("shareholder_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mna_actions_actor_idempotency_unique" ON "mna_actions" USING btree ("actor_user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "mna_actions_campaign_created_idx" ON "mna_actions" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mna_one_active_company" ON "mna_campaigns" USING btree ("company_id") WHERE "mna_campaigns"."status" IN ('tendering', 'proxy_vote');--> statement-breakpoint
CREATE UNIQUE INDEX "mna_campaign_attacker_idempotency_unique" ON "mna_campaigns" USING btree ("attacker_user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "mna_campaigns_status_deadline_idx" ON "mna_campaigns" USING btree ("status","tender_ends_at","proxy_ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mna_support_campaign_user_unique" ON "mna_supports" USING btree ("campaign_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mna_tender_campaign_shareholder_unique" ON "mna_tender_offers" USING btree ("campaign_id","shareholder_user_id");