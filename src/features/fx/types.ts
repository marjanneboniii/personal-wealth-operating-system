/**
 * FX Engine — Type Definitions (Phase 2.6)
 *
 * FX types exist ONLY in the Market Data / Valuation domain.
 * They are NEVER used in Accounting Core.
 */

/**
 * Supported display currencies.
 *
 * USD — US Dollar (current PWOS accounting base currency)
 * IRT — Iranian Toman (NOT IRR/Rial)
 * BTC — Bitcoin (display reference unit only, NOT an accounting currency)
 * ETH — Ethereum (display reference unit only, NOT an accounting currency)
 * XAUT — Tether Gold (tokenized gold, display reference only)
 * PAXG — Pax Gold (tokenized gold, display reference only)
 *
 * IRR (Iranian Rial) is explicitly NOT supported.
 */
export type DisplayCurrency = "USD" | "IRT" | "BTC" | "ETH" | "XAUT" | "PAXG";

/**
 * All supported display currencies as a constant array.
 */
export const SUPPORTED_DISPLAY_CURRENCIES: readonly DisplayCurrency[] = [
  "USD",
  "IRT",
  "BTC",
  "ETH",
  "XAUT",
  "PAXG",
] as const;

/**
 * Validates that a string is a supported display currency.
 * Returns false for IRR or any unsupported code.
 */
export function isSupportedDisplayCurrency(code: string): code is DisplayCurrency {
  return (SUPPORTED_DISPLAY_CURRENCIES as readonly string[]).includes(code);
}

/**
 * Represents a single FX rate record.
 */
export type FxRate = {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  source: string;
  effectiveDate: string;
};

/**
 * Input for recording a new FX rate.
 */
export type RecordFxRateInput = {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  source?: string;
  effectiveDate?: string;
};

/**
 * Result of an FX conversion attempt.
 */
export type FxConversionResult = {
  /** Original amount in base currency */
  originalAmount: string;
  /** Converted amount in target currency */
  convertedAmount: string;
  /** The base currency of the original amount */
  fromCurrency: string;
  /** The target display currency */
  toCurrency: string;
  /** The FX rate used for conversion */
  rateUsed: string;
  /** Date of the FX rate used */
  rateDate: string;
  /** Source of the FX rate */
  rateSource: string;
  /** Whether conversion was successful */
  success: boolean;
  /** If conversion failed, explains why */
  failureReason?: string;
};
