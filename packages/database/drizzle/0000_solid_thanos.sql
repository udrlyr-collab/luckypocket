CREATE TYPE "public"."company_status" AS ENUM('private', 'ipo', 'listed', 'suspended', 'delisted');--> statement-breakpoint
CREATE TYPE "public"."order_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'open', 'partially_filled', 'filled', 'cancelled', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('market', 'limit', 'stop');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"request_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stock_id" uuid NOT NULL,
	"interval" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"open" bigint NOT NULL,
	"high" bigint NOT NULL,
	"low" bigint NOT NULL,
	"close" bigint NOT NULL,
	"volume" bigint NOT NULL,
	CONSTRAINT "candles_ohlc_valid" CHECK ("candles"."high" >= "candles"."open" AND "candles"."high" >= "candles"."close" AND "candles"."low" <= "candles"."open" AND "candles"."low" <= "candles"."close" AND "candles"."low" > 0 AND "candles"."volume" >= 0)
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sector_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "company_status" DEFAULT 'private' NOT NULL,
	"cash" bigint DEFAULT 0 NOT NULL,
	"debt" bigint DEFAULT 0 NOT NULL,
	"revenue" bigint DEFAULT 0 NOT NULL,
	"operating_profit" bigint DEFAULT 0 NOT NULL,
	"net_profit" bigint DEFAULT 0 NOT NULL,
	"book_value" bigint DEFAULT 0 NOT NULL,
	"management" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_cash_nonnegative" CHECK ("companies"."cash" >= 0),
	CONSTRAINT "companies_debt_nonnegative" CHECK ("companies"."debt" >= 0)
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stock_id" uuid NOT NULL,
	"quantity" bigint DEFAULT 0 NOT NULL,
	"reserved_quantity" bigint DEFAULT 0 NOT NULL,
	"cost_basis" bigint DEFAULT 0 NOT NULL,
	"realized_pnl" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holdings_quantities_valid" CHECK ("holdings"."quantity" >= 0 AND "holdings"."reserved_quantity" >= 0 AND "holdings"."reserved_quantity" <= "holdings"."quantity"),
	CONSTRAINT "holdings_cost_basis_nonnegative" CHECK ("holdings"."cost_basis" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stock_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"side" "order_side" NOT NULL,
	"type" "order_type" NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"limit_price" bigint,
	"stop_price" bigint,
	"quantity" bigint NOT NULL,
	"filled_quantity" bigint DEFAULT 0 NOT NULL,
	"reserved_amount" bigint DEFAULT 0 NOT NULL,
	"sequence" bigserial NOT NULL,
	"rejected_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_quantity_valid" CHECK ("orders"."quantity" > 0 AND "orders"."filled_quantity" >= 0 AND "orders"."filled_quantity" <= "orders"."quantity"),
	CONSTRAINT "orders_prices_valid" CHECK (("orders"."limit_price" IS NULL OR "orders"."limit_price" > 0) AND ("orders"."stop_price" IS NULL OR "orders"."stop_price" > 0)),
	CONSTRAINT "orders_reserved_amount_nonnegative" CHECK ("orders"."reserved_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"total_shares" bigint NOT NULL,
	"free_float_shares" bigint NOT NULL,
	"treasury_shares" bigint DEFAULT 0 NOT NULL,
	"current_price" bigint NOT NULL,
	"previous_close" bigint NOT NULL,
	"reference_price" bigint NOT NULL,
	"tick_size" bigint DEFAULT 1 NOT NULL,
	"is_trading_halted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stocks_share_counts_valid" CHECK ("stocks"."total_shares" > 0 AND "stocks"."free_float_shares" >= 0 AND "stocks"."treasury_shares" >= 0 AND "stocks"."free_float_shares" + "stocks"."treasury_shares" <= "stocks"."total_shares"),
	CONSTRAINT "stocks_prices_positive" CHECK ("stocks"."current_price" > 0 AND "stocks"."previous_close" > 0 AND "stocks"."reference_price" > 0 AND "stocks"."tick_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stock_id" uuid NOT NULL,
	"buy_order_id" uuid NOT NULL,
	"sell_order_id" uuid NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"seller_user_id" uuid NOT NULL,
	"price" bigint NOT NULL,
	"quantity" bigint NOT NULL,
	"buyer_fee" bigint DEFAULT 0 NOT NULL,
	"seller_fee" bigint DEFAULT 0 NOT NULL,
	"sequence" bigserial NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trades_price_quantity_positive" CHECK ("trades"."price" > 0 AND "trades"."quantity" > 0),
	CONSTRAINT "trades_users_distinct" CHECK ("trades"."buyer_user_id" <> "trades"."seller_user_id"),
	CONSTRAINT "trades_fees_nonnegative" CHECK ("trades"."buyer_fee" >= 0 AND "trades"."seller_fee" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"username" text NOT NULL,
	"nickname" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"cash" bigint DEFAULT 100000000 NOT NULL,
	"reserved_cash" bigint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_cash_nonnegative" CHECK ("users"."cash" >= 0),
	CONSTRAINT "users_reserved_cash_valid" CHECK ("users"."reserved_cash" >= 0 AND "users"."reserved_cash" <= "users"."cash")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candles" ADD CONSTRAINT "candles_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_buy_order_id_orders_id_fk" FOREIGN KEY ("buy_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_sell_order_id_orders_id_fk" FOREIGN KEY ("sell_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_seller_user_id_users_id_fk" FOREIGN KEY ("seller_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "candles_stock_interval_open_unique" ON "candles" USING btree ("stock_id","interval","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "holdings_user_stock_unique" ON "holdings" USING btree ("user_id","stock_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_user_idempotency_unique" ON "orders" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_book_idx" ON "orders" USING btree ("stock_id","status","side","limit_price","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_unique" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sectors_slug_unique" ON "sectors" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "stocks_symbol_unique" ON "stocks" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "trades_stock_sequence_idx" ON "trades" USING btree ("stock_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "users_nickname_unique" ON "users" USING btree ("nickname");