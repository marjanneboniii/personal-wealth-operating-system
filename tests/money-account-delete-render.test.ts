/**
 * «حذف حساب» — the control is actually reachable on «پول → حساب‌ها».
 *
 * The service is covered by `money-account-delete.test.ts`. This file renders
 * the REAL /accounts server component against an isolated database and asserts
 * that a user who registered an account can SEE the delete affordance for it —
 * both on a one-account wallet row and on a sub-row inside a wallet that holds
 * several accounts — and that it is labelled for a screen reader.
 *
 * Presentation only: nothing here posts, voids or edits a ledger row.
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
let createSession: any, AccountsPage: any, renderToReadableStream: any;
let registerMoneyAccount: any, listMoneyAccountCurrencies: any;

async function loadModules() {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  schema = await import("../src/db/schema");
  ({ createSession } = await import("../src/lib/auth"));
  ({ registerMoneyAccount, listMoneyAccountCurrencies } = await import("../src/features/accounts/service"));
  ({ default: AccountsPage } = await import("../src/app/accounts/page"));
  ({ renderToReadableStream } = await import("react-dom/server"));
}
const modulesReady = loadModules();

async function renderAccounts(): Promise<string> {
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(createElement(AccountsPage as any, {}), {
    onError: (e: unknown) => {
      errors.push(e);
    },
  });
  await stream.allReady;
  const html = await new Response(stream).text();
  if (errors.length) throw errors[0];
  return html;
}

async function setup() {
  await modulesReady;
  await createSchemaIfNotExists();
  const {
    accounts,
    assets,
    assetClasses,
    currencies,
    exchangeRates,
    journalEntries,
    lotConsumptions,
    lots,
    postings,
    prices,
    sessions,
    settings,
    userFxSettings,
    userSetupState,
    users,
    wallets,
  } = schema;
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(wallets);
  await db.delete(prices);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(sessions);
  await db.delete(userSetupState);
  await db.delete(userFxSettings);
  await db.delete(exchangeRates);
  await db.delete(settings);
  await db.delete(users);
  await db.delete(currencies);

  const [user] = await db.insert(users).values({ name: "مالک", role: "owner" }).returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "100000" });
  // /accounts is behind the setup gate; this tenant has finished onboarding.
  await db.insert(userSetupState).values({ userId: user.id, completed: true, currentStep: 9 });
  sessionToken = (await createSession(user.id)).token;

  const currencyRows = await listMoneyAccountCurrencies();
  return { user, currencies: currencyRows };
}

test("a registered account shows «حذف حساب» on its wallet row", async () => {
  const fx = await setup();
  const irt = fx.currencies.find((c: any) => c.symbol === "IRT");
  await registerMoneyAccount({
    name: "بانک سامان",
    kind: "bank",
    assetId: irt.id,
    openingQty: "50000000",
    userId: fx.user.id,
  });

  const html = await renderAccounts();
  assert.match(html, /بانک سامان/);
  assert.match(html, /aria-label="حذف حساب بانک سامان"/);
});

test("each account inside a multi-account wallet gets its own delete control", async () => {
  const fx = await setup();
  const irt = fx.currencies.find((c: any) => c.symbol === "IRT");
  const usdt = fx.currencies.find((c: any) => c.symbol === "USDT");
  const first = await registerMoneyAccount({
    name: "تتر - نوبیتکس",
    kind: "exchange",
    assetId: usdt.id,
    openingQty: "800",
    userId: fx.user.id,
  });
  // A second account sharing the SAME wallet renders as a sub-row.
  const { accounts } = schema;
  await db
    .insert(accounts)
    .values({
      userId: fx.user.id,
      code: "1777",
      name: "تومان - نوبیتکس",
      type: "asset",
      assetId: irt.id,
      walletId: first.walletId,
    })
    .returning();

  const html = await renderAccounts();
  assert.match(html, /aria-label="حذف حساب تتر - نوبیتکس"/);
  assert.match(html, /aria-label="حذف حساب تومان - نوبیتکس"/);
});

test("the chart backbone carries no delete control", async () => {
  const fx = await setup();
  const irt = fx.currencies.find((c: any) => c.symbol === "IRT");
  await registerMoneyAccount({
    name: "صندوق خانه",
    kind: "cash",
    assetId: irt.id,
    openingQty: "1000000",
    userId: fx.user.id,
  });

  const html = await renderAccounts();
  // 3010 «سرمایه افتتاحیه» is provisioned by the opening entry above; it is
  // ledger infrastructure and must never be offered for deletion.
  assert.doesNotMatch(html, /aria-label="حذف حساب سرمایه افتتاحیه"/);
  assert.match(html, /aria-label="حذف حساب صندوق خانه"/);
});
