/**
 * Cash Flow page — END-TO-END freeze verification against the user's exact
 * screenshot data (rendered through the REAL page component + REAL read
 * queries on an in-memory DB — no data-layer mocks).
 *
 * Screenshot scenario (rate had risen 210,000 → 220,000 IRT/USD):
 *   • لوازم و تجهیزات منزل: recorded 80,000,000 Toman (≈380.95 USD)
 *     — buggy UI showed 83,809,524 Toman
 *   • خریدهای متفرقه: 15,000,000 Toman (≈71.43) — buggy: 15,714,286
 *   • هدیه: 12,000,000 Toman (≈57.14) — buggy: 12,571,429
 *   • تعویض روغن: 4,000,000 Toman recorded AT the new 220,000 rate
 *
 * After the fix the rendered page must show the FROZEN recorded Toman
 * (80M / 15M / 12M / 4M) with the live «≈ USD» hints — and must NEVER
 * contain the current-rate re-derivations.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assetClasses,
  assets,
  currencies,
  entryFxSnapshots,
  exchangeRates,
  expenseCategories,
  journalEntries,
  lotConsumptions,
  lots,
  postings,
  prices,
  users,
} from "../src/db/schema";
import { ensureCategoryCatalog, getCategoryByCode } from "../src/features/categories/service";
import { postEntry, recordExpense } from "../src/features/ledger/service";
import { D } from "../src/domain/decimal";
import { formatMoney, todayIso } from "../src/lib/format";

/* ── Mock ONLY the web-boundary modules (auth guard, seed, next/link,
     next/headers cookie access) — the entire DB + query stack is REAL. ── */
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
    headers: async () => new Headers(),
  },
});
mock.module("next/link", {
  defaultExport: (props: any) => React.createElement("a", { href: props.href, className: props.className }, props.children),
});
mock.module("@/lib/authGuard", { namedExports: { ensureAuth: async () => ({ id: "demo", name: "کاربر نمونه" }) } });
mock.module("@/db/seed", { namedExports: { seedIfEmpty: async () => {} } });

const OLD_RATE = "210000";
const NEW_RATE = "220000";

async function fixture() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(entryFxSnapshots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(expenseCategories);
  await db.delete(accounts);
  await db.delete(prices);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(users);
  await db.delete(exchangeRates);
  await ensureCategoryCatalog();

  const [user] = await db.insert(users).values({ name: "کاربر نمونه", role: "user" }).returning();
  const [cur] = await db
    .insert(currencies)
    .values({ code: "USD", name: "دلار آمریکا", symbol: "$", decimals: 2, isFiat: true })
    .returning();
  const [cls] = await db.insert(assetClasses).values({ code: "cash", name: "نقد و بانک", color: "#6e6ff0" }).returning();
  const [usd] = await db
    .insert(assets)
    .values({ symbol: "USD", name: "دلار", classId: cls.id, currencyId: cur.id, decimals: 2 })
    .returning();
  await db.insert(prices).values({ assetId: usd.id, asOf: todayIso(), priceBase: "1", source: "manual" });

  const [bank] = await db.insert(accounts).values({ userId: user.id, code: "1010", name: "بانک", type: "asset", assetId: usd.id }).returning();
  const [expAcct] = await db.insert(accounts).values({ userId: user.id, code: "5010", name: "هزینه", type: "expense", assetId: usd.id }).returning();
  const [equity] = await db.insert(accounts).values({ userId: user.id, code: "3010", name: "سرمایه", type: "equity", assetId: usd.id }).returning();

  const freeze = (entryId: string, irt: string, rate: string) =>
    db.insert(entryFxSnapshots).values({
      entryId,
      irtAmount: irt,
      usdAmount: D(irt).div(rate).toString(),
      fxRate: rate,
      rateSource: "settings",
      rateDate: todayIso(),
    });

  const spend = async (description: string, irt: string, categoryId: string, rate: string) => {
    const usdAmount = D(irt).div(rate).toString();
    const entry = await recordExpense({
      entryDate: todayIso(),
      description,
      cashAccountId: bank.id,
      categoryAccountId: expAcct.id,
      assetId: usd.id,
      quantity: usdAmount,
      baseValue: usdAmount,
      categoryId,
      userId: user.id,
    });
    await freeze(entry.id, irt, rate);
  };

  // Opening cash (balanced entry — never counted as income/expense)
  await postEntry({
    entryDate: todayIso(),
    type: "opening",
    description: "افتتاحیه",
    userId: user.id,
    postings: [
      { accountId: bank.id, assetId: usd.id, quantity: "1000000", baseValue: "1000000" },
      { accountId: equity.id, assetId: usd.id, quantity: "-1000000", baseValue: "-1000000" },
    ],
  });

  // The exact four recorded expenses from the screenshot
  await spend("خرید کولر ۱۲ هزار ایوولی", "80000000", (await getCategoryByCode("HSG-EQUIP"))!.id, OLD_RATE);
  await spend("خریدهای متفرقه", "15000000", (await getCategoryByCode("MSC-MISC"))!.id, OLD_RATE);
  await spend("کادوی عروسی", "12000000", (await getCategoryByCode("SOC-GIFT"))!.id, OLD_RATE);
  await spend("تعویض روغن", "4000000", (await getCategoryByCode("TRN-OIL"))!.id, NEW_RATE);

  // Current market rate = 220,000 (the rate that triggered the bug)
  await db.insert(exchangeRates).values({
    baseCurrency: "USD",
    quoteCurrency: "IRT",
    rate: NEW_RATE,
    source: "manual",
    effectiveDate: todayIso(),
  });

  return { user };
}

test("Cash Flow page renders FROZEN recorded Toman after the rate rose 210k → 220k", async () => {
  await fixture();

  const Page = (await import("../src/app/cash-flow/page")).default;
  const html = renderToStaticMarkup(await Page());

  // Expected display strings are produced by the app's own money SSOT
  // (formatMoney) so the assertion pins the NUMERIC value, not a hand-typed
  // Persian-digit spelling.
  const irt = (v: string) => formatMoney(v, "IRT");
  const usd = (v: string) => formatMoney(v, "USD");

  // ── FROZEN recorded Toman — exactly what the user typed ─────────────
  assert.ok(html.includes(irt("80000000")), "frozen 80,000,000 Toman (cool) rendered");
  assert.ok(html.includes(irt("15000000")), "frozen 15,000,000 Toman (misc) rendered");
  assert.ok(html.includes(irt("12000000")), "frozen 12,000,000 Toman (gift) rendered");
  assert.ok(html.includes(irt("4000000")), "frozen 4,000,000 Toman (oil change) rendered");
  assert.ok(html.includes(irt("111000000")), "frozen total 111,000,000 Toman (80+15+12+4) rendered");

  // ── The buggy current-rate re-derivations must NOT appear ───────────
  assert.ok(!html.includes(irt("83809524")), "bug value 83,809,524 Toman absent");
  assert.ok(!html.includes(irt("15714286")), "bug value 15,714,286 Toman absent");
  assert.ok(!html.includes(irt("12571429")), "bug value 12,571,429 Toman absent");
  assert.ok(!html.includes(irt("4190476")), "bug value 4,190,476 Toman absent");

  // ── Dynamic «≈ USD» hints are still correct (USD book values) ───────
  assert.ok(html.includes(usd("380.95")), "USD hint 380.95");
  assert.ok(html.includes(usd("71.43")), "USD hint 71.43");
  assert.ok(html.includes(usd("57.14")), "USD hint 57.14");
  assert.ok(html.includes(usd("18.18")), "USD hint 18.18");

  // ── The live rate is shown only as the normalization note ───────────
  assert.ok(html.includes(irt("220000")), "current rate 220,000 in the footer");
});
