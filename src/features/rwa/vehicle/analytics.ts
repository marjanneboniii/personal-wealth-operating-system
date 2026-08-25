/**
 * Vehicle investment analytics — PURE functions, no database, no side effects.
 *
 * NON-NEGOTIABLE RULES implemented here:
 *  1. Every historical figure comes from a REAL stored snapshot.
 *  2. The USD figure of a snapshot uses the USD rate stored IN THAT snapshot.
 *     Today's FX rate is never used to re-derive a historical USD value.
 *  3. When the required historical data does not exist, the result is
 *     explicitly "unavailable" — a value is NEVER invented or back-filled
 *     from today's value.
 */
import { D } from "@/domain/decimal";
import { addMonthsIso, toFaDigits } from "@/lib/format";

export type SnapshotPoint = {
  date: string;
  valueToman: string;
  usdRate: string;
  valueUsd: string;
};

export type ChangeSet = {
  tomanChange: string;
  tomanChangePct: string | null;
  usdChange: string;
  usdChangePct: string | null;
};

export type PeriodKey = "1m" | "3m" | "6m" | "1y" | "2y" | "3y" | "purchase" | "all" | "custom";

export const VEHICLE_PERIODS: { key: PeriodKey; label: string; months?: number }[] = [
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

export type PeriodResult =
  | ({
      available: true;
      key: PeriodKey;
      label: string;
      from: SnapshotPoint;
      to: SnapshotPoint;
      /** true when the baseline is the purchase record rather than a snapshot */
      baselineIsPurchase?: boolean;
    } & ChangeSet)
  | { available: false; key: PeriodKey; label: string; reason: string };

/* ─────────────────────────── helpers ─────────────────────────── */

export function sortSeries(points: SnapshotPoint[]): SnapshotPoint[] {
  return [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Latest REAL snapshot on or before the requested date (no interpolation). */
export function valueAt(series: SnapshotPoint[], dateIso: string): SnapshotPoint | null {
  const sorted = sortSeries(series);
  let found: SnapshotPoint | null = null;
  for (const p of sorted) {
    if (p.date <= dateIso) found = p;
    else break;
  }
  return found;
}

export function latestPoint(series: SnapshotPoint[]): SnapshotPoint | null {
  const sorted = sortSeries(series);
  return sorted.length ? sorted[sorted.length - 1] : null;
}

export function pct(from: string, to: string): string | null {
  const base = D(from);
  if (base.isZero()) return null;
  return D(to).sub(base).div(base.abs()).mul("100").toFixed(2);
}

export function changeBetween(from: SnapshotPoint, to: SnapshotPoint): ChangeSet {
  return {
    tomanChange: D(to.valueToman).sub(from.valueToman).toFixed(0),
    tomanChangePct: pct(from.valueToman, to.valueToman),
    usdChange: D(to.valueUsd).sub(from.valueUsd).toFixed(2),
    usdChangePct: pct(from.valueUsd, to.valueUsd),
  };
}

/** History rows with the delta against the previous snapshot (immutable data). */
export function historyWithDeltas(series: SnapshotPoint[]): (SnapshotPoint & Partial<ChangeSet>)[] {
  const sorted = sortSeries(series);
  return sorted.map((point, i) => {
    if (i === 0) return { ...point };
    return { ...point, ...changeBetween(sorted[i - 1], point) };
  });
}

/* ───────────────────── period performance ───────────────────── */

/**
 * Generic period performance over a caller-supplied period catalog — the
 * shared engine behind `periodPerformance` (vehicles) and the real-estate
 * period analysis. Pure, no database, no interpolation: every baseline comes
 * from a REAL stored point (snapshot or purchase record).
 */
export function periodPerformanceOver(
  periods: { key: PeriodKey; label: string; months?: number }[],
  series: SnapshotPoint[],
  key: PeriodKey,
  opts: {
    todayIso: string;
    purchasePoint?: SnapshotPoint | null;
  },
): PeriodResult {
  const meta = periods.find((p) => p.key === key);
  const label = meta?.label ?? key;
  const sorted = sortSeries(series);
  const current = valueAt(sorted, opts.todayIso) ?? latestPoint(sorted);

  if (!current) {
    return { available: false, key, label, reason: "هنوز هیچ ارزش‌گذاری ثبت نشده است" };
  }

  if (key === "purchase") {
    const purchase = opts.purchasePoint;
    if (!purchase) {
      return { available: false, key, label, reason: "اطلاعات خرید ثبت نشده است" };
    }
    if (purchase.date > current.date) {
      return { available: false, key, label, reason: NO_HISTORICAL_DATA };
    }
    return {
      available: true,
      key,
      label,
      from: purchase,
      to: current,
      baselineIsPurchase: true,
      ...changeBetween(purchase, current),
    };
  }

  if (key === "all") {
    const first = sorted[0];
    if (!first || first.date === current.date) {
      return { available: false, key, label, reason: NO_HISTORICAL_DATA };
    }
    return { available: true, key, label, from: first, to: current, ...changeBetween(first, current) };
  }

  const months = meta?.months;
  if (!months) return { available: false, key, label, reason: NO_HISTORICAL_DATA };

  const targetDate = addMonthsIso(opts.todayIso, -months);
  const baseline = valueAt(sorted, targetDate);
  if (!baseline || baseline.date === current.date) {
    return { available: false, key, label, reason: NO_HISTORICAL_DATA };
  }
  return { available: true, key, label, from: baseline, to: current, ...changeBetween(baseline, current) };
}

/** Vehicle period performance over the standard VEHICLE_PERIODS catalog. */
export function periodPerformance(
  series: SnapshotPoint[],
  key: PeriodKey,
  opts: {
    todayIso: string;
    purchasePoint?: SnapshotPoint | null;
  },
): PeriodResult {
  return periodPerformanceOver(VEHICLE_PERIODS, series, key, opts);
}

export function allPeriodResults(
  series: SnapshotPoint[],
  opts: { todayIso: string; purchasePoint?: SnapshotPoint | null },
): PeriodResult[] {
  return VEHICLE_PERIODS.map((p) => periodPerformance(series, p.key, opts));
}

/** Compare two user-selected dates using real snapshots only. */
export function compareDates(
  series: SnapshotPoint[],
  fromDate: string,
  toDate: string,
  purchasePoint?: SnapshotPoint | null,
):
  | ({ available: true; from: SnapshotPoint; to: SnapshotPoint } & ChangeSet)
  | { available: false; reason: string } {
  if (!fromDate || !toDate) return { available: false, reason: "هر دو تاریخ را انتخاب کنید" };
  if (fromDate > toDate) return { available: false, reason: "تاریخ شروع باید قبل از تاریخ پایان باشد" };

  const withPurchase = purchasePoint ? sortSeries([purchasePoint, ...series]) : sortSeries(series);
  const from = valueAt(withPurchase, fromDate);
  const to = valueAt(withPurchase, toDate);
  if (!from) return { available: false, reason: `${NO_HISTORICAL_DATA} (تاریخ شروع)` };
  if (!to) return { available: false, reason: `${NO_HISTORICAL_DATA} (تاریخ پایان)` };
  if (from.date === to.date) return { available: false, reason: "بین دو تاریخ انتخابی، ارزش‌گذاری جدیدی ثبت نشده است" };
  return { available: true, from, to, ...changeBetween(from, to) };
}

/* ───────────────────────── ROI / CAGR ───────────────────────── */

export function roiPercent(fromValue: string, toValue: string): string | null {
  return pct(fromValue, toValue);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * CAGR — only computed when a REAL start and end point exist and the span is
 * at least one full year. Never estimated from assumed data.
 */
export function cagrPercent(
  startValue: string,
  endValue: string,
  startDate: string,
  endDate: string,
): string | null {
  const days = daysBetween(startDate, endDate);
  // A 365-day span IS one year; dividing by 365.25 first would reject it.
  if (days < 365) return null;
  const years = days / 365.25;
  const start = Number(startValue);
  const end = Number(endValue);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0) return null;
  const value = (Math.pow(end / start, 1 / years) - 1) * 100;
  if (!Number.isFinite(value)) return null;
  return value.toFixed(2);
}

/** مدت مالکیت — e.g. «۱ سال و ۴ ماه» */
export function holdingDuration(
  ownershipDate: string | null | undefined,
  todayIso: string,
): { months: number; days: number; label: string } | null {
  if (!ownershipDate) return null;
  const totalDays = daysBetween(ownershipDate, todayIso);
  if (totalDays < 0) return null;
  const months = Math.floor(totalDays / 30.4375);
  const years = Math.floor(months / 12);
  const restMonths = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${toFaDigits(String(years))} سال`);
  if (restMonths > 0) parts.push(`${toFaDigits(String(restMonths))} ماه`);
  if (!parts.length) parts.push(`${toFaDigits(String(totalDays))} روز`);
  return { months, days: totalDays, label: parts.join(" و ") };
}

/**
 * Manufacturing year can be Jalali (۱۴۰۵) or Gregorian (2025).
 * The stored integer is unambiguous by range — no data conversion happens.
 */
export function yearSystem(year: number | null | undefined): "jalali" | "gregorian" | null {
  if (!year || !Number.isFinite(year)) return null;
  return year < 1700 ? "jalali" : "gregorian";
}
