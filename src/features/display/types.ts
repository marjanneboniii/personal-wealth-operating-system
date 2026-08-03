/**
 * Display Valuation Engine — Type Definitions (Phase 2.6)
 *
 * Display types are presentation-layer only.
 * They NEVER affect Accounting Core.
 */

import type { DisplayCurrency } from "@/features/fx/types";

/**
 * User display preference record.
 */
export type DisplayPreference = {
  id: string;
  userId: string | null;
  displayCurrency: DisplayCurrency;
};

/**
 * A single asset valuation converted to the user's display currency.
 */
export type DisplayAssetValuation = {
  assetId: string;
  symbol: string;
  name: string;
  className: string;
  classColor: string;
  /** Original quantity of the asset (unchanged) */
  quantity: string;
  /** Original market price in its native quote currency (e.g., USD) */
  nativeMarketPrice: string;
  /** Original value in accounting base currency (USD) */
  nativeValue: string;
  /** Value converted to display currency */
  displayValue: string;
  /** Display currency code */
  displayCurrency: DisplayCurrency;
  /** Whether this conversion used a valid FX rate */
  fxRateAvailable: boolean;
};

/**
 * Portfolio summary converted to display currency.
 */
export type DisplayPortfolioSummary = {
  /** Total net worth in accounting base currency (USD) */
  nativeNetWorth: string;
  /** Total net worth in display currency */
  displayNetWorth: string;
  /** The display currency used */
  displayCurrency: DisplayCurrency;
  /** Per-asset valuations in display currency */
  assetValuations: DisplayAssetValuation[];
  /** FX rate used for conversion (if applicable) */
  fxRateUsed: string | null;
  /** FX rate source */
  fxRateSource: string | null;
  /** FX rate date */
  fxRateDate: string | null;
  /** Whether the conversion was complete or had missing data */
  conversionComplete: boolean;
  /** Warning if conversion was incomplete */
  conversionWarning: string | null;
};
