ALTER TABLE "trades" DROP CONSTRAINT "trades_fees_nonnegative";--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "seller_tax" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_fees_nonnegative" CHECK ("trades"."buyer_fee" >= 0 AND "trades"."seller_fee" >= 0 AND "trades"."seller_tax" >= 0);