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
  /** A meme coin (DOGE, SHIB, PEPE…) — its own section, apart from crypto. */
  | "meme"
  | "stablecoin"
  | "fund"
  | "stock"
  | "gold"
  | "fx"
  /** A US equity held as a token, e.g. AAPLX «اپل استاک». */
  | "tokenized_stock"
  /** Oil, gas, silver, copper, platinum — held as a tokenised fund share. */
  | "commodity"
  /** A market index held as a token (S&P 500, Nasdaq…). */
  | "index"
  /** A bond ETF held as a token (US Treasuries, aggregate bond). */
  | "bond";

export type PriceQuote = {
  /** Exact decimal string in `currency`. Never a JS number. */
  price: string;
  /** ISO code of the quote currency — "IRT", "IRR" or "USD". Never "USDT" for a dollar price. */
  currency: string;
  /** When the SOURCE observed this price (ISO 8601). */
  observedAt: string;
  /** When WE fetched it (ISO 8601). Drives the staleness the UI reports. */
  fetchedAt: string;
  /** Provider id that produced it, for display and for debugging. */
  source: string;
  /**
   * WHAT the price is for, when the source says more than «per unit». Optional
   * so every existing provider stays valid; the reference-price sources
   * (BrsAPI, Gold API) always set it, because a gram, a troy ounce, a barrel
   * and one hundred yen are not interchangeable and a bare number hides that.
   */
  meta?: QuoteMeta;
};

/**
 * The facts a reference price needs before it may be shown or trusted.
 * Every field is what the SOURCE stated or what was verified against it —
 * never a default filled in to make a row look complete.
 */
export type QuoteMeta = {
  /** The source's own identity for the instrument: an ISIN, «IR_GOLD_18K», «XAU». */
  instrumentId: string;
  /** The unit ONE price buys: "gram", "troy_ounce", "coin", "currency_unit", "barrel", "share", "fund_unit". */
  quantityUnit: string;
  /**
   * How many of `quantityUnit` the source's raw number was for. 100 for
   * «یکصد ین ژاپن». `price` is always already divided down to ONE unit.
   */
  sourceUnitQuantity: string;
  /**
   * What kind of price this is: "last_trade", "market_rate", "spot", …
   * "unspecified" when the source does not say (BrsAPI does not state whether
   * its currency rates are free-market or official, nor whether Brent is spot
   * or front-month) — shown as such, never guessed.
   */
  basis: string;
  /**
   * True when the source gave only a clock time and the DATE was inferred
   * (TSETMC's `time` is «HH:MM:SS» with no day). The UI must say so.
   */
  observedAtInferred?: boolean;
  /** Further prices of the same instrument, kept SEPARATE from `price`. */
  extra?: Record<string, string>;
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
