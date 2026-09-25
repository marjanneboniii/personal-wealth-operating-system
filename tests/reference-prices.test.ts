/**
 * Reference prices — gold, coins, currencies, commodities, the Tehran exchange.
 *
 * WHAT THIS PINS (each test names the rule it guards)
 *   • rial vs toman, and the JPY rate being for ONE HUNDRED yen
 *   • USD is never USDT
 *   • an old figure fetched again stays old; an older figure never overwrites
 *   • partial response, missing symbol, quota exhausted, refused request
 *   • last trade, closing price and NAV are kept apart; a حق‌تقدم is not a share
 *   • a 17-digit TSETMC id survives parsing exactly
 *   • journal entries, postings, lots, cost basis and manual prices never move
 *   • the last valid price survives a failing source, labelled as such
 *   • the provider's SAMPLE files never reach the product
 *   • one lease across instances; the day's request budget is shared
 *
 * No test touches the network: every provider gets a `fetchImpl` that serves
 * the official samples saved under tests/fixtures.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import { marketReferenceQuotes, marketSourceStatus } from "../src/db/schema";
import {
  BrsApiProvider,
  classifyIsin,
  inferTehranSessionInstant,
  parseCommodity,
  parseGoldCurrency,
  parseTsetmc,
  type FeedParse,
} from "../src/features/pricing/providers/brsapi";
import { GoldApiProvider, parseGoldApiPrice } from "../src/features/pricing/providers/goldApi";
import { referenceGet } from "../src/features/pricing/providers/referenceHttp";
import { ProviderRegistry } from "../src/features/pricing/providers/registry";
import type { PriceQuote } from "../src/features/pricing/providers/types";
import {
  claimSource,
  persistReferenceQuotes,
  readReferenceQuotes,
  readSourceStatus,
  refreshReferenceQuotes,
} from "../src/features/pricing/referenceQuotes";
import { readReferenceConfig, type ReferenceConfig } from "../src/features/pricing/referenceConfig";
import { referenceState, referenceViewsFor, supplementalMarketRows, toQuoteView, tseRowsFromQuotes, rowKey } from "../src/features/pricing/referencePresentation";
import { REFERENCE_QUOTE_REFS, referenceMarketRows } from "../src/features/pricing/referenceMarketRows";
import { tseMarketRows } from "../src/features/pricing/tseMarketRows";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const GOLD_CURRENCY = fixture("brsapi-gold-currency-sample.json");
const COMMODITY = fixture("brsapi-commodity-sample.json");
const TSETMC = fixture("brsapi-tsetmc-sample.json");

/** Just after the sample's own timestamps, so none reads as «from the future». */
const SAMPLE_NOW = new Date("2025-07-23T12:00:00Z");

function ok(result: FeedParse | { failure: string }): FeedParse {
  assert.ok(!("failure" in result), `parse failed: ${JSON.stringify(result)}`);
  return result as FeedParse;
}

/* ------------------------------------------------------------------ */
/* Units                                                               */
/* ------------------------------------------------------------------ */

test("rial and toman: each row's own unit decides; JPY is divided by 100", () => {
  const parsed = ok(parseGoldCurrency(GOLD_CURRENCY, SAMPLE_NOW));
  const jpy = parsed.quotes.get("gold_currency:JPY")!;
  assert.equal(jpy.price, "562.83", "«یکصد ین ژاپن» 56,283 → 562.83 per yen");
  assert.equal(jpy.meta?.sourceUnitQuantity, "100");
  assert.equal(jpy.currency, "IRT", "the free feed says «تومان»");
  assert.equal(parsed.quotes.get("gold_currency:EUR")!.meta?.sourceUnitQuantity, "1");
  assert.equal(parsed.quotes.get("gold_currency:IR_GOLD_18K")!.meta?.quantityUnit, "gram");
  assert.equal(parsed.quotes.get("gold_currency:IR_COIN_EMAMI")!.meta?.quantityUnit, "coin");

  // The same symbols in RIAL (as the Pro endpoint sends them) are IRR, and are
  // shown in Toman by an exact division by ten.
  const inRial = GOLD_CURRENCY.replaceAll('"unit": "تومان"', '"unit": "ریال"');
  const rial = ok(parseGoldCurrency(inRial, SAMPLE_NOW)).quotes.get("gold_currency:EUR")!;
  assert.equal(rial.currency, "IRR");
  const view = toQuoteView(stored("brsapi", "gold_currency:EUR", rial), [], SAMPLE_NOW);
  assert.equal(view.currency, "IRT");
  assert.equal(view.amount, "9115", "91,150 rial → 9,115 toman");

  // An unknown unit is refused, not guessed.
  const odd = GOLD_CURRENCY.replace('"unit": "تومان"', '"unit": "درهم"');
  assert.ok(ok(parseGoldCurrency(odd, SAMPLE_NOW)).rejected.size >= 1);
});

test("a per-100 rate is accepted only when the name agrees with the table", () => {
  // JPY quoted per ONE yen without saying so → rejected, not silently ×100 off.
  const jpyPerOne = GOLD_CURRENCY.replace("یکصد ین ژاپن", "ین ژاپن");
  const a = ok(parseGoldCurrency(jpyPerOne, SAMPLE_NOW));
  assert.equal(a.quotes.has("gold_currency:JPY"), false);
  assert.equal(a.rejected.get("gold_currency:JPY"), "invalid_response");
  // Another currency suddenly «per 100» → rejected too.
  const eurPer100 = GOLD_CURRENCY.replace('"name": "یورو"', '"name": "یکصد یورو"');
  assert.equal(ok(parseGoldCurrency(eurPer100, SAMPLE_NOW)).quotes.has("gold_currency:EUR"), false);
});

test("USD is never USDT", () => {
  const parsed = ok(parseGoldCurrency(GOLD_CURRENCY, SAMPLE_NOW));
  assert.equal(parsed.quotes.get("gold_currency:USD")!.price, "81650");
  assert.equal(parsed.quotes.get("gold_currency:USDT_IRT")!.price, "81983", "kept, under its own id");
  assert.deepEqual(REFERENCE_QUOTE_REFS.USD, [{ source: "brsapi", ref: "gold_currency:USD" }]);
  for (const refs of Object.values(REFERENCE_QUOTE_REFS)) {
    for (const r of refs) assert.doesNotMatch(r.ref, /USDT/, "no row is priced from a Tether rate");
  }
  // A dollar-priced metal stays in dollars — never displayed as تتر.
  const xau = parseGoldApiPrice("XAU", JSON.stringify({ symbol: "XAU", currency: "USD", price: 4258.0, updatedAt: "2026-09-24T14:40:27Z" }), new Date("2026-09-24T14:41:00Z"));
  assert.ok("quote" in xau);
  assert.equal(toQuoteView(stored("gold-api", "XAU", xau.quote), [], new Date("2026-09-24T14:41:00Z")).currency, "USD");
});

test("commodities: dollars per barrel / ounce; contract type stated as unspecified", () => {
  const parsed = ok(parseCommodity(COMMODITY, SAMPLE_NOW));
  const brent = parsed.quotes.get("commodity:BRENT")!;
  assert.equal(brent.price, "68.83");
  assert.equal(brent.currency, "USD");
  assert.equal(brent.meta?.quantityUnit, "barrel");
  assert.equal(brent.meta?.basis, "unspecified", "spot vs futures is not documented — never claimed");
  assert.equal(parsed.quotes.get("commodity:WTI")!.meta?.quantityUnit, "barrel");
});

/* ------------------------------------------------------------------ */
/* Tehran exchange                                                     */
/* ------------------------------------------------------------------ */

test("TSE: last trade and closing price are separate; no NAV is invented; rights are not shares", () => {
  const parsed = ok(parseTsetmc(TSETMC, new Date("2025-06-01T10:00:00Z")));
  const ayar = parsed.quotes.get("tsetmc:IRTKMOFD0001")!;
  assert.equal(ayar.price, "315399", "price = last trade (pl)");
  assert.equal(ayar.meta?.basis, "last_trade");
  assert.equal(ayar.meta?.extra?.close, "315703", "closing price (pc) kept apart");
  assert.equal(ayar.meta?.extra?.kind, "etf");
  assert.equal(ayar.currency, "IRR");
  assert.equal(ayar.meta?.observedAtInferred, true, "the feed sends a clock time only");
  for (const q of parsed.quotes.values()) {
    assert.ok(!Object.keys(q.meta?.extra ?? {}).some((k) => /nav/i.test(k)), "the free feed has no NAV — none is made up");
  }
  assert.deepEqual(classifyIsin("IRR1DSOB0101"), { kind: "right", board: null });
  assert.deepEqual(classifyIsin("IRO3BNOP0001"), { kind: "stock", board: "farabourse" });
  assert.deepEqual(classifyIsin("IRO7BTEK0001"), { kind: "stock", board: "base" });
  assert.equal(classifyIsin("IRB3TB030001"), null, "a bond is not guessed into a share");
  const right = [...parsed.quotes.values()].find((q) => q.meta?.extra?.kind === "right");
  assert.ok(right, "the fixture carries a حق‌تقدم");
  const rows = tseRowsFromQuotes(new Map([["brsapi|x", stored("brsapi", right!.meta!.instrumentId.replace(/^/, "tsetmc:"), right!)]]), new Set());
  assert.equal(rows[0]?.kind, "ir_right");
});

test("TSE: a 17-digit instrument id sent as a JSON NUMBER survives exactly", () => {
  const body = JSON.stringify(JSON.parse(TSETMC).slice(0, 1)).replace(/"id":"(\d+)"/, '"id":46348559193224090');
  assert.match(body, /"id":46348559193224090/);
  const q = [...ok(parseTsetmc(body, new Date("2025-06-01T10:00:00Z"))).quotes.values()][0];
  assert.equal(q.meta?.extra?.insCode, "46348559193224090", "Number() would have made it …088");
});

test("TSE: the inferred date is the last Saturday–Wednesday session", () => {
  // Friday 2025-06-06 10:00 Tehran → the session was Wednesday 06-04.
  const friday = new Date("2025-06-06T06:30:00Z");
  assert.equal(inferTehranSessionInstant("12:29:59", friday)!.toISOString(), "2025-06-04T08:59:59.000Z");
  // Saturday 11:00 Tehran, a time earlier today → today.
  const saturday = new Date("2025-06-07T07:30:00Z");
  assert.equal(inferTehranSessionInstant("10:00:00", saturday)!.toISOString(), "2025-06-07T06:30:00.000Z");
  assert.equal(inferTehranSessionInstant("25:00", saturday), null);
});

/* ------------------------------------------------------------------ */
/* Failures                                                            */
/* ------------------------------------------------------------------ */

function serve(bodies: Record<string, { status?: number; body: string }>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    const hit = bodies[url.pathname];
    if (!hit) return new Response("{}", { status: 404 });
    return new Response(hit.body, { status: hit.status ?? 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

test("partial response and a missing symbol are per-symbol, not whole-page failures", async () => {
  const onlyGold = JSON.stringify({ gold: JSON.parse(GOLD_CURRENCY).gold });
  const { fetchImpl } = serve({ "/Market/Gold_Currency.php": { body: onlyGold } });
  const provider = new BrsApiProvider({ apiKey: "k", fetchImpl, now: () => SAMPLE_NOW, retries: 0 });
  const result = await provider.fetchQuotes(["gold_currency:IR_GOLD_18K", "gold_currency:EUR", "gold_currency:NOPE"]);
  assert.equal(result.quotes.get("gold_currency:IR_GOLD_18K")?.price, "6214700");
  assert.equal(result.failures.get("gold_currency:EUR"), "asset_not_found");
  assert.equal(result.failures.get("gold_currency:NOPE"), "asset_not_found");
});

test("quota exhausted and refused requests are not retried; transient errors are, a few times", async () => {
  let calls = 0;
  const quota = (async () => {
    calls += 1;
    return new Response("Too Many Requests", { status: 429 });
  }) as typeof fetch;
  const r1 = await referenceGet("https://example.invalid/?key=SECRET", { fetchImpl: quota, sleep: async () => {} });
  assert.deepEqual(r1, { ok: false, status: 429, code: "quota_exhausted" });
  assert.equal(calls, 1, "a spent quota is not hammered");

  calls = 0;
  const refused = (async () => {
    calls += 1;
    return new Response('{"successful":false,"status":"invalid_key"}', { status: 401 });
  }) as typeof fetch;
  const r2 = await referenceGet("https://example.invalid/?key=SECRET", { fetchImpl: refused, sleep: async () => {} });
  assert.equal(r2.ok ? "" : r2.code, "rejected_request");
  assert.equal(calls, 1, "wrong parameters are never repeated — they get a key banned");

  calls = 0;
  const flaky = (async () => {
    calls += 1;
    return new Response("oops", { status: 503 });
  }) as typeof fetch;
  const gaps: number[] = [];
  const r3 = await referenceGet("https://example.invalid/?key=SECRET", { fetchImpl: flaky, retries: 2, baseDelayMs: 100, sleep: async (ms) => void gaps.push(ms) });
  assert.equal(calls, 3);
  assert.deepEqual(gaps, [100, 300], "growing gaps");
  assert.ok(!JSON.stringify([r1, r2, r3]).includes("SECRET"), "no outcome carries the key");

  // BrsAPI's own error envelope on HTTP 200.
  const envelope = parseGoldCurrency('{"successful":false,"status":"daily_limit","message_error":"limit"}', SAMPLE_NOW);
  assert.deepEqual(envelope, { failure: "quota_exhausted" });
});

/* ------------------------------------------------------------------ */
/* Persistence, lease, isolation                                       */
/* ------------------------------------------------------------------ */

function stored(source: string, ref: string, q: PriceQuote) {
  return {
    source,
    ref,
    instrumentId: q.meta?.instrumentId ?? ref,
    price: q.price,
    currency: q.currency as "IRT" | "IRR" | "USD",
    quantityUnit: q.meta?.quantityUnit ?? "unit",
    sourceUnitQuantity: q.meta?.sourceUnitQuantity ?? "1",
    basis: q.meta?.basis ?? "unspecified",
    observedAt: q.observedAt,
    observedAtInferred: q.meta?.observedAtInferred ?? false,
    fetchedAt: q.fetchedAt,
    extra: q.meta?.extra ?? null,
  };
}

const quote = (price: string, observedAt: string, fetchedAt: string): PriceQuote => ({
  price,
  currency: "USD",
  observedAt,
  fetchedAt,
  source: "gold-api",
  meta: { instrumentId: "XAU", quantityUnit: "troy_ounce", sourceUnitQuantity: "1", basis: "spot" },
});

async function reset() {
  await createSchemaIfNotExists();
  await db.delete(marketReferenceQuotes);
  await db.delete(marketSourceStatus);
}

test("an old figure fetched again stays old, and never overwrites a newer one", async () => {
  await reset();
  await persistReferenceQuotes("gold-api", new Map([["XAU", quote("4258", "2026-09-24T14:40:00Z", "2026-09-24T14:40:05Z")]]));
  // A lagging response: older source time, newer fetch.
  await persistReferenceQuotes("gold-api", new Map([["XAU", quote("4100", "2026-09-24T10:00:00Z", "2026-09-24T14:45:00Z")]]));
  const row = (await readReferenceQuotes()).get("gold-api|XAU")!;
  assert.equal(row.price, "4258", "the older figure did not roll the price back");
  assert.equal(row.observedAt, "2026-09-24T14:40:00.000Z");

  // Freshness is judged by the SOURCE time: fetched a minute ago, observed
  // three hours ago on a weekday → delayed, not live.
  const again = { ...row, fetchedAt: "2026-09-24T17:39:00.000Z" };
  assert.equal(referenceState(again, undefined, new Date("2026-09-24T17:40:00Z")), "delayed");
  assert.equal(referenceState(row, undefined, new Date("2026-09-24T14:45:00Z")), "live");
  // Saturday: the world market is shut, the same figure is «market closed».
  assert.equal(referenceState(row, undefined, new Date("2026-09-26T12:00:00Z")), "market_closed");
});

function testConfig(): ReferenceConfig {
  const c = readReferenceConfig({});
  return { ...c, brsapi: { ...c.brsapi, enabled: true, hasKey: true } };
}

function registryWith(fetchImpl: typeof fetch, now: () => Date) {
  const registry = new ProviderRegistry();
  registry.register(new GoldApiProvider({ fetchImpl, now, retries: 0 }));
  registry.register(new BrsApiProvider({ apiKey: "test-key", fetchImpl, now, retries: 0 }));
  return registry;
}

test("refresh never touches the books: journal, postings, lots, prices and assets are unchanged", async () => {
  await reset();
  const counts = async () =>
    (
      (await db.execute(sql`
        select (select count(*)::int from journal_entries) as j, (select count(*)::int from postings) as p,
               (select count(*)::int from lots) as l, (select count(*)::int from prices) as pr,
               (select count(*)::int from assets) as a,
               (select coalesce(sum(price_base), 0)::text from prices) as manual
      `)) as unknown as { rows: unknown[] }
    ).rows[0];
  const before = await counts();
  const now = () => new Date("2026-09-24T14:41:00Z");
  const { fetchImpl } = serve({
    "/price/XAU": { body: JSON.stringify({ symbol: "XAU", currency: "USD", price: 4258.0, updatedAt: "2026-09-24T14:40:27Z" }) },
    "/price/XAG": { body: JSON.stringify({ symbol: "XAG", currency: "USD", price: 63.529999, updatedAt: "2026-09-24T14:40:26Z" }) },
  });
  const outcomes = await refreshReferenceQuotes({ now, config: testConfig(), registry: registryWith(fetchImpl, now) });
  assert.equal(outcomes.find((o) => o.source === "gold-api")?.status, "ok");
  assert.deepEqual(await counts(), before, "no ledger, lot, asset or manual price row moved");

  const src = readFileSync(new URL("../src/features/pricing/referenceQuotes.ts", import.meta.url), "utf8");
  const schemaImport = src.match(/import \{([^}]*)\} from "@\/db\/schema"/)?.[1] ?? "";
  assert.equal(schemaImport.trim(), "marketReferenceQuotes, marketSourceStatus", "imports no book table");
});

test("the last valid price survives a failing source and is labelled as such", async () => {
  await reset();
  let t = new Date("2026-09-24T14:41:00Z");
  const now = () => t;
  const good = serve({
    "/price/XAU": { body: JSON.stringify({ symbol: "XAU", currency: "USD", price: 4258.0, updatedAt: "2026-09-24T14:40:27Z" }) },
    "/price/XAG": { body: JSON.stringify({ symbol: "XAG", currency: "USD", price: 63.53, updatedAt: "2026-09-24T14:40:26Z" }) },
  });
  await refreshReferenceQuotes({ now, config: testConfig(), registry: registryWith(good.fetchImpl, now) });

  t = new Date("2026-09-24T14:50:00Z");
  const down = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  const outcomes = await refreshReferenceQuotes({ now, config: testConfig(), registry: registryWith(down, now) });
  assert.equal(outcomes.find((o) => o.source === "gold-api")?.status, "failed");

  const quotes = await readReferenceQuotes();
  assert.equal(quotes.get("gold-api|XAU")?.price, "4258", "kept — never replaced by zero or a sample");
  const statuses = await readSourceStatus(testConfig(), t);
  const gold = statuses.find((s) => s.source === "gold-api")!;
  assert.equal(gold.failing, true);
  assert.equal(gold.lastErrorCode, "network_failure");
  const rows = referenceMarketRows();
  const views = referenceViewsFor(rows, quotes, statuses, t);
  assert.equal(views[rowKey({ kind: "gold_bullion", symbol: "XAU" })].state, "source_down");
});

test("one lease across instances; a spent quota blocks further claims until reset", async () => {
  await reset();
  const now = new Date("2026-09-24T10:00:00Z");
  const claims = await Promise.all(Array.from({ length: 5 }, () => claimSource("brsapi:commodity", 300_000, now)));
  assert.equal(claims.filter(Boolean).length, 1, "exactly one instance fetches");
  // Released but asked too recently → still refused within the interval.
  await db.update(marketSourceStatus).set({ leaseUntil: null });
  assert.equal(await claimSource("brsapi:commodity", 300_000, new Date(now.getTime() + 60_000)), false);
  assert.equal(await claimSource("brsapi:commodity", 300_000, new Date(now.getTime() + 301_000)), true);

  // A 429 on a real refresh stops the source until the next Tehran midnight.
  await reset();
  const t = new Date("2026-09-24T10:00:00Z");
  const { fetchImpl, calls } = serve({ "/Market/Commodity.php": { status: 429, body: "limit" } });
  const cfg = { ...testConfig(), goldApi: { ...testConfig().goldApi, enabled: false } };
  cfg.brsapi = { ...cfg.brsapi, feeds: ["commodity"] };
  const first = await refreshReferenceQuotes({ now: () => t, config: cfg, registry: registryWith(fetchImpl, () => t) });
  assert.deepEqual(first.find((o) => o.source === "brsapi:commodity"), { source: "brsapi:commodity", status: "failed", code: "quota_exhausted" });
  const later = new Date("2026-09-24T18:00:00Z");
  const second = await refreshReferenceQuotes({ now: () => later, config: cfg, registry: registryWith(fetchImpl, () => later) });
  assert.equal(second.find((o) => o.source === "brsapi:commodity")?.status, "skipped");
  assert.equal(calls.length, 1, "no request after the quota ran out");
  const status = (await readSourceStatus(cfg, later)).find((s) => s.source === "brsapi:commodity")!;
  assert.equal(status.requestsToday, 1, "the request was counted");
  assert.equal(status.quotaExhaustedUntil, "2026-09-24T20:30:00.000Z", "Tehran midnight");

  // The shared daily budget: all BrsAPI feeds together.
  await reset();
  await db.insert(marketSourceStatus).values({ source: "brsapi:gold_currency", quotaDay: "2026-09-24", requestsToday: 1199 });
  const budgeted = await refreshReferenceQuotes({ now: () => t, config: cfg, registry: registryWith(fetchImpl, () => t) });
  assert.equal(budgeted.find((o) => o.source === "brsapi:commodity")?.status, "skipped", "budget reached across feeds");
});

test("BrsAPI: on once a key is set (host confirmed by support); off on request; 5-minute default", () => {
  assert.equal(readReferenceConfig({}).brsapi.hasKey, false, "no key → nothing is asked");
  assert.equal(readReferenceConfig({ BRSAPI_KEY: "k" }).brsapi.enabled, true);
  assert.equal(readReferenceConfig({ BRSAPI_KEY: "k", BRSAPI_ENABLED: "false" }).brsapi.enabled, false);
  assert.equal(readReferenceConfig({}).goldApi.enabled, true);
  assert.equal(readReferenceConfig({ BRSAPI_REFRESH_SECONDS: "5" }).brsapi.intervalMs, 60_000, "never faster than a minute");
  assert.equal(readReferenceConfig({}).brsapi.intervalMs, 300_000, "5 minutes by default");
  assert.ok(readReferenceConfig({}).brsapi.dailyBudget <= 1500, "one shared allowance for all routes");
});

test("melted gold is a مثقال at ۷۰۵ only when this response's own ratio proves it", () => {
  const parsed = ok(parseGoldCurrency(GOLD_CURRENCY, SAMPLE_NOW));
  const melted = parsed.quotes.get("gold_currency:IR_GOLD_MELTED")!;
  assert.equal(melted.price, "26883000");
  assert.equal(melted.meta?.quantityUnit, "mesghal_705");
  assert.deepEqual(REFERENCE_QUOTE_REFS.MESGHAL, [{ source: "brsapi", ref: "gold_currency:IR_GOLD_MELTED" }]);
  // Per 18K gram instead of per mesghal → the ratio is off → rejected.
  const perGram = GOLD_CURRENCY.replace('"price": 26883000', '"price": 6214700');
  const bad = ok(parseGoldCurrency(perGram, SAMPLE_NOW));
  assert.equal(bad.quotes.has("gold_currency:IR_GOLD_MELTED"), false);
  assert.equal(bad.rejected.get("gold_currency:IR_GOLD_MELTED"), "invalid_response");
});

test("currency rates are labelled free-market only when the dollar sits beside the Tether rate", () => {
  const parsed = ok(parseGoldCurrency(GOLD_CURRENCY, SAMPLE_NOW));
  assert.equal(parsed.quotes.get("gold_currency:EUR")!.meta?.basis, "free_market");
  assert.equal(parsed.quotes.get("gold_currency:USDT_IRT")!.meta?.basis, "unspecified", "Tether is the yardstick, not a free-market dollar");
  // An official-looking dollar (half the street) → no claim at all.
  const official = GOLD_CURRENCY.replace('"price": 81650', '"price": 42000');
  assert.equal(ok(parseGoldCurrency(official, SAMPLE_NOW)).quotes.get("gold_currency:EUR")!.meta?.basis, "unspecified");
});

test("coins: one general half/quarter rate is never attributed to a design; unmapped rows stay priceless", () => {
  assert.deepEqual(REFERENCE_QUOTE_REFS.NIM, [{ source: "brsapi", ref: "gold_currency:IR_COIN_HALF" }]);
  for (const design of ["NIM-EMAMI", "NIM-BAHAR", "ROB-EMAMI", "ROB-BAHAR", "SILVER999", "OPEC", "HKD", "NOK", "DKK"]) {
    assert.equal(REFERENCE_QUOTE_REFS[design], undefined, `${design} has no verified source`);
  }
});

test("TSE catalogue rows are priced by ISIN, never by ticker", () => {
  const parsed = ok(parseTsetmc(TSETMC, new Date("2025-06-01T10:00:00Z")));
  const quotes = new Map([...parsed.quotes].map(([ref, q]) => [`brsapi|${ref}`, stored("brsapi", ref, q)]));
  const rows = tseMarketRows();
  const views = referenceViewsFor(rows, quotes, [], new Date("2025-06-01T10:00:00Z"));
  assert.ok(views[rowKey({ kind: "ir_fund", symbol: "عیار" })], "عیار matched by its ISIN");
  // «نوین»: a fund in the catalogue, بیمه نوین in the feed — not matched.
  assert.equal(views[rowKey({ kind: "ir_fund", symbol: "نوین" })], undefined);
  assert.equal(views[rowKey({ kind: "ir_fund", symbol: "سیمرغ" })], undefined);
});

test("the provider's sample files never reach the product", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  for (const file of walk(new URL("../src", import.meta.url).pathname)) {
    const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /Api\/(Market|Tsetmc|IME)\/Sample|FreeApi_Gold_Currency|tests\/fixtures/, file);
  }
});

test("a catalogue row with no ISIN on record takes the feed's ISIN for the same kind and ticker", () => {
  const now = new Date("2025-06-01T10:00:00Z");
  const feedRow = (isin: string, symbol: string, kind: string) =>
    stored("brsapi", `tsetmc:${isin}`, {
      price: "53000",
      currency: "IRR",
      observedAt: now.toISOString(),
      fetchedAt: now.toISOString(),
      source: "brsapi",
      meta: { instrumentId: isin, quantityUnit: "share", sourceUnitQuantity: "1", basis: "last_trade", observedAtInferred: true, extra: { kind, symbol, name: symbol } },
    });
  const quotes = new Map([
    ["brsapi|tsetmc:IRO1PNBA0001", feedRow("IRO1PNBA0001", "شبندر", "stock")],
    ["brsapi|tsetmc:IRO3BNOP0001", feedRow("IRO3BNOP0001", "نوین", "stock")],
  ]);
  const rows = supplementalMarketRows([], tseMarketRows(), quotes, new Set());
  const shabandar = rows.filter((r) => r.symbol === "شبندر");
  assert.equal(shabandar.length, 1, "joined, not listed twice");
  assert.equal(shabandar[0].displayName, "پالایش نفت بندرعباس", "the catalogue's own name and mark stay");
  const views = referenceViewsFor(rows, quotes, [], now);
  assert.equal(views[rowKey({ kind: "ir_stock", symbol: "شبندر" })]?.amount, "5300", "priced in toman");
  // «نوین»: a fund here, an insurer in the feed — never joined.
  assert.equal(views[rowKey({ kind: "ir_fund", symbol: "نوین" })], undefined);
  assert.ok(views[rowKey({ kind: "ir_stock", symbol: "نوین" })], "the insurer is listed on its own row");
});
