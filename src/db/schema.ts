/**
 * PWOS — Personal Wealth Operating System
 * Database schema (Phase 2 implementation).
 *
 * Rules enforced here:
 *  - No balance columns in the write model. Balances are derived from postings.
 *  - Reference tables instead of enums for assets, currencies, networks, institutions.
 *  - Immutable ledger: journal_entries are never edited; corrections use reversals.
 *  - Soft delete on reference/config tables only.
 */
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const money = (name: string) => numeric(name, { precision: 38, scale: 18 });

const base = {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

/* ------------------------------------------------------------------ */
/* Reference tables                                                     */
/* ------------------------------------------------------------------ */

export const currencies = pgTable("currencies", {
  ...base,
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  decimals: integer("decimals").notNull().default(2),
  isFiat: boolean("is_fiat").notNull().default(true),
});

export const assetClasses = pgTable("asset_classes", {
  ...base,
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#64748b"),
  sortOrder: integer("sort_order").notNull().default(0),
  parentId: uuid("parent_id"), // self-FK for hierarchy Crypto -> Tokenized -> etc., no DB FK constraint to avoid circular migration issues in init-schema, logical parent
  level: integer("level").notNull().default(0),
  attributesSchema: text("attributes_schema"), // JSON schema for expected metadata keys
});

export const networks = pgTable("networks", {
  ...base,
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  chainType: text("chain_type"),
  chainId: integer("chain_id").unique(),
  rpcUrl: text("rpc_url"),
  explorerUrl: text("explorer_url"),
  isEVM: boolean("is_evm").notNull().default(true),
  isTestnet: boolean("is_testnet").notNull().default(false),
});

export const institutions = pgTable("institutions", {
  ...base,
  kind: text("kind").notNull(), // bank | exchange | broker | other
  name: text("name").notNull(),
  country: text("country"),
});

export const assets = pgTable(
  "assets",
  {
    ...base,
    symbol: text("symbol").notNull().unique(),
    name: text("name").notNull(),
    classId: uuid("class_id")
      .notNull()
      .references(() => assetClasses.id),
    networkId: uuid("network_id").references(() => networks.id),
    currencyId: uuid("currency_id").references(() => currencies.id),
    decimals: integer("decimals").notNull().default(8),
    priceSource: text("price_source").notNull().default("manual"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [index("assets_class_idx").on(t.classId)],
);

export const wallets = pgTable("wallets", {
  ...base,
  name: text("name").notNull(),
  kind: text("kind").notNull(), // bank | exchange | hot | cold | cash | fund
  institutionId: uuid("institution_id").references(() => institutions.id),
  networkId: uuid("network_id").references(() => networks.id),
  address: text("address"),
  note: text("note"),
});

/* ------------------------------------------------------------------ */
/* Chart of accounts                                                    */
/* ------------------------------------------------------------------ */

export const accounts = pgTable(
  "accounts",
  {
    ...base,
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    type: text("type").notNull(), // asset | liability | equity | income | expense
    parentId: uuid("parent_id"),
    assetId: uuid("asset_id").references(() => assets.id),
    walletId: uuid("wallet_id").references(() => wallets.id),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [index("accounts_type_idx").on(t.type), index("accounts_asset_idx").on(t.assetId)],
);

/* ------------------------------------------------------------------ */
/* Immutable ledger                                                     */
/* ------------------------------------------------------------------ */

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    entryDate: date("entry_date").notNull(),
    type: text("type").notNull(), // transfer|buy|sell|income|expense|fx|debt|installment|adjustment|opening
    description: text("description").notNull(),
    reference: text("reference"),
    status: text("status").notNull().default("posted"), // posted | void
    reversalOf: uuid("reversal_of"),
    source: text("source").notNull().default("manual"), // manual | plan | import
  },
  (t) => [index("entries_date_idx").on(t.entryDate), index("entries_type_idx").on(t.type)],
);

export const postings = pgTable(
  "postings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    quantity: money("quantity").notNull(),
    baseValue: money("base_value").notNull(),
    memo: text("memo"),
  },
  (t) => [
    index("postings_account_idx").on(t.accountId, t.entryId),
    index("postings_asset_idx").on(t.assetId),
  ],
);

/* ------------------------------------------------------------------ */
/* FIFO lots                                                            */
/* ------------------------------------------------------------------ */

export const lots = pgTable(
  "lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    openEntryId: uuid("open_entry_id")
      .notNull()
      .references(() => journalEntries.id),
    openedAt: date("opened_at").notNull(),
    qtyOpened: money("qty_opened").notNull(),
    qtyRemaining: money("qty_remaining").notNull(),
    unitCostBase: money("unit_cost_base").notNull(),
  },
  (t) => [index("lots_lookup_idx").on(t.assetId, t.openedAt)],
);

export const lotConsumptions = pgTable("lot_consumptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lotId: uuid("lot_id")
    .notNull()
    .references(() => lots.id),
  entryId: uuid("entry_id")
    .notNull()
    .references(() => journalEntries.id),
  quantity: money("quantity").notNull(),
  costBase: money("cost_base").notNull(),
  proceedsBase: money("proceeds_base").notNull(),
  realizedPnl: money("realized_pnl").notNull(),
});

/* ------------------------------------------------------------------ */
/* Review workflow — "has a human confirmed this record?"              */
/* Separate from the ledger: review state is metadata, never changes  */
/* accounting truth. Manual entries are auto-reviewed on creation;    */
/* imported entries start unreviewed until a human confirms them.     */
/* ------------------------------------------------------------------ */

export const entryReviews = pgTable("entry_reviews", {
  entryId: uuid("entry_id")
    .primaryKey()
    .references(() => journalEntries.id, { onDelete: "cascade" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Prices & snapshots                                                   */
/* ------------------------------------------------------------------ */

export const prices = pgTable(
  "prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    asOf: date("as_of").notNull(),
    priceBase: money("price_base").notNull(),
    source: text("source").notNull().default("manual"),
  },
  (t) => [uniqueIndex("prices_asset_date_uq").on(t.assetId, t.asOf)],
);

export const marketPriceSources = pgTable("market_price_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  name: text("name").notNull().unique(), // MANUAL | COINGECKO | TSETMC | API | IMPORT
  type: text("type").notNull().default("manual"), // manual | api | import
  description: text("description"),
});

export const marketPrices = pgTable(
  "market_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    price: money("price").notNull(),
    currencyId: uuid("currency_id").references(() => currencies.id),
    priceTimestamp: timestamp("price_timestamp", { withTimezone: true }).notNull().defaultNow(),
    sourceId: uuid("source_id").references(() => marketPriceSources.id),
  },
  (t) => [index("market_prices_asset_idx").on(t.assetId)],
);

export const marketSnapshots = pgTable(
  "market_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    snapshotDate: date("snapshot_date").notNull(),
    price: money("price").notNull(),
    currencyId: uuid("currency_id").references(() => currencies.id),
    sourceId: uuid("source_id").references(() => marketPriceSources.id),
  },
  (t) => [uniqueIndex("market_snapshots_uq").on(t.assetId, t.snapshotDate, t.sourceId)],
);

export const portfolioValuations = pgTable(
  "portfolio_valuations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    userId: uuid("user_id").references(() => users.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    quantity: money("quantity").notNull(),
    marketPrice: money("market_price").notNull(),
    marketCurrencyId: uuid("market_currency_id").references(() => currencies.id),
    totalValue: money("total_value").notNull(),
    valuationDate: date("valuation_date").notNull(),
  },
  (t) => [index("portfolio_valuations_date_idx").on(t.valuationDate)],
);

export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    userId: uuid("user_id").references(() => users.id),
    snapshotDate: date("snapshot_date").notNull().unique(),
    totalPortfolioValue: money("total_portfolio_value").notNull(),
    baseCurrencyId: uuid("base_currency_id").references(() => currencies.id),
  },
  (t) => [uniqueIndex("portfolio_snapshots_asof_uq").on(t.snapshotDate)],
);

export const assetPerformance = pgTable("asset_performance", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  startingValue: money("starting_value").notNull(),
  endingValue: money("ending_value").notNull(),
  absoluteChange: money("absolute_change").notNull(),
  percentageChange: money("percentage_change").notNull(),
});

export const wealthPerformanceSnapshots = pgTable("wealth_performance_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  userId: uuid("user_id").references(() => users.id),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  startingValue: money("starting_value").notNull(),
  endingValue: money("ending_value").notNull(),
  absoluteChange: money("absolute_change").notNull(),
  percentageChange: money("percentage_change").notNull(),
  currencyId: uuid("currency_id").references(() => currencies.id),
});

export const assetPerformanceAnalysis = pgTable("asset_performance_analysis", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  userId: uuid("user_id").references(() => users.id),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  startingValue: money("starting_value").notNull(),
  endingValue: money("ending_value").notNull(),
  absoluteChange: money("absolute_change").notNull(),
  percentageChange: money("percentage_change").notNull(),
  contributionPercentage: money("contribution_percentage").notNull(),
});

export const portfolioRiskMetrics = pgTable("portfolio_risk_metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  userId: uuid("user_id").references(() => users.id),
  snapshotDate: date("snapshot_date").notNull(),
  largestAssetSymbol: text("largest_asset_symbol"),
  largestAssetPercentage: money("largest_asset_percentage").notNull(),
  cryptoExposurePercentage: money("crypto_exposure_percentage").notNull(),
  maxDrawdownPercentage: money("max_drawdown_percentage").notNull(),
  riskScore: text("risk_score").notNull().default("moderate"),
});

export const benchmarkDefinitions = pgTable("benchmark_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull().unique(), // BTC | GOLD | SP500 | USD | NASDAQ | ETH
  type: text("type").notNull().default("crypto"), // crypto | commodity | index | fiat
  description: text("description"),
});

export const benchmarkSnapshots = pgTable(
  "benchmark_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    benchmarkId: uuid("benchmark_id")
      .notNull()
      .references(() => benchmarkDefinitions.id, { onDelete: "cascade" }),
    snapshotDate: date("snapshot_date").notNull(),
    price: money("price").notNull(),
    currencyId: uuid("currency_id").references(() => currencies.id),
  },
  (t) => [uniqueIndex("benchmark_snapshots_uq").on(t.benchmarkId, t.snapshotDate)],
);

export const benchmarkResults = pgTable("benchmark_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  userId: uuid("user_id").references(() => users.id),
  benchmarkAssetSymbol: text("benchmark_asset_symbol").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  portfolioReturn: money("portfolio_return").notNull(),
  benchmarkReturn: money("benchmark_return").notNull(),
  difference: money("difference").notNull(),
});

export const analyticsRuns = pgTable("analytics_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  userId: uuid("user_id").references(() => users.id),
  runType: text("run_type").notNull().default("dashboard"),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  calculationVersion: text("calculation_version").notNull().default("v1.0"),
  sourceSnapshotReference: text("source_snapshot_reference"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const snapshots = pgTable(
  "snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    asOf: date("as_of").notNull(),
    baseCurrency: text("base_currency").notNull().default("USD"),
    totalAssets: money("total_assets").notNull(),
    totalLiabilities: money("total_liabilities").notNull(),
    netWorth: money("net_worth").notNull(),
  },
  (t) => [uniqueIndex("snapshots_asof_uq").on(t.asOf)],
);

export const snapshotLines = pgTable("snapshot_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshotId: uuid("snapshot_id")
    .notNull()
    .references(() => snapshots.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id),
  quantity: money("quantity").notNull(),
  priceBase: money("price_base").notNull(),
  valueBase: money("value_base").notNull(),
});

/* ------------------------------------------------------------------ */
/* Planning domain                                                      */
/* ------------------------------------------------------------------ */

export const goals = pgTable("goals", {
  ...base,
  name: text("name").notNull(),
  description: text("description"),
  targetBase: money("target_base").notNull(),
  targetDate: date("target_date"),
  priority: integer("priority").notNull().default(2),
  status: text("status").notNull().default("active"), // active | reached | archived
  fundAccountId: uuid("fund_account_id").references(() => accounts.id),
});

export const goalContributions = pgTable("goal_contributions", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  entryId: uuid("entry_id").references(() => journalEntries.id),
  amountBase: money("amount_base").notNull(),
  occurredAt: date("occurred_at").notNull(),
  note: text("note"),
});

export const events = pgTable("events", {
  ...base,
  name: text("name").notNull(),
  category: text("category").notNull().default("other"), // trip | ceremony | gift | purchase | other
  eventDate: date("event_date").notNull(),
  budgetBase: money("budget_base").notNull(),
  status: text("status").notNull().default("planned"), // planned | done | cancelled
  note: text("note"),
});

export const eventItems = pgTable("event_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  amountBase: money("amount_base").notNull(),
  isPaid: boolean("is_paid").notNull().default(false),
});

export const budgets = pgTable("budgets", {
  ...base,
  name: text("name").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  accountId: uuid("account_id").references(() => accounts.id),
  amountBase: money("amount_base").notNull(),
});

export const plannedTransactions = pgTable(
  "planned_transactions",
  {
    ...base,
    title: text("title").notNull(),
    plannedDate: date("planned_date").notNull(),
    direction: text("direction").notNull(), // inflow | outflow
    amountBase: money("amount_base").notNull(),
    fromAccountId: uuid("from_account_id").references(() => accounts.id),
    toAccountId: uuid("to_account_id").references(() => accounts.id),
    assetId: uuid("asset_id").references(() => assets.id),
    recurrence: text("recurrence").notNull().default("none"), // none | monthly | yearly
    status: text("status").notNull().default("pending"), // pending | executed | cancelled
    executedEntryId: uuid("executed_entry_id").references(() => journalEntries.id),
    goalId: uuid("goal_id").references(() => goals.id),
    eventId: uuid("event_id").references(() => events.id),
    note: text("note"),
  },
  (t) => [index("planned_date_idx").on(t.plannedDate, t.status)],
);

/* ------------------------------------------------------------------ */
/* Liabilities                                                          */
/* ------------------------------------------------------------------ */

export const debts = pgTable("debts", {
  ...base,
  creditor: text("creditor").notNull(),
  title: text("title").notNull(),
  principalBase: money("principal_base").notNull(),
  interestRate: numeric("interest_rate", { precision: 8, scale: 4 }).notNull().default("0"),
  startDate: date("start_date").notNull(),
  accountId: uuid("account_id").references(() => accounts.id),
  status: text("status").notNull().default("active"), // active | settled
});

export const installments = pgTable(
  "installments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    debtId: uuid("debt_id")
      .notNull()
      .references(() => debts.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    dueDate: date("due_date").notNull(),
    amountBase: money("amount_base").notNull(),
    status: text("status").notNull().default("pending"), // pending | paid
    paidEntryId: uuid("paid_entry_id").references(() => journalEntries.id),
    paidAt: date("paid_at"),
  },
  (t) => [index("installments_due_idx").on(t.dueDate, t.status)],
);

export const obligations = pgTable("obligations", {
  ...base,
  title: text("title").notNull(),
  amountBase: money("amount_base").notNull(),
  dueDate: date("due_date").notNull(),
  recurrence: text("recurrence").notNull().default("none"),
  status: text("status").notNull().default("pending"),
  note: text("note"),
});

export const funds = pgTable("funds", {
  ...base,
  name: text("name").notNull(),
  kind: text("kind").notNull(), // emergency | reserve | family_support
  targetBase: money("target_base").notNull(),
  accountId: uuid("account_id").references(() => accounts.id),
  note: text("note"),
});

/* Asset Registry Extension — Hierarchy + Multi-Chain                    */
/* ------------------------------------------------------------------ */
// parentId self reference logical, no DB FK to avoid circular init issues, but level tracks depth
// Existing assetClasses now has parentId, level, attributesSchema added above

export const assetNetworks = pgTable(
  "asset_networks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    networkId: uuid("network_id")
      .notNull()
      .references(() => networks.id),
    contractAddress: text("contract_address"),
    chainId: integer("chain_id"),
    decimals: integer("decimals"),
    tokenStandard: text("token_standard"), // ERC20, SPL, etc.
    isPrimary: boolean("is_primary").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    explorerUrl: text("explorer_url"),
    logoUri: text("logo_uri"),
  },
  (t) => [
    uniqueIndex("asset_networks_uq").on(t.assetId, t.networkId, t.contractAddress),
    index("asset_networks_asset_idx").on(t.assetId),
    index("asset_networks_network_idx").on(t.networkId),
  ],
);

export const assetTokenMetadata = pgTable("asset_token_metadata", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" })
    .unique(),
  underlyingAssetId: uuid("underlying_asset_id").references(() => assets.id),
  logoUri: text("logo_uri"),
  coingeckoId: text("coingecko_id"),
  coinMarketCapId: text("coinmarketcap_id"),
  websiteUrl: text("website_url"),
  description: text("description"),
});

/* RWA Domain — Identity, Ownership, Valuation Separation              */
/* ------------------------------------------------------------------ */
// NOTE: No FK to journal_entries, postings, lots — only assets, users, currencies, debts

export const realEstateProperties = pgTable(
  "real_estate_properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" })
      .unique(),
    userId: uuid("user_id").references(() => users.id),
    propertyType: text("property_type").notNull().default("apartment"), // apartment | house | land | commercial
    city: text("city").notNull().default("Ahvaz"),
    area: text("area"), // Kianpars, Golestan, Shahrak Daneshgah, Padad, Kianabad, Zeytoon
    address: text("address"),
    sizeSqm: numeric("size_sqm", { precision: 10, scale: 2 }),
    floor: integer("floor"),
    yearBuilt: integer("year_built"),
    deedNumber: text("deed_number"),
    notes: text("notes"),
  },
  (t) => [
    index("real_estate_properties_user_idx").on(t.userId),
    index("real_estate_properties_city_area_idx").on(t.city, t.area),
  ],
);

export const vehicleAssets = pgTable(
  "vehicle_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" })
      .unique(),
    userId: uuid("user_id").references(() => users.id),
    brand: text("brand").notNull(),
    model: text("model").notNull(),
    year: integer("year").notNull(),
    licensePlate: text("license_plate"),
    chassisNumber: text("chassis_number"),
    mileage: integer("mileage"),
    notes: text("notes"),
  },
  (t) => [index("vehicle_assets_user_idx").on(t.userId)],
);

export const rwaOwnershipRecords = pgTable(
  "rwa_ownership_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id),
    ownershipPercentage: numeric("ownership_percentage", { precision: 5, scale: 2 }).notNull().default("100"),
    ownershipType: text("ownership_type").notNull().default("full"), // full | partial | partnership | inherited | mortgaged
    acquisitionDate: date("acquisition_date").notNull(),
    acquisitionPriceIRR: money("acquisition_price_irr"),
    acquisitionPriceUSD: money("acquisition_price_usd"),
    acquisitionCurrencyId: uuid("acquisition_currency_id").references(() => currencies.id),
    debtId: uuid("debt_id").references(() => debts.id, { onDelete: "set null" }), // mortgage attached
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
  },
  (t) => [
    index("rwa_ownership_asset_idx").on(t.assetId),
    index("rwa_ownership_user_idx").on(t.userId),
  ],
);

export const rwaValuationEvents = pgTable(
  "rwa_valuation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    valuationDate: date("valuation_date").notNull(),
    priceIRR: money("price_irr"),
    priceUSD: money("price_usd"),
    priceBase: money("price_base"), // generic base if needed
    currencyId: uuid("currency_id").references(() => currencies.id),
    valuationSource: text("valuation_source").notNull().default("manual"), // manual | appraisal | market_estimate | spot | book_value
    appraiser: text("appraiser"),
    sourceId: uuid("source_id").references(() => marketPriceSources.id),
    note: text("note"),
  },
  (t) => [
    index("rwa_valuation_asset_date_idx").on(t.assetId, t.valuationDate),
    uniqueIndex("rwa_valuation_asset_date_source_uq").on(t.assetId, t.valuationDate, t.valuationSource),
  ],
);

/* ------------------------------------------------------------------ */
/* Valuation Engine — Source -> Event -> Engine                         */
/* ------------------------------------------------------------------ */

export const valuationSources = pgTable(
  "valuation_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" })
      .unique(),
    sourceType: text("source_type").notNull().default("market_price"), // market_price | spot_price | appraisal | manual | book_value
    primaryProviderName: text("primary_provider_name").notNull().default("MANUAL"), // COINGECKO, TSETMC, MANUAL, APPRAISAL, etc.
    backupProviderName: text("backup_provider_name"),
    isActive: boolean("is_active").notNull().default(true),
    config: text("config"), // JSON config
  },
  (t) => [index("valuation_sources_asset_idx").on(t.assetId)],
);

export const valuationEvents = pgTable(
  "valuation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    valuationDate: date("valuation_date").notNull(),
    price: money("price").notNull(),
    currencyId: uuid("currency_id").references(() => currencies.id),
    sourceType: text("source_type").notNull().default("market_price"),
    providerName: text("provider_name").notNull().default("MANUAL"),
    sourceId: uuid("source_id").references(() => marketPriceSources.id),
    metadata: text("metadata"), // JSON additional
    note: text("note"),
  },
  (t) => [
    index("valuation_events_asset_date_idx").on(t.assetId, t.valuationDate),
    uniqueIndex("valuation_events_asset_date_provider_uq").on(t.assetId, t.valuationDate, t.providerName),
  ],
);

/* Market Data — CoinGecko Mapping                                        */
/* ------------------------------------------------------------------ */

export const coingeckoAssetMappings = pgTable(
  "coingecko_asset_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    internalAssetId: text("internal_asset_id").notNull(), // uuid text for flexibility, references assets.id logically
    coingeckoId: text("coingecko_id").notNull().unique(),
    symbol: text("symbol"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (t) => [
    index("coingecko_mappings_asset_idx").on(t.internalAssetId),
    index("coingecko_mappings_symbol_idx").on(t.symbol),
  ],
);

/* ------------------------------------------------------------------ */
/* Commodities Domain — Dynamic Price Tracking & Inflation Analytics    */
/* ------------------------------------------------------------------ */
// No FK to Financial Core — isolated tables

export const commodityCategories = pgTable(
  "commodity_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("commodity_categories_name_idx").on(t.name)],
);

export const commodityItems = pgTable(
  "commodity_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    categoryId: uuid("category_id").references(() => commodityCategories.id, { onDelete: "set null" }),
    defaultUnit: text("default_unit").notNull().default("piece"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("commodity_items_name_idx").on(t.name),
    index("commodity_items_category_idx").on(t.categoryId),
  ],
);

export const commodityPriceRecords = pgTable(
  "commodity_price_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commodityId: uuid("commodity_id")
      .notNull()
      .references(() => commodityItems.id, { onDelete: "cascade" }),
    unitPrice: money("unit_price").notNull(),
    unit: text("unit").notNull().default("piece"),
    quantity: money("quantity").notNull().default("1"),
    totalAmount: money("total_amount").notNull(),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
    merchantName: text("merchant_name"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("commodity_price_commodity_idx").on(t.commodityId),
    index("commodity_price_purchased_idx").on(t.purchasedAt),
    index("commodity_price_merchant_idx").on(t.merchantName),
  ],
);


/* ------------------------------------------------------------------ */
/* Presentation Layer — Historical FX Snapshot (Freeze on Commit)      */
/* Purely for display & audit, never used for accounting logic.        */
/* Written atomically with ledger entry, immutable after creation.     */
/* ------------------------------------------------------------------ */

export const entryFxSnapshots = pgTable(
  "entry_fx_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" })
      .unique(),
    // User input in IRT (reference amount)
    irtAmount: money("irt_amount").notNull(),
    // Computed USD at commit time using latest rate
    usdAmount: money("usd_amount").notNull(),
    // Rate snapshot: IRT per 1 USD
    fxRate: money("fx_rate").notNull(),
    rateSource: text("rate_source").notNull().default("settings"),
    rateDate: date("rate_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("entry_fx_snap_entry_idx").on(t.entryId)],
);

/* ------------------------------------------------------------------ */
/* Platform                                                             */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  ...base,
  name: text("name").notNull(),
  role: text("role").notNull().default("owner"),
  pinHash: text("pin_hash"),
  username: text("username").unique(),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  googleId: text("google_id").unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
});

export const settings = pgTable("settings", {
  ...base,
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  title: text("title").notNull(),
  body: text("body"),
  level: text("level").notNull().default("info"),
  readAt: timestamp("read_at", { withTimezone: true }),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  payload: text("payload"),
});

export const userSetupState = pgTable("user_setup_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  completed: boolean("completed").notNull().default(false),
  currentStep: integer("current_step").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importJobs = pgTable("import_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  source: text("source").notNull().default("csv"), // csv | clipboard | exchange
  status: text("status").notNull().default("pending"), // pending | processing | completed | failed | cancelled
  rowCount: integer("row_count").notNull().default(0),
  validCount: integer("valid_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const importRecords = pgTable("import_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  importJobId: uuid("import_job_id")
    .notNull()
    .references(() => importJobs.id, { onDelete: "cascade" }),
  rawData: text("raw_data").notNull(), // JSON string of row
  status: text("status").notNull().default("valid"), // valid | invalid | skipped
  errorMessage: text("error_message"),
  mappedTransactionId: uuid("mapped_transaction_id").references(() => journalEntries.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const backupRuns = pgTable("backup_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  kind: text("kind").notNull().default("export"),
  schemaVersion: text("schema_version").notNull().default("1.0"),
  rowCount: integer("row_count").notNull().default(0),
  note: text("note"),
});

/* ------------------------------------------------------------------ */
/* FX Engine & Display Layer (Phase 2.6)                               */
/* Valuation reference data ONLY — never touches ledger tables.        */
/* ------------------------------------------------------------------ */

export const exchangeRates = pgTable(
  "exchange_rates",
  {
    ...base,
    baseCurrency: text("base_currency").notNull(),
    quoteCurrency: text("quote_currency").notNull(),
    rate: money("rate").notNull(),
    source: text("source").notNull().default("manual"),
    effectiveDate: date("effective_date").notNull(),
  },
  (t) => [
    uniqueIndex("exchange_rates_pair_date_unique").on(
      t.baseCurrency,
      t.quoteCurrency,
      t.effectiveDate,
    ),
  ],
);

export const userDisplayPreferences = pgTable(
  "user_display_preferences",
  {
    ...base,
    userId: uuid("user_id").references(() => users.id),
    displayCurrency: text("display_currency").notNull().default("USD"),
  },
  (t) => [index("user_display_preferences_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------------ */
/* External Market Data Provider Layer (Phase 2.7)                     */
/* Reference/market-observation data ONLY.                             */
/* CRITICAL: No FK to journal_entries, postings, accounts, lots,       */
/* lot_consumptions — only to reference tables (assets, wallets, users)*/
/* ------------------------------------------------------------------ */

export const externalProviders = pgTable("external_providers", {
  ...base,
  name: text("name").notNull().unique(), // coingecko | binance | coinbase | mock
  displayName: text("display_name").notNull(),
  providerType: text("provider_type").notNull().default("crypto"), // crypto | stocks | tokenized_assets | fx
  baseUrl: text("base_url"),
  description: text("description"),
});

export const assetProviderMappings = pgTable(
  "asset_provider_mappings",
  {
    ...base,
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => externalProviders.id),
    externalSymbol: text("external_symbol").notNull(),
    externalName: text("external_name"),
    providerAssetId: text("provider_asset_id"), // e.g. Coingecko coin id "bitcoin"
    assetType: text("asset_type").notNull().default("crypto"), // crypto | tokenized_asset | stock
    logoUrl: text("logo_url"),
    supportedMarkets: text("supported_markets"), // CSV or JSON array string, e.g. "USD,IRT,USDT"
    metadataJson: text("metadata_json"),
  },
  (t) => [
    uniqueIndex("asset_provider_mappings_pair_unique").on(t.assetId, t.providerId),
  ],
);

export const externalPriceHistory = pgTable(
  "external_price_history",
  {
    ...base,
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => externalProviders.id),
    price: money("price").notNull(),
    currency: text("currency").notNull().default("USD"),
    asOfDate: date("as_of_date").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    isCurrent: boolean("is_current").notNull().default(true),
    rawResponse: text("raw_response"),
  },
  (t) => [
    uniqueIndex("external_price_history_unique").on(
      t.assetId,
      t.providerId,
      t.asOfDate,
      t.currency,
    ),
    index("external_price_history_asset_idx").on(t.assetId),
  ],
);


/* ------------------------------------------------------------------ */
/* Authentication & Per-User FX (New: username/password + Google)      */
/* ------------------------------------------------------------------ */

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_token_idx").on(t.token)],
);

export const userFxSettings = pgTable(
  "user_fx_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .unique(),
    currentRate: money("current_rate").notNull().default("190000"),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [index("user_fx_settings_user_idx").on(t.userId)],
);

export const walletObservations = pgTable(
  "wallet_observations",
  {
    ...base,
    userId: uuid("user_id").references(() => users.id),
    walletId: uuid("wallet_id").references(() => wallets.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    observedBalance: money("observed_balance").notNull(),
    recordedBalance: money("recorded_balance").notNull(),
    discrepancy: money("discrepancy").notNull(),
    observationDate: date("observation_date").notNull(),
    source: text("source").notNull().default("manual_observation"),
    notes: text("notes"),
  },
  (t) => [
    index("wallet_observations_asset_idx").on(t.assetId),
    index("wallet_observations_wallet_idx").on(t.walletId),
  ],
);
