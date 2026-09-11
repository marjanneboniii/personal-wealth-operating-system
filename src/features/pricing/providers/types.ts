/**
 * Price provider contract — the abstraction every live market source plugs
 * into (بخش ۴، بند ۲).
 *
 * The point of this layer is that adding نوبیتکس, بیت‌پین, fipiran or TSETMC
 * later must not touch a single caller. A provider answers three questions and
 * nothing else: what kinds of instrument it prices, in what currency, and what
 * the current quote is for a set of references.
 *
 * Design rules that are NOT negotiable here:
 *   • Prices are decimal STRINGS. A Toman price is routinely 10-11 digits
 *     (تترگلد was ۱٬۰۲۰٬۸۰۴٬۱۲۳ when this was written); binary floats lose
 *     precision at that scale and this app does exact arithmetic everywhere.
 *   • Every quote carries BOTH timestamps. `observedAt` is when the source saw
 *     the price, `fetchedAt` is when we asked. They differ, and the UI needs
 *     the second one to say «آخرین قیمت شناخته‌شده، ساعت …» when a source is
 *     down (بخش ۴، بند ۵).
 *   • A provider NEVER throws for a missing or rejected reference. It reports
 *     the failure per-reference so one bad symbol cannot blank a whole page.
 *   • Providers are pure I/O: no database, no ledger, no valuation imports.
 */
import type { PriceFailureCode } from "../types";

export type { PriceFailureCode };

/** What kind of instrument a reference denotes. */
export type QuoteKind =
  | "crypto"
  | "stablecoin"
  | "fund"
  | "stock"
  | "gold"
  | "fx";

export type PriceQuote = {
  /** Exact decimal string in `currency`. Never a JS number. */
  price: string;
  /** ISO code of the quote currency — "IRT" or "USD". */
  currency: string;
  /** When the SOURCE observed this price (ISO 8601). */
  observedAt: string;
  /** When WE fetched it (ISO 8601). Drives the staleness the UI reports. */
  fetchedAt: string;
  /** Provider id that produced it, for display and for debugging. */
  source: string;
};

export type ProviderResult = {
  /** reference → quote, for the references this provider could price. */
  quotes: Map<string, PriceQuote>;
  /** reference → why it could not be priced. Never throws instead. */
  failures: Map<string, PriceFailureCode>;
};

/**
 * A catalogue entry a provider can offer to the search box. The Persian name
 * is mandatory: the product's rule is that a user never reads a Latin ticker
 * as the primary label.
 */
export type ProviderCatalogEntry = {
  /** Provider-specific reference, e.g. "BTCTMN" for Wallex. */
  ref: string;
  /** Stable instrument symbol, e.g. "BTC". */
  symbol: string;
  /** Persian display name, e.g. «بیت‌کوین». */
  displayName: string;
  /** Latin name, used for search only. */
  latinName: string;
  kind: QuoteKind;
  /** Absolute logo URL, when the source publishes one. */
  logoUrl: string | null;
};

export interface PriceProvider {
  /** Stable id, used as the cache-key prefix and shown as the quote source. */
  readonly id: string;
  /** Persian name of the source, for «قیمت از …». */
  readonly displayName: string;
  readonly kinds: readonly QuoteKind[];
  /** ISO code every quote from this provider is denominated in. */
  readonly quoteCurrency: string;

  /** Live quotes. Must resolve — per-reference errors go in `failures`. */
  fetchQuotes(refs: readonly string[]): Promise<ProviderResult>;

  /**
   * Searchable catalogue, when the source publishes one. Providers that price
   * only what they are asked about may omit this.
   */
  fetchCatalog?(): Promise<ProviderCatalogEntry[]>;
}
