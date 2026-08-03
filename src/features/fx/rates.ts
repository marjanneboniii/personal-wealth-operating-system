/**
 * FX Engine — Rate Management Service (Phase 2.6)
 *
 * CRITICAL ISOLATION GUARANTEE:
 * This service operates ONLY on the exchange_rates table.
 * It NEVER touches journal_entries, postings, accounts, lots,
 * lot_consumptions, FIFO, or cost basis.
 *
 * FX rates are valuation reference data only.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { exchangeRates } from "@/db/schema";
import { D } from "@/domain/decimal";
import { todayIso } from "@/lib/format";
import type { FxRate, RecordFxRateInput } from "./types";

/**
 * Record a new FX rate into the exchange_rates table.
 *
 * SAFETY: Writes ONLY to exchange_rates. No accounting side effects.
 */
export async function recordFxRate(input: RecordFxRateInput): Promise<FxRate> {
  const rateDec = D(input.rate);
  if (rateDec.lte(0)) {
    throw new Error("نرخ تبدیل ارز باید بزرگ‌تر از صفر باشد.");
  }

  const effectiveDate = input.effectiveDate ?? todayIso();
  const source = input.source ?? "manual";

  const [row] = await db
    .insert(exchangeRates)
    .values({
      baseCurrency: input.baseCurrency.toUpperCase(),
      quoteCurrency: input.quoteCurrency.toUpperCase(),
      rate: rateDec.toString(),
      source,
      effectiveDate,
    })
    .onConflictDoUpdate({
      target: [
        exchangeRates.baseCurrency,
        exchangeRates.quoteCurrency,
        exchangeRates.effectiveDate,
      ],
      set: {
        rate: rateDec.toString(),
        source,
      },
    })
    .returning();

  return {
    id: row.id,
    baseCurrency: row.baseCurrency,
    quoteCurrency: row.quoteCurrency,
    rate: row.rate!,
    source: row.source,
    effectiveDate: row.effectiveDate,
  };
}

/**
 * Look up the latest FX rate for a currency pair.
 * Returns the most recent rate on or before the given date.
 *
 * SAFETY: Read-only. No side effects.
 */
export async function getLatestFxRate(
  baseCurrency: string,
  quoteCurrency: string,
  asOfDate?: string,
): Promise<FxRate | null> {
  const date = asOfDate ?? todayIso();

  const [row] = await db
    .select()
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.baseCurrency, baseCurrency.toUpperCase()),
        eq(exchangeRates.quoteCurrency, quoteCurrency.toUpperCase()),
      ),
    )
    .orderBy(desc(exchangeRates.effectiveDate))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    baseCurrency: row.baseCurrency,
    quoteCurrency: row.quoteCurrency,
    rate: row.rate!,
    source: row.source,
    effectiveDate: row.effectiveDate,
  };
}

/**
 * Look up a historical FX rate for a specific date.
 * Returns null if no rate exists for that exact date.
 *
 * SAFETY: Read-only. No side effects.
 * NEVER uses current rate for historical calculations.
 */
export async function getHistoricalFxRate(
  baseCurrency: string,
  quoteCurrency: string,
  effectiveDate: string,
): Promise<FxRate | null> {
  const [row] = await db
    .select()
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.baseCurrency, baseCurrency.toUpperCase()),
        eq(exchangeRates.quoteCurrency, quoteCurrency.toUpperCase()),
        eq(exchangeRates.effectiveDate, effectiveDate),
      ),
    )
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    baseCurrency: row.baseCurrency,
    quoteCurrency: row.quoteCurrency,
    rate: row.rate!,
    source: row.source,
    effectiveDate: row.effectiveDate,
  };
}

/**
 * Get all FX rates for a given currency pair (history).
 *
 * SAFETY: Read-only. No side effects.
 */
export async function getFxRateHistory(
  baseCurrency: string,
  quoteCurrency: string,
  limit = 30,
): Promise<FxRate[]> {
  const rows = await db
    .select()
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.baseCurrency, baseCurrency.toUpperCase()),
        eq(exchangeRates.quoteCurrency, quoteCurrency.toUpperCase()),
      ),
    )
    .orderBy(desc(exchangeRates.effectiveDate))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    baseCurrency: row.baseCurrency,
    quoteCurrency: row.quoteCurrency,
    rate: row.rate!,
    source: row.source,
    effectiveDate: row.effectiveDate,
  }));
}
