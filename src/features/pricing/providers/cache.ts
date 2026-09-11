/**
 * Short-TTL quote cache with in-flight de-duplication (بخش ۴، بند ۳).
 *
 * WHY THIS EXISTS
 * The free Iranian data sources are rate-limited — brsapi allows on the order
 * of ۱۵۰۰ requests per day, which one impatient user refreshing a portfolio
 * page can burn through in an afternoon. A 30-60s TTL turns a page that shows
 * twenty holdings into one upstream call instead of twenty, and a user
 * hammering refresh into no upstream calls at all.
 *
 * The second half is just as important: `inFlight` collapses CONCURRENT misses
 * for the same reference into a single upstream request. Without it, a cold
 * cache and a page with twenty rows fires twenty parallel requests in the
 * exact moment the cache is least able to absorb them — a stampede that is
 * how a daily quota actually gets destroyed.
 *
 * Deliberately in-process and unbounded-in-time only by TTL: this is a hot
 * cache in front of the database-backed last-known price (lastKnownPrice.ts),
 * not a persistence layer. It holds only public market data — never a user,
 * holding, balance or any accounting row.
 */
import type { PriceQuote } from "./types";

/** Default TTL. Long enough to protect a quota, short enough to feel live. */
export const DEFAULT_TTL_MS = 45_000;

/**
 * Cap on retained entries. A provider catalogue can be hundreds of symbols and
 * this map would otherwise grow with every reference ever requested in the
 * process lifetime.
 */
const MAX_ENTRIES = 2_000;

type Entry = { quote: PriceQuote; expiresAt: number };

export class QuoteCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  private static key(providerId: string, ref: string): string {
    return `${providerId}:${ref}`;
  }

  /** A still-valid quote, or undefined. Expired entries are dropped on read. */
  get(providerId: string, ref: string): PriceQuote | undefined {
    const k = QuoteCache.key(providerId, ref);
    const hit = this.entries.get(k);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.entries.delete(k);
      return undefined;
    }
    return hit.quote;
  }

  set(providerId: string, ref: string, quote: PriceQuote): void {
    if (this.entries.size >= MAX_ENTRIES) this.evictOldest();
    this.entries.set(QuoteCache.key(providerId, ref), {
      quote,
      expiresAt: this.now() + this.ttlMs,
    });
  }

  setMany(providerId: string, quotes: ReadonlyMap<string, PriceQuote>): void {
    for (const [ref, quote] of quotes) this.set(providerId, ref, quote);
  }

  /**
   * Split a request into what the cache can answer now and what must be
   * fetched. Callers fetch only `misses`, which is the whole point.
   */
  partition(
    providerId: string,
    refs: readonly string[],
  ): { hits: Map<string, PriceQuote>; misses: string[] } {
    const hits = new Map<string, PriceQuote>();
    const misses: string[] = [];
    for (const ref of refs) {
      const hit = this.get(providerId, ref);
      if (hit) hits.set(ref, hit);
      else misses.push(ref);
    }
    return { hits, misses };
  }

  /**
   * Run `work` at most once per key while it is in flight. Concurrent callers
   * for the same key await the SAME promise instead of starting their own
   * upstream request.
   */
  async dedupe<T>(key: string, work: () => Promise<T>): Promise<T> {
    const pending = this.inFlight.get(key) as Promise<T> | undefined;
    if (pending) return pending;
    const promise = work().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  /** Test and operational seam. */
  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  /** Map preserves insertion order, so the first key is the oldest written. */
  private evictOldest(): void {
    const oldest = this.entries.keys().next();
    if (!oldest.done) this.entries.delete(oldest.value);
  }
}

/** Process-wide cache. One TTL window shared by every caller. */
export const quoteCache = new QuoteCache();
