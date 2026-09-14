/**
 * Forward-only market growth — PURE functions (no database, no I/O).
 *
 * Tracking starts at the FIRST recorded market price of a segment. Every
 * horizon (1m, 3m, 6m, 1y, 2y, 3y, …) is measured from that baseline to a real
 * observation near baseline + horizon:
 *
 *   target date still in the future       → "pending"   (shows the date)
 *   target passed, no observation near it  → "missing"   (never interpolated)
 *   observation found                      → Toman % and USD % change
 *
 * USD figures use the rate frozen on each observation, so dollar growth is
 * never re-derived with a later rate. Nothing here reads past market data or
 * touches accounting.
 */
import { addMonthsIso } from "@/lib/format";

export const AREA_BANDS = [
  { key: "all", label: "همهٔ متراژها", min: 0, max: Infinity },
  { key: "a0-80", label: "تا ۸۰ متر", min: 0, max: 80 },
  { key: "a80-150", label: "۸۰ تا ۱۵۰ متر", min: 80, max: 150 },
  { key: "a150-up", label: "بیش از ۱۵۰ متر", min: 150, max: Infinity },
] as const;

export type AreaBandKey = (typeof AREA_BANDS)[number]["key"];

export const STALE_AFTER_DAYS = 45;
/** Observations can be recorded up to this many days after the day they describe. */
export const MAX_BACKDATE_DAYS = 31;

export function isAreaBand(value: string): value is AreaBandKey {
  return AREA_BANDS.some((b) => b.key === value);
}

export function areaBandLabel(key: string): string {
  return AREA_BANDS.find((b) => b.key === key)?.label ?? key;
}

/** Size band of a property; null when its size is unknown. */
export function areaBandOf(areaSqm: number | null | undefined): AreaBandKey | null {
  if (!areaSqm || !(areaSqm > 0)) return null;
  return AREA_BANDS.find((b) => b.key !== "all" && areaSqm >= b.min && areaSqm < b.max)?.key ?? null;
}

export type MarketPoint = {
  date: string;
  ppsqmToman: number;
  usdRate: number;
  ppsqmUsd: number;
};

export type HorizonResult =
  | { months: number; targetDate: string; status: "pending" }
  | { months: number; targetDate: string; status: "missing" }
  | { months: number; targetDate: string; status: "available"; to: MarketPoint; tomanPct: number; usdPct: number };

export type SinceStart = { from: MarketPoint; to: MarketPoint; days: number; tomanPct: number; usdPct: number };

export type MarketGrowth = {
  baseline: MarketPoint;
  latest: MarketPoint;
  points: MarketPoint[];
  horizons: HorizonResult[];
  sinceStart: SinceStart | null;
  daysSinceLatest: number;
  stale: boolean;
};

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso.slice(0, 10)) - Date.parse(fromIso.slice(0, 10))) / 86_400_000);
}

function monthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = toIso.slice(0, 10).split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}

export function pctChange(from: number, to: number): number {
  return from > 0 ? Math.round((to / from - 1) * 10_000) / 100 : 0;
}

/** 1m, 3m, 6m, then every year — at least 5 years ahead, and one more year once each year is reached. */
export function horizonsFor(baselineDate: string, todayIso: string): number[] {
  const elapsedYears = Math.floor(Math.max(0, monthsBetween(baselineDate, todayIso)) / 12);
  const years = Math.max(5, elapsedYears + 1);
  return [1, 3, 6, ...Array.from({ length: years }, (_, i) => (i + 1) * 12)];
}

/** Short horizons need a tight match; yearly horizons accept a monthly entry cadence. */
export function toleranceDays(months: number): number {
  return months <= 6 ? 10 : 31;
}

function nearest<T extends { date: string }>(points: T[], target: string, maxDays: number, after?: string): T | null {
  let best: T | null = null;
  let bestGap = Infinity;
  for (const p of points) {
    if (after && p.date <= after) continue;
    const gap = Math.abs(daysBetween(target, p.date));
    if (gap <= maxDays && gap < bestGap) {
      best = p;
      bestGap = gap;
    }
  }
  return best;
}

export function marketGrowth(input: MarketPoint[], todayIso: string): MarketGrowth | null {
  const points = [...input].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!points.length) return null;
  const baseline = points[0];
  const latest = points[points.length - 1];

  const horizons: HorizonResult[] = horizonsFor(baseline.date, todayIso).map((months) => {
    const targetDate = addMonthsIso(baseline.date, months);
    const to = nearest(points, targetDate, toleranceDays(months), baseline.date);
    if (to) {
      return {
        months,
        targetDate,
        status: "available",
        to,
        tomanPct: pctChange(baseline.ppsqmToman, to.ppsqmToman),
        usdPct: pctChange(baseline.ppsqmUsd, to.ppsqmUsd),
      };
    }
    return { months, targetDate, status: targetDate > todayIso ? "pending" : "missing" };
  });

  const daysSinceLatest = Math.max(0, daysBetween(latest.date, todayIso));
  return {
    baseline,
    latest,
    points,
    horizons,
    sinceStart:
      points.length > 1
        ? {
            from: baseline,
            to: latest,
            days: daysBetween(baseline.date, latest.date),
            tomanPct: pctChange(baseline.ppsqmToman, latest.ppsqmToman),
            usdPct: pctChange(baseline.ppsqmUsd, latest.ppsqmUsd),
          }
        : null,
    daysSinceLatest,
    stale: daysSinceLatest > STALE_AFTER_DAYS,
  };
}

export type PropertyPoint = { date: string; valueToman: number; valueUsd: number };

export type RelativeToMarket = {
  from: PropertyPoint;
  to: PropertyPoint;
  propertyTomanPct: number;
  propertyUsdPct: number;
  marketTomanPct: number;
  marketUsdPct: number;
  /** percentage points: property − market */
  tomanPts: number;
  usdPts: number;
};

/**
 * The property's own recorded change over the SAME window as the market
 * (tracking start → latest market observation). Needs a real valuation within
 * ±31 days of both ends — an older valuation is never stretched to fit.
 */
export function relativeToMarket(property: PropertyPoint[], since: SinceStart | null): RelativeToMarket | null {
  if (!since) return null;
  const from = nearest(property, since.from.date, 31);
  const to = nearest(property, since.to.date, 31);
  if (!from || !to || from.date >= to.date || !(from.valueToman > 0) || !(from.valueUsd > 0)) return null;
  const propertyTomanPct = pctChange(from.valueToman, to.valueToman);
  const propertyUsdPct = pctChange(from.valueUsd, to.valueUsd);
  return {
    from,
    to,
    propertyTomanPct,
    propertyUsdPct,
    marketTomanPct: since.tomanPct,
    marketUsdPct: since.usdPct,
    tomanPts: Math.round((propertyTomanPct - since.tomanPct) * 100) / 100,
    usdPts: Math.round((propertyUsdPct - since.usdPct) * 100) / 100,
  };
}
