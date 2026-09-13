"use client";

/**
 * One catalogue load per browser session, shared by every picker and by
 * «نمای بازار».
 *
 * The rows are a few hundred short records, so they are fetched ONCE and
 * searched in memory; opening the purchase form a second time, or switching
 * between buy and sell, costs no request at all. A manual refresh replaces the
 * shared copy so every mounted picker sees the new prices.
 */
import {
  loadMarketCatalogAction,
  refreshMarketCatalogNowAction,
  type MarketCatalogLoadResult,
} from "@/app/actions/pricing";

let cached: Promise<MarketCatalogLoadResult> | null = null;
const listeners = new Set<(result: MarketCatalogLoadResult) => void>();

export function loadMarketCatalog(): Promise<MarketCatalogLoadResult> {
  if (!cached) {
    cached = loadMarketCatalogAction().then((result) => {
      // A failed load must not be cached forever — the next mount retries.
      if (!result.ok) cached = null;
      return result;
    });
  }
  return cached;
}

/** Seed the shared copy from a server-rendered page, avoiding a second load. */
export function primeMarketCatalog(result: MarketCatalogLoadResult): void {
  if (!cached && result.ok) cached = Promise.resolve(result);
}

export async function refreshMarketCatalog(): Promise<MarketCatalogLoadResult> {
  const result = await refreshMarketCatalogNowAction();
  if (result.rows.length > 0) {
    cached = Promise.resolve(result);
    for (const listener of listeners) listener(result);
  }
  return result;
}

export function subscribeMarketCatalog(listener: (result: MarketCatalogLoadResult) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
