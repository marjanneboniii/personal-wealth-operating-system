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
import { rootCauseOf } from "@/db/init-schema";
import { vehicleAssets, vehicleValuationSnapshots } from "@/db/schema";
import { D } from "@/domain/decimal";
import { resolveUsdRateForDateToFreeze, tomanToUsd } from "./fx";
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
 * True when a unique-violation bubbled up from the driver (concurrent insert).
 *
 * The driver error must be UNWRAPPED to see it. Drizzle raises a
 * DrizzleQueryError whose own message is only "Failed query: insert into …"
 * and which carries no `code`; the Postgres error, with 23505 on it, is one
 * level down in `cause`. Testing the outer message — as a first version of
 * this did — silently never matches, and the race would surface to the user as
 * a raw query dump instead of the sentence below.
 */
function isUniqueViolation(e: unknown): boolean {
  const root = rootCauseOf(e);
  return root.code === "23505" || /unique|duplicate/i.test(root.message);
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
    const resolved = await resolveUsdRateForDateToFreeze(snapshotDate, input.createdByUserId ?? null);
    usdRate = resolved.rate;
  }
  if (D(usdRate).lte(0)) throw new Error("نرخ دلار معتبر نیست.");

  const scopeId = input.userVehicleId ?? null;

  // SECURITY (H-02 / IDOR): a user-scoped vehicle valuation must be anchored to a
  // vehicle that is owned by the caller — verified at the DB query level
  // (WHERE id = :vehicleId AND user_id = :currentUserId), not in application logic
  // after loading another user's record. Without this, guessing a vehicle_id of
  // another user would let an attacker attach valuation snapshots to that vehicle.
  if (scopeId && input.createdByUserId) {
    const [owned] = await db
      .select({ id: vehicleAssets.id })
      .from(vehicleAssets)
      .where(and(eq(vehicleAssets.id, scopeId), eq(vehicleAssets.userId, input.createdByUserId)))
      .limit(1);
    if (!owned) {
      throw new Error("خودرو یافت نشد یا متعلق به شما نیست.");
    }
  }

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

  const SAME_DAY_MESSAGE =
    "برای این تاریخ ارزش‌گذاری ثبت شده است. اسنپ‌شات‌های قبلی تغییرناپذیرند؛ برای ارزش جدید یک تاریخ جدید ثبت کنید.";

  // The read below is what produces the Persian message; it is NOT what makes
  // the rule true. It and the insert are two statements, so two concurrent
  // requests both find nothing and both write. The partial unique indexes
  // added in drizzle/0038 are the actual guarantee, and the insert catches
  // their violation so the loser of that race gets the same message as anyone
  // else who picks a date that is already taken.
  if (existing.length) throw new Error(SAME_DAY_MESSAGE);

  const currentValueUsd = tomanToUsd(valueToman.toFixed(0), usdRate);

  let row;
  try {
    [row] = await db
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
  } catch (error) {
    // 23505 = unique_violation. Only the two one-per-day indexes can raise it
    // on this insert, so the cause is unambiguous: a concurrent request took
    // this date between the read above and this write. Report it as the same
    // situation the user would have seen a moment earlier, not as a crash.
    if (isUniqueViolation(error)) throw new Error(SAME_DAY_MESSAGE);
    throw error;
  }

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
