-- Compact, user-friendly property identity (2026-08-25).
--
-- 1. Real-estate asset names become the single short creative word «سرای».
--    The type, city and neighborhood were ALREADY stored in the structured
--    master-data columns, so repeating them in the name was pure noise.
-- 2. Zero-padded RWA symbols (`002`, `003`, …) collapse to the shortest form
--    (`2`, `3`, …). Only property/vehicle rows move — unrelated assets that
--    happen to look numeric (e.g. a reserved `001`) are never touched, and no
--    already-used value is reused (the same collision-safe mapping as 0008).
-- 3. Financial data is strictly out of scope: amounts, postings, lots, FX
--    snapshots, valuation history and ledger entries are never modified.
CREATE TEMP TABLE "rwa_compact_symbol_map" ON COMMIT DROP AS
WITH "target" AS (
  SELECT DISTINCT
    a."id",
    a."symbol" AS "old_symbol",
    row_number() OVER (ORDER BY a."created_at", a."id") AS "position"
  FROM "assets" a
  WHERE a."symbol" ~ '^0+[0-9]+$'
    AND (
      EXISTS (SELECT 1 FROM "real_estate_properties" p WHERE p."asset_id" = a."id")
      OR EXISTS (SELECT 1 FROM "vehicle_assets" v WHERE v."asset_id" = a."id")
    )
),
"free" AS (
  SELECT
    candidate."n"::text AS "new_symbol",
    row_number() OVER (ORDER BY candidate."n") AS "position"
  FROM generate_series(1, (SELECT count(*)::int FROM "assets") + 16) AS candidate("n")
  WHERE NOT EXISTS (
    SELECT 1 FROM "assets" occupied WHERE occupied."symbol" = candidate."n"::text
  )
)
SELECT
  target."id" AS "asset_id",
  target."old_symbol",
  "free"."new_symbol"
FROM "target"
JOIN "free" USING ("position");
--> statement-breakpoint
UPDATE "assets" a
SET "name" = 'سرای'
WHERE EXISTS (
  SELECT 1 FROM "real_estate_properties" p WHERE p."asset_id" = a."id"
);
--> statement-breakpoint
UPDATE "assets" a
SET "symbol" = m."new_symbol"
FROM "rwa_compact_symbol_map" m
WHERE a."id" = m."asset_id";
--> statement-breakpoint
