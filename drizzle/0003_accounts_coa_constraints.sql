-- Idempotent Chart-of-Accounts constraint repair.
--
-- Header/parent rows (1000 دارایی‌ها, 2000 بدهی‌ها, 3000 سرمایه, 4000 درآمد,
-- 5000 هزینه‌ها) are grouping accounts: asset_id and wallet_id stay NULL.
-- Money accounts (bank/cash) keep their own asset_id and are not rewritten.
--
-- Also restores the per-tenant uniqueness used by authenticated setup:
-- drop leftover global UNIQUE(code) and guarantee (user_id, code).
-- No journal / posting / lot / FIFO row is touched.
ALTER TABLE "accounts" ALTER COLUMN "asset_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "wallet_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "accounts_code_key";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_user_code_uq" ON "accounts" USING btree ("user_id","code");
