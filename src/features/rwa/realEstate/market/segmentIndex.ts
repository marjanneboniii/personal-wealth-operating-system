/**
 * Segment index from valuation observations — PURE and DORMANT.
 *
 * Not wired to any query, job or screen. It turns many independent valuations
 * of properties in one segment into a robust price level and a growth figure,
 * and refuses to answer until enough independent contributors exist.
 *
 * Safeguards:
 *  - input checks catch unit slips (×10, ×1000) and implausible jumps;
 *  - only recent observations from accounts older than a minimum age count;
 *  - one vote per contributor (their own median), whatever they record;
 *  - outliers removed on log values (IQR fence + MAD agreement);
 *  - median, never mean;
 *  - growth from the SAME property's consecutive valuations (repeat
 *    valuation), so a contributor's constant optimism cancels out.
 */

export const INDEX_MIN_CONTRIBUTORS = 5;
export const INDEX_MAX_AGE_DAYS = 90;
export const INDEX_MIN_ACCOUNT_AGE_DAYS = 30;
export const INPUT_JUMP_WARNING = 0.4;

export type ValuationObservation = {
  contributorId: string;
  propertyId: string;
  date: string;
  valueToman: number;
  areaSqm: number;
  /** when the contributor's account was created */
  accountCreatedAt: string;
};

function days(fromIso: string, toIso: string): number {
  return (Date.parse(toIso.slice(0, 10)) - Date.parse(fromIso.slice(0, 10))) / 86_400_000;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Drops values that sit outside the 3×IQR fence, or outside 1.5×IQR while the MAD test agrees. */
export function robustKeep(values: number[]): number[] {
  if (values.length < 4) return [...values].sort((a, b) => a - b);
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const med = median(sorted);
  const mad = median(sorted.map((v) => Math.abs(v - med)).sort((a, b) => a - b));
  return sorted.filter((v) => {
    if (iqr > 0 && (v < q1 - 3 * iqr || v > q3 + 3 * iqr)) return false;
    const mild = iqr > 0 && (v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr);
    const madOut = mad > 0 && (0.6745 * Math.abs(v - med)) / mad > 3.5;
    return !(mild && madOut);
  });
}

/* ─────────────────────────── input checks ─────────────────────────── */

export type InputWarning =
  | { code: "unit_x10"; suggestedToman: number }
  | { code: "unit_x1000"; suggestedToman: number }
  | { code: "jump"; changePct: number };

/**
 * Warnings shown BEFORE a valuation is saved. `referencePpsqm` is any trusted
 * price per m² of the segment (e.g. the user's own latest market price).
 */
export function checkValuationInput(input: {
  valueToman: number;
  areaSqm: number;
  previousValueToman?: number | null;
  referencePpsqm?: number | null;
}): InputWarning[] {
  const warnings: InputWarning[] = [];
  const ppsqm = input.areaSqm > 0 ? input.valueToman / input.areaSqm : 0;
  const ref = input.referencePpsqm ?? null;
  if (ref && ppsqm > 0) {
    const ratio = ppsqm / ref;
    if (ratio > 700 && ratio < 1400) warnings.push({ code: "unit_x1000", suggestedToman: Math.round(input.valueToman / 1000) });
    else if (ratio < 1 / 700 && ratio > 1 / 1400) warnings.push({ code: "unit_x1000", suggestedToman: Math.round(input.valueToman * 1000) });
    else if (ratio > 7 && ratio < 14) warnings.push({ code: "unit_x10", suggestedToman: Math.round(input.valueToman / 10) });
    else if (ratio < 1 / 7 && ratio > 1 / 14) warnings.push({ code: "unit_x10", suggestedToman: Math.round(input.valueToman * 10) });
  }
  const prev = input.previousValueToman ?? null;
  if (prev && prev > 0 && !warnings.length) {
    const change = input.valueToman / prev - 1;
    if (Math.abs(change) >= INPUT_JUMP_WARNING) warnings.push({ code: "jump", changePct: Math.round(change * 1000) / 10 });
  }
  return warnings;
}

/* ─────────────────────────── level ─────────────────────────── */

export type SegmentLevel =
  | { status: "insufficient"; contributors: number }
  | { status: "ok"; ppsqmToman: number; contributors: number };

function eligible(observations: ValuationObservation[], asOf: string): ValuationObservation[] {
  return observations.filter(
    (o) =>
      o.areaSqm > 0 &&
      o.valueToman > 0 &&
      o.date <= asOf &&
      days(o.date, asOf) <= INDEX_MAX_AGE_DAYS &&
      days(o.accountCreatedAt, asOf) >= INDEX_MIN_ACCOUNT_AGE_DAYS,
  );
}

/** Robust price per m² of a segment as of a date. */
export function segmentLevel(observations: ValuationObservation[], asOf: string): SegmentLevel {
  const latestPerProperty = new Map<string, ValuationObservation>();
  for (const o of eligible(observations, asOf)) {
    const current = latestPerProperty.get(o.propertyId);
    if (!current || o.date > current.date) latestPerProperty.set(o.propertyId, o);
  }
  const perContributor = new Map<string, number[]>();
  for (const o of latestPerProperty.values()) {
    perContributor.set(o.contributorId, [...(perContributor.get(o.contributorId) ?? []), Math.log(o.valueToman / o.areaSqm)]);
  }
  const votes = [...perContributor.values()].map((v) => median([...v].sort((a, b) => a - b)));
  const kept = robustKeep(votes);
  if (kept.length < INDEX_MIN_CONTRIBUTORS) return { status: "insufficient", contributors: kept.length };
  return { status: "ok", ppsqmToman: Math.round(Math.exp(median(kept))), contributors: kept.length };
}

/* ─────────────────────────── growth (repeat valuation) ─────────────────────────── */

export type SegmentGrowth =
  | { status: "insufficient"; contributors: number }
  | { status: "ok"; pct: number; contributors: number };

function nearestWithin(points: ValuationObservation[], target: string, toleranceDays: number): ValuationObservation | null {
  let best: ValuationObservation | null = null;
  let gap = Infinity;
  for (const p of points) {
    const d = Math.abs(days(target, p.date));
    if (d <= toleranceDays && d < gap) {
      best = p;
      gap = d;
    }
  }
  return best;
}

/**
 * Growth between two dates from pairs of valuations of the SAME property near
 * each date. A contributor who always values 10% high contributes the same
 * change as an accurate one.
 */
export function segmentGrowth(observations: ValuationObservation[], fromDate: string, toDate: string, toleranceDays = 31): SegmentGrowth {
  const usable = observations.filter((o) => o.valueToman > 0 && days(o.accountCreatedAt, toDate) >= INDEX_MIN_ACCOUNT_AGE_DAYS);
  const byProperty = new Map<string, ValuationObservation[]>();
  for (const o of usable) byProperty.set(o.propertyId, [...(byProperty.get(o.propertyId) ?? []), o]);

  const perContributor = new Map<string, number[]>();
  for (const points of byProperty.values()) {
    const from = nearestWithin(points, fromDate, toleranceDays);
    const to = nearestWithin(points, toDate, toleranceDays);
    if (!from || !to || from.date >= to.date) continue;
    perContributor.set(from.contributorId, [...(perContributor.get(from.contributorId) ?? []), Math.log(to.valueToman / from.valueToman)]);
  }
  const votes = [...perContributor.values()].map((v) => median([...v].sort((a, b) => a - b)));
  const kept = robustKeep(votes);
  if (kept.length < INDEX_MIN_CONTRIBUTORS) return { status: "insufficient", contributors: kept.length };
  return { status: "ok", pct: Math.round((Math.exp(median(kept)) - 1) * 10_000) / 100, contributors: kept.length };
}
