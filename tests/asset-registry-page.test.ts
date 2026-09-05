/**
 * «دارایی واقعی و کالا» (/asset-registry) — «املاک من» render regression.
 *
 * THE BUG (2026-09-04)
 * --------------------
 * The page built its view model with a positional
 * `const [a, b, …] = await Promise.all([…])` whose destructuring order had
 * drifted ONE SLOT out of step with the query order:
 *
 *   payoutAccounts      ← getRealEstateDashboard()        (property LIST)
 *   realEstateDashboard ← getRealEstatePortfolioSummary() (totals OBJECT)
 *   realEstateSummary   ← listCities()
 *   cities              ← listNeighborhoods()
 *   neighborhoods       ← listPropertyTypes()
 *   propertyTypes       ← payoutAccounts
 *
 * So the real-estate module received the portfolio SUMMARY where it expected
 * the property LIST. Two visible failures:
 *   1. «املاک من» never rendered — `dashboard.length` was `undefined`, so the
 *      module always opened on the «ثبت ملک» tab, and the property totals
 *      strip (`summary.count > 0`) never appeared either.
 *   2. Clicking «املاک من» threw `dashboard.map is not a function`, which the
 *      route error boundary turned into the full-page card
 *      «مشکلی در نمایش این صفحه پیش آمد … داده‌های مالی شما در دفترکل امن‌اند».
 *
 * The fix loads the view model BY NAME (src/features/registry/loadAssetRegistryData)
 * and hardens the module against a wrong-shaped read model. This suite renders
 * the REAL server component against an isolated in-memory database with a real
 * session and locks both behaviours down.
 *
 * Presentation only — no ledger primitive is asserted or mutated beyond the
 * fixture setup below.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";

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

let db: any, createSchemaIfNotExists: any, schema: any;
let createSession: any;
let AssetRegistryPage: any;
let renderToReadableStream: any;
let createRealEstateAsset: any;
let seedRealEstateMasterData: any;
let RealEstateModule: any;

async function loadModules() {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  schema = await import("../src/db/schema");
  ({ createSession } = await import("../src/lib/auth"));
  ({ default: AssetRegistryPage } = await import("../src/app/asset-registry/page"));
  ({ renderToReadableStream } = await import("react-dom/server"));
  ({ createRealEstateAsset } = await import("../src/features/rwa/realEstate/service"));
  ({ seedRealEstateMasterData } = await import("../src/features/rwa/realEstate/masterData"));
  ({ default: RealEstateModule } = await import("../src/components/registry/realestate/RealEstateModule"));
}
const modulesReady = loadModules();

async function reset() {
  await createSchemaIfNotExists();
  await db.delete(schema.realEstateProperties);
  await db.delete(schema.realEstateValuationSnapshots ?? schema.realEstateProperties);
  await db.delete(schema.prices);
  await db.delete(schema.postings);
  await db.delete(schema.journalEntries);
  await db.delete(schema.assets);
  await db.delete(schema.assetClasses);
  await db.delete(schema.neighborhoods);
  await db.delete(schema.propertyTypes);
  await db.delete(schema.cities);
  await db.delete(schema.sessions);
  await db.delete(schema.users);
}

async function seedOwnerWithProperty() {
  await reset();
  await seedRealEstateMasterData();

  const [user] = await db
    .insert(schema.users)
    .values({ name: "مالک املاک", username: "amlak-owner", role: "owner" })
    .returning();
  sessionToken = (await createSession(user.id)).token;

  const [city] = await db.select().from(schema.cities).limit(1);
  const [hood] = await db.select().from(schema.neighborhoods).limit(1);
  const [type] = await db.select().from(schema.propertyTypes).limit(1);

  const property = await createRealEstateAsset({
    userId: user.id,
    cityId: city.id,
    neighborhoodId: hood.id,
    propertyTypeId: type.id,
    acquisitionDate: "2023-03-21",
    acquisitionDatePersian: "1402-01-01",
    valuationDate: "2025-03-21",
    valuationDatePersian: "1404-01-01",
    purchasePriceToman: "5000000000",
    currentValueToman: "9000000000",
  });

  return { user, city, hood, type, property };
}

async function renderPage(): Promise<string> {
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(createElement(AssetRegistryPage, {}), {
    onError(error: unknown) {
      errors.push(error);
    },
  });
  const html = await new Response(stream).text();
  assert.deepEqual(
    errors.map((e) => (e as Error)?.message ?? String(e)),
    [],
    "the asset-registry page must render without server errors",
  );
  return html;
}

test("«املاک من» renders the property list as the DEFAULT tab, with its totals", async () => {
  await modulesReady;
  const { property } = await seedOwnerWithProperty();

  const html = await renderPage();

  // 1. The tab strip: «املاک من» is the tab that is open.
  const tabStrip = html.slice(html.indexOf('aria-label="بخش املاک"'), html.indexOf('aria-label="بخش املاک"') + 600);
  assert.ok(tabStrip.includes("املاک من"), "the real-estate tab strip must render");
  assert.match(tabStrip, /class="seg-on" aria-pressed="true">املاک من/, "«املاک من» must be the active tab when the user has a property");

  // 2. The LIST table — this is what the positional mismatch used to hide.
  assert.ok(html.includes("قیمت خرید تومان"), "the property list table header must render");
  assert.ok(html.includes("ارزش فعلی دلار"), "the property list columns must render");
  const symbolFa = String(property.symbol).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
  assert.ok(html.includes(symbolFa), `the generated property id (${property.symbol}) must be listed`);

  // 3. The portfolio totals strip — driven by realEstateSummary.count.
  assert.ok(html.includes("مجموع ارزش املاک"), "the property totals must render (summary.count > 0)");
  assert.ok(html.includes("تعداد ملک"), "the property count metric must render");
  assert.ok(html.includes("۹٬۰۰۰٬۰۰۰٬۰۰۰"), "the total current value must be the stored Toman value");
  assert.ok(html.includes("۵٬۰۰۰٬۰۰۰٬۰۰۰"), "the total purchase value must be the stored Toman value");
});

test("the real-estate module degrades gracefully instead of crashing on a wrong-shaped read model", async () => {
  await modulesReady;
  await seedOwnerWithProperty();

  // The exact prop swap the bug produced: the summary OBJECT where the LIST
  // belongs, and the city list where the summary belongs.
  const summary = {
    count: 1,
    unvaluedCount: 0,
    totalCurrentToman: "9000000000",
    totalCurrentUsd: "47368.42",
    totalPurchaseToman: "5000000000",
    totalPurchaseUsd: "26315.79",
    totalGainToman: "4000000000",
    totalGainUsd: "21052.63",
    roiToman: "80.00",
    roiUsd: "80.00",
  };
  const cities = [{ id: "c1", nameFa: "اهواز", nameEn: "Ahvaz", code: "AHZ", isActive: true, sortOrder: 1 }];

  const errors: unknown[] = [];
  const stream = await renderToReadableStream(
    createElement(RealEstateModule, {
      dashboard: summary as any,
      summary: cities as any,
      cities: [],
      neighborhoods: [],
      propertyTypes: [],
      ownerName: "مالک",
      fxRate: "190000",
    }),
    { onError: (e: unknown) => errors.push(e) },
  );
  const html = await new Response(stream).text();

  assert.deepEqual(errors, [], "a wrong-shaped read model must never throw out of the module");
  assert.ok(html.includes("املاک من"), "the module must still render its shell");
  assert.ok(!html.includes("قیمت خرید تومان"), "with no list there is simply no table — no crash, no error page");
});
