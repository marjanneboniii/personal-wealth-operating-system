-- 0013_assets_symbol_active_unique.sql
--
-- Align the physical uniqueness rule for assets.symbol with soft-delete
-- semantics used by RWA identifier generation. Active asset identities remain
-- unique, while soft-deleted tombstones no longer block reuse of compact RWA
-- symbols such as 001.
--
-- Non-destructive: no asset, journal_entry, posting, lot, valuation, or audit
-- rows are deleted or rewritten.

-- Drop both historical names defensively. Drizzle-created installs used
-- assets_symbol_unique; some PostgreSQL/native unique constraints may appear as
-- assets_symbol_key (the constraint name reported by production errors).
alter table "assets" drop constraint if exists "assets_symbol_unique";--> statement-breakpoint
alter table "assets" drop constraint if exists "assets_symbol_key";--> statement-breakpoint
drop index if exists "assets_symbol_unique";--> statement-breakpoint
drop index if exists "assets_symbol_key";--> statement-breakpoint

-- Only live rows participate in uniqueness. Multiple soft-deleted assets may
-- retain their historical symbol, and the next active RWA can reclaim it.
create unique index if not exists "assets_symbol_active_unique"
  on "assets" using btree ("symbol")
  where "deleted_at" is null;
