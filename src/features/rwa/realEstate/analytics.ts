/**
 * Real Estate valuation analytics — PURE functions, no database, no side
 * effects. Built on the exact same engine as the vehicle module
 * (`../vehicle/analytics`), following the module-sharing convention already
 * used for the FX engine (`../vehicle/fx`).
 *
 * NON-NEGOTIABLE RULES implemented here:
 *  1. Every historical figure comes from a REAL stored valuation snapshot
 *     (`real_estate_valuation_snapshots`) or the immutable purchase record.
 *  2. The USD figure of a snapshot uses the USD rate stored IN THAT snapshot.
 *     Today's FX rate is never used to re-derive a historical USD value.
 *  3. When the required historical data does not exist, the result is
 *     explicitly "unavailable" — a value is NEVER invented or back-filled.
 */
import {
  compareDates as compareDatesEngine,
  cagrPercent,
  changeBetween,
  historyWithDeltas,
  latestPoint,
  periodPerformanceOver,
  sortSeries,
  valueAt,
  type ChangeSet,
  type PeriodKey,
  type PeriodResult,
  type SnapshotPoint,
} from "../vehicle/analytics";

export type { ChangeSet, PeriodKey, PeriodResult, SnapshotPoint };

/**
 * بازه‌های استاندارد بررسی رشد/افت دلاری و تومانی ملک —
 * ۱ ماه، ۳ ماه، ۶ ماه، ۱ سال، ۲ سال، ۳ سال، از تاریخ تملک، کل دوره.
 */
export const REAL_ESTATE_PERIODS: { key: PeriodKey; label: string; months?: number }[] = [
  { key: "1m", label: "۱ ماه", months: 1 },
  { key: "3m", label: "۳ ماه", months: 3 },
  { key: "6m", label: "۶ ماه", months: 6 },
  { key: "1y", label: "۱ سال", months: 12 },
  { key: "2y", label: "۲ سال", months: 24 },
  { key: "3y", label: "۳ سال", months: 36 },
  { key: "purchase", label: "از تاریخ تملک" },
  { key: "all", label: "کل دوره" },
];

export const NO_HISTORICAL_DATA = "داده تاریخی کافی وجود ندارد";

export function realEstatePeriodPerformance(
  series: SnapshotPoint[],
  key: PeriodKey,
  opts: { todayIso: string; purchasePoint?: SnapshotPoint | null },
): PeriodResult {
  return periodPerformanceOver(REAL_ESTATE_PERIODS, series, key, opts);
}

export function allRealEstatePeriodResults(
  series: SnapshotPoint[],
  opts: { todayIso: string; purchasePoint?: SnapshotPoint | null },
): PeriodResult[] {
  return REAL_ESTATE_PERIODS.map((p) => realEstatePeriodPerformance(series, p.key, opts));
}

/** History rows with the delta against the previous snapshot (immutable data). */
export function realEstateHistoryWithDeltas(
  series: SnapshotPoint[],
): (SnapshotPoint & Partial<ChangeSet>)[] {
  return historyWithDeltas(series);
}

/** Compare two user-selected dates using real snapshots only. */
export function compareRealEstateDates(
  series: SnapshotPoint[],
  fromDate: string,
  toDate: string,
  purchasePoint?: SnapshotPoint | null,
):
  | ({ available: true; from: SnapshotPoint; to: SnapshotPoint } & ChangeSet)
  | { available: false; reason: string } {
  return compareDatesEngine(series, fromDate, toDate, purchasePoint);
}

export {
  cagrPercent,
  changeBetween,
  latestPoint,
  sortSeries,
  valueAt,
};
