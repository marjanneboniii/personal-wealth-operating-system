"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assetClasses, assets, commodityCategories, commodityItems, commodityPriceRecords } from "@/db/schema";
import { createRealEstateProperty } from "@/features/rwa/realEstate/service";
import {
  createUserVehicle,
  ensureVehicleModuleReady,
  sellVehicle,
  updateVehicleDetails,
} from "@/features/rwa/vehicle/service";
import {
  createCatalogModel,
  createVehicleBrand,
  findOrCreateCatalogModel,
  listVehicleBrands,
} from "@/features/rwa/vehicle/catalog";
import { recordVehicleValuationSnapshot } from "@/features/rwa/vehicle/valuation";
import { formatMoney } from "@/lib/format";
import { resolveUsdRateForDate, tomanToUsd } from "@/features/rwa/vehicle/fx";
import { nextRwaSymbol } from "@/features/rwa/symbol";
import { createOwnershipRecord } from "@/features/rwa/ownership/service";
import { createValuationEvent } from "@/features/rwa/valuation/service";
import { createCategory, createCommodityItem, recordPricePoint } from "@/features/commodities/service";

import { getCurrentUser } from "@/lib/auth";
import { isAdminOrOwner } from "@/lib/authGuard";
import { users } from "@/db/schema";
import { isNotNull } from "drizzle-orm";

export type RegistryResult = { ok: boolean; message: string };
const refresh = () => {
  revalidatePath("/asset-registry");
  revalidatePath("/");
  revalidatePath("/assets");
  revalidatePath("/portfolio");
  revalidatePath("/net-worth");
};

/**
 * SECURITY: registry writes create/modify shared reference records. Require
 * an authenticated session once auth is enabled (legacy single-tenant mode
 * keeps working). Identity comes from the server-side session only.
 * FAIL-CLOSED: DB/auth errors DENY, never allow.
 */
async function guardRegistry(): Promise<string | null> {
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
 * Vehicle catalog is SHARED reference data (brands/models). Adding entries is
 * an admin operation once authentication is enabled; in legacy single-tenant
 * mode it stays open. Fail-closed on any auth/DB error.
 */
async function guardCatalogAdmin(): Promise<string | null> {
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
      return "افزودن برند/خودرو به کاتالوگ فقط برای مدیر امکان‌پذیر است.";
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
const optional = (f: FormData, key: string) => val(f,key) || undefined;
const numeric = (f: FormData, key: string) => val(f, key).replace(/[,٬\s]/g, "");

async function rwaAsset(form: FormData) {
  const name = val(form,"name");
  const kind = val(form,"kind") || "property";
  if (!name) throw new Error("نام دارایی الزامی است.");
  let [klass] = await db.select().from(assetClasses).where(eq(assetClasses.code, "RWA")).limit(1);
  if (!klass) {
    [klass] = await db.insert(assetClasses).values({ code:"RWA", name:"دارایی واقعی", color:"#12131c", sortOrder:90 }).onConflictDoNothing().returning();
    if (!klass) [klass] = await db.select().from(assetClasses).where(eq(assetClasses.code, "RWA")).limit(1);
  }
  const classId = klass?.id;
  if (!classId) throw new Error("کلاس دارایی واقعی ایجاد نشد.");
  const asset = await db.transaction(async (tx) => {
    const symbol = await nextRwaSymbol(tx, classId);
    const [created] = await tx
      .insert(assets)
      .values({ name, symbol, classId, decimals: 2, priceSource: "manual", pricingMethod: "manual" })
      .returning();
    if (!created) throw new Error("ایجاد رکورد دارایی ناموفق بود.");
    return created;
  });
  return { asset, kind };
}

/**
 * ثبت دارایی واقعی (ملک و سایر دارایی‌ها).
 * منطق مالکیت مشاع/درصدی/ارثی/رهنی فقط برای این دارایی‌ها باقی می‌ماند؛
 * خودرو مسیر اختصاصی خود (saveVehicleAction) را دارد و هیچ‌کدام از این
 * فیلدها را ندارد.
 */
export async function saveRwaAction(_previous: RegistryResult | null, form: FormData): Promise<RegistryResult> {
  const denied = await guardRegistry(); if (denied) return { ok: false, message: denied };
  if (val(form, "kind") === "vehicle") {
    // خودرو از مسیر اختصاصی ماژول خودرو ثبت می‌شود (کاتالوگ + قیمت خرید + Snapshot)
    return saveVehicleAction(_previous, form);
  }
  try {
    const userId = await currentUserId();
    const { asset } = await rwaAsset(form);
    await createRealEstateProperty({ assetId:asset.id, userId:userId ?? undefined, propertyType: val(form,"propertyType") as any, city:val(form,"city") || "Ahvaz", area:optional(form,"area"), address:optional(form,"address"), sizeSqm:optional(form,"sizeSqm"), floor: optional(form,"floor") ? Number(val(form,"floor")) : undefined, yearBuilt: optional(form,"yearBuilt") ? Number(val(form,"yearBuilt")) : undefined, deedNumber:optional(form,"deedNumber"), notes:optional(form,"notes") });
    await createOwnershipRecord({assetId:asset.id, userId:userId ?? undefined, ownershipPercentage:val(form,"ownership") || "100", ownershipType:(val(form,"ownershipType") || "full") as any, acquisitionDate:val(form,"acquisitionDate"), acquisitionPriceIRR:optional(form,"acquisitionPrice"), notes:optional(form,"ownershipNotes")});
    if (optional(form,"valuation")) await createValuationEvent({assetId:asset.id, userId:userId ?? undefined, valuationDate:val(form,"valuationDate"), priceIRR:val(form,"valuation"), valuationSource:(val(form,"valuationSource") || "manual") as any, appraiser:optional(form,"appraiser"), note:optional(form,"valuationNote")});
    refresh(); return {ok:true,message:"دارایی واقعی، مالکیت و ارزش‌گذاری با موفقیت ثبت شد."};
  } catch(e) { return {ok:false,message:e instanceof Error ? e.message : "ثبت دارایی ناموفق بود."}; }
}

/* ═══════════════════════════════════════════════════════════════════
   دارایی واقعی → خودرو
   مالکیت شخصی (User → Vehicle)، بدون درصد مالکیت، مشاع، ارث یا رهن.
   قیمت خرید = ورودی کاربر · ارزش فعلی = آخرین Snapshot ارزش‌گذاری.
   ═══════════════════════════════════════════════════════════════════ */

/** نرخ دلار تاریخ موردنظر برای پیش‌نمایش/محاسبه خودکار معادل دلاری. */
export async function getUsdRateForDateAction(
  dateIso: string,
): Promise<{ ok: boolean; rate: string; effectiveDate: string; source: string; isExact: boolean }> {
  try {
    const userId = await currentUserId();
    const resolved = await resolveUsdRateForDate(dateIso, userId);
    return { ok: true, ...resolved };
  } catch {
    return { ok: false, rate: "0", effectiveDate: dateIso, source: "unavailable", isExact: false };
  }
}

/** محاسبه معادل دلاری با نرخ همان تاریخ (بدون ذخیره‌سازی) — فقط پیش‌نمایش. */
export async function previewPurchaseUsdAction(
  amountToman: string,
  dateIso: string,
  manualRate?: string,
): Promise<{ ok: boolean; usd: string; rate: string; effectiveDate: string; source: string; isExact: boolean }> {
  const clean = String(amountToman ?? "").replace(/[,٬\s]/g, "");
  const rateInfo = manualRate && Number(manualRate) > 0
    ? { rate: String(manualRate), effectiveDate: dateIso, source: "manual", isExact: true }
    : await resolveUsdRateForDate(dateIso, await currentUserId());
  if (!clean || Number(clean) <= 0 || Number(rateInfo.rate) <= 0) {
    return { ok: false, usd: "0", ...rateInfo };
  }
  return { ok: true, usd: tomanToUsd(clean, rateInfo.rate), ...rateInfo };
}

export async function saveVehicleAction(_previous: RegistryResult | null, form: FormData): Promise<RegistryResult> {
  const denied = await guardRegistry(); if (denied) return { ok: false, message: denied };
  try {
    await ensureVehicleModuleReady();
    const userId = await currentUserId();

    let catalogId = optional(form, "catalogId");
    const brandId = optional(form, "brandId");
    const customModel = optional(form, "customModelName");

    // برندهای با فهرست باز (تویوتا، رنو، …): مدل واردشده به کاتالوگ اضافه می‌شود
    if (!catalogId && brandId && customModel) {
      const brands = await listVehicleBrands(true);
      const brand = brands.find((b) => b.id === brandId);
      if (!brand) throw new Error("برند انتخاب‌شده یافت نشد.");
      if (!brand.allowsCustomModel) throw new Error("برای این برند باید مدل را از فهرست انتخاب کنید.");
      const model = await findOrCreateCatalogModel({ brandId, modelName: customModel, createdByUserId: userId });
      catalogId = model.id;
    }
    if (!catalogId) throw new Error("نام و مدل خودرو باید از فهرست کاتالوگ انتخاب شود.");

    const initialValue = numeric(form, "initialValuation");
    const result = await createUserVehicle({
      userId,
      catalogId,
      manufacturingYear: Number(numeric(form, "manufacturingYear")),
      ownershipDate: val(form, "ownershipDate"),
      purchasePriceToman: numeric(form, "purchasePriceToman"),
      purchaseUsdRate: numeric(form, "purchaseUsdRate") || undefined,
      plate: optional(form, "plate"),
      mileage: numeric(form, "mileage") ? Number(numeric(form, "mileage")) : undefined,
      notes: optional(form, "notes"),
      initialValuation: initialValue
        ? {
            valueToman: initialValue,
            snapshotDate: val(form, "initialValuationDate") || val(form, "ownershipDate"),
            usdRate: numeric(form, "initialValuationRate") || undefined,
            note: "اولین ارزش‌گذاری ثبت‌شده",
          }
        : undefined,
    });

    refresh();
    return { ok: true, message: `خودرو با شناسه ${result.symbol} ثبت شد. معادل دلاری قیمت خرید بر اساس نرخ همان تاریخ ذخیره شد.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ثبت خودرو ناموفق بود." };
  }
}

/** ثبت ارزش‌گذاری جدید — همیشه یک Snapshot جدید و تغییرناپذیر. */
export async function recordVehicleValuationAction(_previous: RegistryResult | null, form: FormData): Promise<RegistryResult> {
  const denied = await guardRegistry(); if (denied) return { ok: false, message: denied };
  try {
    const userId = await currentUserId();
    const catalogId = val(form, "catalogId");
    const scope = val(form, "scope"); // vehicle | catalog
    const snapshot = await recordVehicleValuationSnapshot({
      catalogId,
      userVehicleId: scope === "catalog" ? null : optional(form, "vehicleId") ?? null,
      snapshotDate: val(form, "snapshotDate"),
      currentValueToman: numeric(form, "currentValueToman"),
      usdRate: numeric(form, "usdRate") || undefined,
      source: optional(form, "source") ?? "manual",
      note: optional(form, "note"),
      createdByUserId: userId,
    });
    refresh();
    return {
      ok: true,
      message: `ارزش‌گذاری جدید ثبت شد: ${formatMoney(snapshot.currentValueToman, "IRT")} با نرخ دلار ${formatMoney(snapshot.usdRate, "IRT")} (≈ ${formatMoney(snapshot.currentValueUsd, "USD")}).`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ثبت ارزش‌گذاری ناموفق بود." };
  }
}

export async function sellVehicleAction(_previous: RegistryResult | null, form: FormData): Promise<RegistryResult> {
  const denied = await guardRegistry(); if (denied) return { ok: false, message: denied };
  try {
    const userId = await currentUserId();
    await sellVehicle({
      vehicleId: val(form, "vehicleId"),
      saleDate: val(form, "saleDate"),
      salePriceToman: numeric(form, "salePriceToman"),
      saleUsdRate: numeric(form, "saleUsdRate") || undefined,
      userId,
    });
    refresh();
    return { ok: true, message: "فروش خودرو ثبت شد. بازدهی نهایی بر اساس قیمت واقعی فروش محاسبه می‌شود." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ثبت فروش ناموفق بود." };
  }
}

export async function updateVehicleDetailsAction(_previous: RegistryResult | null, form: FormData): Promise<RegistryResult> {
  const denied = await guardRegistry(); if (denied) return { ok: false, message: denied };
  try {
    const userId = await currentUserId();
    await updateVehicleDetails({
      vehicleId: val(form, "vehicleId"),
      userId,
      plate: optional(form, "plate") ?? null,
      mileage: numeric(form, "mileage") ? Number(numeric(form, "mileage")) : null,
      notes: optional(form, "notes") ?? null,
    });
    refresh();
    return { ok: true, message: "اطلاعات خودرو به‌روزرسانی شد (قیمت خرید و تاریخچه تغییر نکرد)." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "به‌روزرسانی ناموفق بود." };
  }
}

/** افزودن برند / شرکت سازنده جدید به کاتالوگ (Dynamic Catalog). */
export async function createVehicleBrandAction(_previous: RegistryResult | null, form: FormData): Promise<RegistryResult> {
  const denied = await guardCatalogAdmin(); if (denied) return { ok: false, message: denied };
  try {
    const brand = await createVehicleBrand({
      name: val(form, "name"),
      nameEn: optional(form, "nameEn"),
      origin: (optional(form, "origin") as any) ?? "imported",
      allowsCustomModel: val(form, "allowsCustomModel") === "on",
    });
    refresh();
    return { ok: true, message: `برند «${brand.name}» به کاتالوگ اضافه شد.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ثبت برند ناموفق بود." };
  }
}

/** افزودن خودروی جدید به کاتالوگ — با جلوگیری از ثبت تکراری. */
export async function createVehicleModelAction(_previous: RegistryResult | null, form: FormData): Promise<RegistryResult> {
  const denied = await guardCatalogAdmin(); if (denied) return { ok: false, message: denied };
  try {
    const userId = await currentUserId();
    const model = await createCatalogModel({
      brandId: val(form, "brandId"),
      modelName: val(form, "modelName"),
      modelYear: numeric(form, "modelYear") ? Number(numeric(form, "modelYear")) : null,
      manufacturer: optional(form, "manufacturer") ?? null,
      category: optional(form, "category") ?? null,
      description: optional(form, "description") ?? null,
      createdByUserId: userId,
    });
    refresh();
    return { ok: true, message: `خودرو «${model.brandName} — ${model.modelName}» به کاتالوگ اضافه شد و از این پس در فهرست انتخاب نمایش داده می‌شود.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ثبت خودرو در کاتالوگ ناموفق بود." };
  }
}

export async function saveCommodityAction(_previous: RegistryResult | null, form: FormData): Promise<RegistryResult> {
 const denied = await guardRegistry(); if (denied) return { ok: false, message: denied }; try {
  let categoryId = optional(form,"categoryId"); const categoryName=optional(form,"newCategory");
  if (categoryName) categoryId=(await createCategory(categoryName)).id;
  let commodityId=optional(form,"commodityId");
  if (!commodityId) commodityId=(await createCommodityItem(val(form,"itemName"),categoryId, val(form,"unit") || "عدد")).id;
  await recordPricePoint({commodityId,unitPrice:val(form,"unitPrice"),unit:val(form,"unit")||"عدد",quantity:val(form,"quantity")||"1",purchasedAt:val(form,"purchasedAt"),merchantName:optional(form,"merchant"),notes:optional(form,"notes")});
  refresh(); return {ok:true,message:"قلم کالا و رکورد قیمت ثبت شد."};
 } catch(e) {return {ok:false,message:e instanceof Error?e.message:"ثبت قیمت ناموفق بود."};}
}

export async function updateCommodityItemAction(_previous: RegistryResult | null, form: FormData): Promise<RegistryResult> {
 const denied = await guardRegistry(); if (denied) return { ok: false, message: denied }; try { const id=val(form,"id"), name=val(form,"name"), unit=val(form,"unit"); if(!id||!name) throw new Error("اطلاعات قلم ناقص است."); await db.update(commodityItems).set({name,defaultUnit:unit||"عدد"}).where(eq(commodityItems.id,id)); refresh(); return {ok:true,message:"قلم کالا ویرایش شد."}; } catch(e){return {ok:false,message:e instanceof Error?e.message:"ویرایش ناموفق بود."};}
}

export async function updateCommodityPriceAction(_previous: RegistryResult | null, form: FormData): Promise<RegistryResult> {
 const denied = await guardRegistry(); if (denied) return { ok: false, message: denied }; try {const id=val(form,"id"), price=val(form,"unitPrice"), qty=val(form,"quantity")||"1"; if(!id||!price)throw new Error("قیمت را وارد کنید."); await db.update(commodityPriceRecords).set({unitPrice:price,quantity:qty,totalAmount:String(Number(price)*Number(qty)),merchantName:optional(form,"merchant"),notes:optional(form,"notes")}).where(eq(commodityPriceRecords.id,id)); refresh();return {ok:true,message:"رکورد قیمت ویرایش شد."};}catch(e){return {ok:false,message:e instanceof Error?e.message:"ویرایش ناموفق بود."};}
}
