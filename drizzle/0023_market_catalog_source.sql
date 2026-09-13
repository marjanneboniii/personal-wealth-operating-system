-- 0023_market_catalog_source.sql
--
-- A second PUBLIC market source for the same catalogue: آبان‌تتر.
--
-- Verified live on 2026-09-13 against https://api.abantether.com/manager/coins/data
-- (HTTP 200, no key, 998 coins): 87 tokenised US stocks, index / bond / gold
-- ETFs and commodity funds (xStock, Ondo, bStocks) — against 12 on والکس,
-- 17 on تبدیل, 5 on رمزینکس and 4 on صراف. Every Aban row carries a Tether
-- price and a Toman buy/sell quote.
--
-- `source` records which exchange a row came from, so a sync of one source
-- can never deactivate the other's rows, and a registration records where its
-- price is read. Existing rows are all Wallex, hence the default.
--
-- Additive: one column with a default, one index. No row is rewritten.

ALTER TABLE wallex_asset_catalog ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'wallex';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS wallex_catalog_source_idx ON wallex_asset_catalog(source);
