-- 0022_wallex_asset_catalog.sql
--
-- PUBLIC MARKET DATA ONLY. This table holds exchange-published identities and
-- quotes keyed by symbol: no user id, no holding, no transaction, no
-- accounting value. It is never an authority for the ledger — a purchase still
-- records its own price and cost basis through the existing posting path — so
-- nothing here can move a balance, a lot or a journal entry.
--
-- WHY A SECOND CATALOGUE NEXT TO coingecko_asset_catalog
-- They answer different questions. CoinGecko supplies a global USD identity
-- for 23 curated coins — enough to VALUE a portfolio, not enough to FIND what
-- an Iranian user actually holds. Wallex publishes a few hundred assets named
-- in Persian by the source itself, quoted in BOTH تومان and تتر, with icons on
-- an Iranian host that resolves where CoinGecko's CDN often does not. It also
-- carries the tokenised metals (XAUT «تترگلد», PAXG «پکس گلد») that the
-- 23-coin list could not express at all.
--
-- WHY TWO PRICE COLUMNS AND NOT ONE
-- `price_tmn` is read from the TMN market and `price_usdt` from the USDT
-- market. A Toman market carries its own premium, so deriving either from the
-- other through a USD/IRT rate would produce a third figure matching neither
-- screen the user is comparing against. Both are nullable on purpose: a thin
-- asset trades in only one of the two markets, and the UI must be able to say
-- so instead of inventing the missing side.
--
-- Additive: creates one new table and its indexes. No existing table, column
-- or row is touched.

CREATE TABLE IF NOT EXISTS wallex_asset_catalog (
  symbol text PRIMARY KEY,
  display_name text NOT NULL,
  latin_name text NOT NULL,
  kind text NOT NULL,
  logo_url text,
  price_tmn numeric(38,18),
  price_usdt numeric(38,18),
  is_active boolean NOT NULL DEFAULT true,
  synced_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS wallex_catalog_kind_idx ON wallex_asset_catalog(kind);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS wallex_catalog_active_idx ON wallex_asset_catalog(is_active);
