CREATE TYPE "public"."time_in_force" AS ENUM('GTC', 'IOC');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "time_in_force" time_in_force DEFAULT 'GTC' NOT NULL;