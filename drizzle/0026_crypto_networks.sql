-- 0026_crypto_networks.sql
--
-- Which network each coin lives on («evm», «bitcoin», «solana»…), synced from
-- CoinGecko platform data so a newly listed coin is classified automatically.
-- Market data only: no user, no accounting data. Additive.

CREATE TABLE IF NOT EXISTS "crypto_networks" (
  "symbol" text PRIMARY KEY NOT NULL,
  "coingecko_id" text,
  "networks" text NOT NULL,
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
