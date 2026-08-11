/**
 * Real Estate Master Data — City → Neighborhood → Property Type.
 *
 * NOT hard-coded into the application logic: the default dataset only seeds
 * the database once (idempotent). Admins can add cities, neighborhoods and
 * property types at runtime; new entries immediately show up in the
 * registration form without any schema change.
 *
 * Rules:
 *  - Users only ever pick ACTIVE entries (the form lists active only, and the
 *    create-service re-validates against the DB).
 *  - Duplicate protection: city code, property-type code, and (city_id, code)
 *    for neighborhoods are unique.
 *  - Disabling an entry hides it from users but keeps history intact.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { cities, neighborhoods, propertyTypes } from "@/db/schema";
import { normalizeKey } from "@/features/rwa/vehicle/catalog";
import type { City, Neighborhood, PropertyType } from "./types";

/* ─────────────────────────── seed data ─────────────────────────── */

export const CITIES_SEED = [{ nameFa: "اهواز", nameEn: "Ahvaz", code: "AHZ" }];

export const NEIGHBORHOODS_SEED: { nameFa: string; nameEn: string; code: string }[] = [
  { nameFa: "گلستان", nameEn: "Golestan", code: "GOL" },
  { nameFa: "سعدی", nameEn: "Saadi", code: "SAD" },
  { nameFa: "فرهنگ شهر", nameEn: "Farhang Shahr", code: "FAR" },
  { nameFa: "باغ شیخ", nameEn: "Bagh Sheikh", code: "BAG" },
  { nameFa: "امانیه", nameEn: "Amanieh", code: "AMA" },
  { nameFa: "کوروش", nameEn: "Kourosh", code: "KUR" },
  { nameFa: "کمپلو شمالی", nameEn: "Kompilo North", code: "KNO" },
  { nameFa: "کیانپارس شرقی", nameEn: "Kianpars East", code: "KPE" },
  { nameFa: "کیان پارس غربی", nameEn: "Kianpars West", code: "KPW" },
  { nameFa: "شهرک دانشگاه", nameEn: "Shahrak Daneshgah", code: "SDU" },
  { nameFa: "زیتون کارمندی", nameEn: "Zeytoon Karmandi", code: "ZKA" },
  { nameFa: "کیان آباد شرقی", nameEn: "Kianabad East", code: "KAE" },
  { nameFa: "کیان آباد غربی", nameEn: "Kianabad West", code: "KAW" },
  { nameFa: "پاداد", nameEn: "Padad", code: "PAD" },
  { nameFa: "آریا شهر", nameEn: "Arya Shahr", code: "ARS" },
  { nameFa: "مهر شهر", nameEn: "Mehr Shahr", code: "MHR" },
];

export const PROPERTY_TYPES_SEED: { nameFa: string; nameEn: string; code: string }[] = [
  { nameFa: "آپارتمان", nameEn: "Apartment", code: "APT" },
  { nameFa: "خانه ویلایی", nameEn: "Villa House", code: "HOU" },
  { nameFa: "زمین", nameEn: "Land", code: "LND" },
  { nameFa: "مغازه / واحد تجاری", nameEn: "Shop / Commercial Unit", code: "SHO" },
  { nameFa: "دفتر کار", nameEn: "Office", code: "OFF" },
  { nameFa: "ویلا", nameEn: "Villa", code: "VIL" },
  { nameFa: "باغ", nameEn: "Garden", code: "GAR" },
  { nameFa: "ملک اداری", nameEn: "Administrative Property", code: "ADM" },
  { nameFa: "ملک صنعتی", nameEn: "Industrial Property", code: "IND" },
  { nameFa: "انبار", nameEn: "Warehouse", code: "WAR" },
  { nameFa: "پارکینگ", nameEn: "Parking", code: "PRK" },
  { nameFa: "سایر", nameEn: "Other", code: "OTH" },
];

/* ─────────────────────────── seeding ─────────────────────────── */

let seedPromise: Promise<void> | null = null;

/**
 * Idempotently install the default master data. Existing rows are never
 * overwritten, so admin edits (rename / deactivate) survive every restart.
 */
export async function seedRealEstateMasterData(): Promise<void> {
  for (let i = 0; i < CITIES_SEED.length; i++) {
    const c = CITIES_SEED[i];
    await db
      .insert(cities)
      .values({ nameFa: c.nameFa, nameEn: c.nameEn, code: c.code, sortOrder: i })
      .onConflictDoNothing({ target: cities.code });
  }

  const [ahvaz] = await db.select().from(cities).where(eq(cities.code, "AHZ")).limit(1);
  if (ahvaz) {
    for (let i = 0; i < NEIGHBORHOODS_SEED.length; i++) {
      const n = NEIGHBORHOODS_SEED[i];
      await db
        .insert(neighborhoods)
        .values({
          cityId: ahvaz.id,
          nameFa: n.nameFa,
          nameEn: n.nameEn,
          code: n.code,
          sortOrder: i,
        })
        .onConflictDoNothing({ target: [neighborhoods.cityId, neighborhoods.code] });
    }
  }

  for (let i = 0; i < PROPERTY_TYPES_SEED.length; i++) {
    const p = PROPERTY_TYPES_SEED[i];
    await db
      .insert(propertyTypes)
      .values({ nameFa: p.nameFa, nameEn: p.nameEn, code: p.code, sortOrder: i })
      .onConflictDoNothing({ target: propertyTypes.code });
  }
}

export async function seedRealEstateMasterDataIfEmpty(): Promise<void> {
  const [existing] = await db.select({ id: cities.id }).from(cities).limit(1);
  if (!existing) await seedRealEstateMasterData();
}

/* ─────────────────────────── reads ─────────────────────────── */

const mapCity = (r: typeof cities.$inferSelect): City => ({
  id: r.id,
  nameFa: r.nameFa,
  nameEn: r.nameEn,
  code: r.code,
  isActive: r.isActive,
  sortOrder: r.sortOrder,
});

const mapNeighborhood = (r: typeof neighborhoods.$inferSelect): Neighborhood => ({
  id: r.id,
  cityId: r.cityId,
  nameFa: r.nameFa,
  nameEn: r.nameEn,
  code: r.code,
  isActive: r.isActive,
  sortOrder: r.sortOrder,
});

const mapPropertyType = (r: typeof propertyTypes.$inferSelect): PropertyType => ({
  id: r.id,
  nameFa: r.nameFa,
  nameEn: r.nameEn,
  code: r.code,
  isActive: r.isActive,
  sortOrder: r.sortOrder,
});

export async function listCities(includeInactive = false): Promise<City[]> {
  const rows = await db
    .select()
    .from(cities)
    .where(includeInactive ? undefined : eq(cities.isActive, true))
    .orderBy(asc(cities.sortOrder), asc(cities.nameFa));
  return rows.map(mapCity);
}

export async function listNeighborhoods(cityId?: string, includeInactive = false): Promise<Neighborhood[]> {
  const rows = await db
    .select()
    .from(neighborhoods)
    .where(
      cityId
        ? and(eq(neighborhoods.cityId, cityId), includeInactive ? undefined : eq(neighborhoods.isActive, true))
        : includeInactive
          ? undefined
          : eq(neighborhoods.isActive, true),
    )
    .orderBy(asc(neighborhoods.sortOrder), asc(neighborhoods.nameFa));
  return rows.map(mapNeighborhood);
}

export async function listPropertyTypes(includeInactive = false): Promise<PropertyType[]> {
  const rows = await db
    .select()
    .from(propertyTypes)
    .where(includeInactive ? undefined : eq(propertyTypes.isActive, true))
    .orderBy(asc(propertyTypes.sortOrder), asc(propertyTypes.nameFa));
  return rows.map(mapPropertyType);
}

export async function getCity(id: string): Promise<City | null> {
  const [row] = await db.select().from(cities).where(eq(cities.id, id)).limit(1);
  return row ? mapCity(row) : null;
}

export async function getNeighborhood(id: string): Promise<Neighborhood | null> {
  const [row] = await db.select().from(neighborhoods).where(eq(neighborhoods.id, id)).limit(1);
  return row ? mapNeighborhood(row) : null;
}

export async function getPropertyType(id: string): Promise<PropertyType | null> {
  const [row] = await db.select().from(propertyTypes).where(eq(propertyTypes.id, id)).limit(1);
  return row ? mapPropertyType(row) : null;
}

/* ─────────────────────────── admin CRUD ─────────────────────────── */

export async function createCity(input: { nameFa: string; nameEn?: string; code: string }): Promise<City> {
  const nameFa = input.nameFa.trim();
  const code = input.code.trim().toUpperCase();
  if (!nameFa || !code) throw new Error("نام و کد شهر الزامی است.");
  const [row] = await db
    .insert(cities)
    .values({ nameFa, nameEn: input.nameEn?.trim() || nameFa, code, sortOrder: 999 })
    .onConflictDoNothing({ target: cities.code })
    .returning();
  if (!row) throw new Error("شهری با این کد از قبل ثبت شده است.");
  return mapCity(row);
}

export async function updateCity(id: string, patch: { nameFa?: string; nameEn?: string }): Promise<void> {
  await db.update(cities).set({ ...patch, updatedAt: new Date() }).where(eq(cities.id, id));
}

export async function setCityActive(id: string, isActive: boolean): Promise<void> {
  await db.update(cities).set({ isActive, updatedAt: new Date() }).where(eq(cities.id, id));
}

export async function createNeighborhood(input: { cityId: string; nameFa: string; nameEn?: string; code: string }): Promise<Neighborhood> {
  const nameFa = input.nameFa.trim();
  const code = input.code.trim().toUpperCase();
  if (!nameFa || !code) throw new Error("نام و کد محله الزامی است.");
  const [cityRow] = await db.select().from(cities).where(eq(cities.id, input.cityId)).limit(1);
  if (!cityRow) throw new Error("شهر انتخاب‌شده یافت نشد.");
  const [row] = await db
    .insert(neighborhoods)
    .values({ cityId: input.cityId, nameFa, nameEn: input.nameEn?.trim() || nameFa, code, sortOrder: 999 })
    .onConflictDoNothing({ target: [neighborhoods.cityId, neighborhoods.code] })
    .returning();
  if (!row) throw new Error("محله‌ای با این کد در این شهر از قبل ثبت شده است.");
  return mapNeighborhood(row);
}

export async function updateNeighborhood(id: string, patch: { nameFa?: string; nameEn?: string }): Promise<void> {
  await db.update(neighborhoods).set({ ...patch, updatedAt: new Date() }).where(eq(neighborhoods.id, id));
}

export async function setNeighborhoodActive(id: string, isActive: boolean): Promise<void> {
  await db.update(neighborhoods).set({ isActive, updatedAt: new Date() }).where(eq(neighborhoods.id, id));
}

export async function createPropertyType(input: { nameFa: string; nameEn?: string; code: string }): Promise<PropertyType> {
  const nameFa = input.nameFa.trim();
  const code = input.code.trim().toUpperCase();
  if (!nameFa || !code) throw new Error("نام و کد نوع ملک الزامی است.");
  const [row] = await db
    .insert(propertyTypes)
    .values({ nameFa, nameEn: input.nameEn?.trim() || nameFa, code, sortOrder: 999 })
    .onConflictDoNothing({ target: propertyTypes.code })
    .returning();
  if (!row) throw new Error("نوع ملکی با این کد از قبل ثبت شده است.");
  return mapPropertyType(row);
}

export async function updatePropertyType(id: string, patch: { nameFa?: string; nameEn?: string }): Promise<void> {
  await db.update(propertyTypes).set({ ...patch, updatedAt: new Date() }).where(eq(propertyTypes.id, id));
}

export async function setPropertyTypeActive(id: string, isActive: boolean): Promise<void> {
  await db.update(propertyTypes).set({ isActive, updatedAt: new Date() }).where(eq(propertyTypes.id, id));
}

/** Unique-name protection helper (Persian/Arabic letter unification). */
export { normalizeKey };
