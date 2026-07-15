CREATE TYPE "public"."ipo_status" AS ENUM('announced', 'subscription', 'allocated', 'listed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('normal', 'warning', 'distress_review', 'delisting_review', 'halted', 'delisted');--> statement-breakpoint
CREATE TABLE "ipo_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"description" text NOT NULL,
	"status" "ipo_status" DEFAULT 'announced' NOT NULL,
	"offer_price" bigint NOT NULL,
	"total_shares" bigint NOT NULL,
	"offered_shares" bigint NOT NULL,
	"subscription_starts_at" timestamp with time zone NOT NULL,
	"subscription_ends_at" timestamp with time zone NOT NULL,
	"listing_at" timestamp with time zone NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ipo_campaign_values_valid" CHECK ("ipo_campaigns"."offer_price" > 0 AND "ipo_campaigns"."total_shares" > 0 AND "ipo_campaigns"."offered_shares" > 0 AND "ipo_campaigns"."offered_shares" <= "ipo_campaigns"."total_shares" AND "ipo_campaigns"."subscription_ends_at" > "ipo_campaigns"."subscription_starts_at" AND "ipo_campaigns"."listing_at" >= "ipo_campaigns"."subscription_ends_at")
);
--> statement-breakpoint
CREATE TABLE "ipo_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"requested_quantity" bigint NOT NULL,
	"allocated_quantity" bigint DEFAULT 0 NOT NULL,
	"reserved_amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ipo_subscriptions_values_valid" CHECK ("ipo_subscriptions"."requested_quantity" > 0 AND "ipo_subscriptions"."allocated_quantity" >= 0 AND "ipo_subscriptions"."allocated_quantity" <= "ipo_subscriptions"."requested_quantity" AND "ipo_subscriptions"."reserved_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"price_color_mode" text DEFAULT 'korean' NOT NULL,
	"locale" text DEFAULT 'ko-KR' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_values_valid" CHECK ("user_preferences"."price_color_mode" IN ('korean','global') AND "user_preferences"."locale" IN ('ko-KR','en-US'))
);
--> statement-breakpoint
ALTER TABLE "stocks" ADD COLUMN "listing_status" "listing_status" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "stocks" ADD COLUMN "listing_status_reason" text;--> statement-breakpoint
ALTER TABLE "stocks" ADD COLUMN "listing_review_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ipo_campaigns" ADD CONSTRAINT "ipo_campaigns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ipo_campaigns" ADD CONSTRAINT "ipo_campaigns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ipo_subscriptions" ADD CONSTRAINT "ipo_subscriptions_campaign_id_ipo_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ipo_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ipo_subscriptions" ADD CONSTRAINT "ipo_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ipo_campaigns_symbol_unique" ON "ipo_campaigns" USING btree ("symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "ipo_campaigns_company_active_unique" ON "ipo_campaigns" USING btree ("company_id") WHERE "ipo_campaigns"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "ipo_campaigns_status_deadline_idx" ON "ipo_campaigns" USING btree ("status","subscription_starts_at","subscription_ends_at","listing_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ipo_subscriptions_campaign_user_unique" ON "ipo_subscriptions" USING btree ("campaign_id","user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_read_created_idx" ON "notifications" USING btree ("user_id","read_at","created_at");