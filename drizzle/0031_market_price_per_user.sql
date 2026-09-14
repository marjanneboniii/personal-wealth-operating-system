-- 0031_market_price_per_user.sql
--
-- Market price tracking becomes PER USER: every row belongs to the user who
-- recorded it, and every read/write is scoped to that user. Existing rows are
-- kept and assigned to the user who recorded them.

ALTER TABLE "market_price_snapshots" ADD COLUMN IF NOT EXISTS "user_id" uuid;--> statement-breakpoint
UPDATE "market_price_snapshots" SET "user_id" = "recorded_by" WHERE "user_id" IS NULL AND "recorded_by" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "market_price_snapshots" ADD CONSTRAINT "market_price_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP INDEX IF EXISTS "market_price_segment_date_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_price_user_segment_date_uq" ON "market_price_snapshots" USING btree ("user_id","neighborhood_id","property_type_id","area_band","observed_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_price_user_idx" ON "market_price_snapshots" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "market_price_snapshots" DROP COLUMN IF EXISTS "recorded_by";--> statement-breakpoint
ALTER TABLE "market_price_snapshots" DROP COLUMN IF EXISTS "source";
