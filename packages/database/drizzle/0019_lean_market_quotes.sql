CREATE INDEX "orders_cancelled_cleanup_idx" ON "orders" USING btree ("updated_at") WHERE "orders"."status" = 'cancelled' AND "orders"."filled_quantity" = 0;
