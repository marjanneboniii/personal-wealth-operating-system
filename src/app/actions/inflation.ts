"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { commodityItems, commodityPriceRecords, users } from "@/db/schema";
import { D } from "@/domain/decimal";
import { getCurrentUser } from "@/lib/auth";
import { isNotNull } from "drizzle-orm";
import { recordInflationPrice } from "@/features/inflation/service";

export type InflationResult = { ok: boolean; message: string };

const refresh = () => {
  revalidatePath("/inflation");
};

/**
 * SECURITY: the tracker writes ONLY its own isolated tables. Identity always
 * comes from the server-side session — never from the payload.
 * FAIL-CLOSED: DB/auth errors DENY, never allow.
 */
async function guardInflation(): Promise<string | null> {
  try {
    const user = await getCurrentUser();
    let hasAuth = false;
    try {
      const [row] = await db.select().from(users).where(isNotNull(users.username)).limit(1);
      hasAuth = !!row;
    } catch {
      throw new Error("Authentication/Database error: Access denied");
    }
    if (hasAuth && !user) return "برای این عملیات ابتدا وارد شوید.";
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return e.message;
    if (e instanceof Error && e.message.includes("Authentication/Database error")) {
      return "خطای احراز هویت/پایگاه داده: دسترسی رد شد";
    }
    return "خطای احراز هویت: دسترسی رد شد";
  }
  return null;
}

async function currentUserId(): Promise<string | null> {
  try {
    const user = await getCurrentUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

const val = (f: FormData, key: string) => String(f.get(key) ?? "").trim();
const optional = (f: FormData, key: string) => val(f, key) || undefined;
const numeric = (f: FormData, key: string) => val(f, key).replace(/[,٬\s]/g, "");

const savePriceSchema = z.object({
  commodityId: z.string().uuid().optional(),
  itemName: z.string().max(200).optional(),
  categoryId: z.string().uuid().optional().nullable(),
  newCategory: z.string().max(100).optional().nullable(),
  unit: z.string().max(50).optional(),
  unitPrice: z.string().min(1, "قیمت هر واحد الزامی است."),
  recordedAt: z.string().optional(),
  merchantName: z.string().max(200).optional().nullable(),
  region: z.string().max(200).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * «ثبت قیمت جدید کالا» — a market-price observation, NOT a purchase.
 * No quantity, no purchase date, no ledger/journal/account/asset effect.
 */
export async function saveInflationPriceAction(
  _previous: InflationResult | null,
  form: FormData,
): Promise<InflationResult> {
  const denied = await guardInflation();
  if (denied) return { ok: false, message: denied };
  try {
    const parsed = savePriceSchema.parse({
      commodityId: optional(form, "commodityId") || undefined,
      itemName: optional(form, "itemName") || undefined,
      categoryId: optional(form, "categoryId") || undefined,
      newCategory: optional(form, "newCategory") || undefined,
      unit: optional(form, "unit") || undefined,
      unitPrice: numeric(form, "unitPrice"),
      recordedAt: optional(form, "recordedAt") || undefined,
      merchantName: optional(form, "merchant") || undefined,
      region: optional(form, "region") || undefined,
      notes: optional(form, "notes") || undefined,
    });
    if (!parsed.commodityId && !parsed.itemName) {
      throw new Error("نام کالا الزامی است.");
    }
    const userId = await currentUserId();
    await recordInflationPrice(
      {
        commodityId: parsed.commodityId,
        itemName: parsed.itemName,
        categoryId: parsed.categoryId,
        newCategory: parsed.newCategory,
        unit: parsed.unit,
        unitPrice: parsed.unitPrice,
        recordedAt: parsed.recordedAt,
        merchantName: parsed.merchantName,
        region: parsed.region,
        notes: parsed.notes,
      },
      userId,
    );
    refresh();
    return { ok: true, message: "قیمت جدید کالا ثبت شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ثبت قیمت ناموفق بود." };
  }
}

/** Rename an item / change its default unit (own or shared rows only). */
export async function updateInflationItemAction(
  _previous: InflationResult | null,
  form: FormData,
): Promise<InflationResult> {
  const denied = await guardInflation();
  if (denied) return { ok: false, message: denied };
  try {
    const id = val(form, "id");
    const name = val(form, "name");
    const unit = val(form, "unit");
    if (!id || !name) throw new Error("اطلاعات قلم ناقص است.");
    const userId = await currentUserId();
    const scope = userId
      ? or(eq(commodityItems.userId, userId), isNull(commodityItems.userId))
      : isNull(commodityItems.userId);
    const [existing] = await db
      .select({ id: commodityItems.id })
      .from(commodityItems)
      .where(and(eq(commodityItems.id, id), scope))
      .limit(1);
    if (!existing) throw new Error("قلم کالا یافت نشد یا در دسترس نیست.");
    await db
      .update(commodityItems)
      .set({ name, defaultUnit: unit || "عدد" })
      .where(eq(commodityItems.id, id));
    refresh();
    return { ok: true, message: "قلم کالا ویرایش شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ویرایش ناموفق بود." };
  }
}

/** Correct a price observation (own or shared rows only; precise D() math). */
export async function updateInflationPriceAction(
  _previous: InflationResult | null,
  form: FormData,
): Promise<InflationResult> {
  const denied = await guardInflation();
  if (denied) return { ok: false, message: denied };
  try {
    const id = val(form, "id");
    const price = numeric(form, "unitPrice");
    if (!id || !price) throw new Error("قیمت را وارد کنید.");
    const unitPriceDec = D(price);
    if (unitPriceDec.lte(0)) throw new Error("قیمت باید بزرگ‌تر از صفر باشد.");
    const userId = await currentUserId();
    const scope = userId
      ? or(eq(commodityPriceRecords.userId, userId), isNull(commodityPriceRecords.userId))
      : isNull(commodityPriceRecords.userId);
    const [existing] = await db
      .select({ id: commodityPriceRecords.id, quantity: commodityPriceRecords.quantity })
      .from(commodityPriceRecords)
      .where(and(eq(commodityPriceRecords.id, id), scope))
      .limit(1);
    if (!existing) throw new Error("رکورد قیمت یافت نشد یا در دسترس نیست.");
    // Preserve legacy quantities precisely: total = unitPrice × stored quantity.
    const totalAmount = unitPriceDec.mul(D(existing.quantity)).toString();
    await db
      .update(commodityPriceRecords)
      .set({
        unitPrice: unitPriceDec.toString(),
        totalAmount,
        merchantName: optional(form, "merchant") || null,
        region: optional(form, "region") || null,
        notes: optional(form, "notes") || null,
      })
      .where(eq(commodityPriceRecords.id, id));
    refresh();
    return { ok: true, message: "رکورد قیمت ویرایش شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ویرایش ناموفق بود." };
  }
}
