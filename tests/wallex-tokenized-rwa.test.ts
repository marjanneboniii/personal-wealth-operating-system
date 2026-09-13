/**
 * سهام آمریکا و کامودیتی از والکس — classification, registration, setup, marks.
 *
 * Runs against rows captured from the LIVE https://api.wallex.ir/v1/markets on
 * 2026-09-13 (tests/fixtures/wallex-markets-rwa.json), not an invented shape.
 * That capture held seven tokenised US stocks and five Ondo commodity funds,
 * and NO index token — so «شاخص» is pinned by name pattern only.
 *
 * WHAT THIS PINS
 *   • An oil or gas token is a COMMODITY even though its Latin name says
 *     «Tokenized Stock»; a US share is a tokenized_stock; a coin whose name
 *     merely contains «Gold» stays crypto.
 *   • Registration files them under investment classes — never a class the
 *     purchase form could offer as a payment account — and posts nothing.
 *   • The setup wizard registers a Wallex row inside its own transaction and
 *     gives it an opening lot through the SAME single opening entry.
 *   • Each commodity has its own drawn mark on the system's white rx=12 plate.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
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
import { isLiquidAccount } from "../src/features/accounts/classification";

mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

const FIXTURE = readFileSync(new URL("./fixtures/wallex-markets-rwa.json", import.meta.url), "utf8");

let db: any, createSchemaIfNotExists: any;
let WallexProvider: any, kindOf: any;
let refreshWallexCatalog: any, searchWallexCatalog: any, getWallexAsset: any;
let registerWallexAsset: any, completeSetup: any;

const modulesReady = (async () => {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ WallexProvider, kindOf } = await import("../src/features/pricing/providers/wallex"));
  ({ refreshWallexCatalog, searchWallexCatalog, getWallexAsset } = await import(
    "../src/features/pricing/wallexCatalog"
  ));
  ({ registerWallexAsset } = await import("../src/features/pricing/wallexRegistration"));
  ({ completeSetup } = await import("../src/features/setup/service"));
})();

function provider() {
  return new WallexProvider({
    fetchImpl: (async () => new Response(FIXTURE, { status: 200 })) as unknown as typeof fetch,
  });
}

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

async function makeUser(name: string) {
  const [user] = await db
    .insert(users)
    .values({ name, username: name.toLowerCase(), role: "owner" } as any)
    .returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "200000" } as any);
  return user;
}

/* ------------------------------------------------------------------ */

test("the live feed's US stocks and commodities classify by what they hold", async () => {
  await modulesReady;
  const entries = await provider().fetchMarketCatalog();
  const kind = (s: string) => entries.find((e: any) => e.symbol === s)?.kind;

  assert.equal(kind("NVDAX"), "tokenized_stock");
  // AAPLX and TSLAX had lastPrice «-» in the capture: no trade, so — like every
  // other Wallex market — they are NOT catalogue rows until they trade. Their
  // classification is still what it will be the moment they do.
  assert.equal(kind("AAPLX"), undefined, "an untraded market is not shown at zero");
  for (const s of ["AAPLX", "TSLAX"]) assert.equal(kindOf(s, "Apple tokenized stock"), "tokenized_stock", s);
  // UNGON's Latin name is «US Natural Gas Fund Tokenized Stock (Ondo)» — it
  // must still land as a commodity, not as a share.
  for (const s of ["USOON", "UNGON", "SLVON", "PPLTON", "COPXON"]) assert.equal(kind(s), "commodity", s);
  assert.equal(kind("BTC"), "crypto");
  assert.equal(kind("AGLD"), "crypto", "«Adventure Gold» is a coin, not the metal");

  // Both markets, read independently, exactly like every other Wallex row.
  const nvda = entries.find((e: any) => e.symbol === "NVDAX");
  assert.ok(nvda.priceTmn, "NVIDIA carries its Toman price");
  assert.equal(nvda.displayName, "انویدیا استاک", "the Persian name comes from the source");
});

test("a future listing of the same families is classified by its name alone", async () => {
  await modulesReady;
  assert.equal(kindOf("SPYON", "SPDR S&P 500 ETF Tokenized (Ondo)"), "index");
  assert.equal(kindOf("QQQX", "Nasdaq 100 tokenized ETF"), "index");
  assert.equal(kindOf("MSFTX", "Microsoft tokenized stock"), "tokenized_stock");
  assert.equal(kindOf("PALLON", "Palladium Tokenized ETF (Ondo)"), "commodity");
  // A coin that merely CALLS itself silver is not the metal.
  assert.equal(kindOf("SILV", "Silver Token"), "crypto");
});

test("the real-world family filter returns stocks and commodities, not coins", async () => {
  await modulesReady;
  await clean();
  await refreshWallexCatalog(provider());

  const rwa = await searchWallexCatalog("", { kind: ["tokenized_stock", "commodity", "index"] });
  const symbols = rwa.map((r: any) => r.symbol).sort();
  assert.deepEqual(symbols, ["COPXON", "NVDAX", "PPLTON", "SLVON", "UNGON", "USOON"]);

  assert.equal((await getWallexAsset("USOON")).kindLabel, "کامودیتی");
  assert.equal((await getWallexAsset("NVDAX")).kindLabel, "سهام آمریکا");
  assert.equal((await searchWallexCatalog("نفت"))[0]?.symbol, "USOON", "«نفت» finds the oil token");
});

test("registration files them as investments and posts nothing", async () => {
  await modulesReady;
  await clean();
  await refreshWallexCatalog(provider());
  const user = await makeUser("RwaOwner");

  const nvda = await registerWallexAsset({ symbol: "NVDAX", userId: user.id });
  const oil = await registerWallexAsset({ symbol: "usoon", userId: user.id });

  const classOf = async (assetId: string) => {
    const [row] = await db
      .select({ code: assetClasses.code, name: assetClasses.name })
      .from(assets)
      .innerJoin(assetClasses, eq(assetClasses.id, assets.classId))
      .where(eq(assets.id, assetId));
    return row;
  };
  const nvdaClass = await classOf(nvda.assetId);
  const oilClass = await classOf(oil.assetId);
  assert.equal(nvdaClass.code, "equity");
  assert.equal(oilClass.code, "commodity");

  // Never offered as a payment account in the daily income/expense forms.
  assert.equal(isLiquidAccount({ symbol: "NVDAX", classCode: nvdaClass.code, className: nvdaClass.name }), false);
  assert.equal(isLiquidAccount({ symbol: "USOON", classCode: oilClass.code, className: oilClass.name }), false);

  // Idempotent: a second pick is the same account, not a second one.
  const again = await registerWallexAsset({ symbol: "NVDAX", userId: user.id });
  assert.equal(again.accountId, nvda.accountId);

  assert.equal((await db.select().from(journalEntries)).length, 0, "no journal entry");
  assert.equal((await db.select().from(lots)).length, 0, "no FIFO lot");
});

test("the setup wizard registers a Wallex row and opens its lot in the single opening entry", async () => {
  await modulesReady;
  await clean();
  await refreshWallexCatalog(provider());
  const user = await makeUser("WizardRwa");

  const result = await completeSetup(
    {
      userName: "WizardRwa",
      baseCurrency: "USD",
      displayCurrency: "IRT",
      dateCalendar: "jalali" as const,
      digitStyle: "fa" as const,
      bankAccountName: "بانک اصلی",
      bankAssetSymbol: "USD",
      bankOpeningBalance: "100",
      instruments: [
        { kind: "wallex" as const, symbol: "NVDAX", quantity: "2", unitPrice: "180" },
        { kind: "wallex" as const, symbol: "SLVON" },
      ],
    },
    user.id,
  );
  assert.equal(result.ok, true, result.message);

  const [nvda] = await db.select().from(assets).where(eq(assets.symbol, "NVDAX"));
  const [silver] = await db.select().from(assets).where(eq(assets.symbol, "SLVON"));
  assert.ok(nvda && silver, "both identities exist");

  const [silverAccount] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.assetId, silver.id), eq(accounts.userId, user.id)));
  assert.ok(silverAccount, "a quantity-less row still gets the account a purchase needs");

  const nvdaLots = await db.select().from(lots).where(eq(lots.assetId, nvda.id));
  assert.equal(nvdaLots.length, 1, "one opening lot for the held stock");
  assert.equal((await db.select().from(lots).where(eq(lots.assetId, silver.id))).length, 0, "no fabricated lot");

  const entries = await db.select().from(journalEntries);
  assert.equal(entries.length, 1, "still ONE opening entry");
  const legs = await db.select().from(postings).where(eq(postings.entryId, entries[0].id));
  const sum = legs.reduce((s: number, p: any) => s + Number(p.baseValue), 0);
  assert.ok(Math.abs(sum) < 1e-9, "the opening entry balances with NVDAX in it");
});

test("each commodity has its own drawn mark on the system's white plate", () => {
  const src = readFileSync(new URL("../src/components/ui/AssetTypeMarks.tsx", import.meta.url), "utf8");
  const registry = src.match(/export const WALLEX_ASSET_MARKS[\s\S]*?= \{([\s\S]*?)\};/);
  assert.ok(registry, "the symbol → mark table exists");
  const pairs = [...registry![1].matchAll(/(\w+):\s*(\w+)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(
    pairs.map((p) => p[0]).sort(),
    ["COPXON", "PPLTON", "SLVON", "UNGON", "USOON"],
  );
  assert.equal(new Set(pairs.map((p) => p[1])).size, pairs.length, "no two commodities share a mark");

  for (const [, name] of pairs) {
    const body = src.match(new RegExp(`export function ${name}\\(([\\s\\S]*?)\\n}`));
    assert.ok(body, `${name} is defined`);
    assert.ok(/plate = "(#FFFFFF|var\(--paper-000\))"/.test(body![1]), `${name} sits on the white plate`);
    assert.ok(/<Plate fill=\{plate\} \/>/.test(body![1]), `${name} uses the shared rx=12 plate`);
  }

  const logo = readFileSync(new URL("../src/components/ui/AssetLogo.tsx", import.meta.url), "utf8");
  assert.ok(/WALLEX_ASSET_MARKS\[/.test(logo), "AssetLogo routes the commodity symbols to their marks");
});
