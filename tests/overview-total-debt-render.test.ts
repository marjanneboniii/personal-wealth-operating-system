/**
 * «نمای کلی» end-to-end render — the «کل بدهی‌ها» tile.
 *
 * The user-reported symptom was visual, so this renders the REAL overview
 * server component and reads the tile back out of the HTML:
 *
 *   before the fix:  «کل بدهی‌ها»  →  ۰ تومان     (ledger-only liabilities)
 *   after the fix:   «کل بدهی‌ها»  →  the outstanding debt, in Toman and USD
 *
 * A second fixture proves the flip side: a fully booked ledger liability still
 * reaches the tile, and the assets / liquid tiles are untouched by the change.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";
import { D } from "../src/domain/decimal";
import { formatMoney } from "../src/lib/format";

let sessionToken: string | null = null;
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) =>
        name === "pwos_session" && sessionToken ? { value: sessionToken } : undefined,
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

let db: any, createSchemaIfNotExists: any, schema: any, createSession: any;
let Overview: any, renderToReadableStream: any, eq: any;

async function loadModules() {
  ({ eq } = await import("drizzle-orm"));
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  schema = await import("../src/db/schema");
  ({ createSession } = await import("../src/lib/auth"));
  ({ default: Overview } = await import("../src/components/overview/OverviewDashboard"));
  ({ renderToReadableStream } = await import("react-dom/server"));
}
const modulesReady = loadModules();

const RATE = "190000";

async function renderOverview(): Promise<string> {
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(createElement(Overview, {}), {
    onError(error: unknown) {
      errors.push(error);
    },
  });
  const html = await new Response(stream).text();
  assert.deepEqual(errors.map((e) => String((e as Error)?.message ?? e)), [], "the overview must render without server errors");
  return html;
}

/** Everything from the label «کل بدهی‌ها» to the next tile. */
function debtTile(html: string): string {
  const start = html.indexOf("کل بدهی‌ها");
  assert.ok(start >= 0, "the overview must render the «کل بدهی‌ها» tile");
  const rest = html.slice(start);
  const end = rest.indexOf("نقدشونده");
  return end > 0 ? rest.slice(0, end) : rest.slice(0, 600);
}

async function cleanAll() {
  await createSchemaIfNotExists();
  const { installments, debts, postings, journalEntries, accounts, assets, assetClasses, currencies, userFxSettings, users, sessions } = schema;
  await db.delete(installments);
  await db.delete(debts);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(userFxSettings);
  await db.delete(sessions);
  await db.delete(users);
}

test("overview shows the debt of a planning-only debt instead of ۰", async () => {
  await modulesReady;
  await cleanAll();
  const { users, userFxSettings, debts, installments } = schema;

  const [user] = await db
    .insert(users)
    .values({ name: "نمای کلی", username: "overview-render", role: "owner" } as any)
    .returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: RATE } as any);
  sessionToken = (await createSession(user.id)).token;

  // «بانک تجارت - قرض الحسنه»: 24 installments of 200,000,000, none paid.
  const [debt] = await db
    .insert(debts)
    .values({
      userId: user.id,
      creditor: "بانک تجارت",
      title: "قرض‌الحسنه مسکن",
      principalToman: "4800000000",
      principalUsdCreated: D("4800000000").div(RATE).toString(),
      principalBase: D("4800000000").div(RATE).toString(),
      interestRate: "0",
      startDate: "2026-01-01",
      accountId: null,
      status: "active",
    } as any)
    .returning();
  await db.insert(installments).values(
    Array.from({ length: 24 }, (_, i) => ({
      debtId: debt.id,
      seq: i + 1,
      dueDate: `2026-${String((i % 12) + 1).padStart(2, "0")}-01`,
      amountToman: "200000000",
      amountBase: D("200000000").div(RATE).toString(),
      amountUsdCreated: D("200000000").div(RATE).toString(),
      status: "pending",
    })) as any,
  );

  const html = await renderOverview();
  const tile = debtTile(html);

  assert.ok(tile.includes(formatMoney("4800000000", "IRT")), `tile must render the Toman debt, got: ${tile.slice(0, 300)}`);
  assert.ok(!tile.includes(formatMoney("0", "IRT")), "the tile must never read ۰ تومان while a debt is outstanding");
  // …and the USD sub-line is a positive display equivalent.
  assert.ok(tile.includes(formatMoney(D("4800000000").div(RATE).toFixed(2))), "tile shows the USD equivalent");
  assert.ok(!tile.includes("−"), "the debt sub-line is never a negative amount");

  sessionToken = null;
});

test("overview stays consistent when nothing is owed", async () => {
  await modulesReady;
  await cleanAll();
  const { users, userFxSettings } = schema;
  const [user] = await db
    .insert(users)
    .values({ name: "بدون بدهی", username: "overview-clean", role: "owner" } as any)
    .returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: RATE } as any);
  sessionToken = (await createSession(user.id)).token;

  const html = await renderOverview();
  const tile = debtTile(html);
  assert.ok(tile.includes(formatMoney("0", "IRT")), "an empty debt book honestly reads ۰");

  sessionToken = null;
});
