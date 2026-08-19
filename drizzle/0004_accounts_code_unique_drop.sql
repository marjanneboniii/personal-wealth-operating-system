-- Repair leftover production UNIQUE(code) on accounts.
--
-- Neon/PostgreSQL still raises:
--   duplicate key value violates unique constraint "accounts_code_unique"
--
-- That name is drizzle's `.unique()` on a single column (`{table}_{column}_unique`).
-- Migration 0003 only dropped `accounts_code_key` (PostgreSQL's auto-name for
-- `code text NOT NULL UNIQUE` in raw SQL), so the real leftover constraint
-- survived. ON CONFLICT ("user_id","code") cannot catch it because the conflict
-- target does not match the unique index that is actually violated.
--
-- First Setup Wizard insert that fails is always the header row:
--   code=1000, name=دارایی‌ها
-- for the *new* tenant, colliding with another tenant's (or a leftover) 1000.
--
-- Intended multi-user uniqueness is (user_id, code), not code alone.
-- No journal / posting / lot / FIFO / historical row is touched.
ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "accounts_code_unique";--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "accounts_code_key";--> statement-breakpoint
DROP INDEX IF EXISTS "accounts_code_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "accounts_code_key";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_user_code_uq" ON "accounts" USING btree ("user_id","code");
