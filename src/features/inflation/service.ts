/**
 * Personal-Inflation Tracker («ردیاب تورم شخصی») — independent analytical module.
 *
 * SCOPE CONTRACT (never violate):
 *   • Price Tracking + Inflation Analysis ONLY.
 *   • Reads/writes ONLY the isolated `commodity_*` tables.
 *   • NEVER imports accounting / ledger / portfolio / valuation / transaction
 *     code, NEVER creates a journal entry, posting, lot, account or asset, and
 *     NEVER feeds Net Worth, Portfolio or P&L. The dashboard is read-only with
 *     respect to every other domain: the only writes here land in the
 *     module's own tables.
 *
 * TENANCY: rows with `user_id = NULL` are shared/global (legacy data + the
 * suggested catalog) and readable by every tenant; rows with `user_id` set
 * belong to one tenant. Reads scope to (owner OR shared); writes stamp the
 * author when authenticated.
 */

import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { commodityCategories, commodityItems, commodityPriceRecords } from "@/features/commodities/schema";
import { D, Decimal } from "@/domain/decimal";
import {
  INFLATION_CATEGORY_SUGGESTIONS,
  INFLATION_COMPARISON_WINDOWS,
  INFLATION_DEFAULT_UNIT,
  type InflationComparisonWindowKey,
} from "./constants";
import { commodityAnalyticsService, type TenantId } from "@/features/commodities/service";

export type InflationItemRow = {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  unit: string;
  latestPrice: string | null;
  latestUnit: string | null;
  latestDate: string | null;
  recordCount: number;
};

export type InflationHistoryPoint = {
  id: string;
  unitPrice: string;
  unit: string;
  recordedAt: string;
  merchantName: string | null;
  region: string | null;
  notes: string | null;
};

export type InflationItemComparison = {
  itemId: string;
  name: string;
  categoryName: string | null;
  unit: string;
  latestPrice: string | null;
  latestDate: string | null;
  growth: Record<InflationComparisonWindowKey, string | null>;
};

export type InflationBasketWindow = {
  key: InflationComparisonWindowKey;
  label: string;
  days: number;
  /** Simple average of per-item growths, «+۳۵٪» style (two decimals, signed). */
  growthPercent: string | null;
  itemsWithBaseline: number;
  itemsWithCurrent: number;
};

export type InflationDashboard = {
  generatedAt: string;
  totalItems: number;
  totalObservations: number;
  headline: InflationBasketWindow; // 6-month basket — «تورم کل سبد کالا»
  windows: InflationBasketWindow[];
  topRisers: InflationItemComparison[]; // بیشترین افزایش قیمت (۶ ماهه)
  leastRisers: InflationItemComparison[]; // کمترین افزایش قیمت (۶ ماهه)
  items: InflationItemComparison[]; // full «مقایسه رشد کالاها» table
};

export type RecordInflationPriceInput = {
  /** Existing item id, or omit to create by name. */
  commodityId?: string;
  itemName?: string;
  categoryId?: string | null;
  newCategory?: string | null;
  unit?: string;
  unitPrice: string;
  /** «تاریخ ثبت قیمت» — Gregorian ISO (the form submits it via JalaliDateInput). */
  recordedAt?: string;
  merchantName?: string | null;
  region?: string | null;
  notes?: string | null;
};

function visibleTo(userIdColumn: AnyPgColumn, userId: TenantId) {
  return userId ? or(eq(userIdColumn, userId), isNull(userIdColumn)) : isNull(userIdColumn);
}

/**
 * Idempotent module bootstrap (memory-DB / dev path; production PostgreSQL is
 * seeded by migration 0012). Inserts the suggested Persian categories as
 * shared rows only when missing — never destructive, never duplicated.
 */
export async function ensureInflationModuleReady(): Promise<void> {
  for (const name of INFLATION_CATEGORY_SUGGESTIONS) {
    const [existing] = await db
      .select({ id: commodityCategories.id })
      .from(commodityCategories)
      .where(and(eq(commodityCategories.name, name), isNull(commodityCategories.userId)))
      .limit(1);
    if (!existing) {
      try {
        await db.insert(commodityCategories).values({ name, userId: null });
      } catch {
        // Concurrent bootstrap race — the row exists now; safe to ignore.
      }
    }
  }
}

/** All items visible to this tenant, newest-price-first metadata attached. */
export async function listInflationItems(userId?: TenantId): Promise<InflationItemRow[]> {
  const owner = userId ?? null;
  const items = await db
    .select({
      id: commodityItems.id,
      name: commodityItems.name,
      categoryId: commodityItems.categoryId,
      categoryName: commodityCategories.name,
      unit: commodityItems.defaultUnit,
    })
    .from(commodityItems)
    .leftJoin(commodityCategories, eq(commodityCategories.id, commodityItems.categoryId))
    .where(visibleTo(commodityItems.userId, owner));

  const rows: InflationItemRow[] = [];
  for (const item of items) {
    const records = await db
      .select({
        unitPrice: commodityPriceRecords.unitPrice,
        unit: commodityPriceRecords.unit,
        purchasedAt: commodityPriceRecords.purchasedAt,
      })
      .from(commodityPriceRecords)
      .where(
        and(
          eq(commodityPriceRecords.commodityId, item.id),
          visibleTo(commodityPriceRecords.userId, owner),
        ),
      )
      .orderBy(desc(commodityPriceRecords.purchasedAt))
      .limit(1);
    const latest = records[0];
    const countRes = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(commodityPriceRecords)
      .where(
        and(
          eq(commodityPriceRecords.commodityId, item.id),
          visibleTo(commodityPriceRecords.userId, owner),
        ),
      );
    const count = countRes[0]?.count ?? 0;
    rows.push({
      id: item.id,
      name: item.name,
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      unit: item.unit,
      latestPrice: latest ? latest.unitPrice.toString() : null,
      latestUnit: latest ? latest.unit : null,
      latestDate: latest?.purchasedAt ? latest.purchasedAt.toISOString() : null,
      recordCount: count,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "fa"));
  return rows;
}

/**
 * Record a new market-price observation («ثبت قیمت جدید کالا»).
 * Not a purchase: quantity is always 1 and total == unit price; the legacy
 * `quantity`/`total_amount` columns are preserved in the DB but no longer
 * part of the form.
 */
export async function recordInflationPrice(
  input: RecordInflationPriceInput,
  userId?: TenantId,
): Promise<{ id: string; commodityId: string }> {
  const owner = userId ?? null;
  const unitPriceDec = D(input.unitPrice);
  if (unitPriceDec.lte(0)) throw new Error("قیمت هر واحد باید بزرگ‌تر از صفر باشد.");

  let commodityId = input.commodityId?.trim() || undefined;
  if (!commodityId) {
    const itemName = input.itemName?.trim();
    if (!itemName) throw new Error("نام کالا الزامی است.");
    if (itemName.length > 200) throw new Error("نام کالا بیش از حد طولانی است.");
    let categoryId = input.categoryId?.trim() || undefined;
    const newCategory = input.newCategory?.trim();
    if (newCategory) {
      categoryId = (await commodityAnalyticsService.createCategory(newCategory, owner)).id;
    }
    const unit = input.unit?.trim().slice(0, 50) || INFLATION_DEFAULT_UNIT;
    commodityId = (await commodityAnalyticsService.createCommodityItem(itemName, categoryId, unit, owner)).id;
  }

  const recordedAt = input.recordedAt ? new Date(input.recordedAt) : new Date();
  if (isNaN(recordedAt.getTime())) throw new Error("تاریخ ثبت قیمت معتبر نیست.");

  const unit = input.unit?.trim().slice(0, 50) || undefined;
  const { id } = await commodityAnalyticsService.recordPricePoint(
    {
      commodityId,
      unitPrice: unitPriceDec.toString(),
      unit,
      quantity: "1",
      purchasedAt: recordedAt,
      merchantName: input.merchantName?.trim() || undefined,
      region: input.region?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
    },
    owner,
  );
  return { id, commodityId };
}

/** Full price history of one item, newest first («تاریخچه قیمت»). */
export async function getInflationHistory(
  commodityId: string,
  userId?: TenantId,
  limit = 200,
): Promise<InflationHistoryPoint[]> {
  const owner = userId ?? null;
  const [item] = await db
    .select({ id: commodityItems.id })
    .from(commodityItems)
    .where(and(eq(commodityItems.id, commodityId), visibleTo(commodityItems.userId, owner)))
    .limit(1);
  if (!item) throw new Error("کالا یافت نشد.");

  const rows = await db
    .select({
      id: commodityPriceRecords.id,
      unitPrice: commodityPriceRecords.unitPrice,
      unit: commodityPriceRecords.unit,
      purchasedAt: commodityPriceRecords.purchasedAt,
      merchantName: commodityPriceRecords.merchantName,
      region: commodityPriceRecords.region,
      notes: commodityPriceRecords.notes,
    })
    .from(commodityPriceRecords)
    .where(
      and(eq(commodityPriceRecords.commodityId, commodityId), visibleTo(commodityPriceRecords.userId, owner)),
    )
    .orderBy(desc(commodityPriceRecords.purchasedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    unitPrice: r.unitPrice.toString(),
    unit: r.unit,
    recordedAt: r.purchasedAt?.toISOString() ?? new Date().toISOString(),
    merchantName: r.merchantName,
    region: r.region,
    notes: r.notes,
  }));
}

type Observation = { price: Decimal; at: number };

/** Growth % of `current` vs `baseline` via D(), two decimals. Null-safe. */
function growthOf(current: Decimal, baseline: Decimal): string | null {
  if (baseline.isZero()) return null;
  return current.sub(baseline).div(baseline).mul("100").toFixed(2);
}

/**
 * Dashboard («تحلیل تورم» + «مقایسه رشد کالاها»).
 * Per item: latest observation vs the nearest observation on/before
 * (now − N days) for N ∈ {30, 90, 180, 365}. Basket growth per window is the
 * simple average of the items that have data on both ends.
 */
export async function getInflationDashboard(userId?: TenantId): Promise<InflationDashboard> {
  const owner = userId ?? null;
  const now = Date.now();

  const items = await db
    .select({
      id: commodityItems.id,
      name: commodityItems.name,
      categoryName: commodityCategories.name,
      unit: commodityItems.defaultUnit,
    })
    .from(commodityItems)
    .leftJoin(commodityCategories, eq(commodityCategories.id, commodityItems.categoryId))
    .where(visibleTo(commodityItems.userId, owner));

  const comparisons: InflationItemComparison[] = [];
  let totalObservations = 0;
  const windowSums: Record<InflationComparisonWindowKey, Decimal> = {
    "1m": Decimal.zero(),
    "3m": Decimal.zero(),
    "6m": Decimal.zero(),
    "12m": Decimal.zero(),
  };
  const windowCounts: Record<InflationComparisonWindowKey, number> = { "1m": 0, "3m": 0, "6m": 0, "12m": 0 };
  const windowCoverage: Record<InflationComparisonWindowKey, number> = { "1m": 0, "3m": 0, "6m": 0, "12m": 0 };

  for (const item of items) {
    const records = await db
      .select({
        unitPrice: commodityPriceRecords.unitPrice,
        purchasedAt: commodityPriceRecords.purchasedAt,
      })
      .from(commodityPriceRecords)
      .where(
        and(eq(commodityPriceRecords.commodityId, item.id), visibleTo(commodityPriceRecords.userId, owner)),
      )
      .orderBy(asc(commodityPriceRecords.purchasedAt));

    if (records.length === 0) {
      comparisons.push({
        itemId: item.id,
        name: item.name,
        categoryName: item.categoryName,
        unit: item.unit,
        latestPrice: null,
        latestDate: null,
        growth: { "1m": null, "3m": null, "6m": null, "12m": null },
      });
      continue;
    }

    totalObservations += records.length;
    const obs: Observation[] = records.map((r) => ({
      price: D(r.unitPrice),
      at: r.purchasedAt ? r.purchasedAt.getTime() : now,
    }));
    const latest = obs[obs.length - 1];
    const latestRec = records[records.length - 1];

    const growth = {} as Record<InflationComparisonWindowKey, string | null>;
    for (const w of INFLATION_COMPARISON_WINDOWS) {
      const cutoff = now - w.days * 24 * 60 * 60 * 1000;
      // Nearest observation on/before the cutoff (the price "then").
      let baseline: Observation | null = null;
      for (const o of obs) {
        if (o.at <= cutoff) baseline = o;
        else break;
      }
      windowCoverage[w.key] += 1;
      if (!baseline) {
        growth[w.key] = null;
        continue;
      }
      const g = growthOf(latest.price, baseline.price);
      growth[w.key] = g;
      if (g !== null) {
        windowSums[w.key] = windowSums[w.key].add(D(g));
        windowCounts[w.key] += 1;
      }
    }

    comparisons.push({
      itemId: item.id,
      name: item.name,
      categoryName: item.categoryName,
      unit: item.unit,
      latestPrice: latestRec.unitPrice.toString(),
      latestDate: latestRec.purchasedAt?.toISOString() ?? null,
      growth,
    });
  }

  const itemsWithCurrent = comparisons.filter((c) => c.latestPrice !== null).length;
  const windows: InflationBasketWindow[] = INFLATION_COMPARISON_WINDOWS.map((w) => ({
    key: w.key,
    label: w.label,
    days: w.days,
    growthPercent:
      windowCounts[w.key] > 0 ? windowSums[w.key].div(String(windowCounts[w.key])).toFixed(2) : null,
    itemsWithBaseline: windowCounts[w.key],
    itemsWithCurrent,
  }));

  const headline = windows.find((w) => w.key === "6m") ?? windows[0];

  const with6m = comparisons.filter((c) => c.growth["6m"] !== null);
  const topRisers = [...with6m].sort((a, b) => Number(b.growth["6m"]) - Number(a.growth["6m"])).slice(0, 5);
  const leastRisers = [...with6m].sort((a, b) => Number(a.growth["6m"]) - Number(b.growth["6m"])).slice(0, 5);

  comparisons.sort((a, b) => {
    const ga = a.growth["6m"];
    const gb = b.growth["6m"];
    if (ga === null && gb === null) return a.name.localeCompare(b.name, "fa");
    if (ga === null) return 1;
    if (gb === null) return -1;
    return Number(gb) - Number(ga);
  });

  return {
    generatedAt: new Date().toISOString(),
    totalItems: items.length,
    totalObservations,
    headline,
    windows,
    topRisers,
    leastRisers,
    items: comparisons,
  };
}
