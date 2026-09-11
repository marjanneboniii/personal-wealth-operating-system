/**
 * Provider registry and the resolve pipeline (بخش ۴، بندهای ۲، ۳ و ۵).
 *
 * `resolveQuotes` is the single entry point every caller uses. It walks the
 * providers registered for a kind, in order, and for each reference returns the
 * FIRST usable answer:
 *
 *     fresh cache hit  →  live provider  →  next provider  →  last known  →  unavailable
 *
 * The last two steps are the whole reason this is not a bare fetch. When a
 * source is down — and with free Iranian endpoints it will be — the product
 * requirement is «آخرین قیمت شناخته‌شده + زمان دریافت آن», never a crash and
 * never a silently fabricated number. A degraded answer is therefore marked
 * `stale` and carries the timestamp it was actually observed at, so the UI can
 * say so instead of pretending the figure is live.
 *
 * `unavailable` is a real, expected outcome and carries a failure code. It is
 * not an error to throw; a portfolio with one dead symbol must still render
 * the other nineteen.
 */
import type { PriceFreshness } from "../types";
import { QuoteCache, quoteCache } from "./cache";
import type {
  PriceFailureCode,
  PriceProvider,
  PriceQuote,
  QuoteKind,
} from "./types";

export type ResolvedQuote = {
  ref: string;
  quote: PriceQuote | null;
  freshness: PriceFreshness;
  failureCode?: PriceFailureCode;
};

/** Supplies a previously stored quote when every live provider fails. */
export type LastKnownLookup = (
  refs: readonly string[],
) => Promise<ReadonlyMap<string, PriceQuote>>;

export class ProviderRegistry {
  private readonly providers: PriceProvider[] = [];

  /** Registration order IS priority order for a given kind. */
  register(provider: PriceProvider): this {
    if (this.providers.some((p) => p.id === provider.id)) {
      throw new Error(`Price provider «${provider.id}» is already registered.`);
    }
    this.providers.push(provider);
    return this;
  }

  for(kind: QuoteKind): PriceProvider[] {
    return this.providers.filter((p) => p.kinds.includes(kind));
  }

  get(id: string): PriceProvider | undefined {
    return this.providers.find((p) => p.id === id);
  }

  list(): readonly PriceProvider[] {
    return this.providers;
  }

  clear(): void {
    this.providers.length = 0;
  }
}

export const providerRegistry = new ProviderRegistry();

export type ResolveOptions = {
  registry?: ProviderRegistry;
  cache?: QuoteCache;
  lastKnown?: LastKnownLookup;
};

/**
 * Resolve every reference of one kind. Always resolves — per-reference outcomes
 * are reported in the result, never thrown.
 */
export async function resolveQuotes(
  kind: QuoteKind,
  refs: readonly string[],
  options: ResolveOptions = {},
): Promise<Map<string, ResolvedQuote>> {
  const registry = options.registry ?? providerRegistry;
  const cache = options.cache ?? quoteCache;
  const out = new Map<string, ResolvedQuote>();

  const wanted = [...new Set(refs)].filter((r) => r.trim().length > 0);
  if (wanted.length === 0) return out;

  let outstanding = wanted;
  const failures = new Map<string, PriceFailureCode>();

  for (const provider of registry.for(kind)) {
    if (outstanding.length === 0) break;

    const { hits, misses } = cache.partition(provider.id, outstanding);
    for (const [ref, quote] of hits) {
      out.set(ref, { ref, quote, freshness: "fresh" });
    }

    if (misses.length > 0) {
      // One upstream call per provider per batch, and concurrent callers asking
      // for the same batch share it rather than racing.
      const key = `${provider.id}|${[...misses].sort().join(",")}`;
      try {
        const result = await cache.dedupe(key, () => provider.fetchQuotes(misses));
        cache.setMany(provider.id, result.quotes);
        for (const [ref, quote] of result.quotes) {
          out.set(ref, { ref, quote, freshness: "fresh" });
        }
        for (const [ref, code] of result.failures) failures.set(ref, code);
      } catch {
        // A provider that throws is a broken provider, not a broken page: mark
        // its references and let the next provider (or last-known) answer.
        for (const ref of misses) failures.set(ref, "upstream_error");
      }
    }

    outstanding = outstanding.filter((ref) => !out.has(ref));
  }

  if (outstanding.length === 0) return out;

  // Every live path failed. Fall back to the last price we ever saw, clearly
  // marked stale and carrying its own observation time.
  if (options.lastKnown) {
    try {
      const known = await options.lastKnown(outstanding);
      for (const [ref, quote] of known) {
        out.set(ref, { ref, quote, freshness: "stale" });
      }
      outstanding = outstanding.filter((ref) => !out.has(ref));
    } catch {
      /* A failing fallback must not mask the original failure. */
    }
  }

  for (const ref of outstanding) {
    out.set(ref, {
      ref,
      quote: null,
      freshness: "unavailable",
      failureCode: failures.get(ref) ?? "asset_not_found",
    });
  }

  return out;
}
