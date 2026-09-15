/**
 * Vehicle module — historical USD rate resolution.
 *
 * GOLDEN RULE OF THIS MODULE:
 *   FX rate is a *historical conversion index*, never a valuation engine.
 *   The rate is resolved ONCE (at purchase time / at snapshot time), stored
 *   next to the value, and never recomputed afterwards.
 *
 * Resolution order for a given date:
 *   1. exact rate recorded for that date (exchange_rates USD→IRT)
 *   2. the bundled free-market history (features/fx/historicalUsdIrt) — the
 *      close of that day or of the last trading day before it — unless the
 *      table holds a rate closer to the date
 *   3. the most recent rate recorded ON OR BEFORE that date
 *   4. the user's current rate (user_fx_settings / settings / default)
 *
 * Reads only. No ledger writes, no snapshot rewrites.
 */
import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { exchangeRates } from "@/db/schema";
import { D } from "@/domain/decimal";
import { getLatestUsdIrtRateForUser } from "@/lib/fx";
import { todayIso } from "@/lib/format";
import { historicalUsdIrtOnOrBefore } from "@/features/fx/historicalUsdIrt";
import type { UsdRateResolution } from "./types";

export async function resolveUsdRateForDate(
  dateIso: string,
  userId?: string | null,
): Promise<UsdRateResolution> {
  const date = (dateIso || "").slice(0, 10);

  if (date) {
    let before: { rate: string; effectiveDate: string } | null = null;
    try {
      const [exact] = await db
        .select()
        .from(exchangeRates)
        .where(
          and(
            eq(exchangeRates.baseCurrency, "USD"),
            eq(exchangeRates.quoteCurrency, "IRT"),
            eq(exchangeRates.effectiveDate, date),
          ),
        )
        .limit(1);
      if (exact?.rate && D(exact.rate).gt(0)) {
        return { rate: exact.rate.toString(), effectiveDate: exact.effectiveDate, source: "exact", isExact: true };
      }

      const [row] = await db
        .select()
        .from(exchangeRates)
        .where(
          and(
            eq(exchangeRates.baseCurrency, "USD"),
            eq(exchangeRates.quoteCurrency, "IRT"),
            lte(exchangeRates.effectiveDate, date),
          ),
        )
        .orderBy(desc(exchangeRates.effectiveDate))
        .limit(1);
      if (row?.rate && D(row.rate).gt(0)) before = { rate: row.rate.toString(), effectiveDate: row.effectiveDate };
    } catch {
      // table unavailable — the bundled history can still answer
    }

    // History is for PAST days only. Today (and later) belongs to the rate the
    // user confirmed: a sale booked today is converted to USD and back by the
    // ledger at that rate, and a second «today» rate would split the two.
    const history = date < todayIso() ? historicalUsdIrtOnOrBefore(date) : null;
    if (history && (!before || history.effectiveDate >= before.effectiveDate)) {
      return {
        rate: history.rate,
        effectiveDate: history.effectiveDate,
        source: "historical",
        isExact: history.effectiveDate === date,
      };
    }
    if (before) {
      return { rate: before.rate, effectiveDate: before.effectiveDate, source: "nearest", isExact: false };
    }
  }

  const snap = await getLatestUsdIrtRateForUser(userId ?? null);
  return {
    rate: snap.rate,
    effectiveDate: date || snap.effectiveDate,
    source: snap.source === "fallback" ? "fallback" : "current",
    isExact: false,
  };
}

/** value_usd = value_toman ÷ usd_rate — the ONLY allowed conversion formula. */
export function tomanToUsd(valueToman: string, usdRate: string): string {
  const rate = D(usdRate);
  if (rate.lte(0)) return "0";
  return D(valueToman).div(rate).toFixed(2);
}
