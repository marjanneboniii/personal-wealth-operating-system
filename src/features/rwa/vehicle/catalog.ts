/**
 * Vehicle Catalog service — Brand → Model, fully dynamic.
 *
 * - The list of vehicles is NOT hard-coded into the application logic: the
 *   default dataset only seeds the database once. Admins can add brands and
 *   models at runtime; new entries immediately show up in the registration
 *   form without any schema change.
 * - Duplicate protection: brand key (normalised name) and model key
 *   (normalised name inside its brand) are unique.
 * - Users never type brand/model freely for catalog brands. Only brands
 *   flagged `allowsCustomModel` accept a typed model name, which is then
 *   persisted into the catalog for reuse.
 */
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { vehicleBrands, vehicleCatalog } from "@/db/schema";
import { VEHICLE_CATALOG_SEED, inferCategory } from "./catalogData";
import type { VehicleBrand, VehicleCatalogModel, VehicleOrigin } from "./types";

/**
 * Normalised comparison key: Persian/Arabic letter unification, digit
 * unification, ZWNJ removal, whitespace collapse, lower-casing.
 * "هایما  S7 پرو" and "هايما S7 پرو" collide → duplicate is rejected.
 */
export function normalizeKey(input: string): string {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  return (input ?? "")
    .toString()
    .replace(/[\u064A\u0649]/g, "\u06CC") // ي/ى → ی
    .replace(/\u0643/g, "\u06A9") // ك → ک
    .replace(/[\u200c\u200f\u200e]/g, "") // ZWNJ / direction marks
    .replace(/[٠-٩]/g, (d) => String(arabicDigits.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(persianDigits.indexOf(d)))
    .replace(/[\u064B-\u0652]/g, "") // harakat
    .replace(/[-_/\\.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function mapBrand(row: typeof vehicleBrands.$inferSelect, modelCount?: number): VehicleBrand {
  return {
    id: row.id,
    name: row.name,
    nameEn: row.nameEn,
    origin: (row.origin as VehicleOrigin) ?? "imported",
    allowsCustomModel: row.allowsCustomModel,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    modelCount,
  };
}

/* ───────────────────────────── Seeding ───────────────────────────── */

let seedPromise: Promise<void> | null = null;

/**
 * Idempotently install the default catalog. Existing rows are never
 * overwritten, so admin edits survive every restart.
 */
export async function seedVehicleCatalog(): Promise<void> {
  for (let index = 0; index < VEHICLE_CATALOG_SEED.length; index++) {
    const seed = VEHICLE_CATALOG_SEED[index];
    const brandKey = normalizeKey(seed.name);
    let [brand] = await db.select().from(vehicleBrands).where(eq(vehicleBrands.brandKey, brandKey)).limit(1);
    if (!brand) {
      const inserted = await db
        .insert(vehicleBrands)
        .values({
          name: seed.name,
          brandKey,
          nameEn: seed.nameEn,
          origin: seed.origin,
          allowsCustomModel: seed.allowsCustomModel ?? false,
          sortOrder: index,
        })
        .onConflictDoNothing()
        .returning();
      brand = inserted[0];
      if (!brand) {
        [brand] = await db.select().from(vehicleBrands).where(eq(vehicleBrands.brandKey, brandKey)).limit(1);
      }
    }
    if (!brand) continue;

    for (const modelName of seed.models) {
      await db
        .insert(vehicleCatalog)
        .values({
          brandId: brand.id,
          modelName,
          modelKey: normalizeKey(modelName),
          manufacturer: seed.manufacturer ?? seed.nameEn ?? seed.name,
          category: inferCategory(modelName),
        })
        .onConflictDoNothing();
    }
  }
}

/** Seed once per process, and only when the catalog is still empty. */
export async function seedVehicleCatalogIfEmpty(): Promise<void> {
  seedPromise ??= (async () => {
    const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(vehicleBrands);
    if ((row?.c ?? 0) > 0) return;
    await seedVehicleCatalog();
  })().catch((err) => {
    seedPromise = null;
    throw err;
  });
  return seedPromise;
}

/* ───────────────────────────── Queries ───────────────────────────── */

export async function listVehicleBrands(includeInactive = false): Promise<VehicleBrand[]> {
  const rows = await db
    .select({
      brand: vehicleBrands,
      modelCount: sql<number>`(select count(*)::int from vehicle_catalog c where c.brand_id = ${vehicleBrands.id} and c.is_active = true)`,
    })
    .from(vehicleBrands)
    .orderBy(asc(vehicleBrands.sortOrder), asc(vehicleBrands.name));

  return rows
    .filter((r) => includeInactive || r.brand.isActive)
    .map((r) => mapBrand(r.brand, Number(r.modelCount ?? 0)));
}

export async function listVehicleCatalogModels(brandId?: string): Promise<VehicleCatalogModel[]> {
  const rows = await db
    .select({ c: vehicleCatalog, b: vehicleBrands })
    .from(vehicleCatalog)
    .innerJoin(vehicleBrands, eq(vehicleBrands.id, vehicleCatalog.brandId))
    .orderBy(asc(vehicleBrands.sortOrder), asc(vehicleCatalog.modelName));

  return rows
    .filter((r) => (brandId ? r.c.brandId === brandId : true))
    .map((r) => ({
      id: r.c.id,
      brandId: r.c.brandId,
      brandName: r.b.name,
      brandNameEn: r.b.nameEn,
      brandOrigin: (r.b.origin as VehicleOrigin) ?? "imported",
      modelName: r.c.modelName,
      modelYear: r.c.modelYear,
      manufacturer: r.c.manufacturer,
      category: r.c.category,
      description: r.c.description,
      isActive: r.c.isActive,
    }));
}

export async function getCatalogModel(catalogId: string): Promise<VehicleCatalogModel | null> {
  const rows = await db
    .select({ c: vehicleCatalog, b: vehicleBrands })
    .from(vehicleCatalog)
    .innerJoin(vehicleBrands, eq(vehicleBrands.id, vehicleCatalog.brandId))
    .where(eq(vehicleCatalog.id, catalogId))
    .limit(1);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.c.id,
    brandId: r.c.brandId,
    brandName: r.b.name,
    brandNameEn: r.b.nameEn,
    brandOrigin: (r.b.origin as VehicleOrigin) ?? "imported",
    modelName: r.c.modelName,
    modelYear: r.c.modelYear,
    manufacturer: r.c.manufacturer,
    category: r.c.category,
    description: r.c.description,
    isActive: r.c.isActive,
  };
}

/* ──────────────────────────── Mutations ──────────────────────────── */

export async function createVehicleBrand(input: {
  name: string;
  nameEn?: string;
  origin?: VehicleOrigin;
  allowsCustomModel?: boolean;
}): Promise<VehicleBrand> {
  const name = (input.name ?? "").trim();
  if (!name) throw new Error("نام برند / شرکت سازنده الزامی است.");
  const brandKey = normalizeKey(name);

  const [existing] = await db.select().from(vehicleBrands).where(eq(vehicleBrands.brandKey, brandKey)).limit(1);
  if (existing) {
    throw new Error(`برند «${existing.name}» از قبل در سیستم ثبت شده است.`);
  }

  const [row] = await db
    .insert(vehicleBrands)
    .values({
      name,
      brandKey,
      nameEn: input.nameEn?.trim() || null,
      origin: input.origin ?? "imported",
      allowsCustomModel: input.allowsCustomModel ?? false,
      sortOrder: 500,
    })
    .returning();
  return mapBrand(row, 0);
}

/**
 * Add a model to the catalog. Duplicate (same brand + same normalised name)
 * is refused with an explicit warning instead of creating a second record.
 */
export async function createCatalogModel(input: {
  brandId: string;
  modelName: string;
  modelYear?: number | null;
  manufacturer?: string | null;
  category?: string | null;
  description?: string | null;
  createdByUserId?: string | null;
}): Promise<VehicleCatalogModel> {
  const modelName = (input.modelName ?? "").trim();
  if (!input.brandId) throw new Error("برند خودرو را انتخاب کنید.");
  if (!modelName) throw new Error("نام خودرو / مدل الزامی است.");

  const [brand] = await db.select().from(vehicleBrands).where(eq(vehicleBrands.id, input.brandId)).limit(1);
  if (!brand) throw new Error("برند انتخاب‌شده یافت نشد.");

  const modelKey = normalizeKey(modelName);
  const duplicates = await db.select().from(vehicleCatalog).where(eq(vehicleCatalog.brandId, input.brandId));
  const clash = duplicates.find((d) => d.modelKey === modelKey);
  if (clash) {
    throw new Error(`این خودرو قبلاً با همین برند و نام ثبت شده است: «${brand.name} — ${clash.modelName}»`);
  }

  const [row] = await db
    .insert(vehicleCatalog)
    .values({
      brandId: input.brandId,
      modelName,
      modelKey,
      modelYear: input.modelYear ?? null,
      manufacturer: input.manufacturer?.trim() || brand.name,
      category: input.category?.trim() || inferCategory(modelName),
      description: input.description?.trim() || null,
      createdByUserId: input.createdByUserId ?? null,
    })
    .returning();

  return {
    id: row.id,
    brandId: row.brandId,
    brandName: brand.name,
    brandNameEn: brand.nameEn,
    brandOrigin: (brand.origin as VehicleOrigin) ?? "imported",
    modelName: row.modelName,
    modelYear: row.modelYear,
    manufacturer: row.manufacturer,
    category: row.category,
    description: row.description,
    isActive: row.isActive,
  };
}

/**
 * For brands that allow free model entry (Toyota, Renault, …): reuse the
 * existing catalog entry when the same model was already registered,
 * otherwise create it. Never produces duplicates.
 */
export async function findOrCreateCatalogModel(input: {
  brandId: string;
  modelName: string;
  createdByUserId?: string | null;
}): Promise<VehicleCatalogModel> {
  const modelKey = normalizeKey(input.modelName);
  if (!modelKey) throw new Error("نام مدل خودرو الزامی است.");
  const existing = await listVehicleCatalogModels(input.brandId);
  const found = existing.find((m) => normalizeKey(m.modelName) === modelKey);
  if (found) return found;
  return createCatalogModel(input);
}
