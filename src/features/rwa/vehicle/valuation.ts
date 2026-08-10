/**
 * Vehicle Valuation Snapshots — append-only, immutable history.
 *
 * The current value of a vehicle changes ONLY when a new snapshot is stored.
 * An FX-rate update is NOT a valuation update:
 *
 *      FX rate update  ≠  Vehicle valuation update
 *      New snapshot    =  the only way Current Value can change
 *
 * Every snapshot keeps the USD rate that was valid when it was recorded, so a
 * later FX movement can never rewrite history:
 *      value_usd = value_toman ÷ usd_rate_of_the_same_snapshot
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { vehicleValuationSnapshots } from "@/db/schema";
import { D } from "@/domain/decimal";
import { resolveUsdRateForDate, tomanToUsd } from "./fx";
import { rateStr, tomanStr, usdStr } from "./num";
import type { RecordVehicleValuationInput, VehicleValuationSnapshot } from "./types";
import type { SnapshotPoint } from "./analytics";

function mapSnapshot(row: typeof vehicleValuationSnapshots.$inferSelect): VehicleValuationSnapshot {
  return {
    id: row.id,
    vehicleCatalogId: row.vehicleCatalogId,
    userVehicleId: row.userVehicleId ?? null,
    snapshotDate: row.snapshotDate,
    currentValueToman: tomanStr(row.currentValueToman) ?? "0",
    usdRate: rateStr(row.usdRate) ?? "0",
    currentValueUsd: usdStr(row.currentValueUsd) ?? "0",
    source: row.source,
    note: row.note,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

export function toPoint(s: VehicleValuationSnapshot): SnapshotPoint {
  return {
    date: s.snapshotDate,
    valueToman: s.currentValueToman,
    usdRate: s.usdRate,
    valueUsd: s.currentValueUsd,
  };
}

/**
 * INSERT a new immutable snapshot. Existing snapshots are never updated:
 * a second valuation for the same day is refused, a new value must be
 * recorded on a new date.
 */
export async function recordVehicleValuationSnapshot(
  input: RecordVehicleValuationInput,
): Promise<VehicleValuationSnapshot> {
  const snapshotDate = (input.snapshotDate || "").slice(0, 10);
  if (!input.catalogId) throw new Error("خودرو (کاتالوگ) مشخص نشده است.");
  if (!snapshotDate) throw new Error("تاریخ ارزش‌گذاری الزامی است.");
  const valueToman = D(input.currentValueToman ?? "0");
  if (valueToman.lte(0)) throw new Error("ارزش فعلی خودرو باید بزرگ‌تر از صفر باشد.");

  // FX rate: explicit override, otherwise the rate of the SNAPSHOT DATE.
  let usdRate = input.usdRate?.trim();
  if (!usdRate) {
    const resolved = await resolveUsdRateForDate(snapshotDate, input.createdByUserId ?? null);
    usdRate = resolved.rate;
  }
  if (D(usdRate).lte(0)) throw new Error("نرخ دلار معتبر نیست.");

  const scopeId = input.userVehicleId ?? null;
  const existing = await db
    .select()
    .from(vehicleValuationSnapshots)
    .where(
      scopeId
        ? and(
            eq(vehicleValuationSnapshots.userVehicleId, scopeId),
            eq(vehicleValuationSnapshots.snapshotDate, snapshotDate),
          )
        : and(
            eq(vehicleValuationSnapshots.vehicleCatalogId, input.catalogId),
            isNull(vehicleValuationSnapshots.userVehicleId),
            eq(vehicleValuationSnapshots.snapshotDate, snapshotDate),
          ),
    )
    .limit(1);

  if (existing.length) {
    throw new Error(
      "برای این تاریخ ارزش‌گذاری ثبت شده است. اسنپ‌شات‌های قبلی تغییرناپذیرند؛ برای ارزش جدید یک تاریخ جدید ثبت کنید.",
    );
  }

  const currentValueUsd = tomanToUsd(valueToman.toFixed(0), usdRate);

  const [row] = await db
    .insert(vehicleValuationSnapshots)
    .values({
      vehicleCatalogId: input.catalogId,
      userVehicleId: scopeId,
      snapshotDate,
      currentValueToman: valueToman.toFixed(0),
      usdRate: D(usdRate).toString(),
      currentValueUsd,
      source: input.source ?? "manual",
      note: input.note ?? null,
      createdByUserId: input.createdByUserId ?? null,
    })
    .returning();

  return mapSnapshot(row);
}

/** All catalog-level (market) snapshots of a model, oldest first. */
export async function listCatalogSnapshots(catalogId: string): Promise<VehicleValuationSnapshot[]> {
  const rows = await db
    .select()
    .from(vehicleValuationSnapshots)
    .where(
      and(eq(vehicleValuationSnapshots.vehicleCatalogId, catalogId), isNull(vehicleValuationSnapshots.userVehicleId)),
    )
    .orderBy(asc(vehicleValuationSnapshots.snapshotDate));
  return rows.map(mapSnapshot);
}

/** Snapshots recorded for one specific car, oldest first. */
export async function listVehicleOwnSnapshots(userVehicleId: string): Promise<VehicleValuationSnapshot[]> {
  const rows = await db
    .select()
    .from(vehicleValuationSnapshots)
    .where(eq(vehicleValuationSnapshots.userVehicleId, userVehicleId))
    .orderBy(asc(vehicleValuationSnapshots.snapshotDate));
  return rows.map(mapSnapshot);
}

/**
 * Effective valuation series of a user's car:
 *   - if the car has its own snapshots → they are authoritative,
 *   - otherwise the catalog (model market) snapshots are used.
 * The two series are never mixed, so every comparison stays consistent.
 */
export async function getEffectiveSnapshots(
  catalogId: string | null,
  userVehicleId: string,
): Promise<{ snapshots: VehicleValuationSnapshot[]; scope: "vehicle" | "catalog" | "none" }> {
  const own = await listVehicleOwnSnapshots(userVehicleId);
  if (own.length) return { snapshots: own, scope: "vehicle" };
  if (!catalogId) return { snapshots: [], scope: "none" };
  const catalogSnapshots = await listCatalogSnapshots(catalogId);
  return { snapshots: catalogSnapshots, scope: catalogSnapshots.length ? "catalog" : "none" };
}

export function latestSnapshot(list: VehicleValuationSnapshot[]): VehicleValuationSnapshot | null {
  if (!list.length) return null;
  return [...list].sort((a, b) => (a.snapshotDate < b.snapshotDate ? -1 : 1))[list.length - 1];
}
