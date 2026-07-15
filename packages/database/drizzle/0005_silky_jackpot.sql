CREATE TYPE "public"."order_purpose" AS ENUM('spot', 'leverage_close', 'liquidation');--> statement-breakpoint
CREATE TABLE "system_accounts" (
	"key" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leverage_positions" ADD COLUMN "close_order_id" uuid;--> statement-breakpoint
ALTER TABLE "leverage_positions" ADD COLUMN "close_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "purpose" "order_purpose" DEFAULT 'spot' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "position_id" uuid;--> statement-breakpoint
ALTER TABLE "system_accounts" ADD CONSTRAINT "system_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "system_accounts_user_unique" ON "system_accounts" USING btree ("user_id");