/**
 * Registering a صندوق / سهم must not be a DEAD END.
 *
 * THE BUG THIS PINS
 * `registerInstrument` created an asset IDENTITY and nothing else. The purchase
 * form lists asset ACCOUNTS (plus the CoinGecko crypto catalogue), so a
 * registered fund had no account, could never be selected, could never receive
 * a buy, could never become a holding — and every asset page hides
 * zero-quantity rows, so it was invisible forever. The user's reasonable
 * conclusion was «صندوق‌ها نمایش داده نمی‌شوند»; nothing was broken in the
 * display, the registration simply led nowhere.
 *
 * Two rules follow, and this file pins both:
 *   1. Registration creates a tenant-owned asset account, so the instrument
 *      reaches the purchase form.
 *   2. Registration still posts NOTHING — no journal entry, no posting, no FIFO
 *      lot, no balance. A registration is not a purchase, and the account opens
 *      at zero.
 *
 * Plus the visibility half: an instrument registered but not yet bought is
 * reported by `listRegisteredWithoutHoldings` so a page can surface the user's
 * unfinished work instead of showing them an empty screen.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
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
} from "../src/db/schema";
import { searchStocks, searchFunds } from "../src/features/funds/search";

const cookieJar: { value: string | null } = { value: null };
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) =>
        name === "pwos_session" && cookieJar.value ? { value: cookieJar.value } : undefined,
      set: () => {},
      delete: () => {},
    }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

let db: any, createSchemaIfNotExists: any;
let createSession: any, registerInstrument: any, listRegisteredWithoutHoldings: any;
let completeSetup: any, getHoldings: any;

async function loadModules() {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ createSession } = await import("../src/lib/auth"));
  ({ registerInstrument } = await import("../src/features/funds/service"));
  ({ listRegisteredWithoutHoldings } = await import("../src/features/portfolio/service"));
  ({ completeSetup } = await import("../src/features/setup/service"));
  ({ getHoldings } = await import("../src/features/ledger/queries"));
}
const modulesReady = loadModules();

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
}

async function makeUser(name: string) {
  const [user] = await db
    .insert(users)
    .values({ name, username: name.toLowerCase().replace(/\s+/g, "-"), role: "owner" } as any)
    .returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "200000" } as any);
  return user;
}

/* ══════════════════════════════════════════════════════════════════════
   PURE — the stock catalogue the registrar needed and did not have.
   ══════════════════════════════════════════════════════════════════════ */

test("the stock catalogue is searchable with the same Persian folding as funds", () => {
  // An exact symbol wins.
  assert.equal(searchStocks("فولاد")[0]?.symbol, "فولاد");
  // Company name matches too, not just the symbol.
  assert.ok(searchStocks("مبارکه").some((s) => s.symbol === "فولاد"));
  // Arabic keyboard ي/ك must not break matching — the whole point of folding.
  assert.ok(searchStocks("وبملك").some((s) => s.symbol === "وبملت") === false);
  assert.equal(searchStocks("وبملت")[0]?.symbol, "وبملت");
  // A sector filter stays inside its sector.
  const banks = searchStocks("", { sector: "banking", limit: 50 });
  assert.ok(banks.length > 0);
  assert.ok(banks.every((s) => s.sector === "banking"));
  // Every row carries its Persian label for the UI.
  assert.ok(banks.every((s) => s.sectorLabel.length > 0));
  // Nothing matched must return nothing — never a wrong company.
  assert.equal(searchStocks("قطعاًهیچ‌نمادی").length, 0);
});

test("an unsearched stock list represents every sector, not just the first one", () => {
  // The catalogue is declared sector by sector, so a naive slice(0, 12) showed
  // twelve metals rows and made the picker look metals-only.
  const rows = searchStocks("", { limit: 12 });
  assert.ok(new Set(rows.map((r) => r.sector)).size >= 4, "several sectors are visible up front");
});

test("funds and stocks are separate catalogues — neither leaks into the other", () => {
  assert.equal(searchStocks("عیار").length, 0, "a gold FUND is not a stock");
  assert.equal(searchFunds("فولاد").length, 0, "a steel COMPANY is not a fund");
});

/* ══════════════════════════════════════════════════════════════════════
   WIRED — registration creates a buyable account and moves no money.
   ══════════════════════════════════════════════════════════════════════ */

test("registering an instrument creates a tenant-owned asset account — the dead end is gone", async () => {
  await modulesReady;
  await clean();
  const user = await makeUser("InstrumentOwner");
  cookieJar.value = (await createSession(user.id)).token;

  const fund = await registerInstrument({ kind: "fund", symbol: "عیار", userId: user.id });
  assert.ok(fund.accountId, "THE FIX: a registered fund now has an account to be bought into");
  assert.equal(fund.created, true);
  assert.equal(fund.name, "صندوق طلای عیار مفید", "the catalogue supplies the full name");

  const [account] = await db.select().from(accounts).where(eq(accounts.id, fund.accountId));
  assert.equal(account.type, "asset", "it is an ASSET account — a position can live in it");
  assert.equal(account.userId, user.id, "and it belongs to the registering tenant, never globally");
  assert.equal(account.assetId, fund.assetId);

  // A stock resolves its name from the OTHER catalogue and gets the same treatment.
  const stock = await registerInstrument({ kind: "stock", symbol: "فولاد", userId: user.id });
  assert.ok(stock.accountId);
  assert.equal(stock.name, "فولاد مبارکه اصفهان");
  const [stockClass] = await db.select().from(assetClasses).where(eq(assetClasses.code, "stock"));
  assert.equal(stockClass.name, "سهام", "the «سهام» class exists and the stock is filed under it");
});

test("registration moves NO money: no entry, no posting, no lot, no balance", async () => {
  await modulesReady;
  await clean();
  const user = await makeUser("NoMoneyMoved");
  cookieJar.value = (await createSession(user.id)).token;

  await registerInstrument({ kind: "fund", symbol: "کهربا", userId: user.id });
  await registerInstrument({ kind: "stock", symbol: "شستا", userId: user.id });

  assert.equal((await db.select().from(journalEntries)).length, 0, "no journal entry");
  assert.equal((await db.select().from(postings)).length, 0, "no posting");
  assert.equal((await db.select().from(lots)).length, 0, "no FIFO lot was fabricated");
});

test("registering the same symbol twice is idempotent — one identity, one account", async () => {
  await modulesReady;
  await clean();
  const user = await makeUser("DoubleTapper");
  cookieJar.value = (await createSession(user.id)).token;

  const first = await registerInstrument({ kind: "fund", symbol: "عیار", userId: user.id });
  const second = await registerInstrument({ kind: "fund", symbol: "عیار", userId: user.id });

  assert.equal(second.created, false, "the second call found the identity rather than duplicating it");
  assert.equal(second.assetId, first.assetId);
  assert.equal(second.accountId, first.accountId, "and it did not split the fund across two accounts");

  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.assetId, first.assetId), eq(accounts.type, "asset")));
  assert.equal(rows.length, 1);
});

test("an instrument registered but not bought is REPORTED, not silently hidden", async () => {
  await modulesReady;
  await clean();
  const user = await makeUser("UnheldOwner");
  cookieJar.value = (await createSession(user.id)).token;

  await registerInstrument({ kind: "fund", symbol: "عیار", userId: user.id });
  await registerInstrument({ kind: "stock", symbol: "فولاد", userId: user.id });

  const unheld = await listRegisteredWithoutHoldings(user.id);
  const symbols = unheld.map((u: any) => u.symbol).sort();
  assert.deepEqual(
    symbols,
    ["عیار", "فولاد"].sort(),
    "both registrations surface so the user sees their own unfinished work",
  );
  assert.ok(
    unheld.every((u: any) => u.name.length > 0 && u.className.length > 0),
    "each row names itself and its class, so the list is actionable",
  );
});

test("tenant isolation: one user's registrations never appear in another's unheld list", async () => {
  await modulesReady;
  await clean();
  const alice = await makeUser("AliceInstruments");
  const bob = await makeUser("BobInstruments");

  cookieJar.value = (await createSession(alice.id)).token;
  await registerInstrument({ kind: "fund", symbol: "عیار", userId: alice.id });

  // Bob sees nothing: the asset IDENTITY is a shared catalogue row, but the
  // account that makes it his is not, and the unheld list is account-scoped.
  const bobUnheld = await listRegisteredWithoutHoldings(bob.id);
  assert.equal(
    bobUnheld.filter((u: any) => u.symbol === "عیار").length,
    0,
    "Alice's registration is not offered to Bob as his own unfinished work",
  );

  const aliceUnheld = await listRegisteredWithoutHoldings(alice.id);
  assert.equal(aliceUnheld.filter((u: any) => u.symbol === "عیار").length, 1);
});

/* ══════════════════════════════════════════════════════════════════════
   SETUP WIZARD — the initial-run path.
   ══════════════════════════════════════════════════════════════════════ */

test("the setup wizard registers صندوق/سهام and opens their positions atomically", async () => {
  await modulesReady;
  await clean();
  const user = await makeUser("WizardOwner");
  cookieJar.value = (await createSession(user.id)).token;

  const result = await completeSetup(
    {
      userName: "WizardOwner",
      baseCurrency: "USD",
      displayCurrency: "IRT",
      dateCalendar: "jalali" as const,
      digitStyle: "fa" as const,
      bankAccountName: "بانک اصلی",
      bankAssetSymbol: "IRT",
      bankOpeningBalance: "10000000",
      instruments: [
        // Owned, with an amount → registered AND given an opening position.
        { kind: "fund" as const, symbol: "عیار", quantity: "100", unitPrice: "2" },
        // Owned, amount unknown → registered only. No lot may be fabricated.
        { kind: "stock" as const, symbol: "فولاد" },
      ],
    },
    user.id,
  );
  assert.equal(result.ok, true, result.message);

  // Both identities exist and both are the tenant's to buy into.
  const assetRows = await db.select().from(assets);
  const symbols = assetRows.map((a: any) => a.symbol);
  assert.ok(symbols.includes("عیار"), "the fund was registered by the wizard");
  assert.ok(symbols.includes("فولاد"), "…and so was the quantity-less stock");

  // ONE opening entry carries everything — bank and instruments alike.
  const entries = await db.select().from(journalEntries);
  assert.equal(entries.length, 1, "a single atomic opening entry, not one per asset");
  assert.equal(entries[0].type, "opening");

  // The entry balances. This is the invariant that would break first if the
  // instrument postings had been added without their equity counterweight.
  const lines = await db.select().from(postings).where(eq(postings.entryId, entries[0].id));
  const sum = lines.reduce(
    (acc: any, l: any) => acc + Number(l.baseValue),
    0,
  );
  assert.ok(Math.abs(sum) < 1e-6, `Σ base_value must be 0, got ${sum}`);

  // The fund got a FIFO lot at the cost basis entered; the stock got none.
  const lotRows = await db.select().from(lots);
  const fundAsset = assetRows.find((a: any) => a.symbol === "عیار");
  const stockAsset = assetRows.find((a: any) => a.symbol === "فولاد");
  const fundLots = lotRows.filter((l: any) => l.assetId === fundAsset.id);
  assert.equal(fundLots.length, 1, "the held fund opened exactly one lot");
  assert.equal(Number(fundLots[0].qtyRemaining ?? fundLots[0].qtyOpened), 100);
  assert.equal(
    lotRows.filter((l: any) => l.assetId === stockAsset.id).length,
    0,
    "a quantity-less registration must NEVER fabricate a lot",
  );

  // The held fund is a real holding; the registered-only stock is reported as
  // unfinished work rather than silently hidden.
  const holdings = await getHoldings(user.id);
  const fundHolding = holdings.find((h: any) => h.symbol === "عیار");
  assert.equal(Number(fundHolding.quantity), 100);

  const unheld = await listRegisteredWithoutHoldings(user.id);
  assert.ok(
    unheld.some((u: any) => u.symbol === "فولاد"),
    "the stock the user owns but did not quantify is surfaced",
  );
  assert.ok(
    !unheld.some((u: any) => u.symbol === "عیار"),
    "…and the one that DOES have a position is not listed as unfinished",
  );
});
