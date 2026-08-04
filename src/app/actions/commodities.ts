"use server";

import { z } from "zod";
import {
  createCategory,
  createCommodityItem,
  recordPricePoint,
  getCommodityPriceHistory,
  calculatePersonalInflationIndex,
  getInflationSummaryReport,
} from "@/features/commodities/service";

const categorySchema = z.object({
  name: z.string().min(1, "Category name is required").max(100, "Category name too long"),
});

const commodityItemSchema = z.object({
  name: z.string().min(1, "Item name is required").max(200, "Item name too long"),
  categoryId: z.string().uuid().optional().nullable(),
  defaultUnit: z.string().max(50).optional().default("piece"),
});

const priceRecordSchema = z.object({
  commodityId: z.string().uuid(),
  unitPrice: z.string().min(1, "Unit price is required"),
  unit: z.string().max(50).optional().default("piece"),
  quantity: z.string().optional().default("1"),
  totalAmount: z.string().optional(),
  purchasedAt: z.string().optional(),
  merchantName: z.string().max(200).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

const priceTrendsSchema = z.object({
  commodityId: z.string().uuid(),
  days: z.number().int().min(1).max(3650).optional().default(90),
});

const inflationReportSchema = z.object({
  timeRangeMonths: z.number().int().min(1).max(60).default(1),
});

export async function createCategoryAction(name: string) {
  try {
    const parsed = categorySchema.parse({ name });

    // Graceful handling for env config
    if (process.env.COMMODITY_MAX_CATEGORIES) {
      const max = parseInt(process.env.COMMODITY_MAX_CATEGORIES, 10);
      if (isNaN(max)) {
        console.warn("[createCategoryAction] Invalid COMMODITY_MAX_CATEGORIES env, ignoring");
      }
    }

    const result = await createCategory(parsed.name);
    return { ok: true, message: `Category created: ${parsed.name}`, data: result };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Failed to create category" };
  }
}

export async function createCommodityItemAction(input: { name: string; categoryId?: string | null; defaultUnit?: string }) {
  try {
    const parsed = commodityItemSchema.parse(input);

    const result = await createCommodityItem(parsed.name, parsed.categoryId ?? undefined, parsed.defaultUnit);
    return { ok: true, message: `Commodity item created: ${parsed.name}`, data: result };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Failed to create commodity item" };
  }
}

export async function recordCommodityPriceAction(input: {
  commodityId: string;
  unitPrice: string;
  unit?: string;
  quantity?: string;
  totalAmount?: string;
  purchasedAt?: string;
  merchantName?: string | null;
  notes?: string | null;
}) {
  try {
    const parsed = priceRecordSchema.parse(input);

    const result = await recordPricePoint({
      commodityId: parsed.commodityId,
      unitPrice: parsed.unitPrice,
      unit: parsed.unit,
      quantity: parsed.quantity,
      totalAmount: parsed.totalAmount,
      purchasedAt: parsed.purchasedAt ? new Date(parsed.purchasedAt) : undefined,
      merchantName: parsed.merchantName ?? undefined,
      notes: parsed.notes ?? undefined,
    });

    return { ok: true, message: "Price point recorded", data: result };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Failed to record price point" };
  }
}

export async function getCommodityPriceTrendsAction(commodityId: string, days: number = 90) {
  try {
    const parsed = priceTrendsSchema.parse({ commodityId, days });
    const history = await getCommodityPriceHistory(parsed.commodityId, parsed.days);
    return { ok: true, data: history };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Failed to fetch price trends", data: [] };
  }
}

export async function getPersonalInflationReportAction(timeRangeMonths: number = 1) {
  try {
    const parsed = inflationReportSchema.parse({ timeRangeMonths });

    // Use the summary report if timeRangeMonths is 1 to get top analysis, otherwise calculate specific
    if (parsed.timeRangeMonths === 1) {
      const summary = await getInflationSummaryReport();
      return { ok: true, data: summary };
    }

    const result = await calculatePersonalInflationIndex(parsed.timeRangeMonths);
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Failed to generate inflation report", data: null };
  }
}

export async function getInflationSummaryReportAction() {
  try {
    const report = await getInflationSummaryReport();
    return { ok: true, data: report };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Failed to generate summary report", data: null };
  }
}
