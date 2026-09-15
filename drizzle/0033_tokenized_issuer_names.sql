-- 0033_tokenized_issuer_names.sql
--
-- One company is often tokenised by several issuers — AMZNON (Ondo) and AMZNX
-- (xStocks) are both Amazon — so a tokenised stock, index, commodity or bond
-- now reads with a short Persian issuer tag: «آمازون اندو», «آمازون ایکس»,
-- «اسپیس‌ایکس بی». The catalogue sync writes new names that way; this
-- migration renames what is already stored. Names only: no posting, lot or
-- price is touched.

-- 1. Account names start with the asset name («آمازون - بیت‌پین»): rename them
--    first, while the asset still carries its old name.
UPDATE "accounts" ac
SET "name" = a."name" || ' ' || t.tag || substring(ac."name" from char_length(a."name") + 1)
FROM "assets" a
JOIN "asset_classes" c ON c."id" = a."class_id"
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN a."symbol" ~ '^[A-Z0-9]{2,}ON$' THEN 'اندو'
    WHEN a."symbol" ~ '^[A-Z0-9]{2,}X$' THEN 'ایکس'
    WHEN a."symbol" ~ '^[A-Z0-9]{2,}B$' THEN 'بی'
  END AS tag
) t
WHERE ac."asset_id" = a."id"
  AND c."code" IN ('equity', 'etf', 'commodity', 'security')
  AND t.tag IS NOT NULL
  AND a."name" NOT LIKE ('% ' || t.tag)
  AND left(ac."name", char_length(a."name")) = a."name";
--> statement-breakpoint

-- 2. The assets themselves.
UPDATE "assets" a
SET "name" = a."name" || ' ' || t.tag, "updated_at" = now()
FROM (
  SELECT x."id",
    CASE
      WHEN x."symbol" ~ '^[A-Z0-9]{2,}ON$' THEN 'اندو'
      WHEN x."symbol" ~ '^[A-Z0-9]{2,}X$' THEN 'ایکس'
      WHEN x."symbol" ~ '^[A-Z0-9]{2,}B$' THEN 'بی'
    END AS tag
  FROM "assets" x
  JOIN "asset_classes" c ON c."id" = x."class_id"
  WHERE c."code" IN ('equity', 'etf', 'commodity', 'security')
) t
WHERE a."id" = t."id"
  AND t.tag IS NOT NULL
  AND a."name" NOT LIKE ('% ' || t.tag);
--> statement-breakpoint

-- 3. The market catalogue (the next sync writes the same names).
UPDATE "wallex_asset_catalog" w
SET "display_name" = w."display_name" || ' ' || t.tag
FROM (
  SELECT symbol,
    CASE
      WHEN latin_name ~* '\mondo\M' THEN 'اندو'
      WHEN latin_name ~* 'xstock' THEN 'ایکس'
      WHEN latin_name ~* 'bstock' THEN 'بی'
      WHEN symbol ~ '^[A-Z0-9]{2,}ON$' THEN 'اندو'
      WHEN symbol ~ '^[A-Z0-9]{2,}X$' THEN 'ایکس'
      WHEN symbol ~ '^[A-Z0-9]{2,}B$' THEN 'بی'
    END AS tag
  FROM "wallex_asset_catalog"
  WHERE kind IN ('tokenized_stock', 'index', 'commodity', 'bond')
) t
WHERE w.symbol = t.symbol
  AND t.tag IS NOT NULL
  AND w."display_name" NOT LIKE ('% ' || t.tag);
