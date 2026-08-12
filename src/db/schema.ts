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
import { sql } from "drizzle-orm";
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
  parentId: uuid("parent_id"), // self-FK for hierarchy, no DB FK constraint to avoid circular migration issues in init-schema, logical parent
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
    /**
     * Valuation identity only. These columns never participate in journal,
     * posting, FIFO, cost-basis, or realized-P&L calculations.
     */
    pricingMethod: text("pricing_method").notNull().default("manual"), // coingecko | manual | face_value | unsupported
    coingeckoId: text("coingecko_id").unique(),
    logoUrl: text("logo_url"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [index("assets_class_idx").on(t.classId), index("assets_coingecko_idx").on(t.coingeckoId)],
);

export const wallets = pgTable(
  "wallets",
  {
    ...base,
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(), // bank | exchange | hot | cold | cash | fund
    institutionId: uuid("institution_id").references(() => institutions.id),
    networkId: uuid("network_id").references(() => networks.id),
    address: text("address"),
    note: text("note"),
  },
  (t) => [index("wallets_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------------ */
/* Expense categories — Hierarchical (Parent-Child) classification      */
/*                                                                      */
/* Reporting dimension of every expense entry. The accounting truth     */
/* stays in the double-entry ledger (postings to expense accounts);     */
/* categories add the standard, extensible classification used by all   */
/* expense reports.                                                     */
/*                                                                      */
/*  - System catalog rows have user_id NULL (shared reference data,     */
/*    like currencies / asset classes).                                 */
/*  - Users may extend the tree with their own sub-categories           */
/*    (user_id = owner).                                                */
/*  - `nature = 'non_cash'` marks depreciation / reserve categories     */
/*    (e.g. vehicle depreciation): they are expenses in reports but     */
/*    NEVER a cash outflow, so cash-flow analytics exclude them.        */
/* ------------------------------------------------------------------ */

export const expenseCategories = pgTable(
  "expense_categories",
  {
    ...base,
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    /** Stable machine code, unique per tenant scope, e.g. "TRN-FUEL". */
    code: text("code").notNull(),
    /** Persian display name. */
    name: text("name").notNull(),
    /** Optional Latin name for exports / integrations. */
    nameEn: text("name_en"),
    /** Self-FK for the hierarchy (parent → child), logical (no DB FK). */
    parentId: uuid("parent_id"),
    /** 0 = top-level group, 1 = leaf sub-category. */
    level: integer("level").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    /** cash | non_cash — non_cash = depreciation / reserve (no cash outflow). */
    nature: text("nature").notNull().default("cash"),
    /** Assignment rule shown to the user (prevents overlapping usage). */
    description: text("description"),
    /** System catalog entries are managed by the standard taxonomy. */
    isSystem: boolean("is_system").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("expense_categories_user_code_uq").on(t.userId, t.code),
    index("expense_categories_parent_idx").on(t.parentId),
    index("expense_categories_user_idx").on(t.userId),
  ],
);

/* ------------------------------------------------------------------ */
/* Chart of accounts                                                    */
/* ------------------------------------------------------------------ */

export const accounts = pgTable(
  "accounts",
  {
    ...base,
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(), // asset | liability | equity | income | expense
    parentId: uuid("parent_id"),
    assetId: uuid("asset_id").references(() => assets.id),
    walletId: uuid("wallet_id").references(() => wallets.id),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("accounts_user_code_uq").on(t.userId, t.code),
    index("accounts_user_idx").on(t.userId),
    index("accounts_user_type_idx").on(t.userId, t.type),
    index("accounts_type_idx").on(t.type),
    index("accounts_asset_idx").on(t.assetId),
  ],
);

/* ------------------------------------------------------------------ */
/* Immutable ledger                                                     */
/* ------------------------------------------------------------------ */

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    entryDate: date("entry_date").notNull(),
    type: text("type").notNull(), // transfer|buy|sell|income|expense|fx|debt|installment|adjustment|opening
    description: text("description").notNull(),
    reference: text("reference"),
    status: text("status").notNull().default("posted"), // posted | void
    reversalOf: uuid("reversal_of"),
    source: text("source").notNull().default("manual"), // manual | plan | import
    idempotencyKey: text("idempotency_key"),
    idempotencyHash: text("idempotency_hash"),
    /**
     * Reporting dimension: the (leaf) expense category of the entry.
     * Set for expense entries; NULL for transfers/buys/sells/etc.
     * Never participates in the double-entry balance — classification only.
     */
    categoryId: uuid("category_id").references(() => expenseCategories.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("journal_entries_user_idemp_uq").on(t.userId, t.idempotencyKey).where(sql`idempotency_key IS NOT NULL`),
    index("entries_date_idx").on(t.entryDate),
    index("entries_type_idx").on(t.type),
    index("entries_user_idx").on(t.userId),
    index("entries_user_date_idx").on(t.userId, t.entryDate),
    index("entries_category_idx").on(t.categoryId),
  ],
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
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
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
  (t) => [
    index("lots_lookup_idx").on(t.assetId, t.openedAt),
    index("lots_user_idx").on(t.userId),
    index("lots_user_asset_idx").on(t.userId, t.assetId),
  ],
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
  (t) => [
    index("portfolio_valuations_date_idx").on(t.valuationDate),
    uniqueIndex("portfolio_valuations_user_asset_date_uq").on(t.userId, t.assetId, t.valuationDate),
  ],
);

export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    userId: uuid("user_id").references(() => users.id),
    snapshotDate: date("snapshot_date").notNull(),
    totalPortfolioValue: money("total_portfolio_value").notNull(),
    baseCurrencyId: uuid("base_currency_id").references(() => currencies.id),
  },
  (t) => [uniqueIndex("portfolio_snapshots_asof_uq").on(t.userId, t.snapshotDate)],
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
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    asOf: date("as_of").notNull(),
    baseCurrency: text("base_currency").notNull().default("USD"),
    totalAssets: money("total_assets").notNull(),
    totalLiabilities: money("total_liabilities").notNull(),
    netWorth: money("net_worth").notNull(),
  },
  (t) => [
    uniqueIndex("snapshots_user_asof_uq").on(t.userId, t.asOf),
    index("snapshots_user_idx").on(t.userId),
  ],
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

export const goals = pgTable(
  "goals",
  {
    ...base,
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    targetBase: money("target_base").notNull(),
    targetDate: date("target_date"),
    priority: integer("priority").notNull().default(2),
    status: text("status").notNull().default("active"), // active | reached | archived
    fundAccountId: uuid("fund_account_id").references(() => accounts.id),
  },
  (t) => [index("goals_user_idx").on(t.userId)],
);

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

export const events = pgTable(
  "events",
  {
    ...base,
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull().default("other"), // trip | ceremony | gift | purchase | other
    eventDate: date("event_date").notNull(),
    budgetBase: money("budget_base").notNull(),
    status: text("status").notNull().default("planned"), // planned | done | cancelled
    note: text("note"),
  },
  (t) => [index("events_user_idx").on(t.userId)],
);

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

export const budgets = pgTable(
  "budgets",
  {
    ...base,
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    accountId: uuid("account_id").references(() => accounts.id),
    amountBase: money("amount_base").notNull(),
  },
  (t) => [index("budgets_user_idx").on(t.userId)],
);

export const plannedTransactions = pgTable(
  "planned_transactions",
  {
    ...base,
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
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
  (t) => [
    index("planned_date_idx").on(t.plannedDate, t.status),
    index("planned_user_idx").on(t.userId),
  ],
);

/* ------------------------------------------------------------------ */
/* Liabilities                                                          */
/* ------------------------------------------------------------------ */

export const debts = pgTable(
  "debts",
  {
    ...base,
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    creditor: text("creditor").notNull(),
    title: text("title").notNull(),
    principalBase: money("principal_base").notNull(),
    interestRate: numeric("interest_rate", { precision: 8, scale: 4 }).notNull().default("0"),
    startDate: date("start_date").notNull(),
    accountId: uuid("account_id").references(() => accounts.id),
    status: text("status").notNull().default("active"), // active | settled
  },
  (t) => [index("debts_user_idx").on(t.userId)],
);

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

export const obligations = pgTable(
  "obligations",
  {
    ...base,
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    amountBase: money("amount_base").notNull(),
    dueDate: date("due_date").notNull(),
    recurrence: text("recurrence").notNull().default("none"),
    status: text("status").notNull().default("pending"),
    note: text("note"),
  },
  (t) => [index("obligations_user_idx").on(t.userId)],
);

export const funds = pgTable(
  "funds",
  {
    ...base,
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(), // emergency | reserve | family_support
    targetBase: money("target_base").notNull(),
    accountId: uuid("account_id").references(() => accounts.id),
    note: text("note"),
  },
  (t) => [index("funds_user_idx").on(t.userId)],
);

/* Asset Registry Extension — Hierarchy + Multi-Chain                    */
/* ------------------------------------------------------------------ */
// parentId self reference logical, no DB FK to avoid circular init issues, but level tracks depth
// Existing assetClasses now has parentId, level, attributesSchema added above





/* ------------------------------------------------------------------ */
/* Real Estate Master Data — Cities, Neighborhoods, Property Types      */
/* Extensible reference tables (NOT hard-coded): admins can add cities, */
/* neighborhoods per city, and property types at runtime. Users can    */
/* only pick ACTIVE entries.                                            */
/* ------------------------------------------------------------------ */

export const cities = pgTable(
  "cities",
  {
    ...base,
    nameFa: text("name_fa").notNull(),
    nameEn: text("name_en").notNull(),
    /** 3-letter latin code used inside generated symbols, e.g. AHZ */
    code: text("code").notNull().unique(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("cities_active_idx").on(t.isActive)],
);

export const neighborhoods = pgTable(
  "neighborhoods",
  {
    ...base,
    cityId: uuid("city_id")
      .notNull()
      .references(() => cities.id, { onDelete: "cascade" }),
    nameFa: text("name_fa").notNull(),
    nameEn: text("name_en").notNull(),
    /** latin code unique per city, used inside generated symbols, e.g. KPE */
    code: text("code").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    uniqueIndex("neighborhoods_city_code_uq").on(t.cityId, t.code),
    index("neighborhoods_city_active_idx").on(t.cityId, t.isActive),
  ],
);

export const propertyTypes = pgTable(
  "property_types",
  {
    ...base,
    nameFa: text("name_fa").notNull(),
    nameEn: text("name_en").notNull(),
    /** latin code used inside generated symbols, e.g. APT */
    code: text("code").notNull().unique(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("property_types_active_idx").on(t.isActive)],
);

/* RWA Domain — Identity, Ownership, Valuation Separation              */
/* ------------------------------------------------------------------ */
// NOTE: The legacy identity columns (property_type/city/area) remain for
// backward compatibility with rows created by the old free-text form.
// New rows use the master-data FKs (city_id/neighborhood_id/property_type_id).

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
    /* ── legacy identity (free-text, kept for old rows) ── */
    propertyType: text("property_type").notNull().default("apartment"),
    city: text("city").notNull().default("Ahvaz"),
    area: text("area"),
    /* ── master-data identity (new rows) ── */
    cityId: uuid("city_id").references(() => cities.id),
    neighborhoodId: uuid("neighborhood_id").references(() => neighborhoods.id),
    propertyTypeId: uuid("property_type_id").references(() => propertyTypes.id),
    address: text("address"),
    sizeSqm: numeric("size_sqm", { precision: 10, scale: 2 }),
    floor: integer("floor"),
    yearBuilt: integer("year_built"),
    deedNumber: text("deed_number"),
    notes: text("notes"),
    /* ── timing: acquisition vs system entry ── */
    /** REAL ownership date — Gregorian/ISO, the accounting date of the entry */
    acquisitionDate: date("acquisition_date"),
    /** display/audit copy of the Persian date the user typed, e.g. 1404/05/20 */
    acquisitionDatePersian: text("acquisition_date_persian"),
    /** valuation date — Gregorian/ISO */
    valuationDate: date("valuation_date"),
    valuationDatePersian: text("valuation_date_persian"),
    /** when this record was entered into the system (≠ acquisition date) */
    systemEntryDate: date("system_entry_date"),
    /** true when the acquisition predates the system entry (prior-period acquisition) */
    isHistorical: boolean("is_historical").notNull().default(false),
    /* ── purchase (historical, immutable) ── */
    purchasePriceToman: money("purchase_price_toman"),
    /** USD rate of the ACQUISITION date, frozen at insert */
    purchaseFxRate: money("purchase_fx_rate"),
    purchaseFxRateSource: text("purchase_fx_rate_source"),
    purchaseFxRateDate: date("purchase_fx_rate_date"),
    purchaseValueUsd: money("purchase_value_usd"),
    /* ── current valuation (updated only by a NEW valuation) ── */
    currentValueToman: money("current_value_toman"),
    /** USD rate of the VALUATION date, frozen at insert */
    valuationFxRate: money("valuation_fx_rate"),
    valuationFxRateSource: text("valuation_fx_rate_source"),
    valuationFxRateDate: date("valuation_fx_rate_date"),
    currentValueUsd: money("current_value_usd"),
    /* ── ledger link (asset ↔ journal entry navigation) ── */
    ledgerEntryId: uuid("ledger_entry_id").references(() => journalEntries.id),
  },
  (t) => [
    index("real_estate_properties_user_idx").on(t.userId),
    index("real_estate_properties_city_area_idx").on(t.city, t.area),
    index("real_estate_properties_city_idx").on(t.cityId),
    index("real_estate_properties_neighborhood_idx").on(t.neighborhoodId),
    index("real_estate_properties_type_idx").on(t.propertyTypeId),
    index("real_estate_properties_ledger_idx").on(t.ledgerEntryId),
  ],
);

/* ------------------------------------------------------------------ */
/* Vehicle Catalog — Brand -> Model (standard, selectable, extensible)  */
/* Users NEVER type a brand/model freely for catalog brands; admins can */
/* extend the catalog at runtime (dynamic, no schema change needed).    */
/* ------------------------------------------------------------------ */

export const vehicleBrands = pgTable(
  "vehicle_brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    /** Canonical display name (Persian or Latin), e.g. "ایران‌خودرو" / "BMW" */
    name: text("name").notNull(),
    /** Normalised lookup key (lower-cased, trimmed) — duplicate protection */
    brandKey: text("brand_key").notNull(),
    /** Optional Latin alias for search, e.g. "Iran Khodro" */
    nameEn: text("name_en"),
    /** domestic (مونتاژی/تولید داخل) | imported (وارداتی) */
    origin: text("origin").notNull().default("imported"),
    /** Free model entry allowed (brands with a very large model space) */
    allowsCustomModel: boolean("allows_custom_model").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("vehicle_brands_key_uq").on(t.brandKey)],
);

export const vehicleCatalog = pgTable(
  "vehicle_catalog",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => vehicleBrands.id, { onDelete: "cascade" }),
    /** Model name as shown to the user, e.g. "تارا اتوماتیک V4" / "iX3" */
    modelName: text("model_name").notNull(),
    /** Normalised lookup key within the brand — duplicate protection */
    modelKey: text("model_key").notNull(),
    /** Optional catalog model year (general catalog info, NOT the user's car) */
    modelYear: integer("model_year"),
    /** Assembler / importer company when different from the brand */
    manufacturer: text("manufacturer"),
    /** sedan | suv | crossover | pickup | van | ev | hybrid | other */
    category: text("category"),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
  },
  (t) => [
    index("vehicle_catalog_brand_idx").on(t.brandId),
    uniqueIndex("vehicle_catalog_brand_model_uq").on(t.brandId, t.modelKey),
  ],
);

/**
 * Vehicle Valuation Snapshots — IMMUTABLE historical valuation records.
 *
 * RULES (never violate):
 *  - A snapshot stores the Toman value AND the USD rate used at that moment.
 *  - value_usd = value_toman / usd_rate  (computed once, at insert time).
 *  - An FX-rate change NEVER rewrites a stored snapshot and NEVER changes the
 *    current value. Only a NEW snapshot changes the current value.
 *  - Snapshots are INSERT-only. Never UPDATE.
 *
 * Scope: catalog-level (market valuation of the model, user_vehicle_id NULL)
 * or vehicle-level (a specific car of a specific user).
 */
export const vehicleValuationSnapshots = pgTable(
  "vehicle_valuation_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    vehicleCatalogId: uuid("vehicle_catalog_id")
      .notNull()
      .references(() => vehicleCatalog.id, { onDelete: "cascade" }),
    /** NULL => catalog/market level snapshot; set => this user's specific car */
    userVehicleId: uuid("user_vehicle_id"),
    snapshotDate: date("snapshot_date").notNull(),
    currentValueToman: money("current_value_toman").notNull(),
    usdRate: money("usd_rate").notNull(),
    currentValueUsd: money("current_value_usd").notNull(),
    source: text("source").notNull().default("manual"), // manual | market_estimate | appraisal | dataset
    note: text("note"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
  },
  (t) => [
    index("vehicle_valuation_catalog_date_idx").on(t.vehicleCatalogId, t.snapshotDate),
    index("vehicle_valuation_user_vehicle_idx").on(t.userVehicleId),
  ],
);

/**
 * User Vehicle Asset (`vehicle_assets` — kept for backward compatibility).
 *
 * Conceptually this IS the `user_vehicles` entity of the vehicle module:
 *   User → Vehicle Asset (exactly ONE owner, no shares, no percentages).
 *
 * Ownership percentage / ownership type / mortgage / inheritance / co-owners
 * intentionally DO NOT exist here — they remain available for real-estate
 * assets through `rwa_ownership_records` only.
 */
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
    /** Selected from the catalog — free text is not accepted by the vehicle form */
    catalogId: uuid("catalog_id").references(() => vehicleCatalog.id),
    brand: text("brand").notNull(),
    model: text("model").notNull(),
    /** Actual manufacturing year of THIS car (Jalali or Gregorian) — required */
    year: integer("year").notNull(),
    /** Date the user actually became the owner — required, basis of all analysis */
    ownershipDate: date("ownership_date"),
    /** Real amount paid by the user, in Toman — required, manual input */
    purchasePriceToman: money("purchase_price_toman"),
    /** USD rate at the OWNERSHIP DATE — historical, never recomputed */
    purchaseUsdRate: money("purchase_usd_rate"),
    /** purchase_price_toman / purchase_usd_rate — historical, never recomputed */
    purchaseValueUsd: money("purchase_value_usd"),
    licensePlate: text("license_plate"),
    chassisNumber: text("chassis_number"),
    mileage: integer("mileage"),
    status: text("status").notNull().default("active"), // active | sold
    saleDate: date("sale_date"),
    salePriceToman: money("sale_price_toman"),
    saleUsdRate: money("sale_usd_rate"),
    saleValueUsd: money("sale_value_usd"),
    notes: text("notes"),
  },
  (t) => [
    index("vehicle_assets_user_idx").on(t.userId),
    index("vehicle_assets_catalog_idx").on(t.catalogId),
  ],
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
    /** Tenant owner copied from the verified ownership record for DB-level isolation. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    valuationDate: date("valuation_date").notNull(),
    priceIRR: money("price_irr"),
    priceUSD: money("price_usd"),
    priceBase: money("price_base"),
    currencyId: uuid("currency_id").references(() => currencies.id),
    valuationSource: text("valuation_source").notNull().default("manual"), // manual | appraisal | market_estimate | book_value
    appraiser: text("appraiser"),
    note: text("note"),
  },
  (t) => [
    index("rwa_valuation_asset_date_idx").on(t.assetId, t.valuationDate),
    index("rwa_valuation_user_idx").on(t.userId),
    uniqueIndex("rwa_valuation_user_asset_date_source_uq").on(t.userId, t.assetId, t.valuationDate, t.valuationSource),
  ],
);

/* ------------------------------------------------------------------ */
/* CoinGecko asset identity catalog — no prices and no user data.       */
/* ------------------------------------------------------------------ */

export const coingeckoAssetCatalog = pgTable(
  "coingecko_asset_catalog",
  {
    coingeckoId: text("coingecko_id").primaryKey(),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    logoUrl: text("logo_url").notNull(),
    marketCapRank: integer("market_cap_rank"),
    kind: text("kind").notNull(), // crypto
    isActive: boolean("is_active").notNull().default(true),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("coingecko_catalog_symbol_idx").on(t.symbol),
    index("coingecko_catalog_kind_rank_idx").on(t.kind, t.marketCapRank),
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
  role: text("role").notNull().default("user"),
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

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    result: text("result").notNull().default("SUCCESS"),
    requestId: text("request_id"),
    beforeData: text("before_data"),
    afterData: text("after_data"),
    payload: text("payload"),
    metadata: text("metadata"),
  },
  (t) => [
    index("audit_log_user_idx").on(t.userId),
    index("audit_log_action_idx").on(t.action),
    index("audit_log_created_idx").on(t.createdAt),
  ],
);

export const userSetupState = pgTable("user_setup_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  completed: boolean("completed").notNull().default(false),
  currentStep: integer("current_step").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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



/* ------------------------------------------------------------------ */
/* External Market Data Provider Layer (Phase 2.7)                     */
/* Reference/market-observation data ONLY.                             */
/* CRITICAL: No FK to journal_entries, postings, accounts, lots,       */
/* lot_consumptions — only to reference tables (assets, wallets, users)*/
/* ------------------------------------------------------------------ */








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
