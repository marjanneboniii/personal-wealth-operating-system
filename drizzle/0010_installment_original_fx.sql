ALTER TABLE "installments" ADD COLUMN IF NOT EXISTS "original_fx_rate" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "installments" ADD COLUMN IF NOT EXISTS "original_fx_rate_captured_at" timestamp with time zone;--> statement-breakpoint
UPDATE "installments"
   SET "original_fx_rate" = "amount_toman" / "amount_usd_created",
       "original_fx_rate_captured_at" = "created_at"
 WHERE "original_fx_rate" IS NULL
   AND "amount_toman" IS NOT NULL
   AND "amount_usd_created" IS NOT NULL
   AND "amount_usd_created" > 0;
