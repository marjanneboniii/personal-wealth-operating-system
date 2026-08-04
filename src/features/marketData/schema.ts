/**
 * Market Data Schema — CoinGecko Asset Mapping
 * Manages asset price mapping without touching accounting lots or transaction tables
 * Isolated mapping table coingecko_asset_mappings + updates SSOT price tables market_prices, market_snapshots, prices
 * No FK to Financial Core (accounts, journal_entries, postings, lots) — only logical internal_asset_id as text referencing assets.id
 */

import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const coingeckoAssetMappings = pgTable(
  "coingecko_asset_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    internalAssetId: text("internal_asset_id").notNull(),
    coingeckoId: text("coingecko_id").notNull().unique(),
    symbol: text("symbol"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (t) => [
    index("coingecko_mappings_asset_idx").on(t.internalAssetId),
    index("coingecko_mappings_symbol_idx").on(t.symbol),
  ],
);
