-- Compact real-world-asset identity migration.
--
-- Canonical storage uses ASCII (`001`, `002`, ...); the Persian UI renders the
-- same values as `۰۰۱`, `۰۰۲`, ... . Property and vehicle rows share ONE global
-- sequence because assets.symbol is globally unique.
--
-- Only identity metadata in assets is renamed. Journal entries, postings,
-- lots, valuation snapshots and all financial amounts remain untouched.
CREATE TEMP TABLE "rwa_symbol_migration_map" ON COMMIT DROP AS
WITH "target_assets" AS (
  SELECT DISTINCT
    a."id",
    a."symbol" AS "old_symbol",
    a."created_at",
    row_number() OVER (ORDER BY a."created_at", a."id") AS "position"
  FROM "assets" a
  WHERE EXISTS (
    SELECT 1 FROM "real_estate_properties" p WHERE p."asset_id" = a."id"
  ) OR EXISTS (
    SELECT 1 FROM "vehicle_assets" v WHERE v."asset_id" = a."id"
  )
),
"candidate_numbers" AS (
  SELECT
    candidate."n",
    lpad(candidate."n"::text, 3, '0') AS "new_symbol"
  FROM generate_series(
    1,
    (SELECT count(*)::int FROM "assets") + (SELECT count(*)::int FROM "target_assets") + 1
  ) AS candidate("n")
  WHERE NOT EXISTS (
    SELECT 1
    FROM "assets" occupied
    WHERE occupied."id" NOT IN (SELECT "id" FROM "target_assets")
      AND occupied."symbol" = lpad(candidate."n"::text, 3, '0')
  )
),
"ranked_candidates" AS (
  SELECT
    "new_symbol",
    row_number() OVER (ORDER BY "n") AS "position"
  FROM "candidate_numbers"
)
SELECT
  target."id" AS "asset_id",
  target."old_symbol",
  candidate."new_symbol"
FROM "target_assets" target
JOIN "ranked_candidates" candidate USING ("position");
--> statement-breakpoint
-- Move every target to a collision-free temporary namespace first. This also
-- makes swaps/re-numbering safe under assets_symbol_unique.
UPDATE "assets" a
SET "symbol" = '__RWA_SYMBOL_MIGRATION__' || a."id"::text,
    "updated_at" = now()
FROM "rwa_symbol_migration_map" mapping
WHERE a."id" = mapping."asset_id";
--> statement-breakpoint
UPDATE "assets" a
SET "symbol" = mapping."new_symbol",
    "updated_at" = now()
FROM "rwa_symbol_migration_map" mapping
WHERE a."id" = mapping."asset_id";
--> statement-breakpoint
-- Keep an explicit before/after trail without mutating prior audit or ledger
-- history. The current identity changes; historical evidence remains intact.
INSERT INTO "audit_log" (
  "action",
  "entity_type",
  "entity_id",
  "user_id",
  "result",
  "before_data",
  "after_data",
  "payload"
)
SELECT
  'MIGRATE_RWA_SHORT_SYMBOL',
  'asset',
  mapping."asset_id",
  coalesce(property."user_id", vehicle."user_id"),
  'SUCCESS',
  json_build_object('symbol', mapping."old_symbol")::text,
  json_build_object('symbol', mapping."new_symbol")::text,
  json_build_object('storage_digits', 'ascii', 'display_digits', 'persian')::text
FROM "rwa_symbol_migration_map" mapping
LEFT JOIN "real_estate_properties" property ON property."asset_id" = mapping."asset_id"
LEFT JOIN "vehicle_assets" vehicle ON vehicle."asset_id" = mapping."asset_id";
