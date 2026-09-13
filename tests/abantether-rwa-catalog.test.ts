/**
 * آبان‌تتر — the wider tokenised-RWA source, merged into the same catalogue.
 *
 * Runs against rows captured from the LIVE
 * https://api.abantether.com/manager/coins/data on 2026-09-13
 * (tests/fixtures/abantether-coins-rwa.json) — not an invented shape.
 *
 * WHAT THIS PINS
 *   • Only tokenised real-world assets are read; BTC and USDT are not copied
 *     into a second catalogue under a second price.
 *   • Index, bond and gold ETFs classify as such; a leveraged QQQ ETF does not
 *     pass itself off as the index.
 *   • The Toman price is the exact midpoint of buy/sell; Tether is as published.
 *   • Names carry no exchange or tokenisation-family tag; the symbol tells
 *     TSLAX from TSLAON.
 *   • Merged with Wallex: Wallex wins a shared symbol; each source deactivates
 *     only its own rows; a registration records which source it prices from.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { D } from "../src/domain/decimal";
import {
  accounts,
  assetClasses,
  assets,
  currencies,
  journalEntries,
  lots,
  postings,
  users,
  userFxSettings,
  wallexAssetCatalog,
} from "../src/db/schema";

mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

const ABAN = readFileSync(new URL("./fixtures/abantether-coins-rwa.json", import.meta.url), "utf8");
const WALLEX = readFileSync(new URL("./fixtures/wallex-markets-rwa.json", import.meta.url), "utf8");

let db: any, createSchemaIfNotExists: any;
let AbanTetherProvider: any, WallexProvider: any;
let refreshWallexCatalog: any, searchWallexCatalog: any, getWallexAsset: any, registerWallexAsset: any;

const modulesReady = (async () => {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ AbanTetherProvider } = await import("../src/features/pricing/providers/abantether"));
  ({ WallexProvider } = await import("../src/features/pricing/providers/wallex"));
  ({ refreshWallexCatalog, searchWallexCatalog, getWallexAsset } = await import(
    "../src/features/pricing/wallexCatalog"
  ));
  ({ registerWallexAsset } = await import("../src/features/pricing/wallexRegistration"));
})();

const respond = (body: string, status = 200) =>
  (async () => new Response(body, { status })) as unknown as typeof fetch;
const aban = (body = ABAN, status = 200) => new AbanTetherProvider({ fetchImpl: respond(body, status) });
const wallex = (body = WALLEX, status = 200) => new WallexProvider({ fetchImpl: respond(body, status) });

async function clean() {
  await createSchemaIfNotExists();
  await db.delete(lots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(userFxSettings);
  await db.delete(users);
  await db.delete(wallexAssetCatalog);
}

/* ------------------------------------------------------------------ */

test("only tokenised real-world assets are read, each classified by what it holds", async () => {
  await modulesReady;
  const entries = await aban().fetchMarketCatalog();
  const by = new Map(entries.map((e: any) => [e.symbol, e]));

  assert.ok(!by.has("BTC") && !by.has("USDT"), "coins are Wallex's job, never a second copy");

  const kind = (s: string) => (by.get(s) as any)?.kind;
  assert.equal(kind("AAPLX"), "tokenized_stock");
  assert.equal(kind("MSFTON"), "tokenized_stock");
  assert.equal(kind("NFLXON"), "tokenized_stock", "«Netflix stock price» is still a share");
  assert.equal(kind("SPYON"), "index");
  assert.equal(kind("SPYX"), "index", "«SP500 tokenized ETF» — written without the ampersand");
  assert.equal(kind("QQQON"), "index");
  assert.equal(kind("EWYB"), "index", "an MSCI country ETF");
  assert.equal(kind("TQQQB"), "tokenized_stock", "a leveraged QQQ ETF is not the index");
  assert.equal(kind("TLTON"), "bond");
  assert.equal(kind("AGGON"), "bond");
  assert.equal(kind("GLDX"), "commodity");
  assert.equal(kind("USOON"), "commodity");

  assert.equal((by.get("GLDX") as any).logoUrl, "mark:gold");
  assert.equal((by.get("TLTON") as any).logoUrl, "mark:bond");
  assert.equal((by.get("SPYON") as any).logoUrl, "mark:index");
  assert.equal((by.get("AAPLX") as any).logoUrl, "mark:stock");
});

test("Toman is the exact buy/sell midpoint; Tether is as published; names carry no source tag", async () => {
  await modulesReady;
  const coins = JSON.parse(ABAN).data;
  const raw = coins.find((c: any) => c.symbol === "SPYON");
  const entries = await aban().fetchMarketCatalog();
  const spy = entries.find((e: any) => e.symbol === "SPYON");

  assert.equal(spy.priceTmn, D(raw.price_buy).add(raw.price_sell).div(2).toString());
  assert.equal(spy.priceUsdt, D(raw.tether_price).toString());
  assert.equal(spy.source, "abantether");

  for (const e of entries) {
    assert.doesNotMatch(e.displayName, /xStock|bStock|Ondo|آبان|والکس/i, `${e.symbol}: no source in the name`);
  }
  // Twins of one company are told apart by their symbols, which differ.
  assert.notEqual(
    entries.find((e: any) => e.symbol === "AAPLX").symbol,
    entries.find((e: any) => e.symbol === "AAPLON").symbol,
  );
});

test("merged with Wallex: Wallex wins a shared symbol, Aban fills the rest", async () => {
  await modulesReady;
  await clean();
  const result = await refreshWallexCatalog(wallex(), aban());
  assert.equal(result.status, "fresh");

  // USOON and SLVON are on BOTH — shown once, with Wallex's market prices.
  assert.equal((await getWallexAsset("USOON")).source, "wallex");
  assert.equal((await getWallexAsset("SLVON")).source, "wallex");

  const spy = await getWallexAsset("SPYON");
  assert.equal(spy.source, "abantether", "provenance is kept internally…");
  assert.equal("sourceLabel" in spy, false, "…but never shaped for display");

  const indices = await searchWallexCatalog("", { kind: "index" });
  assert.deepEqual(indices.map((r: any) => r.symbol).sort(), ["EWYB", "QQQON", "SPYON", "SPYX"]);
});

test("each source deactivates only its own rows, and only when it answered", async () => {
  await modulesReady;
  await clean();
  await refreshWallexCatalog(wallex(), aban());

  // Aban goes down: its rows stay, Wallex's still refresh.
  await refreshWallexCatalog(wallex(), aban("{}", 503));
  assert.ok(await getWallexAsset("SPYON"), "an Aban outage does not empty Aban's rows");
  assert.equal((await searchWallexCatalog("SPYON"))[0]?.symbol, "SPYON");

  // Aban delists SPYON: only that row goes inactive, Wallex's rows are untouched.
  const body = JSON.parse(ABAN);
  body.data = body.data.filter((c: any) => c.symbol !== "SPYON");
  await refreshWallexCatalog(wallex(), aban(JSON.stringify(body)));
  const [spy] = await db.select().from(wallexAssetCatalog).where(eq(wallexAssetCatalog.symbol, "SPYON"));
  assert.equal(spy.isActive, false, "delisted, never deleted");
  assert.equal((await getWallexAsset("NVDAX")).source, "wallex");
  assert.ok((await searchWallexCatalog("NVDAX")).length > 0, "Wallex rows survived Aban's sync");
});

test("a registered Aban asset records where its price is read, and posts nothing", async () => {
  await modulesReady;
  await clean();
  await refreshWallexCatalog(wallex(), aban());
  const [user] = await db
    .insert(users)
    .values({ name: "AbanOwner", username: "abanowner", role: "owner" } as any)
    .returning();

  const spy = await registerWallexAsset({ symbol: "SPYON", userId: user.id });
  const [asset] = await db.select().from(assets).where(eq(assets.id, spy.assetId));
  assert.equal(asset.priceSource, "abantether");

  const bond = await registerWallexAsset({ symbol: "TLTON", userId: user.id });
  const [cls] = await db
    .select({ code: assetClasses.code })
    .from(assets)
    .innerJoin(assetClasses, eq(assetClasses.id, assets.classId))
    .where(eq(assets.id, bond.assetId));
  assert.equal(cls.code, "security", "a bond ETF is filed as a security, never as cash");

  assert.equal((await db.select().from(journalEntries)).length, 0);
  assert.equal((await db.select().from(lots)).length, 0);
});

test("a `mark:` logo renders the drawn mark, never an <img> with a bogus src", () => {
  const logo = readFileSync(new URL("../src/components/ui/AssetLogo.tsx", import.meta.url), "utf8");
  assert.ok(/startsWith\("mark:"\)/.test(logo), "AssetLogo intercepts mark: references");
  for (const k of ["stock", "index", "bond", "gold", "commodity"]) {
    assert.ok(new RegExp(`\\b${k}:\\s*\\w+Mark`).test(logo), `mark:${k} has a drawn mark`);
  }
});
