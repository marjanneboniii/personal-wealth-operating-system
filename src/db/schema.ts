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
});

export const networks = pgTable("networks", {
  ...base,
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  chainType: text("chain_type"),
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

/* ------------------------------------------------------------------ */
/* Platform                                                             */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  ...base,
  name: text("name").notNull(),
  role: text("role").notNull().default("owner"),
  pinHash: text("pin_hash"),
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

export const backupRuns = pgTable("backup_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  kind: text("kind").notNull().default("export"),
  schemaVersion: text("schema_version").notNull().default("1.0"),
  rowCount: integer("row_count").notNull().default(0),
  note: text("note"),
});
