CREATE TYPE "public"."strategy_execution_mode" AS ENUM('PAPER', 'LIVE_VIRTUAL');--> statement-breakpoint
CREATE TYPE "public"."strategy_execution_status" AS ENUM('skipped', 'submitted', 'filled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."strategy_status" AS ENUM('DRAFT', 'BACKTEST', 'PAPER', 'LIVE_VIRTUAL', 'PAUSED');--> statement-breakpoint
CREATE TABLE "backtest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"definition" jsonb NOT NULL,
	"safety" jsonb NOT NULL,
	"candle_count" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backtest_runs_candles_valid" CHECK ("backtest_runs"."candle_count" >= 2 AND "backtest_runs"."ends_at" >= "backtest_runs"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stock_id" uuid NOT NULL,
	"name" text NOT NULL,
	"interval" text DEFAULT '1m' NOT NULL,
	"status" "strategy_status" DEFAULT 'DRAFT' NOT NULL,
	"definition" jsonb NOT NULL,
	"safety" jsonb NOT NULL,
	"paper_initial_cash" bigint DEFAULT 100000000 NOT NULL,
	"paper_cash" bigint DEFAULT 100000000 NOT NULL,
	"paper_quantity" bigint DEFAULT 0 NOT NULL,
	"paper_cost_basis" bigint DEFAULT 0 NOT NULL,
	"last_evaluated_candle_at" timestamp with time zone,
	"last_trade_at" timestamp with time zone,
	"live_confirmed_at" timestamp with time zone,
	"paused_from_status" "strategy_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategies_name_valid" CHECK (char_length("strategies"."name") BETWEEN 1 AND 100),
	CONSTRAINT "strategies_interval_valid" CHECK ("strategies"."interval" IN ('1m','5m','15m','1h','1d')),
	CONSTRAINT "strategies_paper_ledger_valid" CHECK ("strategies"."paper_initial_cash" > 0 AND "strategies"."paper_cash" >= 0 AND "strategies"."paper_quantity" >= 0 AND "strategies"."paper_cost_basis" >= 0)
);
--> statement-breakpoint
CREATE TABLE "strategy_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"mode" "strategy_execution_mode" NOT NULL,
	"status" "strategy_execution_status" NOT NULL,
	"candle_opened_at" timestamp with time zone NOT NULL,
	"order_id" uuid,
	"action" jsonb NOT NULL,
	"signal_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quantity" bigint DEFAULT 0 NOT NULL,
	"execution_price" bigint,
	"fee" bigint DEFAULT 0 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_executions_values_valid" CHECK ("strategy_executions"."quantity" >= 0 AND ("strategy_executions"."execution_price" IS NULL OR "strategy_executions"."execution_price" > 0) AND "strategy_executions"."fee" >= 0)
);
--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_stock_id_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_executions" ADD CONSTRAINT "strategy_executions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_executions" ADD CONSTRAINT "strategy_executions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backtest_runs_strategy_created_idx" ON "backtest_runs" USING btree ("strategy_id","created_at");--> statement-breakpoint
CREATE INDEX "strategies_user_status_idx" ON "strategies" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "strategies_active_stock_idx" ON "strategies" USING btree ("status","stock_id");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_executions_strategy_candle_unique" ON "strategy_executions" USING btree ("strategy_id","candle_opened_at");--> statement-breakpoint
CREATE INDEX "strategy_executions_strategy_created_idx" ON "strategy_executions" USING btree ("strategy_id","created_at");