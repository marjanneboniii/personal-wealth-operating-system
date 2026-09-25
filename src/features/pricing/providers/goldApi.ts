/**
 * Gold API — the world price of one troy ounce of gold (XAU) and silver (XAG)
 * in US dollars.
 *
 * VERIFIED against the live service on 2026-09-24, not against docs:
 *   GET https://api.gold-api.com/price/XAU → 200
 *   {"currency":"USD","name":"Gold","price":4258.0,"symbol":"XAU",
 *    "updatedAt":"2026-09-24T14:40:27Z", …}
 * No key. Its terms permit commercial use and set no limit on the real-time
 * endpoint; only «multiple requests per second» is abuse. This app asks at
 * most once per configured interval (default 60 s) per metal, from the server,
 * shared by every user through the lease in referenceQuotes.ts.
 *
 * WHAT THE NUMBER IS — AND IS NOT
 * A global dollar price per troy ounce. It is NOT a Toman price and NOT the
 * price of a gram of Iranian gold or silver: converting it to either is an
 * estimate of the metal's value, never the domestic dealt price (which carries
 * its own premium). Nothing here converts it.
 *
 * `observedAt` is the source's own `updatedAt`. Fetching an old figure again
 * does not make it newer.
 *
 * Pure I/O plus parsing. No database, no ledger.
 */
import { exactPositiveDecimal, parseJsonKeepingDigits, referenceGet, type ReferenceHttpOptions } from "./referenceHttp";
import type { PriceFailureCode, PriceProvider, PriceQuote, ProviderResult, QuoteKind } from "./types";

export const GOLD_API_BASE_URL = "https://api.gold-api.com";

/** The only symbols this app asks for, and what one price buys. */
const METALS: Record<string, { quantityUnit: "troy_ounce" }> = {
  XAU: { quantityUnit: "troy_ounce" },
  XAG: { quantityUnit: "troy_ounce" },
};

/** A timestamp more than this far in the FUTURE is a broken clock, not a price. */
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;

export type GoldApiParse = { quote: PriceQuote } | { failure: PriceFailureCode };

/** Exported for tests: the parsing contract, run against a fixed body. */
export function parseGoldApiPrice(symbol: string, body: string, fetchedAt: Date): GoldApiParse {
  let data: unknown;
  try {
    data = parseJsonKeepingDigits(body, ["price"]);
  } catch {
    return { failure: "invalid_response" };
  }
  if (!data || typeof data !== "object") return { failure: "invalid_response" };
  const row = data as Record<string, unknown>;

  // The response must be about the metal we asked for, in dollars.
  if (row.symbol !== symbol) return { failure: "invalid_response" };
  if (row.currency !== "USD") return { failure: "invalid_response" };

  const price = exactPositiveDecimal(row.price);
  if (!price) return { failure: "invalid_response" };

  const observed = typeof row.updatedAt === "string" ? new Date(row.updatedAt) : null;
  if (!observed || Number.isNaN(observed.getTime())) return { failure: "invalid_response" };
  if (observed.getTime() > fetchedAt.getTime() + MAX_FUTURE_SKEW_MS) return { failure: "invalid_response" };

  return {
    quote: {
      price,
      currency: "USD",
      observedAt: observed.toISOString(),
      fetchedAt: fetchedAt.toISOString(),
      source: "gold-api",
      meta: {
        instrumentId: symbol,
        quantityUnit: METALS[symbol].quantityUnit,
        sourceUnitQuantity: "1",
        basis: "spot",
      },
    },
  };
}

export type GoldApiProviderOptions = ReferenceHttpOptions & {
  baseUrl?: string;
  now?: () => Date;
};

export class GoldApiProvider implements PriceProvider {
  readonly id = "gold-api";
  readonly displayName = "Gold API";
  readonly kinds: readonly QuoteKind[] = ["gold", "commodity"];
  readonly quoteCurrency = "USD";

  constructor(private readonly options: GoldApiProviderOptions = {}) {}

  async fetchQuotes(refs: readonly string[]): Promise<ProviderResult> {
    const quotes = new Map<string, PriceQuote>();
    const failures = new Map<string, PriceFailureCode>();
    const baseUrl = this.options.baseUrl ?? GOLD_API_BASE_URL;
    const now = this.options.now ?? (() => new Date());

    // One request per metal, one after the other — never a burst.
    for (const ref of [...new Set(refs)]) {
      if (!METALS[ref]) {
        failures.set(ref, "asset_not_found");
        continue;
      }
      const outcome = await referenceGet(`${baseUrl}/price/${ref}`, this.options);
      if (!outcome.ok) {
        failures.set(ref, outcome.code);
        continue;
      }
      const parsed = parseGoldApiPrice(ref, outcome.body, now());
      if ("quote" in parsed) quotes.set(ref, parsed.quote);
      else failures.set(ref, parsed.failure);
    }
    return { quotes, failures };
  }
}
