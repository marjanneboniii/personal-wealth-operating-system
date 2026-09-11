/**
 * Provider bootstrap — the one place a new market source is switched on.
 *
 * Adding نوبیتکس, بیت‌پین, fipiran or TSETMC later is a `register(...)` line
 * here plus an adapter file; no caller changes. Registration order is priority
 * order per kind, so a more reliable source can be put in front of a flaky one
 * without touching the resolve pipeline.
 *
 * WHAT IS AND IS NOT WIRED, AND WHY
 * والکس is registered because its endpoint was verified against the live
 * service — HTTP 200, 385 markets, 193 quoted in Toman, Persian names and
 * icons served from an Iranian host.
 *
 * The other sources in the plan (نوبیتکس, بیت‌پین, رمزینکس, fipiran, TSETMC,
 * brsapi) are NOT registered here yet, and deliberately so: none of those hosts
 * resolves from the environment this was built in, so their response shapes
 * could only have been guessed from documentation. An adapter written against
 * an unverified shape is a bug waiting for production. Each needs one real
 * request from an Iranian network to confirm status code, JSON shape and data
 * freshness before it is written and registered.
 */
import { ProviderRegistry, providerRegistry } from "./registry";
import { WallexProvider } from "./wallex";

let bootstrapped = false;

/**
 * Register the verified providers. Idempotent, so a serverless handler that
 * runs it per request does not throw on the duplicate-id guard.
 */
export function bootstrapProviders(registry: ProviderRegistry = providerRegistry): ProviderRegistry {
  if (registry === providerRegistry) {
    if (bootstrapped) return registry;
    bootstrapped = true;
  }
  if (!registry.get("wallex")) registry.register(new WallexProvider());
  return registry;
}

export { ProviderRegistry, providerRegistry, resolveQuotes } from "./registry";
export type { ResolvedQuote, LastKnownLookup, ResolveOptions } from "./registry";
export { QuoteCache, quoteCache, DEFAULT_TTL_MS } from "./cache";
export { WallexProvider } from "./wallex";
export type {
  PriceProvider,
  PriceQuote,
  ProviderCatalogEntry,
  ProviderResult,
  QuoteKind,
} from "./types";
