/**
 * The price provider layer: adapter contract, TTL cache, and the degradation
 * path that keeps a portfolio rendering when a free Iranian endpoint is down.
 *
 * The Wallex fixture in tests/fixtures/wallex-markets.json is a REAL response
 * captured from https://api.wallex.ir/v1/markets (HTTP 200, 385 markets), cut
 * down to the symbols asserted here. Its prices are genuine — «تترگلد» really
 * is quoted above one billion Toman, which is precisely why nothing in this
 * pipeline is allowed near a binary float.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { QuoteCache } from "../src/features/pricing/providers/cache";
import { ProviderRegistry, resolveQuotes } from "../src/features/pricing/providers/registry";
import { WallexProvider } from "../src/features/pricing/providers/wallex";
import type {
  PriceProvider,
  PriceQuote,
  ProviderResult,
  QuoteKind,
} from "../src/features/pricing/providers/types";

const WALLEX_FIXTURE = readFileSync(
  new URL("./fixtures/wallex-markets.json", import.meta.url),
  "utf8",
);

function wallexFetch(calls?: { n: number }): typeof fetch {
  return (async () => {
    if (calls) calls.n += 1;
    return new Response(WALLEX_FIXTURE, { status: 200 });
  }) as unknown as typeof fetch;
}

const AT = "2026-09-11T09:00:00.000Z";
const provider = (over: Partial<WallexProviderOverrides> = {}) =>
  new WallexProvider({ fetchImpl: wallexFetch(), now: () => new Date(AT), ...over });
type WallexProviderOverrides = { fetchImpl: typeof fetch; now: () => Date };

/* ───────────────────────────── Wallex adapter ───────────────────────────── */

test("Wallex prices in Toman, exactly, with no float anywhere near the value", () => {
  return provider()
    .fetchQuotes(["BTCTMN", "USDTTMN", "XAUTTMN"])
    .then((res) => {
      assert.equal(res.failures.size, 0);
      // Trailing zeros trimmed; the integer part is preserved digit for digit.
      assert.equal(res.quotes.get("BTCTMN")!.price, "18122214670");
      assert.equal(res.quotes.get("USDTTMN")!.price, "235997");
      // A price that does not survive Number(): 1,020,804,123 Toman.
      assert.equal(res.quotes.get("XAUTTMN")!.price, "1020804123");
      assert.equal(res.quotes.get("BTCTMN")!.currency, "IRT");
      assert.equal(res.quotes.get("BTCTMN")!.source, "wallex");
      assert.equal(res.quotes.get("BTCTMN")!.fetchedAt, AT);
    });
});

test("a bare asset symbol is read as its Toman market", async () => {
  const res = await provider().fetchQuotes(["BTC", "usdt"]);
  assert.equal(res.quotes.get("BTC")!.price, "18122214670");
  assert.equal(res.quotes.get("usdt")!.price, "235997");
});

test("a bad reference fails alone — it never blanks the batch", async () => {
  const res = await provider().fetchQuotes(["BTCTMN", "NOPETMN", "ZZZTMN"]);
  assert.equal(res.quotes.get("BTCTMN")!.price, "18122214670");
  assert.equal(res.quotes.has("NOPETMN"), false);
  assert.equal(res.failures.get("NOPETMN"), "asset_not_found");
  // A market that exists but has no usable last trade is a different state
  // from a symbol that does not exist.
  assert.equal(res.failures.get("ZZZTMN"), "invalid_response");
});

test("the catalogue carries Persian names and Iranian-hosted icons", async () => {
  const catalog = await provider().fetchCatalog();
  const bySymbol = new Map(catalog.map((c) => [c.symbol, c]));

  // The Persian name comes from the SOURCE — nothing here is hand-maintained.
  assert.equal(bySymbol.get("BTC")!.displayName, "بیت کوین");
  assert.equal(bySymbol.get("USDT")!.displayName, "تتر");
  assert.equal(bySymbol.get("XAUT")!.displayName, "تترگلد");

  // Tokenised metal is offered as gold, and a fiat claim as a stablecoin, so
  // «استیبل‌کوین» can keep counting as نقدینگی rather than as crypto exposure.
  assert.equal(bySymbol.get("XAUT")!.kind, "gold");
  assert.equal(bySymbol.get("PAXG")!.kind, "gold");
  assert.equal(bySymbol.get("USDT")!.kind, "stablecoin");
  assert.equal(bySymbol.get("BTC")!.kind, "crypto");

  // Icons are served from an Iranian host, not an external CDN.
  assert.match(bySymbol.get("BTC")!.logoUrl ?? "", /^https:\/\/api\.wallex\.ir\//);

  // Only Toman markets are offered — BTCUSDT is in the fixture and excluded.
  assert.equal(catalog.every((c) => c.ref.endsWith("TMN")), true);
});

test("a non-200 response fails every reference instead of throwing", async () => {
  const failing = new WallexProvider({
    fetchImpl: (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch,
  });
  const res = await failing.fetchQuotes(["BTCTMN"]);
  assert.equal(res.quotes.size, 0);
  assert.equal(res.failures.get("BTCTMN"), "network_failure");
});

/* ────────────────────────────── TTL cache ──────────────────────────────── */

const quote = (price: string): PriceQuote => ({
  price,
  currency: "IRT",
  observedAt: AT,
  fetchedAt: AT,
  source: "fake",
});

test("a hit inside the TTL is served from cache; past it, it is a miss", () => {
  let now = 1_000_000;
  const cache = new QuoteCache({ ttlMs: 45_000, now: () => now });
  cache.set("p", "BTC", quote("100"));

  assert.equal(cache.get("p", "BTC")!.price, "100");
  now += 44_000;
  assert.equal(cache.get("p", "BTC")!.price, "100", "still inside the window");
  now += 2_000;
  assert.equal(cache.get("p", "BTC"), undefined, "expired");
  assert.equal(cache.size, 0, "an expired entry is dropped on read");
});

test("partition asks upstream for the misses only", () => {
  const cache = new QuoteCache();
  cache.set("p", "BTC", quote("100"));
  const { hits, misses } = cache.partition("p", ["BTC", "ETH", "SOL"]);
  assert.deepEqual([...hits.keys()], ["BTC"]);
  assert.deepEqual(misses, ["ETH", "SOL"]);
});

test("concurrent misses for the same batch collapse into ONE upstream call", async () => {
  // The stampede this prevents is the real threat to a 1500/day quota: a cold
  // cache and a twenty-row page firing twenty parallel requests at once.
  const calls = { n: 0 };
  const p = new WallexProvider({ fetchImpl: wallexFetch(calls) });
  const registry = new ProviderRegistry().register(p);
  const cache = new QuoteCache();

  await Promise.all(
    Array.from({ length: 8 }, () =>
      resolveQuotes("crypto", ["BTCTMN"], { registry, cache }),
    ),
  );
  assert.equal(calls.n, 1, `expected a single upstream call, made ${calls.n}`);
});

/* ─────────────────────── Degradation (بخش ۴، بند ۵) ─────────────────────── */

function fakeProvider(
  id: string,
  behaviour: (refs: readonly string[]) => Promise<ProviderResult>,
  kinds: QuoteKind[] = ["crypto"],
): PriceProvider {
  return {
    id,
    displayName: id,
    kinds,
    quoteCurrency: "IRT",
    fetchQuotes: (refs) => behaviour(refs),
  };
}

const dead = (id: string) =>
  fakeProvider(id, async (refs) => ({
    quotes: new Map(),
    failures: new Map(refs.map((r) => [r, "upstream_error" as const])),
  }));

test("a dead first provider falls through to the second", async () => {
  const registry = new ProviderRegistry()
    .register(dead("down"))
    .register(
      fakeProvider("up", async (refs) => ({
        quotes: new Map(refs.map((r) => [r, quote("7")])),
        failures: new Map(),
      })),
    );

  const res = await resolveQuotes("crypto", ["BTC"], { registry, cache: new QuoteCache() });
  assert.equal(res.get("BTC")!.freshness, "fresh");
  assert.equal(res.get("BTC")!.quote!.price, "7");
});

test("a provider that THROWS is a broken provider, not a broken page", async () => {
  const registry = new ProviderRegistry()
    .register(
      fakeProvider("explodes", async () => {
        throw new Error("connection reset");
      }),
    )
    .register(
      fakeProvider("up", async (refs) => ({
        quotes: new Map(refs.map((r) => [r, quote("7")])),
        failures: new Map(),
      })),
    );

  const res = await resolveQuotes("crypto", ["BTC"], { registry, cache: new QuoteCache() });
  assert.equal(res.get("BTC")!.quote!.price, "7");
});

test("when every source is down, the last known price is served — marked stale", async () => {
  const registry = new ProviderRegistry().register(dead("down"));
  const known: PriceQuote = {
    price: "18000000000",
    currency: "IRT",
    observedAt: "2026-09-10T18:30:00.000Z",
    fetchedAt: "2026-09-10T18:30:00.000Z",
    source: "wallex",
  };

  const res = await resolveQuotes("crypto", ["BTC"], {
    registry,
    cache: new QuoteCache(),
    lastKnown: async (refs) => new Map(refs.map((r) => [r, known])),
  });

  const btc = res.get("BTC")!;
  assert.equal(btc.freshness, "stale", "never reported as live");
  assert.equal(btc.quote!.price, "18000000000");
  // The timestamp is what lets the UI say «آخرین قیمت شناخته‌شده، …» instead of
  // presenting yesterday's figure as today's.
  assert.equal(btc.quote!.observedAt, "2026-09-10T18:30:00.000Z");
});

test("with no live price and nothing known, the answer is an honest 'unavailable'", async () => {
  const registry = new ProviderRegistry().register(dead("down"));
  const res = await resolveQuotes("crypto", ["BTC"], { registry, cache: new QuoteCache() });
  const btc = res.get("BTC")!;
  assert.equal(btc.freshness, "unavailable");
  assert.equal(btc.quote, null, "a missing price is null — never zero, never invented");
  assert.equal(btc.failureCode, "upstream_error");
});

test("one dead symbol never takes the rest of the portfolio down with it", async () => {
  const registry = new ProviderRegistry().register(
    fakeProvider("partial", async (refs) => ({
      quotes: new Map(refs.filter((r) => r !== "GHOST").map((r) => [r, quote("7")])),
      failures: new Map(refs.includes("GHOST") ? [["GHOST", "asset_not_found" as const]] : []),
    })),
  );

  const res = await resolveQuotes("crypto", ["BTC", "GHOST", "ETH"], {
    registry,
    cache: new QuoteCache(),
  });
  assert.equal(res.get("BTC")!.freshness, "fresh");
  assert.equal(res.get("ETH")!.freshness, "fresh");
  assert.equal(res.get("GHOST")!.freshness, "unavailable");
  assert.equal(res.get("GHOST")!.failureCode, "asset_not_found");
});

test("a kind with no registered provider resolves — it does not throw", async () => {
  const res = await resolveQuotes("stock", ["فولاد"], {
    registry: new ProviderRegistry(),
    cache: new QuoteCache(),
  });
  assert.equal(res.get("فولاد")!.freshness, "unavailable");
});

test("registering the same provider id twice is a programming error", () => {
  const registry = new ProviderRegistry().register(dead("dup"));
  assert.throws(() => registry.register(dead("dup")), /already registered/);
});
