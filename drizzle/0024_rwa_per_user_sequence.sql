-- 0024_rwa_per_user_sequence.sql
--
-- Per-user identifiers for real assets.
--
-- Before: the visible identifier was assets.symbol, allocated from ONE global
-- counter shared by every user and by both properties and vehicles. A new
-- account's first property could therefore show up as 002 or 005.
--
-- After: each tenant-owned row carries user_seq, numbered 1, 2, … per
-- (user, kind). The UI renders it as «ملک ۱» / «خودرو ۱». assets.symbol stays
-- untouched as the internal, globally unique key (journal references, symbol
-- lookups and P&L grouping keep working).
--
-- Non-destructive: no journal_entry, posting, lot, valuation or audit row is
-- deleted or rewritten. The only data update renames assets whose display name
-- was the system-generated compact symbol (name = symbol) to the new label.

ALTER TABLE "real_estate_properties" ADD COLUMN IF NOT EXISTS "user_seq" integer;--> statement-breakpoint
ALTER TABLE "vehicle_assets" ADD COLUMN IF NOT EXISTS "user_seq" integer;--> statement-breakpoint

-- Backfill in registration order per user; continues after any value already set.
WITH taken AS (
  SELECT user_id, max(user_seq) AS max_seq FROM "real_estate_properties" GROUP BY user_id
), numbered AS (
  SELECT p.id,
         coalesce(t.max_seq, 0) + row_number() OVER (PARTITION BY p.user_id ORDER BY p.created_at, p.id) AS seq
  FROM "real_estate_properties" p
  LEFT JOIN taken t ON t.user_id IS NOT DISTINCT FROM p.user_id
  WHERE p.user_seq IS NULL
)
UPDATE "real_estate_properties" p SET user_seq = numbered.seq FROM numbered WHERE p.id = numbered.id;--> statement-breakpoint

WITH taken AS (
  SELECT user_id, max(user_seq) AS max_seq FROM "vehicle_assets" GROUP BY user_id
), numbered AS (
  SELECT v.id,
         coalesce(t.max_seq, 0) + row_number() OVER (PARTITION BY v.user_id ORDER BY v.created_at, v.id) AS seq
  FROM "vehicle_assets" v
  LEFT JOIN taken t ON t.user_id IS NOT DISTINCT FROM v.user_id
  WHERE v.user_seq IS NULL
)
UPDATE "vehicle_assets" v SET user_seq = numbered.seq FROM numbered WHERE v.id = numbered.id;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "real_estate_properties_user_seq_unique"
  ON "real_estate_properties" USING btree ("user_id", "user_seq");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_assets_user_seq_unique"
  ON "vehicle_assets" USING btree ("user_id", "user_seq");--> statement-breakpoint

-- Property assets were named after their compact symbol ("005"); give them the per-user label.
UPDATE "assets" a
SET name = 'ملک ' || translate(p.user_seq::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
    updated_at = now()
FROM "real_estate_properties" p
WHERE p.asset_id = a.id
  AND a.name = a.symbol
  AND p.user_seq IS NOT NULL;
