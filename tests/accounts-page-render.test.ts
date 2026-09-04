/**
 * «پول → حساب‌ها» (/accounts) render regression.
 *
 * The page used to pass `toIrt` — a FUNCTION — from the server component into
 * the `AccountListItem` client component. React cannot serialise functions
 * across the RSC boundary, so as soon as the user had one wallet the render
 * threw and the page showed the generic error card
 * («مشکلی در نمایش این صفحه پیش آمد … داده‌های مالی شما در دفترکل امن‌اند»).
 *
 * This test renders the REAL server component against an isolated in-memory
 * database with a real session and asserts that:
 *   • the page renders without throwing,
 *   • the account rows and their money strings are present,
 *   • the correct bank / currency logos are emitted.
 *
 * It only inspects presentation. No journal entry, posting, lot or balance is
 * created or modified beyond the fixture setup.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";

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

let db: any, createSchemaIfNotExists: any, schema: any;
let createSession: any, AccountsPage: any, renderToReadableStream: any;

async function loadModules() {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  schema = await import("../src/db/schema");
  ({ createSession } = await import("../src/lib/auth"));
  ({ default: AccountsPage } = await import("../src/app/accounts/page"));
  ({ renderToReadableStream } = await import("react-dom/server"));
}
const modulesReady = loadModules();

async function renderAccounts(): Promise<string> {
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(createElement(AccountsPage, {}), {
    onError(error: unknown) {
      errors.push(error);
    },
  });
  const html = await new Response(stream).text();
  assert.deepEqual(
    errors.map((e) => (e as Error)?.message ?? String(e)),
    [],
    "the accounts page must render without server errors",
  );
  return html;
}

test("/accounts renders money accounts without the RSC serialisation crash", async () => {
  await modulesReady;
  const { users, sessions, wallets, accounts, assets, assetClasses, currencies, institutions } = schema;

  await createSchemaIfNotExists();
  await db.delete(accounts);
  await db.delete(wallets);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(institutions);
  await db.delete(currencies);
  await db.delete(sessions);
  await db.delete(users);

  const [user] = await db
    .insert(users)
    .values({ name: "Logo Tester", username: "logo-accounts", role: "owner" })
    .returning();
  sessionToken = (await createSession(user.id)).token;

  const [irt] = await db
    .insert(currencies)
    .values({ code: "IRT", name: "تومان", symbol: "تومان", decimals: 0, isFiat: true })
    .returning();
  const [cashClass] = await db
    .insert(assetClasses)
    .values({ code: "cash", name: "نقد و بانک", color: "#6e6ff0", sortOrder: 1 })
    .returning();
  const [stableClass] = await db
    .insert(assetClasses)
    .values({ code: "stable", name: "استیبل‌کوین", color: "#9ea1f6", sortOrder: 2 })
    .returning();

  const [irtAsset] = await db
    .insert(assets)
    .values({ symbol: "IRT", name: "تومان", classId: cashClass.id, currencyId: irt.id, decimals: 0 })
    .returning();
  const [usdtAsset] = await db
    .insert(assets)
    .values({
      symbol: "USDT",
      name: "تتر",
      classId: stableClass.id,
      decimals: 6,
      pricingMethod: "coingecko",
      coingeckoId: "tether",
      logoUrl: "https://coin-images.coingecko.com/coins/images/325/large/Tether.png",
    })
    .returning();

  const [mellat] = await db
    .insert(institutions)
    .values({ kind: "bank", name: "بانک ملت", country: "IR" })
    .returning();
  const [bankWallet] = await db
    .insert(wallets)
    .values({ userId: user.id, name: "بانک ملت — جاری", kind: "bank", institutionId: mellat.id })
    .returning();
  const [exchangeWallet] = await db
    .insert(wallets)
    .values({ userId: user.id, name: "نوبیتکس", kind: "exchange" })
    .returning();

  await db.insert(accounts).values([
    { userId: user.id, code: "1010", name: "بانک ملت", type: "asset", assetId: irtAsset.id, walletId: bankWallet.id },
    { userId: user.id, code: "1100", name: "تتر نوبیتکس", type: "asset", assetId: usdtAsset.id, walletId: exchangeWallet.id },
  ]);

  const html = await renderAccounts();

  // The error boundary copy must be nowhere near this page.
  assert.ok(!html.includes("مشکلی در نمایش این صفحه پیش آمد"), "no generic render-error card");
  assert.ok(!html.includes("یک خطای غیرمنتظره رخ داد"), "no unexpected-error copy");

  // The real content rendered (front-end cleanup: single-account wallets
  // render as one summary card with full titles, no duplicate sub-row and
  // no «مانده اصلی» / «ارزش:» / «حساب» labels).
  assert.ok(html.includes("حساب‌ها"), "page title present");
  assert.ok(html.includes("بانک ملت"), "bank account row present");
  assert.ok(html.includes("نوبیتکس"), "exchange wallet present");
  assert.ok(html.includes("تتر"), "USDT amount unit present in Persian");
  assert.ok(!html.includes("مانده اصلی"), "redundant «مانده اصلی» label removed");
  assert.ok(!html.includes("مانده ارزش"), "redundant «مانده ارزش» label removed");
  assert.ok(!html.includes("ارزش:"), "redundant «ارزش:» prefix removed");
  // Full titles are never cut to «…» — the wallet name renders in full.
  assert.ok(html.includes("بانک ملت — جاری"), "wallet title renders in full");

  // Logos: PersianLabs bank mark + official Tether artwork from CoinGecko.
  assert.ok(html.includes("/ir-icons/banks/mellat.svg"), "Bank Mellat logo rendered");
  assert.ok(
    html.includes("coin-images.coingecko.com/coins/images/325/large/Tether.png"),
    "USDT row uses the official Tether logo",
  );

  sessionToken = null;
});
