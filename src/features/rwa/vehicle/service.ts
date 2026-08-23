/**
 * RWA Vehicle Service — دارایی واقعی → خودرو
 *
 * The vehicle is managed as a personal asset that can be analysed as an
 * investment. It is isolated from the accounting ledger (no FK to
 * journal_entries / postings / lots) and from the real-estate ownership model:
 *
 *   User → Vehicle Asset            (exactly ONE owner)
 *   NO ownership_percentage, NO co_owner, NO ownership_type,
 *   NO inheritance_share, NO mortgage_share  — those stay in the property module.
 *
 * Value rules:
 *   Purchase Price  = the real amount paid by the user (immutable history)
 *   Current Value   = the latest valuation SNAPSHOT (never today's FX rate)
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assetClasses, assets, rwaOwnershipRecords, vehicleAssets } from "@/db/schema";
import { ensureSchemaOnce } from "@/db/init-schema";
import { D } from "@/domain/decimal";
import { todayIso } from "@/lib/format";
import { nextRwaSymbol } from "@/features/rwa/symbol";
import type { CreateVehicleInput, VehicleAsset } from "../types";
import {
  getCatalogModel,
  listVehicleCatalogModels,
  normalizeKey,
  seedVehicleCatalogIfEmpty,
  createVehicleBrand,
  createCatalogModel,
  listVehicleBrands,
} from "./catalog";
import { resolveUsdRateForDate, tomanToUsd } from "./fx";
import { rateStr, tomanStr, usdStr } from "./num";
import {
  getEffectiveSnapshots,
  latestSnapshot,
  recordVehicleValuationSnapshot,
  toPoint,
} from "./valuation";
import {
  allPeriodResults,
  cagrPercent,
  holdingDuration,
  historyWithDeltas,
  roiPercent,
  type PeriodResult,
  type SnapshotPoint,
} from "./analytics";
import type {
  VehicleDashboardItem,
  VehicleGains,
  VehiclePortfolioSummary,
  VehicleValuationState,
} from "./dto";
import type {
  CreateUserVehicleInput,
  SellVehicleInput,
  UserVehicle,
  VehicleCatalogModel,
  VehicleStatus,
  VehicleValuationSnapshot,
} from "./types";

/* ────────────────────── legacy identity helpers ────────────────────── */

export async function createVehicleAsset(input: CreateVehicleInput): Promise<{ id: string }> {
  const [assetRow] = await db.select().from(assets).where(eq(assets.id, input.assetId)).limit(1);
  if (!assetRow) throw new Error(`Asset not found: ${input.assetId}`);

  const [inserted] = await db
    .insert(vehicleAssets)
    .values({
      assetId: input.assetId,
      userId: input.userId ?? null,
      brand: input.brand,
      model: input.model,
      year: input.year,
      licensePlate: input.licensePlate ?? null,
      chassisNumber: input.chassisNumber ?? null,
      mileage: input.mileage ?? null,
      notes: input.notes ?? null,
    })
    .onConflictDoUpdate({
      target: vehicleAssets.assetId,
      set: {
        userId: input.userId ?? null,
        brand: input.brand,
        model: input.model,
        year: input.year,
        licensePlate: input.licensePlate ?? null,
        chassisNumber: input.chassisNumber ?? null,
        mileage: input.mileage ?? null,
        notes: input.notes ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return { id: inserted.id };
}

function mapVehicleAsset(r: typeof vehicleAssets.$inferSelect & { assetSymbol?: string }): VehicleAsset {
  return {
    id: r.id,
    assetId: r.assetId,
    assetSymbol: r.assetSymbol,
    userId: r.userId,
    brand: r.brand,
    model: r.model,
    year: r.year,
    licensePlate: r.licensePlate,
    chassisNumber: r.chassisNumber,
    mileage: r.mileage,
    notes: r.notes,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: r.updatedAt?.toISOString() ?? null,
  };
}

export async function getVehicleAsset(assetId: string): Promise<VehicleAsset | null> {
  const rows = await db
    .select({ v: vehicleAssets, assetSymbol: assets.symbol })
    .from(vehicleAssets)
    .innerJoin(assets, eq(assets.id, vehicleAssets.assetId))
    .where(eq(vehicleAssets.assetId, assetId))
    .limit(1);
  if (!rows.length) return null;
  return mapVehicleAsset({ ...rows[0].v, assetSymbol: rows[0].assetSymbol });
}

// SECURITY (multi-user isolation): tenant scoping is applied at the DB query
// level (WHERE user_id = :currentUserId), never by post-filtering in memory.
export async function listVehicleAssets(userId?: string): Promise<VehicleAsset[]> {
  const rows = await db
    .select({ v: vehicleAssets, assetSymbol: assets.symbol })
    .from(vehicleAssets)
    .innerJoin(assets, eq(assets.id, vehicleAssets.assetId))
    .where(userId ? eq(vehicleAssets.userId, userId) : undefined)
    .orderBy(desc(vehicleAssets.createdAt));

  return rows.map((r) => mapVehicleAsset({ ...r.v, assetSymbol: r.assetSymbol }));
}

/* ─────────────────────── user vehicle mapping ─────────────────────── */

function mapUserVehicle(r: typeof vehicleAssets.$inferSelect, assetSymbol?: string): UserVehicle {
  return {
    id: r.id,
    assetId: r.assetId,
    assetSymbol,
    userId: r.userId,
    catalogId: r.catalogId ?? null,
    brand: r.brand,
    model: r.model,
    year: r.year,
    ownershipDate: r.ownershipDate ?? null,
    purchasePriceToman: tomanStr(r.purchasePriceToman),
    purchaseUsdRate: rateStr(r.purchaseUsdRate),
    purchaseValueUsd: usdStr(r.purchaseValueUsd),
    licensePlate: r.licensePlate,
    mileage: r.mileage,
    status: ((r.status as VehicleStatus) ?? "active") satisfies VehicleStatus,
    saleDate: r.saleDate ?? null,
    salePriceToman: tomanStr(r.salePriceToman),
    saleUsdRate: rateStr(r.saleUsdRate),
    saleValueUsd: usdStr(r.saleValueUsd),
    notes: r.notes,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: r.updatedAt?.toISOString() ?? null,
  };
}

/* ───────────────────────── asset identity ───────────────────────── */

async function ensureRwaAssetClassId(): Promise<string> {
  let [klass] = await db.select().from(assetClasses).where(eq(assetClasses.code, "RWA")).limit(1);
  if (!klass) {
    [klass] = await db
      .insert(assetClasses)
      .values({ code: "RWA", name: "دارایی واقعی", color: "#12131c", sortOrder: 90 })
      .onConflictDoNothing()
      .returning();
    if (!klass) [klass] = await db.select().from(assetClasses).where(eq(assetClasses.code, "RWA")).limit(1);
  }
  if (!klass) throw new Error("کلاس دارایی واقعی ایجاد نشد.");
  return klass.id;
}

/* ───────────────────────── create / update ───────────────────────── */

/**
 * ثبت خودروی کاربر.
 *  - نام و مدل فقط از Vehicle Catalog (ورود آزاد پذیرفته نمی‌شود)
 *  - سال ساخت، تاریخ تملک و قیمت خرید اجباری
 *  - معادل دلاری قیمت خرید با نرخ دلارِ «تاریخ تملک» محاسبه و ذخیره می‌شود
 */
export async function createUserVehicle(input: CreateUserVehicleInput): Promise<{ id: string; assetId: string; symbol: string }> {
  if (!input.catalogId) throw new Error("خودرو باید از فهرست (کاتالوگ) انتخاب شود.");
  const model = await getCatalogModel(input.catalogId);
  if (!model) throw new Error("خودروی انتخاب‌شده در کاتالوگ یافت نشد.");

  const year = Number(input.manufacturingYear);
  if (!Number.isFinite(year) || year <= 0) throw new Error("سال ساخت خودرو الزامی است.");

  const ownershipDate = (input.ownershipDate || "").slice(0, 10);
  if (!ownershipDate) throw new Error("تاریخ تملک الزامی است.");

  const purchase = D(input.purchasePriceToman ?? "0");
  if (purchase.lte(0)) throw new Error("قیمت خرید (تومان) الزامی است و باید بزرگ‌تر از صفر باشد.");

  // Historical FX: the rate of the OWNERSHIP DATE, stored forever.
  let purchaseUsdRate = input.purchaseUsdRate?.trim();
  if (!purchaseUsdRate) {
    const resolved = await resolveUsdRateForDate(ownershipDate, input.userId ?? null);
    purchaseUsdRate = resolved.rate;
  }
  if (D(purchaseUsdRate).lte(0)) throw new Error("نرخ دلار تاریخ خرید معتبر نیست.");
  const purchaseValueUsd = tomanToUsd(purchase.toFixed(0), purchaseUsdRate);

  const classId = await ensureRwaAssetClassId();
  const name = `${model.brandName} ${model.modelName} (${year})`;

  // Asset identity and vehicle row commit atomically. Locking the shared RWA
  // class row also serialises the compact numeric sequence with properties.
  const { asset, row, symbol } = await db.transaction(async (tx) => {
    const symbol = await nextRwaSymbol(tx, classId);
    const [asset] = await tx
      .insert(assets)
      .values({ name, symbol, classId, decimals: 2, priceSource: "manual" })
      .returning();
    if (!asset) throw new Error("ایجاد رکورد دارایی خودرو ناموفق بود.");

    const [row] = await tx
      .insert(vehicleAssets)
      .values({
        assetId: asset.id,
        userId: input.userId ?? null,
        catalogId: model.id,
        brand: model.brandName,
        model: model.modelName,
        year,
        ownershipDate,
        purchasePriceToman: purchase.toFixed(0),
        purchaseUsdRate: D(purchaseUsdRate).toString(),
        purchaseValueUsd,
        licensePlate: input.plate?.trim() || null,
        mileage: Number.isFinite(Number(input.mileage)) && input.mileage != null ? Number(input.mileage) : null,
        status: "active",
        notes: input.notes?.trim() || null,
      })
      .returning();
    if (!row) throw new Error("ثبت خودروی کاربر ناموفق بود.");

    return { asset, row, symbol };
  });

  // Optional first valuation snapshot (never derived from the purchase price).
  if (input.initialValuation && D(input.initialValuation.valueToman ?? "0").gt(0)) {
    await recordVehicleValuationSnapshot({
      catalogId: model.id,
      userVehicleId: row.id,
      snapshotDate: input.initialValuation.snapshotDate,
      currentValueToman: input.initialValuation.valueToman,
      usdRate: input.initialValuation.usdRate,
      source: "manual",
      note: input.initialValuation.note,
      createdByUserId: input.userId ?? null,
    });
  }

  return { id: row.id, assetId: asset.id, symbol };
}

/** Mutable, non-historical details only (plate + mileage + notes). */
export async function updateVehicleDetails(input: {
  vehicleId: string;
  userId?: string | null;
  plate?: string | null;
  mileage?: number | null;
  notes?: string | null;
}): Promise<void> {
  const [row] = await db.select().from(vehicleAssets).where(eq(vehicleAssets.id, input.vehicleId)).limit(1);
  if (!row) throw new Error("خودرو یافت نشد.");
  assertOwnership(row, input.userId);
  await db
    .update(vehicleAssets)
    .set({
      licensePlate: input.plate?.trim() || null,
      mileage: input.mileage ?? null,
      notes: input.notes?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(vehicleAssets.id, input.vehicleId));
}

// SECURITY (multi-user isolation): when a tenant identity exists (multi-user
// system), ownership must match EXACTLY — a NULL-owned row is NOT shared data,
// it belongs to the legacy owner only, and must not be mutable by other users.
// When no identity exists at all (legacy single-tenant installs without auth
// users) the check is skipped so existing deployments keep working.
function assertOwnership(row: typeof vehicleAssets.$inferSelect, userId?: string | null) {
  if (!userId) return; // legacy single-tenant mode
  if (row.userId !== userId) {
    throw new Error("دسترسی غیرمجاز: این خودرو متعلق به شما نیست.");
  }
}

/** فروش خودرو — قیمت واقعی فروش، مبنای بازدهی نهایی (نه ارزش فعلی). */
export async function sellVehicle(input: SellVehicleInput & { userId?: string | null }): Promise<void> {
  const [row] = await db.select().from(vehicleAssets).where(eq(vehicleAssets.id, input.vehicleId)).limit(1);
  if (!row) throw new Error("خودرو یافت نشد.");
  assertOwnership(row, input.userId);

  const saleDate = (input.saleDate || "").slice(0, 10);
  if (!saleDate) throw new Error("تاریخ فروش الزامی است.");
  const salePrice = D(input.salePriceToman ?? "0");
  if (salePrice.lte(0)) throw new Error("قیمت فروش (تومان) الزامی است.");

  let saleUsdRate = input.saleUsdRate?.trim();
  if (!saleUsdRate) {
    const resolved = await resolveUsdRateForDate(saleDate, input.userId ?? null);
    saleUsdRate = resolved.rate;
  }
  const saleValueUsd = tomanToUsd(salePrice.toFixed(0), saleUsdRate);

  await db
    .update(vehicleAssets)
    .set({
      status: "sold",
      saleDate,
      salePriceToman: salePrice.toFixed(0),
      saleUsdRate: D(saleUsdRate).toString(),
      saleValueUsd,
      updatedAt: new Date(),
    })
    .where(eq(vehicleAssets.id, input.vehicleId));
}

/* ───────────────────────────── read model ───────────────────────────── */

export type {
  VehicleValuationState,
  VehicleGains,
  VehicleDashboardItem,
  VehiclePortfolioSummary,
  VehiclePortfolioItem,
} from "./dto";

export function purchasePointOf(vehicle: UserVehicle): SnapshotPoint | null {
  if (!vehicle.ownershipDate || !vehicle.purchasePriceToman || !vehicle.purchaseUsdRate) return null;
  return {
    date: vehicle.ownershipDate,
    valueToman: vehicle.purchasePriceToman,
    usdRate: vehicle.purchaseUsdRate,
    valueUsd: vehicle.purchaseValueUsd ?? tomanToUsd(vehicle.purchasePriceToman, vehicle.purchaseUsdRate),
  };
}

function computeGains(vehicle: UserVehicle, valuation: VehicleValuationState): VehicleGains {
  const purchaseToman = vehicle.purchasePriceToman;
  const purchaseUsd = vehicle.purchaseValueUsd;

  // After a sale the REAL sale price — not the current value — drives the result.
  const endToman = vehicle.status === "sold" ? vehicle.salePriceToman : valuation.currentValueToman;
  const endUsd = vehicle.status === "sold" ? vehicle.saleValueUsd : valuation.currentValueUsd;

  if (!purchaseToman || !endToman) {
    return { gainToman: null, roiToman: null, gainUsd: null, roiUsd: null, realised: vehicle.status === "sold" };
  }

  const gainToman = D(endToman).sub(purchaseToman).toFixed(0);
  const roiToman = roiPercent(purchaseToman, endToman);
  const gainUsd = purchaseUsd && endUsd ? D(endUsd).sub(purchaseUsd).toFixed(2) : null;
  const roiUsd = purchaseUsd && endUsd ? roiPercent(purchaseUsd, endUsd) : null;

  return { gainToman, roiToman, gainUsd, roiUsd, realised: vehicle.status === "sold" };
}

async function buildDashboardItem(vehicle: UserVehicle, today: string): Promise<VehicleDashboardItem> {
  const catalog = vehicle.catalogId ? await getCatalogModel(vehicle.catalogId) : null;
  const { snapshots, scope } = await getEffectiveSnapshots(vehicle.catalogId, vehicle.id);
  const latest = latestSnapshot(snapshots);

  const valuation: VehicleValuationState = {
    currentValueToman: latest?.currentValueToman ?? null,
    currentValueUsd: latest?.currentValueUsd ?? null,
    currentUsdRate: latest?.usdRate ?? null,
    lastValuationDate: latest?.snapshotDate ?? null,
    scope,
  };

  const purchasePoint = purchasePointOf(vehicle);
  const points = snapshots.map(toPoint);
  const periods = allPeriodResults(points, { todayIso: today, purchasePoint });

  const gains = computeGains(vehicle, valuation);
  const holding = holdingDuration(vehicle.ownershipDate, vehicle.status === "sold" && vehicle.saleDate ? vehicle.saleDate : today);

  let cagrToman: string | null = null;
  let cagrUsd: string | null = null;
  if (purchasePoint && latest) {
    cagrToman = cagrPercent(purchasePoint.valueToman, latest.currentValueToman, purchasePoint.date, latest.snapshotDate);
    cagrUsd = cagrPercent(purchasePoint.valueUsd, latest.currentValueUsd, purchasePoint.date, latest.snapshotDate);
  }

  return {
    vehicle,
    catalog,
    valuation,
    gains,
    purchasePoint,
    snapshots,
    history: historyWithDeltas(points),
    periods,
    holding,
    cagrToman,
    cagrUsd,
  };
}

// SECURITY (multi-user isolation): tenant scoping at the DB query level.
// NULL-owned rows are NOT visible to an identified tenant (NULL ≠ shared).
export async function listUserVehicles(userId?: string | null): Promise<UserVehicle[]> {
  const rows = await db
    .select({ v: vehicleAssets, symbol: assets.symbol })
    .from(vehicleAssets)
    .innerJoin(assets, eq(assets.id, vehicleAssets.assetId))
    .where(userId ? eq(vehicleAssets.userId, userId) : undefined)
    .orderBy(desc(vehicleAssets.createdAt));

  return rows.map((r) => mapUserVehicle(r.v, r.symbol));
}

export async function getVehicleDashboard(userId?: string | null): Promise<VehicleDashboardItem[]> {
  const today = todayIso();
  const vehicles = await listUserVehicles(userId);
  const items: VehicleDashboardItem[] = [];
  for (const v of vehicles) items.push(await buildDashboardItem(v, today));
  return items;
}

/* ─────────────────────── portfolio integration ─────────────────────── */

/**
 * Portfolio category «خودروها».
 * Totals in USD are the SUM of each vehicle's own snapshot USD value —
 * they are never recomputed with today's FX rate.
 */
export async function getVehiclePortfolioSummary(userId?: string | null): Promise<VehiclePortfolioSummary> {
  const dashboard = await getVehicleDashboard(userId);

  let totalCurrentToman = D("0");
  let totalCurrentUsd = D("0");
  let totalPurchaseToman = D("0");
  let totalPurchaseUsd = D("0");
  let soldProceedsToman = D("0");
  let soldProceedsUsd = D("0");
  let realisedGainToman = D("0");
  let realisedGainUsd = D("0");
  let unvaluedCount = 0;
  let activeCount = 0;
  let soldCount = 0;

  const items: VehiclePortfolioSummary["items"] = [];

  for (const item of dashboard) {
    const { vehicle, valuation, gains } = item;
    if (vehicle.status === "sold") soldCount++;
    else activeCount++;

    const currentToman = vehicle.status === "sold" ? vehicle.salePriceToman : valuation.currentValueToman;
    const currentUsd = vehicle.status === "sold" ? vehicle.saleValueUsd : valuation.currentValueUsd;

    if (vehicle.status === "sold") {
      // Sold cars are no longer part of the portfolio value; their real,
      // already-realised result is reported separately.
      if (vehicle.salePriceToman) soldProceedsToman = soldProceedsToman.add(vehicle.salePriceToman);
      if (vehicle.saleValueUsd) soldProceedsUsd = soldProceedsUsd.add(vehicle.saleValueUsd);
      if (gains.gainToman) realisedGainToman = realisedGainToman.add(gains.gainToman);
      if (gains.gainUsd) realisedGainUsd = realisedGainUsd.add(gains.gainUsd);
    } else {
      if (!valuation.currentValueToman) unvaluedCount++;
      if (valuation.currentValueToman) totalCurrentToman = totalCurrentToman.add(valuation.currentValueToman);
      if (valuation.currentValueUsd) totalCurrentUsd = totalCurrentUsd.add(valuation.currentValueUsd);
      if (vehicle.purchasePriceToman) totalPurchaseToman = totalPurchaseToman.add(vehicle.purchasePriceToman);
      if (vehicle.purchaseValueUsd) totalPurchaseUsd = totalPurchaseUsd.add(vehicle.purchaseValueUsd);
    }

    items.push({
      id: vehicle.id,
      title: `${vehicle.brand} ${vehicle.model}`,
      status: vehicle.status,
      currentValueToman: currentToman,
      currentValueUsd: currentUsd,
      purchasePriceToman: vehicle.purchasePriceToman,
      purchaseValueUsd: vehicle.purchaseValueUsd,
      roiToman: gains.roiToman,
      roiUsd: gains.roiUsd,
      lastValuationDate: valuation.lastValuationDate,
    });
  }

  const totalGainToman = totalCurrentToman.sub(totalPurchaseToman);
  const totalGainUsd = totalCurrentUsd.sub(totalPurchaseUsd);

  return {
    count: dashboard.length,
    activeCount,
    soldCount,
    unvaluedCount,
    totalCurrentToman: totalCurrentToman.toFixed(0),
    totalCurrentUsd: totalCurrentUsd.toFixed(2),
    totalPurchaseToman: totalPurchaseToman.toFixed(0),
    totalPurchaseUsd: totalPurchaseUsd.toFixed(2),
    totalGainToman: totalGainToman.toFixed(0),
    totalGainUsd: totalGainUsd.toFixed(2),
    roiToman: totalPurchaseToman.gt(0) ? totalGainToman.div(totalPurchaseToman).mul("100").toFixed(2) : null,
    roiUsd: totalPurchaseUsd.gt(0) ? totalGainUsd.div(totalPurchaseUsd).mul("100").toFixed(2) : null,
    soldProceedsToman: soldProceedsToman.toFixed(0),
    soldProceedsUsd: soldProceedsUsd.toFixed(2),
    realisedGainToman: realisedGainToman.toFixed(0),
    realisedGainUsd: realisedGainUsd.toFixed(2),
    items,
  };
}

/* ─────────────────────── bootstrap / migration ─────────────────────── */

let readyPromise: Promise<void> | null = null;

/**
 * Prepare the vehicle module:
 *  1. seed the default catalog once (dynamic afterwards),
 *  2. attach legacy vehicle rows (free-text brand/model) to catalog entries,
 *  3. carry purchase information from legacy RWA ownership records into the
 *     vehicle itself — vehicles no longer use ownership records at all.
 *
 * Existing data is preserved: nothing is deleted, only completed.
 */
export async function ensureVehicleModuleReady(): Promise<void> {
  readyPromise ??= (async () => {
    // The vehicle tables may not exist yet on a cold start (fresh database or
    // a page that never ran the seeder). The DDL is idempotent and memoised
    // per process, so this is a no-op once the schema is in place.
    await ensureSchemaOnce();
    await seedVehicleCatalogIfEmpty();
    await migrateLegacyVehicleRows();
  })().catch((err) => {
    readyPromise = null;
    throw err;
  });
  return readyPromise;
}

export async function migrateLegacyVehicleRows(): Promise<{ linked: number; purchaseFilled: number }> {
  const rows = await db.select().from(vehicleAssets).orderBy(asc(vehicleAssets.createdAt));
  let linked = 0;
  let purchaseFilled = 0;

  for (const row of rows) {
    const patch: Partial<typeof vehicleAssets.$inferInsert> = {};

    if (!row.catalogId && row.brand && row.model) {
      const brands = await listVehicleBrands(true);
      const brandKey = normalizeKey(row.brand);
      let brand = brands.find((b) => normalizeKey(b.name) === brandKey || normalizeKey(b.nameEn ?? "") === brandKey);
      if (!brand) {
        brand = await createVehicleBrand({
          name: row.brand,
          origin: "imported",
          allowsCustomModel: true,
        }).catch(() => undefined);
      }
      if (brand) {
        const models = await listVehicleCatalogModels(brand.id);
        const modelKey = normalizeKey(row.model);
        let model = models.find((m) => normalizeKey(m.modelName) === modelKey);
        if (!model) {
          model = await createCatalogModel({
            brandId: brand.id,
            modelName: row.model,
            modelYear: row.year ?? null,
          }).catch(() => undefined);
        }
        if (model) {
          patch.catalogId = model.id;
          linked++;
        }
      }
    }

    if (!row.ownershipDate || !row.purchasePriceToman) {
      const [ownership] = await db
        .select()
        .from(rwaOwnershipRecords)
        .where(and(eq(rwaOwnershipRecords.assetId, row.assetId), eq(rwaOwnershipRecords.isActive, true)))
        .orderBy(asc(rwaOwnershipRecords.acquisitionDate))
        .limit(1);

      if (ownership) {
        const ownershipDate = row.ownershipDate ?? ownership.acquisitionDate;
        const price = row.purchasePriceToman ?? ownership.acquisitionPriceIRR;
        if (ownershipDate && price && D(price.toString()).gt(0)) {
          const resolved = await resolveUsdRateForDate(ownershipDate, row.userId);
          patch.ownershipDate = ownershipDate;
          patch.purchasePriceToman = D(price.toString()).toFixed(0);
          patch.purchaseUsdRate = resolved.rate;
          patch.purchaseValueUsd = tomanToUsd(D(price.toString()).toFixed(0), resolved.rate);
          purchaseFilled++;
        }
      }
    }

    if (Object.keys(patch).length) {
      await db.update(vehicleAssets).set(patch).where(eq(vehicleAssets.id, row.id));
    }
  }

  return { linked, purchaseFilled };
}
