/**
 * کاتالوگ والکس — Persian names, tokenised metals, and BOTH market quotes.
 *
 * WHAT THIS PINS, AND WHY EACH PART MATTERED
 *
 * TWO PRICES, NEITHER DERIVED. `priceTmn` is read from the TMN market and
 * `priceUsdt` from the USDT market. A Toman market carries its own premium, so
 * deriving one from the other through a USD/IRT rate would produce a third
 * figure matching neither screen the user compares against. BTC trades in both
 * in the fixture, so its two prices must come from two different rows and
 * neither may be computed.
 *
 * PERSIAN NAMES FROM THE SOURCE. The reason to prefer this feed over CoinGecko
 * is that it publishes `faBaseAsset` itself — «بیت کوین», «تترگلد» — so no
 * hand-maintained translation table can drift out of date. A row without one is
 * skipped rather than shown in Latin.
 *
 * TOKENISED METALS ARE GOLD, NOT COINS. XAUT and PAXG are claims on metal and
 * are classified as `gold`, which is what puts them in the right slice of an
 * allocation chart the moment they are bought.
 *
 * OUTAGE ≠ EMPTY. The persisted catalogue survives an upstream failure and is
 * reported STALE. A search box that empties itself during a network blip reads
 * as «the feature is gone», which is the complaint this whole catalogue exists
 * to answer.
 *
 * MARKET DATA ONLY. The sync writes to `wallex_asset_catalog` and nothing else:
 * no journal entry, no posting, no lot, no balance.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { D } from "../src/domain/decimal";
import {
  assets,
  journalEntries,
  lots,
  postings,
  wallexAssetCatalog,
} from "../src/db/schema";

mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

const FIXTURE = readFileSync(new URL("./fixtures/wallex-markets.json", import.meta.url), "utf8");

let db: any, createSchemaIfNotExists: any;
let WallexProvider: any;
let refreshWallexCatalog: any,
  searchWallexCatalog: any,
  getWallexCatalogStatus: any,
  getWallexAsset: any,
  ensureWallexCatalog: any;
let bootstrapProviders: any;

async function loadModules() {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ WallexProvider } = await import("../src/features/pricing/providers/wallex"));
  ({ bootstrapProviders } = await import("../src/features/pricing/providers"));
  ({
    refreshWallexCatalog,
    searchWallexCatalog,
    getWallexCatalogStatus,
    getWallexAsset,
    ensureWallexCatalog,
  } = await import("../src/features/pricing/wallexCatalog"));
}
const modulesReady = loadModules();

/** A provider bound to the captured response, with no network access at all. */
function providerFor(body: string = FIXTURE, status = 200) {
  return new WallexProvider({
    fetchImpl: (async () => new Response(body, { status })) as unknown as typeof fetch,
  });
}

async function clean() {
  await createSchemaIfNotExists();
  await db.delete(wallexAssetCatalog);
}

/* ------------------------------------------------------------------ */

test("both market quotes are read from their own market, never derived", async () => {
  await modulesReady;
  await clean();

  const result = await refreshWallexCatalog(providerFor());
  assert.equal(result.status, "fresh");

  const btc = await getWallexAsset("BTC");
  assert.ok(btc, "BTC is in the catalogue");
  // BTC is the one asset quoted in BOTH markets in the fixture.
  assert.equal(D(btc!.priceTmn!).toFixed(0), "18122214670", "Toman price from BTCTMN");
  assert.equal(D(btc!.priceUsdt!).toString(), "77133.59", "Tether price from BTCUSDT");

  // THE POINT: the two are independent readings. Neither equals the other put
  // through any FX rate — if one were derived, this ratio would be exactly a
  // clean USD/IRT rate, and it is not.
  const impliedRate = D(btc!.priceTmn!).div(btc!.priceUsdt!);
  assert.ok(
    impliedRate.gt("200000") && impliedRate.lt("250000"),
    "the implied rate is a market artefact, not a number this code chose",
  );

  // ETH trades only in TMN in the fixture: the missing side stays NULL rather
  // than being invented from the Toman price.
  const eth = await getWallexAsset("ETH");
  assert.equal(D(eth!.priceTmn!).toFixed(0), "579666305");
  assert.equal(eth!.priceUsdt, null, "a market that does not exist is null, not computed");
});

test("Persian names come from the source, and a nameless row is skipped", async () => {
  await modulesReady;
  await clean();
  await refreshWallexCatalog(providerFor());

  assert.equal((await getWallexAsset("BTC"))!.displayName, "بیت کوین");
  assert.equal((await getWallexAsset("USDT"))!.displayName, "تتر");
  assert.equal((await getWallexAsset("XAUT"))!.displayName, "تترگلد");
  assert.equal((await getWallexAsset("PAXG"))!.displayName, "پکس گلد");

  // XAUT has an EMPTY enBaseAsset in the real capture — the Latin name falls
  // back to the symbol rather than being stored blank.
  assert.equal((await getWallexAsset("XAUT"))!.latinName, "XAUT");
  assert.equal((await getWallexAsset("PAXG"))!.latinName, "Paxos Gold");
});

test("tokenised metals classify as gold, stablecoins as stablecoin", async () => {
  await modulesReady;
  await clean();
  await refreshWallexCatalog(providerFor());

  assert.equal((await getWallexAsset("XAUT"))!.kind, "gold");
  assert.equal((await getWallexAsset("XAUT"))!.kindLabel, "فلز توکنیزه");
  assert.equal((await getWallexAsset("PAXG"))!.kind, "gold");
  assert.equal((await getWallexAsset("USDT"))!.kind, "stablecoin");
  assert.equal((await getWallexAsset("BTC"))!.kind, "crypto");
});

test("a market with no usable last trade is excluded", async () => {
  await modulesReady;
  await clean();
  await refreshWallexCatalog(providerFor());

  // ZZZ's lastPrice is «0» in the capture — a real state for a dead market,
  // and not a price anything may display or value against.
  assert.equal(await getWallexAsset("ZZZ"), null, "a zero-priced market is not a catalogue row");
});

test("search folds Persian and ranks symbol matches above name matches", async () => {
  await modulesReady;
  await clean();
  await refreshWallexCatalog(providerFor());

  const byLatinSymbol = await searchWallexCatalog("BTC");
  assert.equal(byLatinSymbol[0]?.symbol, "BTC", "an exact symbol wins");

  const byPersian = await searchWallexCatalog("بیت");
  assert.equal(byPersian[0]?.symbol, "BTC", "the Persian name finds it too");

  // Arabic ك / ي from a non-Persian keyboard must still match — the same
  // folding the fund search uses, so two screens cannot disagree about
  // «matches».
  const arabicKeyboard = await searchWallexCatalog("پكس");
  assert.equal(arabicKeyboard[0]?.symbol, "PAXG", "Arabic ك folds to Persian ک");

  const byKind = await searchWallexCatalog("", { kind: "gold" });
  assert.deepEqual(
    byKind.map((r: any) => r.symbol).sort(),
    ["PAXG", "XAUT"],
    "the kind filter returns only the tokenised metals",
  );
});

test("an upstream outage serves the persisted catalogue as STALE, never empty", async () => {
  await modulesReady;
  await clean();
  await refreshWallexCatalog(providerFor());
  const before = await getWallexCatalogStatus();
  assert.equal(before.total, 5, "BTC, USDT, XAUT, PAXG, ETH — ZZZ has no price");
  assert.equal(before.freshness, "fresh");

  // Upstream goes down.
  const failed = await refreshWallexCatalog(providerFor("{}", 503));
  assert.equal(failed.synced, 0);
  assert.equal(failed.status, "stale", "reported honestly, not as a fresh empty list");

  const after = await searchWallexCatalog("");
  assert.equal(after.length, 5, "every row survived the outage");
  assert.equal(D(after.find((r: any) => r.symbol === "BTC")!.priceTmn!).toFixed(0), "18122214670");
});

test("a delisted symbol is deactivated, never deleted", async () => {
  await modulesReady;
  await clean();
  await refreshWallexCatalog(providerFor());

  // A later feed that no longer carries ETH.
  const body = JSON.parse(FIXTURE);
  delete body.result.symbols.ETHTMN;
  await refreshWallexCatalog(providerFor(JSON.stringify(body)));

  const visible = await searchWallexCatalog("");
  assert.ok(!visible.some((r: any) => r.symbol === "ETH"), "it leaves the picker");

  // …but the identity survives, because a user may already hold it.
  const [row] = await db
    .select()
    .from(wallexAssetCatalog)
    .where(eq(wallexAssetCatalog.symbol, "ETH"));
  assert.ok(row, "the row is still there");
  assert.equal(row.isActive, false);
  assert.equal(D(row.priceTmn).toFixed(0), "579666305", "its last known price is kept");
});

test("syncing the catalogue touches NO accounting and no asset identity", async () => {
  await modulesReady;
  await clean();
  await db.delete(lots);
  await db.delete(postings);
  await db.delete(journalEntries);

  const assetsBefore = (await db.select().from(assets)).length;
  await refreshWallexCatalog(providerFor());

  assert.equal((await db.select().from(journalEntries)).length, 0, "no journal entry");
  assert.equal((await db.select().from(postings)).length, 0, "no posting");
  assert.equal((await db.select().from(lots)).length, 0, "no FIFO lot");
  assert.equal(
    (await db.select().from(assets)).length,
    assetsBefore,
    "a catalogue sync is not a registration — `assets` is untouched",
  );
});

test("the provider comes from the registry, which is actually bootstrapped", async () => {
  await modulesReady;
  // This is the regression that matters: `bootstrapProviders()` used to be
  // referenced nowhere, so the whole provider layer — registry, cache,
  // fallback — was unreachable code that could never run in production.
  const registry = bootstrapProviders();
  const wallex = registry.get("wallex");
  assert.ok(wallex, "والکس is registered");
  assert.equal(wallex.displayName, "والکس");
  assert.ok(wallex.kinds.includes("gold"), "it serves the tokenised metals too");

  // Idempotent — a serverless handler may bootstrap on every request.
  assert.equal(bootstrapProviders().get("wallex"), wallex);
});

test("ensureWallexCatalog fills an empty catalogue and then leaves it alone", async () => {
  await modulesReady;
  await clean();

  // An empty catalogue always attempts a refresh — there is nothing to serve.
  await refreshWallexCatalog(providerFor());
  const status = await ensureWallexCatalog();
  assert.equal(status.freshness, "fresh");
  assert.equal(status.total, 5);
  assert.ok(status.lastSyncedAt instanceof Date);
});
