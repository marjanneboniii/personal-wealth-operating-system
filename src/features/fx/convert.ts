/**
 * FX Engine — Pure Conversion Functions (Phase 2.6)
 *
 * CRITICAL: These are PURE functions with zero side effects.
 * They NEVER write to any database table.
 * They NEVER create journal entries, postings, or any financial events.
 *
 * Architecture:
 *   Market Data Layer (FX rates) → FX Engine (convert) → Display Layer
 *
 * The FX Engine exists ONLY to support:
 *   - Currency conversion
 *   - Portfolio valuation display
 *   - Historical valuation display
 *
 * The FX Engine NEVER:
 *   - Creates journal entries
 *   - Creates postings
 *   - Modifies accounts
 *   - Modifies balances
 *   - Modifies lots
 *   - Modifies lot_consumptions
 *   - Modifies FIFO state
 *   - Modifies cost basis
 *   - Changes transaction history
 */
import { D, Decimal } from "@/domain/decimal";
import type { FxConversionResult } from "./types";

/**
 * Convert an amount from one currency to another using a known FX rate.
 *
 * This is a PURE calculation. No database access. No side effects.
 *
 * @param amount - The amount to convert (string, in base currency)
 * @param rate - The FX rate (1 baseCurrency = rate quoteCurrency)
 * @param fromCurrency - The source currency code
 * @param toCurrency - The target currency code
 * @param rateDate - The date of the FX rate used
 * @param rateSource - The source of the FX rate
 * @returns FxConversionResult with converted amount
 */
export function convertAmount(
  amount: string,
  rate: string,
  fromCurrency: string,
  toCurrency: string,
  rateDate: string,
  rateSource: string,
): FxConversionResult {
  const amountDec = D(amount);
  const rateDec = D(rate);

  // SAFETY: If rate is zero or negative, conversion is impossible
  if (rateDec.lte(0)) {
    return {
      originalAmount: amount,
      convertedAmount: "0",
      fromCurrency,
      toCurrency,
      rateUsed: "0",
      rateDate,
      rateSource,
      success: false,
      failureReason: "نرخ تبدیل نامعتبر است (صفر یا منفی).",
    };
  }

  const converted = amountDec.mul(rateDec);

  return {
    originalAmount: amount,
    convertedAmount: converted.toString(),
    fromCurrency,
    toCurrency,
    rateUsed: rate,
    rateDate,
    rateSource,
    success: true,
  };
}

/**
 * Convert an amount through an intermediate currency.
 * Example: IRT → USD → BTC (if direct IRT→BTC rate is unavailable)
 *
 * This is a PURE calculation. No database access. No side effects.
 *
 * @param amount - Amount to convert
 * @param firstRate - Rate from source to intermediate
 * @param secondRate - Rate from intermediate to target
 * @param fromCurrency - Source currency
 * @param throughCurrency - Intermediate currency
 * @param toCurrency - Target currency
 * @param rateDate - Date of rates used
 * @param rateSource - Source of rates
 */
export function convertThroughIntermediate(
  amount: string,
  firstRate: string,
  secondRate: string,
  fromCurrency: string,
  throughCurrency: string,
  toCurrency: string,
  rateDate: string,
  rateSource: string,
): FxConversionResult {
  const firstResult = convertAmount(
    amount,
    firstRate,
    fromCurrency,
    throughCurrency,
    rateDate,
    rateSource,
  );

  if (!firstResult.success) {
    return {
      ...firstResult,
      fromCurrency,
      toCurrency,
      failureReason: `تبدیل ${fromCurrency} → ${throughCurrency} ناموفق: ${firstResult.failureReason}`,
    };
  }

  return convertAmount(
    firstResult.convertedAmount,
    secondRate,
    throughCurrency,
    toCurrency,
    rateDate,
    rateSource,
  );
}

/**
 * Calculate the inverse of an FX rate.
 * If 1 USD = 920000 IRT, then 1 IRT = 1/920000 USD
 *
 * This is a PURE calculation. No side effects.
 */
export function invertRate(rate: string): string {
  const rateDec = D(rate);
  if (rateDec.isZero()) return "0";
  return D("1").div(rateDec).toString();
}

/**
 * Attempt a missing-FX-safe conversion.
 * Returns null if conversion would require a missing rate.
 * NEVER silently falls back to rate = 1.
 *
 * This is a PURE function. No side effects.
 */
export function safeConvert(
  amount: string,
  rate: string | null | undefined,
  fromCurrency: string,
  toCurrency: string,
  rateDate: string,
  rateSource: string,
): FxConversionResult | null {
  // Same currency — no conversion needed
  if (fromCurrency === toCurrency) {
    return {
      originalAmount: amount,
      convertedAmount: amount,
      fromCurrency,
      toCurrency,
      rateUsed: "1",
      rateDate,
      rateSource: "identity",
      success: true,
    };
  }

  // SAFETY: Missing FX rate → return null, NEVER silently continue
  if (!rate || D(rate).lte(0)) {
    return null;
  }

  return convertAmount(amount, rate, fromCurrency, toCurrency, rateDate, rateSource);
}
