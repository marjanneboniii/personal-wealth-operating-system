/**
 * Commodity Analytics Service — Dynamic Commodity Price Tracker & Inflation Analytics
 * Isolated domain — No FK to Financial Core, never imports postEntry/recordBuy/recordSell, never writes ledger
 * Uses D() from domain/decimal.ts for all unit price, total amount, inflation percentage calculations to preserve 18-decimal precision
 * No hardcoded fixed list or Enum of specific groceries/items or rigid categories — all user-defined dynamic
 * ALL configuration from process.env, no hardcoded secrets, graceful handling if missing
 */

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { commodityCategories, commodityItems, commodityPriceRecords } from "./schema";
import { D, Decimal } from "@/domain/decimal";

// Configuration from env — no hardcode, graceful handling
function getConfig() {
  const lookbackDefaultDays = process.env.COMMODITY_DEFAULT_LOOKBACK_DAYS
    ? parseInt(process.env.COMMODITY_DEFAULT_LOOKBACK_DAYS, 10)
    : 90;

  const currentPeriodDays = process.env.COMMODITY_CURRENT_PERIOD_DAYS
    ? parseInt(process.env.COMMODITY_CURRENT_PERIOD_DAYS, 10)
    : 30;

  if (isNaN(lookbackDefaultDays) || lookbackDefaultDays <= 0) {
    console.warn(
      "[CommodityAnalyticsService] Invalid COMMODITY_DEFAULT_LOOKBACK_DAYS env, using default 90. Set COMMODITY_DEFAULT_LOOKBACK_DAYS in .env.local for custom lookback",
    );
  }

  if (isNaN(currentPeriodDays) || currentPeriodDays <= 0) {
    console.warn(
      "[CommodityAnalyticsService] Invalid COMMODITY_CURRENT_PERIOD_DAYS env, using default 30. Set COMMODITY_CURRENT_PERIOD_DAYS in .env.local for custom period",
    );
  }

  return {
    defaultLookbackDays: isNaN(lookbackDefaultDays) || lookbackDefaultDays <= 0 ? 90 : lookbackDefaultDays,
    currentPeriodDays: isNaN(currentPeriodDays) || currentPeriodDays <= 0 ? 30 : currentPeriodDays,
  };
}

export type PriceRecordData = {
  commodityId: string;
  unitPrice: string; // decimal string, will be converted via D()
  unit?: string;
  quantity?: string; // decimal string
  totalAmount?: string; // if not provided, calculated as unitPrice * quantity
  purchasedAt?: Date | string; // date of purchase
  merchantName?: string;
  notes?: string;
};

export type PriceHistoryPoint = {
  id: string;
  commodityId: string;
  commodityName?: string;
  categoryName?: string;
  unitPrice: string;
  unit: string;
  quantity: string;
  totalAmount: string;
  purchasedAt: string;
  merchantName: string | null;
  notes: string | null;
  createdAt: string;
};

export type InflationItemResult = {
  commodityId: string;
  commodityName: string;
  categoryName: string | null;
  baselinePeriod: {
    start: string;
    end: string;
    weightedAvgUnitPrice: string;
    totalQuantity: string;
    totalAmount: string;
    count: number;
  };
  currentPeriod: {
    start: string;
    end: string;
    weightedAvgUnitPrice: string;
    totalQuantity: string;
    totalAmount: string;
    count: number;
  };
  priceGrowthAbsolute: string; // currentAvg - baselineAvg
  priceGrowthPercent: string; // percentage via D()
  isInflated: boolean;
};

export type InflationIndexResult = {
  timeRangeMonths: number;
  baselinePeriod: { start: string; end: string };
  currentPeriod: { start: string; end: string };
  totalItemsTracked: number;
  itemsWithDataInBothPeriods: number;
  overallWeightedAvgGrowthPercent: string; // overall CPI change
  overallSimpleAvgGrowthPercent: string;
  totalBaselineAmount: string;
  totalCurrentAmount: string;
  items: InflationItemResult[];
};

export type InflationSummaryReport = {
  generatedAt: string;
  reports: {
    "1m": InflationIndexResult;
    "3m": InflationIndexResult;
    "6m": InflationIndexResult;
    "12m": InflationIndexResult;
  };
  topInflatedLastMonth: InflationItemResult[];
  topInflatedLast3Months: InflationItemResult[];
  topDeflatedLastMonth: InflationItemResult[]; // negative growth
};

export class CommodityAnalyticsService {
  /**
   * Create dynamic user-defined category
   * No hardcoded enum — user provides any name
   */
  async createCategory(name: string): Promise<{ id: string }> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 1) throw new Error("Category name is required");
    if (trimmed.length > 100) throw new Error("Category name too long (max 100 chars)");

    // Check env for max categories limit (optional config)
    const maxCategoriesEnv = process.env.COMMODITY_MAX_CATEGORIES
      ? parseInt(process.env.COMMODITY_MAX_CATEGORIES, 10)
      : null;

    if (maxCategoriesEnv && !isNaN(maxCategoriesEnv)) {
      const existingCount = await db.select({ count: sql<number>`count(*)::int` }).from(commodityCategories);
      if (existingCount[0]?.count >= maxCategoriesEnv) {
        console.warn(
          `[CommodityAnalyticsService] Max categories limit reached (${maxCategoriesEnv}) from COMMODITY_MAX_CATEGORIES env`,
        );
        throw new Error(`Maximum categories limit (${maxCategoriesEnv}) reached`);
      }
    } else if (process.env.COMMODITY_MAX_CATEGORIES) {
      console.warn(
        "[CommodityAnalyticsService] Invalid COMMODITY_MAX_CATEGORIES env, ignoring. Set valid integer in .env.local",
      );
    }

    const [inserted] = await db
      .insert(commodityCategories)
      .values({ name: trimmed })
      .onConflictDoNothing({ target: commodityCategories.name })
      .returning();

    // If conflict (existing), return existing
    if (!inserted) {
      const [existing] = await db.select().from(commodityCategories).where(eq(commodityCategories.name, trimmed)).limit(1);
      if (existing) return { id: existing.id };
      throw new Error("Failed to create category");
    }

    return { id: inserted.id };
  }

  /**
   * Create dynamic user-defined commodity item
   * No hardcoded grocery list — user provides any name, category optional, defaultUnit custom string
   */
  async createCommodityItem(name: string, categoryId?: string, defaultUnit?: string): Promise<{ id: string }> {
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length < 1) throw new Error("Commodity item name is required");
    if (trimmedName.length > 200) throw new Error("Commodity item name too long (max 200 chars)");

    const unit = (defaultUnit || "piece").trim().slice(0, 50) || "piece";

    if (categoryId) {
      const [cat] = await db.select().from(commodityCategories).where(eq(commodityCategories.id, categoryId)).limit(1);
      if (!cat) throw new Error(`Category not found: ${categoryId}`);
    }

    const [inserted] = await db
      .insert(commodityItems)
      .values({
        name: trimmedName,
        categoryId: categoryId ?? null,
        defaultUnit: unit,
      })
      .onConflictDoNothing({ target: commodityItems.name })
      .returning();

    if (!inserted) {
      const [existing] = await db.select().from(commodityItems).where(eq(commodityItems.name, trimmedName)).limit(1);
      if (existing) return { id: existing.id };
      throw new Error("Failed to create commodity item");
    }

    return { id: inserted.id };
  }

  /**
   * Store a unit price observation for any item
   * Uses D() for all unit price, total amount calculations to preserve 18-decimal precision
   */
  async recordPricePoint(recordData: PriceRecordData): Promise<{ id: string }> {
    const { commodityId, unitPrice, unit, quantity, totalAmount, purchasedAt, merchantName, notes } = recordData;

    if (!commodityId) throw new Error("commodityId is required");

    const [commodity] = await db.select().from(commodityItems).where(eq(commodityItems.id, commodityId)).limit(1);
    if (!commodity) throw new Error(`Commodity item not found: ${commodityId}`);

    // Use D() for precise decimal handling
    let unitPriceDec: Decimal;
    try {
      unitPriceDec = D(unitPrice);
    } catch {
      throw new Error("Invalid unitPrice format");
    }
    if (unitPriceDec.lte(0)) throw new Error("unitPrice must be greater than zero");

    let quantityDec: Decimal;
    try {
      quantityDec = quantity ? D(quantity) : D("1");
    } catch {
      throw new Error("Invalid quantity format");
    }
    if (quantityDec.lte(0)) throw new Error("quantity must be greater than zero");

    let totalAmountDec: Decimal;
    if (totalAmount) {
      try {
        totalAmountDec = D(totalAmount);
      } catch {
        throw new Error("Invalid totalAmount format");
      }
      if (totalAmountDec.lte(0)) throw new Error("totalAmount must be greater than zero");
    } else {
      // Calculate total_amount = unit_price * quantity via D()
      totalAmountDec = unitPriceDec.mul(quantityDec);
    }

    const purchasedAtDate = purchasedAt ? new Date(purchasedAt) : new Date();
    if (isNaN(purchasedAtDate.getTime())) throw new Error("Invalid purchasedAt date");

    const [inserted] = await db
      .insert(commodityPriceRecords)
      .values({
        commodityId,
        unitPrice: unitPriceDec.toString(),
        unit: (unit || commodity.defaultUnit || "piece").trim().slice(0, 50),
        quantity: quantityDec.toString(),
        totalAmount: totalAmountDec.toString(),
        purchasedAt: purchasedAtDate,
        merchantName: merchantName?.trim().slice(0, 200) || null,
        notes: notes?.trim().slice(0, 1000) || null,
      })
      .returning();

    return { id: inserted.id };
  }

  /**
   * Fetch historical price points for trend visualization
   */
  async getCommodityPriceHistory(commodityId: string, daysLookback?: number): Promise<PriceHistoryPoint[]> {
    const config = getConfig();
    const lookback = daysLookback ?? config.defaultLookbackDays;

    const [commodity] = await db.select().from(commodityItems).where(eq(commodityItems.id, commodityId)).limit(1);
    if (!commodity) throw new Error(`Commodity not found: ${commodityId}`);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookback);

    const rows = await db
      .select({
        id: commodityPriceRecords.id,
        commodityId: commodityPriceRecords.commodityId,
        commodityName: commodityItems.name,
        categoryName: commodityCategories.name,
        unitPrice: commodityPriceRecords.unitPrice,
        unit: commodityPriceRecords.unit,
        quantity: commodityPriceRecords.quantity,
        totalAmount: commodityPriceRecords.totalAmount,
        purchasedAt: commodityPriceRecords.purchasedAt,
        merchantName: commodityPriceRecords.merchantName,
        notes: commodityPriceRecords.notes,
        createdAt: commodityPriceRecords.createdAt,
      })
      .from(commodityPriceRecords)
      .innerJoin(commodityItems, eq(commodityItems.id, commodityPriceRecords.commodityId))
      .leftJoin(commodityCategories, eq(commodityCategories.id, commodityItems.categoryId))
      .where(and(eq(commodityPriceRecords.commodityId, commodityId), gte(commodityPriceRecords.purchasedAt, cutoffDate)))
      .orderBy(desc(commodityPriceRecords.purchasedAt));

    return rows.map((r) => ({
      id: r.id,
      commodityId: r.commodityId,
      commodityName: r.commodityName,
      categoryName: r.categoryName ?? undefined,
      unitPrice: r.unitPrice.toString(),
      unit: r.unit,
      quantity: r.quantity.toString(),
      totalAmount: r.totalAmount.toString(),
      purchasedAt: r.purchasedAt?.toISOString() ?? new Date().toISOString(),
      merchantName: r.merchantName,
      notes: r.notes,
      createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    }));
  }

  /**
   * Calculate personal inflation index
   * Compare weighted average unit prices of all user-tracked items between baseline period (N months ago) and current period
   * Uses D() for all percentage calculations
   */
  async calculatePersonalInflationIndex(timeRangeMonths: number): Promise<InflationIndexResult> {
    if (!Number.isInteger(timeRangeMonths) || timeRangeMonths <= 0) {
      throw new Error("timeRangeMonths must be positive integer");
    }

    const config = getConfig();
    const currentPeriodDays = config.currentPeriodDays;

    const now = new Date();
    const currentPeriodStart = new Date(now);
    currentPeriodStart.setDate(now.getDate() - currentPeriodDays);
    const currentPeriodEnd = now;

    const baselinePeriodEnd = new Date(now);
    baselinePeriodEnd.setMonth(now.getMonth() - timeRangeMonths);
    const baselinePeriodStart = new Date(baselinePeriodEnd);
    baselinePeriodStart.setDate(baselinePeriodEnd.getDate() - currentPeriodDays);

    // Fetch all commodity items
    const allItems = await db.select().from(commodityItems);

    const inflationItems: InflationItemResult[] = [];
    let totalBaselineAmount = Decimal.zero();
    let totalCurrentAmount = Decimal.zero();
    let totalBaselineQty = Decimal.zero();
    let totalCurrentQty = Decimal.zero();
    let simpleAvgGrowthSum = Decimal.zero();
    let itemsWithBothPeriods = 0;

    for (const item of allItems) {
      // Fetch records for baseline period
      const baselineRecords = await db
        .select()
        .from(commodityPriceRecords)
        .where(
          and(
            eq(commodityPriceRecords.commodityId, item.id),
            gte(commodityPriceRecords.purchasedAt, baselinePeriodStart),
            lte(commodityPriceRecords.purchasedAt, baselinePeriodEnd),
          ),
        );

      // Fetch records for current period
      const currentRecords = await db
        .select()
        .from(commodityPriceRecords)
        .where(
          and(
            eq(commodityPriceRecords.commodityId, item.id),
            gte(commodityPriceRecords.purchasedAt, currentPeriodStart),
            lte(commodityPriceRecords.purchasedAt, currentPeriodEnd),
          ),
        );

      if (baselineRecords.length === 0 || currentRecords.length === 0) {
        // Skip items missing data in either period for inflation calculation
        continue;
      }

      // Calculate weighted average unit price: totalAmount / totalQuantity via D()
      let baselineTotalAmount = Decimal.zero();
      let baselineTotalQty = Decimal.zero();
      for (const rec of baselineRecords) {
        baselineTotalAmount = baselineTotalAmount.add(D(rec.totalAmount));
        baselineTotalQty = baselineTotalQty.add(D(rec.quantity));
      }

      let currentTotalAmount = Decimal.zero();
      let currentTotalQty = Decimal.zero();
      for (const rec of currentRecords) {
        currentTotalAmount = currentTotalAmount.add(D(rec.totalAmount));
        currentTotalQty = currentTotalQty.add(D(rec.quantity));
      }

      if (baselineTotalQty.isZero() || currentTotalQty.isZero()) continue;

      const baselineWeightedAvg = baselineTotalAmount.div(baselineTotalQty);
      const currentWeightedAvg = currentTotalAmount.div(currentTotalQty);

      // priceGrowthAbsolute = currentAvg - baselineAvg via D()
      const growthAbsolute = currentWeightedAvg.sub(baselineWeightedAvg);

      // priceGrowthPercent = (currentAvg - baselineAvg) / baselineAvg * 100 via D()
      let growthPercent: Decimal;
      if (baselineWeightedAvg.isZero()) {
        growthPercent = Decimal.zero();
      } else {
        growthPercent = growthAbsolute.div(baselineWeightedAvg).mul("100");
      }

      // Get category name
      let categoryName: string | null = null;
      if (item.categoryId) {
        const [cat] = await db.select().from(commodityCategories).where(eq(commodityCategories.id, item.categoryId)).limit(1);
        categoryName = cat?.name ?? null;
      }

      inflationItems.push({
        commodityId: item.id,
        commodityName: item.name,
        categoryName,
        baselinePeriod: {
          start: baselinePeriodStart.toISOString(),
          end: baselinePeriodEnd.toISOString(),
          weightedAvgUnitPrice: baselineWeightedAvg.toString(),
          totalQuantity: baselineTotalQty.toString(),
          totalAmount: baselineTotalAmount.toString(),
          count: baselineRecords.length,
        },
        currentPeriod: {
          start: currentPeriodStart.toISOString(),
          end: currentPeriodEnd.toISOString(),
          weightedAvgUnitPrice: currentWeightedAvg.toString(),
          totalQuantity: currentTotalQty.toString(),
          totalAmount: currentTotalAmount.toString(),
          count: currentRecords.length,
        },
        priceGrowthAbsolute: growthAbsolute.toString(),
        priceGrowthPercent: growthPercent.toFixed(2),
        isInflated: growthPercent.gt(0),
      });

      totalBaselineAmount = totalBaselineAmount.add(baselineTotalAmount);
      totalCurrentAmount = totalCurrentAmount.add(currentTotalAmount);
      totalBaselineQty = totalBaselineQty.add(baselineTotalQty);
      totalCurrentQty = totalCurrentQty.add(currentTotalQty);
      simpleAvgGrowthSum = simpleAvgGrowthSum.add(growthPercent);
      itemsWithBothPeriods++;
    }

    // Overall weighted average growth percent
    // Overall baseline weighted avg = totalBaselineAmount / totalBaselineQty
    // Overall current weighted avg = totalCurrentAmount / totalCurrentQty
    // Overall growth = (currentOverallAvg - baselineOverallAvg) / baselineOverallAvg * 100
    let overallWeightedAvgGrowthPercent = "0.00";
    if (!totalBaselineQty.isZero() && !totalCurrentQty.isZero()) {
      const overallBaselineAvg = totalBaselineAmount.div(totalBaselineQty);
      const overallCurrentAvg = totalCurrentAmount.div(totalCurrentQty);
      if (!overallBaselineAvg.isZero()) {
        const overallGrowthAbs = overallCurrentAvg.sub(overallBaselineAvg);
        const overallGrowthPct = overallGrowthAbs.div(overallBaselineAvg).mul("100");
        overallWeightedAvgGrowthPercent = overallGrowthPct.toFixed(2);
      }
    }

    // Simple average growth percent
    let overallSimpleAvgGrowthPercent = "0.00";
    if (itemsWithBothPeriods > 0) {
      const simpleAvg = simpleAvgGrowthSum.div(String(itemsWithBothPeriods));
      overallSimpleAvgGrowthPercent = simpleAvg.toFixed(2);
    }

    return {
      timeRangeMonths,
      baselinePeriod: {
        start: baselinePeriodStart.toISOString(),
        end: baselinePeriodEnd.toISOString(),
      },
      currentPeriod: {
        start: currentPeriodStart.toISOString(),
        end: currentPeriodEnd.toISOString(),
      },
      totalItemsTracked: allItems.length,
      itemsWithDataInBothPeriods: itemsWithBothPeriods,
      overallWeightedAvgGrowthPercent,
      overallSimpleAvgGrowthPercent,
      totalBaselineAmount: totalBaselineAmount.toString(),
      totalCurrentAmount: totalCurrentAmount.toString(),
      items: inflationItems.sort((a, b) => Number(b.priceGrowthPercent) - Number(a.priceGrowthPercent)),
    };
  }

  /**
   * Generate top inflated items analysis over 1, 3, 6, and 12 months
   */
  async getInflationSummaryReport(): Promise<InflationSummaryReport> {
    const [report1m, report3m, report6m, report12m] = await Promise.all([
      this.calculatePersonalInflationIndex(1),
      this.calculatePersonalInflationIndex(3),
      this.calculatePersonalInflationIndex(6),
      this.calculatePersonalInflationIndex(12),
    ]);

    const topInflatedLastMonth = [...report1m.items]
      .filter((i) => i.isInflated)
      .sort((a, b) => Number(b.priceGrowthPercent) - Number(a.priceGrowthPercent))
      .slice(0, 10);

    const topInflatedLast3Months = [...report3m.items]
      .filter((i) => i.isInflated)
      .sort((a, b) => Number(b.priceGrowthPercent) - Number(a.priceGrowthPercent))
      .slice(0, 10);

    const topDeflatedLastMonth = [...report1m.items]
      .filter((i) => !i.isInflated)
      .sort((a, b) => Number(a.priceGrowthPercent) - Number(b.priceGrowthPercent))
      .slice(0, 10);

    return {
      generatedAt: new Date().toISOString(),
      reports: {
        "1m": report1m,
        "3m": report3m,
        "6m": report6m,
        "12m": report12m,
      },
      topInflatedLastMonth,
      topInflatedLast3Months,
      topDeflatedLastMonth,
    };
  }

  async listCategories() {
    return db.select().from(commodityCategories).orderBy(commodityCategories.name);
  }

  async listItems() {
    const rows = await db
      .select({
        id: commodityItems.id,
        name: commodityItems.name,
        categoryId: commodityItems.categoryId,
        categoryName: commodityCategories.name,
        defaultUnit: commodityItems.defaultUnit,
        createdAt: commodityItems.createdAt,
      })
      .from(commodityItems)
      .leftJoin(commodityCategories, eq(commodityCategories.id, commodityItems.categoryId))
      .orderBy(commodityItems.name);

    return rows;
  }
}

// Export singleton instance and standalone functions for convenience
export const commodityAnalyticsService = new CommodityAnalyticsService();

export async function createCategory(name: string) {
  return commodityAnalyticsService.createCategory(name);
}

export async function createCommodityItem(name: string, categoryId?: string, defaultUnit?: string) {
  return commodityAnalyticsService.createCommodityItem(name, categoryId, defaultUnit);
}

export async function recordPricePoint(recordData: PriceRecordData) {
  return commodityAnalyticsService.recordPricePoint(recordData);
}

export async function getCommodityPriceHistory(commodityId: string, daysLookback?: number) {
  return commodityAnalyticsService.getCommodityPriceHistory(commodityId, daysLookback);
}

export async function calculatePersonalInflationIndex(timeRangeMonths: number) {
  return commodityAnalyticsService.calculatePersonalInflationIndex(timeRangeMonths);
}

export async function getInflationSummaryReport() {
  return commodityAnalyticsService.getInflationSummaryReport();
}
