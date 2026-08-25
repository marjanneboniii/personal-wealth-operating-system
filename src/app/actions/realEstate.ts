"use server";

import { revalidatePath } from "next/cache";
import { isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isAdminOrOwner } from "@/lib/authGuard";
import {
  createRealEstateAsset,
  ensureRealEstateModuleReady,
  previewRealEstateIdentity,
  recordRealEstateValuation,
} from "@/features/rwa/realEstate/service";
import { formatMoney } from "@/lib/format";
import { tomanToUsd } from "@/features/rwa/vehicle/fx";
import { resolveUsdRateForDate } from "@/features/rwa/vehicle/fx";
import {
  createCity,
  createNeighborhood,
  createPropertyType,
  setCityActive,
  setNeighborhoodActive,
  setPropertyTypeActive,
  updateCity,
  updateNeighborhood,
  updatePropertyType,
} from "@/features/rwa/realEstate/masterData";

export type RealEstateResult = { ok: boolean; message: string };

const refresh = () => {
  revalidatePath("/asset-registry");
  revalidatePath("/");
  revalidatePath("/assets");
  revalidatePath("/portfolio");
  revalidatePath("/net-worth");
};

/**
 * SECURITY: real estate writes create/modify user assets and ledger entries.
 * Fail-closed: DB/auth errors DENY, never allow.
 */
async function guardRealEstate(): Promise<string | null> {
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
  } catch (e: any) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return e.message;
    if (e instanceof Error && e.message.includes("Authentication/Database error")) {
      return "خطای احراز هویت/پایگاه داده: دسترسی رد شد";
    }
    return "خطای احراز هویت: دسترسی رد شد";
  }
  return null;
}

/**
 * Master data (cities / neighborhoods / property types) is SHARED reference
 * data — adding or editing entries is an admin operation once authentication
 * is enabled; in legacy single-tenant mode it stays open.
 */
async function guardRealEstateAdmin(): Promise<string | null> {
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
    if (hasAuth && user && !isAdminOrOwner(user)) {
      return "مدیریت شهر/محله/نوع ملک فقط برای مدیر امکان‌پذیر است.";
    }
  } catch (e: any) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return e.message;
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

/* ═══════════════════════════════════════════════════════════════════
   ثبت ملک
   ═══════════════════════════════════════════════════════════════════ */

export async function saveRealEstateAction(_previous: RealEstateResult | null, form: FormData): Promise<RealEstateResult> {
  const denied = await guardRealEstate();
  if (denied) return { ok: false, message: denied };
  try {
    await ensureRealEstateModuleReady();
    const userId = await currentUserId();

    const result = await createRealEstateAsset({
      userId,
      cityId: val(form, "cityId"),
      neighborhoodId: val(form, "neighborhoodId"),
      propertyTypeId: val(form, "propertyTypeId"),
      acquisitionDate: val(form, "acquisitionDate"),
      acquisitionDatePersian: optional(form, "acquisitionDatePersian"),
      valuationDate: val(form, "valuationDate"),
      valuationDatePersian: optional(form, "valuationDatePersian"),
      purchasePriceToman: numeric(form, "purchasePriceToman"),
      currentValueToman: numeric(form, "currentValueToman"),
      purchaseFxRate: numeric(form, "purchaseFxRate") || undefined,
      valuationFxRate: numeric(form, "valuationFxRate") || undefined,
      address: optional(form, "address"),
      sizeSqm: optional(form, "sizeSqm"),
      floor: optional(form, "floor") ? Number(numeric(form, "floor")) : null,
      yearBuilt: optional(form, "yearBuilt") ? Number(numeric(form, "yearBuilt")) : null,
      deedNumber: optional(form, "deedNumber"),
      notes: optional(form, "notes"),
    });

    refresh();
    return {
      ok: true,
      message: `ملک «${result.assetName}» با شناسه ${result.symbol} ثبت شد. معادل‌های دلاری با نرخ تاریخی همان روزها محاسبه و سند افتتاحیه دفترکل با تاریخ تملک واقعی ایجاد شد.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ثبت ملک ناموفق بود." };
  }
}

/** پیش‌نمایش نام و شناسه کوتاه تولیدشده توسط سیستم (بدون ذخیره‌سازی). */
export async function previewRealEstateIdentityAction(
  cityId: string,
  neighborhoodId: string,
  propertyTypeId: string,
): Promise<{ ok: boolean; assetName?: string; symbol?: string; sequence?: number; message?: string }> {
  try {
    if (!cityId || !neighborhoodId || !propertyTypeId) return { ok: false };
    const preview = await previewRealEstateIdentity(cityId, neighborhoodId, propertyTypeId);
    if (!preview) return { ok: false, message: "داده پایه یافت نشد." };
    return { ok: true, assetName: preview.assetName, symbol: preview.symbol, sequence: preview.sequence };
  } catch {
    return { ok: false, message: "پیش‌نمایش نام/شناسه در دسترس نیست." };
  }
}

/** محاسبه معادل دلاری با نرخ همان تاریخ (بدون ذخیره‌سازی) — فقط پیش‌نمایش. */
export async function previewRealEstateUsdAction(
  amountToman: string,
  dateIso: string,
  manualRate?: string,
): Promise<{ ok: boolean; usd: string; rate: string; effectiveDate: string; source: string; isExact: boolean }> {
  const clean = String(amountToman ?? "").replace(/[,٬\s]/g, "");
  const rateInfo =
    manualRate && Number(manualRate) > 0
      ? { rate: String(manualRate), effectiveDate: dateIso, source: "manual", isExact: true }
      : await resolveUsdRateForDate(dateIso, await currentUserId());
  if (!clean || Number(clean) <= 0 || Number(rateInfo.rate) <= 0) {
    return { ok: false, usd: "0", ...rateInfo };
  }
  return { ok: true, usd: tomanToUsd(clean, rateInfo.rate), ...rateInfo };
}

/** ارزش‌گذاری جدید — فقط Current Value را تغییر می‌دهد؛ تاریخچه خرید و دفترکل تغییرناپذیرند. */
export async function recordRealEstateValuationAction(_previous: RealEstateResult | null, form: FormData): Promise<RealEstateResult> {
  const denied = await guardRealEstate();
  if (denied) return { ok: false, message: denied };
  try {
    const userId = await currentUserId();
    const result = await recordRealEstateValuation({
      propertyId: val(form, "propertyId"),
      userId,
      valuationDate: val(form, "valuationDate"),
      valuationDatePersian: optional(form, "valuationDatePersian"),
      currentValueToman: numeric(form, "currentValueToman"),
      valuationFxRate: numeric(form, "valuationFxRate") || undefined,
      note: optional(form, "note"),
    });
    refresh();
    return {
      ok: true,
      message: `ارزش‌گذاری جدید ثبت شد: ${formatMoney(result.currentValueToman, "IRT")} با نرخ دلار ${formatMoney(result.valuationFxRate, "IRT")} (≈ ${formatMoney(result.currentValueUsd, "USD")}). سند دفترکل تغییری نکرد.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ثبت ارزش‌گذاری ناموفق بود." };
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Master Data — admin only (cities / neighborhoods / property types)
   ═══════════════════════════════════════════════════════════════════ */

export async function createCityAction(_previous: RealEstateResult | null, form: FormData): Promise<RealEstateResult> {
  const denied = await guardRealEstateAdmin();
  if (denied) return { ok: false, message: denied };
  try {
    const city = await createCity({ nameFa: val(form, "nameFa"), nameEn: optional(form, "nameEn"), code: val(form, "code") });
    refresh();
    return { ok: true, message: `شهر «${city.nameFa}» (${city.code}) اضافه شد.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ثبت شهر ناموفق بود." };
  }
}

export async function updateCityAction(_previous: RealEstateResult | null, form: FormData): Promise<RealEstateResult> {
  const denied = await guardRealEstateAdmin();
  if (denied) return { ok: false, message: denied };
  try {
    await updateCity(val(form, "id"), { nameFa: val(form, "nameFa"), nameEn: optional(form, "nameEn") });
    refresh();
    return { ok: true, message: "شهر ویرایش شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ویرایش شهر ناموفق بود." };
  }
}

export async function setCityActiveAction(_previous: RealEstateResult | null, form: FormData): Promise<RealEstateResult> {
  const denied = await guardRealEstateAdmin();
  if (denied) return { ok: false, message: denied };
  try {
    await setCityActive(val(form, "id"), val(form, "isActive") === "on");
    refresh();
    return { ok: true, message: "وضعیت شهر به‌روزرسانی شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "به‌روزرسانی شهر ناموفق بود." };
  }
}

export async function createNeighborhoodAction(_previous: RealEstateResult | null, form: FormData): Promise<RealEstateResult> {
  const denied = await guardRealEstateAdmin();
  if (denied) return { ok: false, message: denied };
  try {
    const hood = await createNeighborhood({
      cityId: val(form, "cityId"),
      nameFa: val(form, "nameFa"),
      nameEn: optional(form, "nameEn"),
      code: val(form, "code"),
    });
    refresh();
    return { ok: true, message: `محله «${hood.nameFa}» (${hood.code}) اضافه شد.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ثبت محله ناموفق بود." };
  }
}

export async function updateNeighborhoodAction(_previous: RealEstateResult | null, form: FormData): Promise<RealEstateResult> {
  const denied = await guardRealEstateAdmin();
  if (denied) return { ok: false, message: denied };
  try {
    await updateNeighborhood(val(form, "id"), { nameFa: val(form, "nameFa"), nameEn: optional(form, "nameEn") });
    refresh();
    return { ok: true, message: "محله ویرایش شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ویرایش محله ناموفق بود." };
  }
}

export async function setNeighborhoodActiveAction(_previous: RealEstateResult | null, form: FormData): Promise<RealEstateResult> {
  const denied = await guardRealEstateAdmin();
  if (denied) return { ok: false, message: denied };
  try {
    await setNeighborhoodActive(val(form, "id"), val(form, "isActive") === "on");
    refresh();
    return { ok: true, message: "وضعیت محله به‌روزرسانی شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "به‌روزرسانی محله ناموفق بود." };
  }
}

export async function createPropertyTypeAction(_previous: RealEstateResult | null, form: FormData): Promise<RealEstateResult> {
  const denied = await guardRealEstateAdmin();
  if (denied) return { ok: false, message: denied };
  try {
    const ptype = await createPropertyType({ nameFa: val(form, "nameFa"), nameEn: optional(form, "nameEn"), code: val(form, "code") });
    refresh();
    return { ok: true, message: `نوع ملک «${ptype.nameFa}» (${ptype.code}) اضافه شد.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ثبت نوع ملک ناموفق بود." };
  }
}

export async function updatePropertyTypeAction(_previous: RealEstateResult | null, form: FormData): Promise<RealEstateResult> {
  const denied = await guardRealEstateAdmin();
  if (denied) return { ok: false, message: denied };
  try {
    await updatePropertyType(val(form, "id"), { nameFa: val(form, "nameFa"), nameEn: optional(form, "nameEn") });
    refresh();
    return { ok: true, message: "نوع ملک ویرایش شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ویرایش نوع ملک ناموفق بود." };
  }
}

export async function setPropertyTypeActiveAction(_previous: RealEstateResult | null, form: FormData): Promise<RealEstateResult> {
  const denied = await guardRealEstateAdmin();
  if (denied) return { ok: false, message: denied };
  try {
    await setPropertyTypeActive(val(form, "id"), val(form, "isActive") === "on");
    refresh();
    return { ok: true, message: "وضعیت نوع ملک به‌روزرسانی شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "به‌روزرسانی نوع ملک ناموفق بود." };
  }
}
