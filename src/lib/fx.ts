/**
 * FX Preview — Shared Single Source of Truth
 * Provides latest USD→IRT rate for presentation-layer previews.
 * Never writes to ledger. Pure read from exchange_rates + settings fallback.
 */
import { db } from "@/db";
import { exchangeRates, settings } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

export type FxSnapshot = {
  rate: string; // IRT per 1 USD, e.g. "100000"
  effectiveDate: string;
  source: string;
};

/**
 * Get latest USD→IRT rate.
 * Priority: exchange_rates (USD→IRT) latest by effectiveDate, then settings.irt_rate, then fallback 100000.
 * All preview calculations MUST use this single function.
 */
export async function getLatestUsdIrtRate(): Promise<FxSnapshot> {
  try {
    const [row] = await db
      .select()
      .from(exchangeRates)
      .where(and(eq(exchangeRates.baseCurrency, "USD"), eq(exchangeRates.quoteCurrency, "IRT")))
      .orderBy(desc(exchangeRates.effectiveDate))
      .limit(1);

    if (row?.rate) {
      return {
        rate: row.rate.toString(),
        effectiveDate: row.effectiveDate,
        source: row.source ?? "exchange_rates",
      };
    }
  } catch {
    // ignore — fallback to settings
  }

  try {
    const [s] = await db.select().from(settings).where(eq(settings.key, "irt_rate")).limit(1);
    if (s?.value) {
      return { rate: s.value, effectiveDate: new Date().toISOString().slice(0, 10), source: "settings" };
    }
  } catch {}

  // ultimate fallback — matches seed default
  return { rate: "100000", effectiveDate: new Date().toISOString().slice(0, 10), source: "fallback" };
}

/** Server-side helper to compute USD from IRT using latest rate */
export async function previewIrtToUsd(irtAmount: string): Promise<{ usd: string; rate: FxSnapshot }> {
  const snap = await getLatestUsdIrtRate();
  const { D } = await import("@/domain/decimal");
  const rateDec = D(snap.rate);
  const usd = rateDec.lte(0) ? "0" : D(irtAmount).div(rateDec).toFixed(2);
  return { usd, rate: snap };
}
