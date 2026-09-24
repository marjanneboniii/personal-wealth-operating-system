/**
 * Render regression for the pages added from the «آپ» review: /accounts/reconcile,
 * /insurance and the new alerts on /insights.
 *
 * Renders the REAL server components (and their client children) against an
 * in-memory database with a real session: no server error, no function crossing
 * the RSC boundary, and the figures a user acts on are present.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";

let sessionToken: string | null = null;
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({ get: (name: string) => (name === "pwos_session" && sessionToken ? { value: sessionToken } : undefined), set: () => {}, delete: () => {} }),
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
    usePathname: () => "/",
  },
});

async function render(Page: any, props: Record<string, unknown> = {}): Promise<string> {
  const { renderToReadableStream } = await import("react-dom/server");
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(createElement(Page, props), { onError: (e: unknown) => void errors.push(e) });
  const html = await new Response(stream).text();
  assert.deepEqual(errors.map((e) => (e as Error)?.message ?? String(e)), [], "renders without server errors");
  return html;
}

test("reconcile, insurance and insights pages render with real data", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const schema = await import("../src/db/schema");
  const { createSession } = await import("../src/lib/auth");
  const { recordBalanceCheckpoint } = await import("../src/features/reconcile/service");
  const { createPolicy } = await import("../src/features/insurance/service");
  const { todayIso } = await import("../src/lib/format");
  await createSchemaIfNotExists();

  const { users, userFxSettings, assetClasses, assets, accounts, vehicleAssets, userSetupState } = schema;
  const [u] = await db.insert(users).values({ name: "Render", username: `render-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
  await db.insert(userFxSettings).values({ userId: u.id, currentRate: "100000" } as any);
  await db.insert(userSetupState).values({ userId: u.id, completed: true, currentStep: 7 } as any);
  const [cash] = await db.insert(assetClasses).values({ code: "cash", name: "نقد" } as any).returning();
  const [rwa] = await db.insert(assetClasses).values({ code: "vehicle", name: "خودرو" } as any).returning();
  await db.insert(assets).values({ symbol: "USD", name: "دلار", classId: cash.id, decimals: 2 } as any);
  const [irt] = await db.insert(assets).values({ symbol: "IRT", name: "تومان", classId: cash.id, decimals: 0 } as any).returning();
  const [bank] = await db.insert(accounts).values({ userId: u.id, code: "1010", name: "بانک ملت", type: "asset", assetId: irt.id } as any).returning();
  const [carAsset] = await db.insert(assets).values({ symbol: `CAR-R-${Math.random().toString(36).slice(2, 6)}`, name: "پراید", classId: rwa.id, decimals: 0 } as any).returning();
  await db.insert(vehicleAssets).values({ assetId: carAsset.id, userId: u.id, brand: "سایپا", model: "پراید", year: 1398 } as any);
  sessionToken = (await createSession(u.id)).token;
  const today = todayIso();

  await recordBalanceCheckpoint({ userId: u.id, accountId: bank.id, asOf: today, balance: "1250000", source: "manual" });
  await createPolicy(u.id, { kind: "fire", title: "آتش‌سوزی منزل", startDate: today, endDate: addDays(today, 20), premiumToman: "900000", premiumFrequency: "annual", payAccountId: bank.id });

  const { default: ReconcilePage } = await import("../src/app/accounts/reconcile/page");
  const reconcile = await render(ReconcilePage);
  assert.match(reconcile, /تطبیق با بانک/);
  assert.match(reconcile, /بانک ملت/);
  assert.match(reconcile, /اختلاف با بانک/, "the mismatch is shown");
  assert.match(reconcile, /ثبت تراکنش جاافتاده/, "and the way to resolve it");
  assert.match(reconcile, /type=income/, "the bank holds more → a missed income");

  const { default: InsurancePage } = await import("../src/app/insurance/page");
  const insurance = await render(InsurancePage, { searchParams: Promise.resolve({}) });
  assert.match(insurance, /آتش‌سوزی منزل/);
  assert.match(insurance, /پراید بیمه‌ی شخص ثالث فعال ندارد/, "the coverage gap is shown");
  assert.match(insurance, /پرداخت حق بیمه/);
  assert.match(insurance, /planId=/, "the premium is paid from its reminder");

  const { default: InsightsPage } = await import("../src/app/insights/page");
  const insights = await render(InsightsPage);
  assert.match(insights, /با بانک یکی نیست/);
  assert.match(insights, /بیمه‌ی شخص ثالث فعال ندارد/);

  const { default: VehiclesPage } = await import("../src/app/vehicles/page");
  const vehiclesHtml = await render(VehiclesPage);
  assert.match(vehiclesHtml, /سایپا پراید/);
  assert.match(vehiclesHtml, /ثالث ثبت نشده/, "the missing third-party cover is visible on the car");
  assert.match(vehiclesHtml, /#سایپا_پراید/, "costs are filed under the car's tag");

  const { default: RecurringPage } = await import("../src/app/recurring/page");
  const recurringHtml = await render(RecurringPage);
  assert.match(recurringHtml, /آتش‌سوزی منزل/, "premiums are part of the fixed monthly outflow");

  const { default: OverviewDashboard } = await import("../src/components/overview/OverviewDashboard");
  const home = await render(OverviewDashboard);
  assert.doesNotMatch(home, /بخشی از داده‌ها بارگذاری نشد/, "every home widget loads — none silently failed");
  assert.match(home, /پوشش داده/, "the coverage strip is shown while something is missing");
  assert.match(home, /\/insights#data-coverage/);

  const { default: PropertiesPage } = await import("../src/app/properties/page");
  assert.match(await render(PropertiesPage), /درآمد و هزینه‌ی املاک/);

  const { default: AccountsPage } = await import("../src/app/accounts/page");
  const accountsHtml = await render(AccountsPage);
  assert.match(accountsHtml, /\/accounts\/reconcile/, "the accounts page links to reconciliation");
});

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
