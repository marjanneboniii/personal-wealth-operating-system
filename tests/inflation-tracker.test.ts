/**
 * ردیاب تورم شخصی (`/inflation`) — independent analytical module.
 *
 * LOCKED RULES (asserted here, must never regress):
 *
 *   1. MIGRATION SAFETY — 0012 is purely additive: legacy rows (no user_id,
 *      no region) survive and stay readable; new columns accept values.
 *   2. PER-USER ISOLATION — tenant A never sees tenant B's items/prices;
 *      both see shared (`user_id IS NULL`) legacy/catalog rows.
 *   3. GROWTH MATH — latest observation vs the nearest observation on/before
 *      (now − N days); no interpolation, no invented baselines. Worked
 *      example (the product scenario):
 *        برنج ایرانی — ۲۰۰٬۰۰۰ تومان (۶ ماه پیش) → ۲۸۰٬۰۰۰ تومان (امروز)
 *        ⇒ رشد ۶ ماهه دقیقاً ‎+40.00٪.
 *   4. FORM CONTRACT — a price observation is NOT a purchase: quantity is
 *      always 1, total == unit price, «تاریخ ثبت قیمت» is stored as the
 *      observation date, «منطقه یا شهر» is persisted.
 *   5. ACCOUNTING ISOLATION — the module never imports ledger / portfolio /
 *      valuation / accounting / FIFO / transaction code and never references
 *      their tables; the commodity tables hold no FK into the financial core.
 *   6. UI SEPARATION — `/inflation` renders the five tracker sections and
 *      never the real-asset workspace.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createElement } from "react";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const src = (p: string) => readFileSync(join(root, p), "utf-8");

/* ── static isolation guards (no DB needed) ─────────────────────────── */

const FORBIDDEN_IMPORTS = [
  "features/ledger",
  "features/portfolio",
  "features/valuation",
  "features/accounts",
  "domain/fifo",
  "domain/accounting",
  "app/actions/registry",
  "features/registry/loadAssetRegistryData",
];

const FORBIDDEN_TABLES = ["journal_entries", "postings", "lot_consumptions", '"lots"', "portfolio_valuations", "portfolio_snapshots"];

for (const file of [
  "src/features/inflation/service.ts",
  "src/features/inflation/constants.ts",
  "src/app/actions/inflation.ts",
  "src/app/inflation/page.tsx",
  "src/components/inflation/InflationTracker.tsx",
]) {
  test(`isolation: ${file} never touches accounting/portfolio/ledger code or tables`, () => {
    const body = src(file);
    for (const needle of [...FORBIDDEN_IMPORTS, ...FORBIDDEN_TABLES]) {
      assert.ok(!body.includes(needle), `${file} must not reference ${needle}`);
    }
  });
}

test("isolation: commodity tables hold no FK into the financial core", () => {
  const body = src("src/features/commodities/schema.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!body.includes("accounts"), "no FK to accounts");
  assert.ok(!body.includes("journal"), "no FK to journal_entries");
  assert.ok(!body.includes("postings"), "no FK to postings");
  assert.ok(!body.includes("lots"), "no FK to lots");
  assert.ok(!body.includes("assets"), "no FK to assets");
  // …but they do carry tenancy + region now.
  assert.ok(body.includes("user_id"), "tenancy column present");
  assert.ok(body.includes("region"), "region column present");
});

/* ── functional tests (isolated in-memory database) ─────────────────── */

let db: any;
let schema: any;
let createSchemaIfNotExists: any;
let ensureInflationModuleReady: any;
let listInflationItems: any;
let recordInflationPrice: any;
let getInflationHistory: any;
let getInflationDashboard: any;
let createSession: any;

async function loadModules() {
  ({ db } = await import("../src/db"));
  schema = await import("../src/db/schema");
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({
    ensureInflationModuleReady,
    listInflationItems,
    recordInflationPrice,
    getInflationHistory,
    getInflationDashboard,
  } = await import("../src/features/inflation/service"));
  ({ createSession } = await import("../src/lib/auth"));
}
const modulesReady = loadModules();

async function reset() {
  await modulesReady;
  await createSchemaIfNotExists();
  await db.delete(schema.commodityPriceRecords);
  await db.delete(schema.commodityItems);
  await db.delete(schema.commodityCategories);
  await db.delete(schema.sessions);
  await db.delete(schema.users);
}

async function seedUser(name: string, username: string) {
  const [user] = await db.insert(schema.users).values({ name, username, role: "user" }).returning();
  return user as { id: string };
}

const daysAgoIso = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

test("migration safety: legacy rows survive and stay readable; new columns work", async () => {
  await reset();
  // Legacy-style row: no user_id, no region (as written before 0012).
  const [cat] = await db.insert(schema.commodityCategories).values({ name: "لبنیات" }).returning();
  const [item] = await db
    .insert(schema.commodityItems)
    .values({ name: "شیر", categoryId: cat.id, defaultUnit: "لیتر" })
    .returning();
  await db.insert(schema.commodityPriceRecords).values({
    commodityId: item.id,
    unitPrice: "50000",
    unit: "لیتر",
    quantity: "2",
    totalAmount: "100000",
    purchasedAt: new Date("2025-01-01"),
  });

  const items = await listInflationItems(undefined);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "شیر");
  assert.equal(Number(items[0].latestPrice), 50000);

  // New columns accept values on the same tables.
  const user = await seedUser("کاربر", "user-legacy");
  const created = await recordInflationPrice(
    { itemName: "پنیر", unit: "کیلوگرم", unitPrice: "300000", region: "تهران", merchantName: "فروشگاه" },
    user.id,
  );
  const history = await getInflationHistory(created.commodityId, user.id);
  assert.equal(history[0].region, "تهران");
});

test("tenancy: tenants are isolated; shared rows stay visible to everyone", async () => {
  await reset();
  const seed = await import("../src/features/commodities/service");
  const a = await seedUser("الف", "user-a");
  const b = await seedUser("ب", "user-b");

  await recordInflationPrice({ itemName: "برنج ایرانی", unit: "کیلوگرم", unitPrice: "200000" }, a.id);

  const seenByA = await listInflationItems(a.id);
  const seenByB = await listInflationItems(b.id);
  assert.ok(seenByA.some((x: any) => x.name === "برنج ایرانی"), "owner sees own item");
  assert.ok(!seenByB.some((x: any) => x.name === "برنج ایرانی"), "other tenant must not see it");

  // Same label may exist once per tenant (no cross-tenant unique clash).
  await recordInflationPrice({ itemName: "برنج ایرانی", unit: "کیلوگرم", unitPrice: "210000" }, b.id);
  const seenByB2 = await listInflationItems(b.id);
  assert.ok(seenByB2.some((x: any) => x.name === "برنج ایرانی"), "second tenant owns the same label");

  // Shared (legacy NULL) rows are visible to every tenant.
  await db.insert(schema.commodityItems).values({ name: "روغن", defaultUnit: "لیتر" });
  assert.ok((await listInflationItems(a.id)).some((x: any) => x.name === "روغن"));
  assert.ok((await listInflationItems(b.id)).some((x: any) => x.name === "روغن"));

  // Suggested catalog seeds idempotently as shared rows.
  await ensureInflationModuleReady();
  await ensureInflationModuleReady();
  const cats = await seed.commodityAnalyticsService.listCategories(a.id);
  for (const name of ["مواد غذایی", "پروتئین", "لبنیات", "حبوبات", "نان و غلات", "روغن", "شوینده و بهداشتی", "سایر"]) {
    assert.ok(cats.some((c: any) => c.name === name), `catalog contains ${name}`);
  }
});

test("growth math: 200,000 → 280,000 over six months is exactly +40.00%", async () => {
  await reset();
  const user = await seedUser("کاربر", "user-growth");

  const first = await recordInflationPrice(
    { itemName: "برنج ایرانی", unit: "کیلوگرم", unitPrice: "200000", recordedAt: daysAgoIso(185) },
    user.id,
  );
  await recordInflationPrice(
    { commodityId: first.commodityId, unit: "کیلوگرم", unitPrice: "280000", recordedAt: new Date().toISOString() },
    user.id,
  );

  // A second item observed only today: every window baseline must stay null.
  await recordInflationPrice(
    { itemName: "گوشت", unit: "کیلوگرم", unitPrice: "800000", recordedAt: new Date().toISOString() },
    user.id,
  );

  const dashboard = await getInflationDashboard(user.id);
  assert.equal(dashboard.totalItems, 2);
  assert.equal(dashboard.headline.key, "6m");
  assert.equal(dashboard.headline.growthPercent, "40.00");
  assert.equal(dashboard.topRisers[0].name, "برنج ایرانی");
  assert.equal(dashboard.topRisers[0].growth["6m"], "40.00");
  const byName = Object.fromEntries(dashboard.items.map((x: any) => [x.name, x]));
  // The old observation doubles as the baseline of every window it covers.
  assert.equal(byName["برنج ایرانی"].growth["1m"], "40.00");
  assert.equal(byName["برنج ایرانی"].growth["3m"], "40.00");
  assert.equal(byName["برنج ایرانی"].growth["6m"], "40.00");
  // 185 days of history cannot cover the 12-month window — null, never invented.
  assert.equal(byName["برنج ایرانی"].growth["12m"], null);
  // گوشت has no observation on/before any cutoff — null, never invented.
  for (const key of ["1m", "3m", "6m", "12m"]) {
    assert.equal(byName["گوشت"].growth[key], null);
  }
});

test("form contract: observation defaults (qty 1, total = unit price, recordedAt, region)", async () => {
  await reset();
  const user = await seedUser("کاربر", "user-contract");
  const at = daysAgoIso(10);
  const { commodityId } = await recordInflationPrice(
    {
      itemName: "تخم مرغ",
      unit: "عدد",
      unitPrice: "5000",
      recordedAt: at,
      merchantName: "بازار",
      region: "اصفهان",
      notes: "شانه‌ای",
    },
    user.id,
  );
  const [row] = await db
    .select()
    .from(schema.commodityPriceRecords)
    .where((await import("drizzle-orm")).eq(schema.commodityPriceRecords.commodityId, commodityId));
  assert.equal(Number(row.quantity), 1);
  assert.equal(Number(row.totalAmount), 5000);
  assert.equal(row.region, "اصفهان");
  assert.equal(row.merchantName, "بازار");
  assert.ok(Math.abs(new Date(row.purchasedAt).getTime() - new Date(at).getTime()) < 1000);
});

/* ── page render (real server component, isolated DB, real session) ──── */

let sessionToken: string | null = null;
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) => (name === "pwos_session" && sessionToken ? { value: sessionToken } : undefined),
      set: () => {},
      delete: () => {},
    }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("next/navigation", {
  namedExports: {
    redirect: (url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    },
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  },
});

let InflationPage: any;
let renderToReadableStream: any;

async function loadPageModules() {
  await modulesReady;
  ({ default: InflationPage } = await import("../src/app/inflation/page"));
  ({ renderToReadableStream } = await import("react-dom/server"));
}
const pageReady = loadPageModules();

test("«ردیاب تورم شخصی» renders its five sections and never the real-asset workspace", async () => {
  await pageReady;
  await reset();
  const user = await seedUser("کاربر تورم", "inflation-owner");
  sessionToken = (await createSession(user.id)).token;
  await recordInflationPrice(
    { itemName: "برنج ایرانی", unit: "کیلوگرم", unitPrice: "200000", recordedAt: daysAgoIso(185) },
    user.id,
  );
  await recordInflationPrice({ itemName: "گوشت", unit: "کیلوگرم", unitPrice: "800000" }, user.id);

  const errors: unknown[] = [];
  const stream = await renderToReadableStream(createElement(InflationPage, {}), {
    onError(error: unknown) {
      errors.push(error);
    },
  });
  const html = await new Response(stream).text();
  assert.deepEqual(
    errors.map((e) => (e as Error)?.message ?? String(e)),
    [],
    "the inflation page must render without server errors",
  );
  for (const label of [
    "ردیاب تورم شخصی",
    "کالاهای من",
    "ثبت قیمت جدید",
    "تاریخچه قیمت",
    "تحلیل تورم",
    "مقایسه رشد کالاها",
    "تورم سبد کالا",
    "برنج ایرانی",
  ]) {
    assert.ok(html.includes(label), `page must contain «${label}»`);
  }
  assert.ok(!html.includes("املاک من"), "the real-asset workspace must not render here");
  assert.ok(!html.includes("تعداد / وزن"), "warehouse-style quantity must be gone from the form");
  assert.ok(!html.includes("تاریخ خرید"), "purchase-date semantics must be gone from the form");
});
