"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assetClasses, assets, commodityCategories, commodityItems, commodityPriceRecords } from "@/db/schema";
import { createRealEstateProperty } from "@/features/rwa/realEstate/service";
import { createVehicleAsset } from "@/features/rwa/vehicle/service";
import { createOwnershipRecord } from "@/features/rwa/ownership/service";
import { createValuationEvent } from "@/features/rwa/valuation/service";
import { createCategory, createCommodityItem, recordPricePoint } from "@/features/commodities/service";

import { getCurrentUser } from "@/lib/auth";
import { users } from "@/db/schema";
import { isNotNull } from "drizzle-orm";

export type RegistryResult = { ok: boolean; message: string };
const refresh = () => revalidatePath("/asset-registry");

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
const val = (f: FormData, key: string) => String(f.get(key) ?? "").trim();
const optional = (f: FormData, key: string) => val(f,key) || undefined;

async function rwaAsset(form: FormData) {
  const name = val(form,"name"), symbol = val(form,"symbol").toUpperCase();
  const kind = val(form,"kind");
  if (!name || !symbol || !kind) throw new Error("نام، نماد و نوع دارایی الزامی است.");
  let [klass] = await db.select().from(assetClasses).where(eq(assetClasses.code, "RWA")).limit(1);
  if (!klass) {
    [klass] = await db.insert(assetClasses).values({ code:"RWA", name:"دارایی واقعی", color:"#0f766e", sortOrder:90 }).onConflictDoNothing().returning();
    if (!klass) [klass] = await db.select().from(assetClasses).where(eq(assetClasses.code, "RWA")).limit(1);
  }
  const classId = klass?.id;
  if (!classId) throw new Error("کلاس دارایی واقعی ایجاد نشد.");
  const [asset] = await db.insert(assets).values({ name, symbol, classId, decimals: 2, priceSource:"manual" }).onConflictDoUpdate({target: assets.symbol, set:{name}}).returning();
  return { asset, kind };
}

export async function saveRwaAction(_previous: RegistryResult | null, form: FormData): Promise<RegistryResult> {
  const denied = await guardRegistry(); if (denied) return { ok: false, message: denied }; try {
    const { asset, kind } = await rwaAsset(form);
    if (kind === "property") await createRealEstateProperty({ assetId:asset.id, propertyType: val(form,"propertyType") as any, city:val(form,"city") || "Ahvaz", area:optional(form,"area"), address:optional(form,"address"), sizeSqm:optional(form,"sizeSqm"), floor: optional(form,"floor") ? Number(val(form,"floor")) : undefined, yearBuilt: optional(form,"yearBuilt") ? Number(val(form,"yearBuilt")) : undefined, deedNumber:optional(form,"deedNumber"), notes:optional(form,"notes") });
    else await createVehicleAsset({ assetId:asset.id, brand:val(form,"brand"), model:val(form,"model"), year:Number(val(form,"year")), licensePlate:optional(form,"licensePlate"), mileage:optional(form,"mileage") ? Number(val(form,"mileage")) : undefined, notes:optional(form,"notes") });
    await createOwnershipRecord({assetId:asset.id, ownershipPercentage:val(form,"ownership") || "100", ownershipType:(val(form,"ownershipType") || "full") as any, acquisitionDate:val(form,"acquisitionDate"), acquisitionPriceIRR:optional(form,"acquisitionPrice"), notes:optional(form,"ownershipNotes")});
    if (optional(form,"valuation")) await createValuationEvent({assetId:asset.id, valuationDate:val(form,"valuationDate"), priceIRR:val(form,"valuation"), valuationSource:(val(form,"valuationSource") || "manual") as any, appraiser:optional(form,"appraiser"), note:optional(form,"valuationNote")});
    refresh(); return {ok:true,message:"دارایی واقعی، مالکیت و ارزش‌گذاری با موفقیت ثبت شد."};
  } catch(e) { return {ok:false,message:e instanceof Error ? e.message : "ثبت دارایی ناموفق بود."}; }
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
