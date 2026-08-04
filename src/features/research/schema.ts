/**
 * Research Domain Schema — DeFi Research Metrics Cache Tables
 * Isolated DeFi research metrics cache, no FKs to Financial Core (accounts, journal_entries, postings, lots)
 * Read-only cache for DeFiLlama API data — TVL, chains, yields, stablecoins, fees/revenue
 */

import { numeric, pgTable, text, timestamp, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";

const money = (name: string) => numeric(name, { precision: 38, scale: 18 });

export const defiProtocolMetrics = pgTable(
  "defi_protocol_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    protocolSlug: text("protocol_slug").notNull().unique(),
    name: text("name"),
    category: text("category"),
    chain: text("chain"),
    tvlUSD: money("tvl_usd"),
    tvlChange24h: numeric("tvl_change_24h", { precision: 10, scale: 4 }),
    fees24h: money("fees_24h"),
    revenue24h: money("revenue_24h"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("defi_protocol_metrics_chain_idx").on(t.chain),
    index("defi_protocol_metrics_category_idx").on(t.category),
    index("defi_protocol_metrics_fetched_idx").on(t.fetchedAt),
  ],
);

export const defiChainTvl = pgTable(
  "defi_chain_tvl",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainName: text("chain_name").notNull().unique(),
    tvlUSD: money("tvl_usd"),
    tokenSymbol: text("token_symbol"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("defi_chain_tvl_fetched_idx").on(t.fetchedAt)],
);

export const defiYieldOpportunities = pgTable(
  "defi_yield_opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    poolId: text("pool_id").notNull().unique(),
    protocolSlug: text("protocol_slug"),
    chain: text("chain"),
    symbol: text("symbol"),
    tvlUSD: money("tvl_usd"),
    apy: numeric("apy", { precision: 10, scale: 4 }),
    apyBase: numeric("apy_base", { precision: 10, scale: 4 }),
    apyReward: numeric("apy_reward", { precision: 10, scale: 4 }),
    ilRisk: text("il_risk"), // yes/no
    rawJson: text("raw_json"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("defi_yield_chain_idx").on(t.chain),
    index("defi_yield_protocol_idx").on(t.protocolSlug),
    index("defi_yield_apy_idx").on(t.apy),
    index("defi_yield_tvl_idx").on(t.tvlUSD),
  ],
);

export const defiStablecoinsCache = pgTable(
  "defi_stablecoins_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stablecoinId: text("stablecoin_id").notNull().unique(),
    name: text("name"),
    symbol: text("symbol"),
    circulatingUSD: money("circulating_usd"),
    priceUSD: money("price_usd"),
    pegType: text("peg_type"),
    pegMechanism: text("peg_mechanism"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("defi_stablecoins_symbol_idx").on(t.symbol),
    index("defi_stablecoins_fetched_idx").on(t.fetchedAt),
  ],
);

export const defiFeesRevenue = pgTable(
  "defi_fees_revenue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetSlug: text("target_slug").notNull(),
    targetType: text("target_type").notNull().default("protocol"), // protocol/chain
    dailyFeesUSD: money("daily_fees_usd"),
    dailyRevenueUSD: money("daily_revenue_usd"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("defi_fees_target_slug_idx").on(t.targetSlug),
    index("defi_fees_type_idx").on(t.targetType),
    index("defi_fees_fetched_idx").on(t.fetchedAt),
  ],
);
