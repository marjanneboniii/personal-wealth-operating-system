-- 0025_entry_fx_trade_snapshot.sql
--
-- Freeze what a buy / sell / swap actually was, next to the entry's FX snapshot:
-- the traded quantity, what left or reached the settlement account, the unit
-- price in Toman AND in Tether, the Toman-per-Tether rate of that moment, and
-- whether the price was the market price or a limit price the user typed.
--
-- Display and audit only — postings, lots and balances never read these
-- columns. Additive: nullable columns, no row is rewritten.

ALTER TABLE "entry_fx_snapshots" ADD COLUMN IF NOT EXISTS "trade_symbol" text;--> statement-breakpoint
ALTER TABLE "entry_fx_snapshots" ADD COLUMN IF NOT EXISTS "trade_quantity" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "entry_fx_snapshots" ADD COLUMN IF NOT EXISTS "settle_symbol" text;--> statement-breakpoint
ALTER TABLE "entry_fx_snapshots" ADD COLUMN IF NOT EXISTS "settle_quantity" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "entry_fx_snapshots" ADD COLUMN IF NOT EXISTS "unit_price_irt" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "entry_fx_snapshots" ADD COLUMN IF NOT EXISTS "unit_price_usdt" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "entry_fx_snapshots" ADD COLUMN IF NOT EXISTS "usdt_rate_irt" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "entry_fx_snapshots" ADD COLUMN IF NOT EXISTS "price_mode" text;
