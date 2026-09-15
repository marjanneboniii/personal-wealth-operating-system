/**
 * Historical free-market USD→IRT rate — the bundled daily series.
 *
 * WHY BUNDLED
 * `exchange_rates` only fills from the day the app starts recording, so a home
 * bought in ۱۴۰۱ used to be converted at TODAY's dollar — understating its
 * dollar cost several times over. The free-market dollar has a public daily
 * history back to ۱۳۹۰; it is frozen into `historicalUsdIrtData.ts` (refresh
 * with `npm run fx:history`), so a lookup needs no network and no table rows.
 *
 * Toman per US dollar, daily close. Pure and read-only.
 */
import { HISTORICAL_USD_IRT_DAYS, HISTORICAL_USD_IRT_FIRST } from "./historicalUsdIrtData";

const DAY_MS = 86_400_000;

/**
 * A quote older than this is not «the rate of that day». Market closures last
 * days (نوروز is the longest), never weeks — past the end of the bundled series
 * the lookup answers null and the recorded/current rate takes over.
 */
export const HISTORICAL_MAX_GAP_DAYS = 16;

type Series = { first: number; days: Int32Array; rates: Int32Array };
let parsed: Series | null = null;

function series(): Series {
  if (parsed) return parsed;
  const pairs = HISTORICAL_USD_IRT_DAYS ? HISTORICAL_USD_IRT_DAYS.split(",") : [];
  const days = new Int32Array(pairs.length);
  const rates = new Int32Array(pairs.length);
  pairs.forEach((pair, i) => {
    const [day, rate] = pair.split(":");
    days[i] = Number(day);
    rates[i] = Number(rate);
  });
  parsed = { first: Date.parse(`${HISTORICAL_USD_IRT_FIRST}T00:00:00Z`), days, rates };
  return parsed;
}

/** The daily close of `dateIso`, or of the last trading day before it. */
export function historicalUsdIrtOnOrBefore(dateIso: string): { rate: string; effectiveDate: string } | null {
  const date = (dateIso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const s = series();
  const target = Math.round((Date.parse(`${date}T00:00:00Z`) - s.first) / DAY_MS);
  if (!Number.isFinite(target) || target < 0 || s.days.length === 0) return null;

  let lo = 0;
  let hi = s.days.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s.days[mid] <= target) {
      hit = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (hit < 0 || target - s.days[hit] > HISTORICAL_MAX_GAP_DAYS) return null;

  return {
    rate: String(s.rates[hit]),
    effectiveDate: new Date(s.first + s.days[hit] * DAY_MS).toISOString().slice(0, 10),
  };
}
