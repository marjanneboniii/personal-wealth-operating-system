/**
 * Commodity Price Tracking Schema — Isolated Tables
 * No foreign keys to accounting tables (accounts, journal_entries, postings, lots)
 * User-defined dynamic categories and items — no hardcoded grocery list or rigid enum
 * Isolated cache for personal commodity price tracking and inflation analytics
 *
 * NOTE: these table objects mirror `src/db/schema.ts` (the migration source of
 * truth). Keep both definitions in sync — the service layer imports from here.
 *
 * TENANCY (0012): `user_id` NULL = shared/global row (legacy + suggested
 * catalog); set = owned by one tenant.
 */

import { index, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const money = (name: string) => numeric(name, { precision: 38, scale: 18 });

/**
 * commodity_categories: id uuid PK, user_id uuid nullable (tenant owner, NULL = shared),
 * name text user-defined, created_at
 * Dynamic user-defined categories — e.g., user can create "Dairy", "Produce", "Bakery", or custom
 * No hardcoded enum, no fixed list
 */
export const commodityCategories = pgTable(
  "commodity_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id"),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("commodity_categories_name_idx").on(t.name),
    index("commodity_categories_user_idx").on(t.userId),
    uniqueIndex("commodity_categories_shared_name_uq").on(t.name).where(sql`user_id IS NULL`),
    uniqueIndex("commodity_categories_user_name_uq").on(t.userId, t.name).where(sql`user_id IS NOT NULL`),
  ],
);

/**
 * commodity_items: id uuid PK, user_id uuid nullable, name text user-defined item name,
 * category_id FK commodity_categories.id nullable, default_unit text, created_at
 * Dynamic user-defined items — e.g., any product user wants to track, no hardcoded list
 * default_unit: kg, g, liter, ml, pack, piece, box, or custom string — user-defined, not enum rigid
 */
export const commodityItems = pgTable(
  "commodity_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id"),
    name: text("name").notNull(),
    categoryId: uuid("category_id").references(() => commodityCategories.id, { onDelete: "set null" }),
    defaultUnit: text("default_unit").notNull().default("piece"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("commodity_items_name_idx").on(t.name),
    index("commodity_items_category_idx").on(t.categoryId),
    index("commodity_items_user_idx").on(t.userId),
    uniqueIndex("commodity_items_shared_name_uq").on(t.name).where(sql`user_id IS NULL`),
    uniqueIndex("commodity_items_user_name_uq").on(t.userId, t.name).where(sql`user_id IS NOT NULL`),
  ],
);

/**
 * commodity_price_records: id uuid PK, user_id uuid nullable, commodity_id FK commodity_items.id,
 * unit_price decimal price per single unit, unit text unit used, quantity decimal,
 * total_amount decimal, purchased_at timestamp («تاریخ ثبت قیمت» — the price observation date),
 * merchant_name text optional, region text optional («منطقه یا شهر»), notes text optional, created_at timestamp
 * Price observations for any item — isolated, no FK to accounting
 * unit_price, quantity, total_amount must use D() from domain/decimal.ts for 18-decimal precision in service layer
 */
export const commodityPriceRecords = pgTable(
  "commodity_price_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id"),
    commodityId: uuid("commodity_id")
      .notNull()
      .references(() => commodityItems.id, { onDelete: "cascade" }),
    unitPrice: money("unit_price").notNull(),
    unit: text("unit").notNull().default("piece"),
    quantity: money("quantity").notNull().default("1"),
    totalAmount: money("total_amount").notNull(),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
    merchantName: text("merchant_name"),
    region: text("region"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("commodity_price_commodity_idx").on(t.commodityId),
    index("commodity_price_purchased_idx").on(t.purchasedAt),
    index("commodity_price_merchant_idx").on(t.merchantName),
    index("commodity_price_user_idx").on(t.userId),
  ],
);
