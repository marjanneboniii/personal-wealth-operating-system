/**
 * Regression — «افتتاحیه — ثبت موجودی اولیه» headline showed ONLY the cash leg.
 *
 * User report: the opening registration carried «اتریوم ۳٫۳۳ واحد + ۱۴۵۶ تتر +
 * ۶٬۰۰۰٬۰۰۰ تومان نقد», yet the app displayed only «۶٬۰۰۰٬۰۰۰ تومان».
 *
 * Root cause: humanizeEntry() took the entry's FIRST IRT leg as the entry's
 * whole Toman amount. For a multi-asset opening entry (cash Toman + Tether +
 * Ethereum balanced against opening equity in USD) that leg is just one
 * component, so the Ethereum and Tether value disappeared from the headline.
 *
 * Fix: a native Toman figure is produced only when Toman is the WHOLE side of
 * the entry (every positive leg, or every negative leg, is IRT/IRR) — the
 * Toman that actually moved. Multi-asset entries fall back to the full
 * base-currency total (UI converts with an «≈» marker). Frozen real-estate
 * purchase Toman and commit-time FX snapshots keep their priority for the
 * entries they belong to.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  exchangeRates,
  journalEntries,
  lotConsumptions,
  lots,
  postings,
  settings,
  userFxSettings,
  userSetupState,
  users,
  accounts,
} from "../src/db/schema";
import { completeSetup } from "../src/features/setup/service";
import { getLedger } from "../src/features/ledger/queries";
import { humanizeEntry } from "../src/lib/tx";
import { D } from "../src/domain/decimal";

type Line = {
  account: string;
  accountType: string;
  symbol: string;
  quantity: string;
  baseValue: string;
  decimals: number;
  memo: string | null;
};

function line(partial: Partial<Line> & Pick<Line, "symbol" | "quantity" | "baseValue">): Line {
  return {
    account: "حساب",
    accountType: "asset",
    decimals: 2,
    memo: null,
    ...partial,
  };
}

function ledgerRow(lines: Line[], extra: Record<string, unknown> = {}) {
  return {
    id: "e1",
    entryDate: "2026-08-25",
    type: "opening",
    description: "افتتاحیه — ثبت موجودی اولیه حساب‌ها",
    status: "posted",
    source: "manual",
    lines,
    ...extra,
  } as never;
}

/* ────────────────────────── unit: the reported entry ────────────────────── */

test("opening entry with «۳٫۳۳ اتریوم + ۱۴۵۶ تتر + ۶٬۰۰۰٬۰۰۰ تومان» is NOT reduced to the cash leg", () => {
  // Exactly the shape the setup wizard posts: ETH leg (3.33 × 3000 = 9,990 USD),
  // USDT leg 1456, native Toman cash leg 6,000,000 (≈ 60 USD at 100,000),
  // balanced by USD opening equity.
  const h = humanizeEntry(
    ledgerRow([
      line({ account: "کیف رمزارز (ETH)", symbol: "ETH", quantity: "3.33", baseValue: "9990", decimals: 8 }),
      line({ account: "صرافی — تتر", symbol: "USDT", quantity: "1456", baseValue: "1456", decimals: 6 }),
      line({ account: "صندوق خانگی", symbol: "IRT", quantity: "6000000", baseValue: "60", decimals: 0 }),
      line({ account: "سرمایه افتتاحیه", accountType: "equity", symbol: "USD", quantity: "-11506", baseValue: "-11506" }),
    ]),
  );
  // The bug: nativeIrt was "6000000" — only the cash component. The full entry
  // is 11,506 USD ≈ 1,150,600,000 Toman; the UI must fall back to that total.
  assert.notEqual(h.nativeIrt, "6000000", "a lone Toman leg is one component, not the entry amount");
  assert.equal(h.nativeIrt, null, "no native Toman side exists → full base total is shown with «≈»");
  assert.equal(D(h.amountExact).toFixed(2), "11506.00", "Ethereum + Tether + cash all count");
  assert.ok(h.qtyLabel?.includes("اتریوم"), "the Ethereum quantity is surfaced (in Persian, per the UI standard)");
});

test("mixed entries never hide non-Toman assets (seed-style opening: several Toman banks + Tether)", () => {
  const h = humanizeEntry(
    ledgerRow([
      line({ symbol: "IRT", quantity: "1200000000", baseValue: "12000", decimals: 0 }),
      line({ symbol: "IRT", quantity: "450000000", baseValue: "4500", decimals: 0 }),
      line({ symbol: "USDT", quantity: "8000", baseValue: "8000", decimals: 6 }),
      line({ accountType: "equity", symbol: "USD", quantity: "-24500", baseValue: "-24500" }),
    ]),
  );
  assert.equal(h.nativeIrt, null, "even a mostly-Toman entry must not drop the Tether component");
  assert.equal(D(h.amountExact).toFixed(2), "24500.00");
});

/* ─────────────────── unit: behaviour that must NOT change ───────────────── */

test("a plain Toman expense still displays its exact frozen Toman", () => {
  const h = humanizeEntry(
    ledgerRow([
      line({ account: "خوراک و خانه", accountType: "expense", symbol: "IRT", quantity: "6000000", baseValue: "60", decimals: 0 }),
      line({ account: "حساب بانکی", symbol: "IRT", quantity: "-6000000", baseValue: "-60", decimals: 0 }),
    ], { type: "expense" }),
  );
  assert.equal(h.nativeIrt, "6000000");
});

test("a split Toman expense sums ALL category legs (no partial first-leg display)", () => {
  const h = humanizeEntry(
    ledgerRow([
      line({ account: "خوراک", accountType: "expense", symbol: "IRT", quantity: "6000000", baseValue: "60", decimals: 0 }),
      line({ account: "مسکن", accountType: "expense", symbol: "IRT", quantity: "4000000", baseValue: "40", decimals: 0 }),
      line({ account: "حساب بانکی", symbol: "IRT", quantity: "-10000000", baseValue: "-100", decimals: 0 }),
    ], { type: "expense" }),
  );
  assert.equal(h.nativeIrt, "10000000");
});

test("a Toman-paid crypto buy keeps the full Toman outflow as headline", () => {
  const h = humanizeEntry(
    ledgerRow([
      line({ account: "کیف رمزارز (ETH)", symbol: "ETH", quantity: "3.33", baseValue: "9990", decimals: 8 }),
      line({ account: "حساب بانکی", symbol: "IRT", quantity: "-999000000", baseValue: "-9990", decimals: 0 }),
    ], { type: "buy" }),
  );
  // The negative side is wholly Toman → that IS what the purchase cost.
  assert.equal(h.nativeIrt, "999000000");
});

test("an IRT→USDT conversion keeps the frozen Toman that left", () => {
  const h = humanizeEntry(
    ledgerRow([
      line({ account: "صرافی", symbol: "USDT", quantity: "1900", baseValue: "1900", decimals: 6 }),
      line({ account: "حساب بانکی", symbol: "IRT", quantity: "-361000000", baseValue: "-1900", decimals: 0 }),
    ], { type: "fx" }),
  );
  assert.equal(h.nativeIrt, "361000000");
});

test("Rial legs are normalised to Toman on a fully-Rial side", () => {
  const h = humanizeEntry(
    ledgerRow([
      line({ account: "هزینه", accountType: "expense", symbol: "IRR", quantity: "50000000", baseValue: "50", decimals: 0 }),
      line({ account: "حساب بانکی", symbol: "IRR", quantity: "-50000000", baseValue: "-50", decimals: 0 }),
    ], { type: "expense" }),
  );
  assert.equal(h.nativeIrt, "5000000");
});

test("frozen real-estate purchase Toman still wins for USD-booked acquisitions", () => {
  const h = humanizeEntry(
    ledgerRow(
      [
        line({ account: "ملک", symbol: "RWA-APT", quantity: "1", baseValue: "50000", decimals: 0 }),
        line({ accountType: "equity", symbol: "USD", quantity: "-50000", baseValue: "-50000" }),
      ],
      { realEstatePurchaseToman: "4500000000", fxIrtAmount: "99999999999" },
    ),
  );
  assert.equal(h.nativeIrt, "4500000000");
});

test("commit-time FX snapshot still freezes non-Toman entries", () => {
  const h = humanizeEntry(
    ledgerRow(
      [
        line({ account: "صرافی", symbol: "USDT", quantity: "100", baseValue: "100", decimals: 6 }),
        line({ account: "کارتی", symbol: "USDT", quantity: "-100", baseValue: "-100", decimals: 6 }),
      ],
      { fxIrtAmount: "19000000" },
    ),
  );
  assert.equal(h.nativeIrt, "19000000");
});

/* ───── integration: the wizard itself posts the complete opening entry ───── */

async function freshDb() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(userSetupState);
  await db.delete(userFxSettings);
  await db.delete(exchangeRates);
  await db.delete(settings);
  await db.delete(users);
  await db.delete(accounts);
}

test("setup with «ETH 3.33 + USDT 1456 + IRT 6,000,000» records everything and the headline covers it all", async () => {
  await freshDb();
  await db.insert(exchangeRates).values({
    baseCurrency: "USD",
    quoteCurrency: "IRT",
    rate: "100000", // 1 USD = 100,000 Toman → 6,000,000 Toman = 60 USD
    effectiveDate: "2026-08-25",
  });

  const result = await completeSetup({
    userName: "مالک خانواده",
    baseCurrency: "USD",
    displayCurrency: "IRT",
    dateCalendar: "jalali",
    digitStyle: "fa",
    bankAccountName: "صرافی — تتر",
    bankAssetSymbol: "USDT",
    bankOpeningBalance: "1456",
    cashWalletName: "صندوق خانگی",
    cashAssetSymbol: "IRT",
    cashOpeningBalance: "6000000",
    cryptoOpeningQty: "3.33",
    cryptoUnitPrice: "3000",
  });
  assert.equal(result.ok, true);

  // (1) Data integrity: the single opening entry carries ALL four postings.
  const entries = await db.select().from(journalEntries);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "opening");
  const lines = await db.select().from(postings).where(eq(postings.entryId, entries[0].id));
  assert.equal(lines.length, 4, "Ethereum + Tether + Toman cash + opening equity");
  const sum = lines.reduce((s, p) => s.add(p.baseValue), D("0"));
  assert.equal(sum.toString(), "0", "entry stays balanced");

  // (2) The reported bug: the human headline must not collapse to the cash leg.
  const [row] = await getLedger(10);
  const h = humanizeEntry(row!);
  assert.notEqual(h.nativeIrt, "6000000", "the reported bug: only the Toman leg was displayed");
  assert.equal(h.nativeIrt, null);
  // 9,990 (ETH) + 1,456 (USDT) + 60 (cash) = 11,506 USD — every asset counted.
  assert.equal(D(h.amountExact).toFixed(2), "11506.00", "Ethereum and Tether are part of the headline");
});
