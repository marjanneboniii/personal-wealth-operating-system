/**
 * Observation Domain Schema — Isolated Cache/Read-Only Snapshot Tables
 * CRITICAL RULE: No FKs to Financial Core (accounts, journal_entries, postings, lots)
 * These tables are read-only caches for watch wallets, NOT accounting truth
 * Financial Core remains source of truth for owned assets
 */

import { date, index, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const money = (name: string) => numeric(name, { precision: 38, scale: 18 });

/**
 * watch_wallets: id (uuid PK), address (text unique), label (text), created_at
 * Isolated identity for watch-only wallets — separate from accounting wallets and wallet_identities
 * No FK to accounts/journal/postings/lots — only address
 */
export const watchWallets = pgTable(
  "watch_wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    address: text("address").notNull().unique(),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("watch_wallets_address_idx").on(t.address)],
);

/**
 * watch_wallet_portfolio_cache: wallet_address (text PK), total_value_usd, net_unrealized_pnl_usd, net_realized_pnl_usd, fetched_at
 * Cache of total portfolio value from Zerion/DeBank — NOT SSOT price, NOT ledger
 */
export const watchWalletPortfolioCache = pgTable(
  "watch_wallet_portfolio_cache",
  {
    walletAddress: text("wallet_address").primaryKey(),
    totalValueUSD: money("total_value_usd").notNull().default("0"),
    netUnrealizedPnlUSD: money("net_unrealized_pnl_usd").notNull().default("0"),
    netRealizedPnlUSD: money("net_realized_pnl_usd").notNull().default("0"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("watch_wallet_portfolio_cache_fetched_idx").on(t.fetchedAt)],
);

/**
 * watch_wallet_positions_cache: id (uuid PK), wallet_address, protocol_id, market_symbol, position_type (deposit, loan, staked, perp, yield), quantity, price_usd, value_usd, unrealized_pnl_usd, raw_json, fetched_at
 * Cache of DeFi positions — tokens, staking, deposits, loans, perps — observation only
 */
export const watchWalletPositionsCache = pgTable(
  "watch_wallet_positions_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletAddress: text("wallet_address").notNull(),
    protocolId: text("protocol_id"),
    marketSymbol: text("market_symbol"),
    positionType: text("position_type").notNull().default("deposit"), // deposit, loan, staked, perp, yield
    quantity: money("quantity").notNull().default("0"),
    priceUSD: money("price_usd"),
    valueUSD: money("value_usd"),
    unrealizedPnlUSD: money("unrealized_pnl_usd"),
    rawJson: text("raw_json"), // JSON string
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("watch_wallet_positions_wallet_idx").on(t.walletAddress),
    index("watch_wallet_positions_protocol_idx").on(t.protocolId),
    index("watch_wallet_positions_fetched_idx").on(t.fetchedAt),
  ],
);

/**
 * watch_wallet_transactions_cache: id (text PK), wallet_address, tx_hash, tx_type, status, fee_usd, summary, details_json, mined_at, fetched_at
 * Cache of wallet transactions history — observation only, never creates ledger entries
 */
export const watchWalletTransactionsCache = pgTable(
  "watch_wallet_transactions_cache",
  {
    id: text("id").primaryKey(), // Zerion tx id or hash
    walletAddress: text("wallet_address").notNull(),
    txHash: text("tx_hash"),
    txType: text("tx_type"), // send, receive, trade, approve, etc.
    status: text("status"), // confirmed, failed, pending
    feeUSD: money("fee_usd"),
    summary: text("summary"),
    detailsJson: text("details_json"), // JSON string
    minedAt: timestamp("mined_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("watch_wallet_txs_wallet_idx").on(t.walletAddress),
    index("watch_wallet_txs_mined_idx").on(t.minedAt),
    index("watch_wallet_txs_fetched_idx").on(t.fetchedAt),
  ],
);

/**
 * watch_wallet_nfts_cache: id (uuid PK), wallet_address, collection_name, nft_id, floor_price_usd, estimated_value_usd, raw_json, fetched_at
 * Cache of NFTs — observation only
 */
export const watchWalletNftsCache = pgTable(
  "watch_wallet_nfts_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletAddress: text("wallet_address").notNull(),
    collectionName: text("collection_name"),
    nftId: text("nft_id"),
    floorPriceUSD: money("floor_price_usd"),
    estimatedValueUSD: money("estimated_value_usd"),
    rawJson: text("raw_json"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("watch_wallet_nfts_wallet_idx").on(t.walletAddress),
    index("watch_wallet_nfts_collection_idx").on(t.collectionName),
  ],
);

/**
 * watch_wallet_perps_cache: id (uuid PK), wallet_address, exchange_protocol, market_pair, side (long/short), leverage, margin_usd, size, entry_price_usd, mark_price_usd, unrealized_pnl_usd, raw_json, fetched_at
 * Cache of perpetual positions — observation only
 */
export const watchWalletPerpsCache = pgTable(
  "watch_wallet_perps_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletAddress: text("wallet_address").notNull(),
    exchangeProtocol: text("exchange_protocol"),
    marketPair: text("market_pair"),
    side: text("side"), // long/short
    leverage: numeric("leverage", { precision: 10, scale: 2 }),
    marginUSD: money("margin_usd"),
    size: money("size"),
    entryPriceUSD: money("entry_price_usd"),
    markPriceUSD: money("mark_price_usd"),
    unrealizedPnlUSD: money("unrealized_pnl_usd"),
    rawJson: text("raw_json"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("watch_wallet_perps_wallet_idx").on(t.walletAddress),
    index("watch_wallet_perps_pair_idx").on(t.marketPair),
  ],
);
