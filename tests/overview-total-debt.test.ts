/**
 * «نمای کلی → کل بدهی‌ها» — the tile must show the debt, never ۰.
 *
 * USER-REPORTED BUG: the overview's «کل بدهی‌ها» tile read ۰ تومان while
 * «بدهی‌ها» showed a live outstanding balance for the very same debts
 * (بانک تجارت قرض‌الحسنه، بانک پاسارگاد، بانک سامان).
 *
 * ROOT CAUSE: `getCurrentNetWorth()` derived the tile from
 * `getAccountBalances().filter(type === "liability")` — the LEDGER only. But a
 * debt registered in the debt module is a planning row: `createDebtAction`
 * writes `debts.account_id = null` on purpose ("A planning-only debt has no
 * ledger account by design"), so no liability account exists, the filter is
 * empty and the tile reads ۰. Meanwhile `netWorth` stayed correct, because it
 * deliberately subtracts only booked liabilities — the two numbers answered
 * different questions while wearing the same label.
 *
 * THE FIX: the read model exposes `totalDebtToman` / `totalDebtUsd`, built from
 * the same source «مانده کل بدهی» uses (`listDebts().outstandingToman`) plus
 * any ledger liability account no debt row owns. The overview tile renders
 * those, `totalLiabilities*` keeps its accounting meaning, and no debt is ever
 * counted twice.
 *
 * These tests run the REAL service against a REAL (in-memory) schema.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { D } from "../src/domain/decimal";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assetClasses,
  assets,
  currencies,
  debts,
  entryFxSnapshots,
  installments,
  journalEntries,
  lotConsumptions,
  lots,
  postings,
  prices,
  userFxSettings,
  users,
} from "../src/db/schema";
import { postEntry } from "../src/features/ledger/service";
import { listDebts } from "../src/features/planning/service";
import { getCurrentNetWorth } from "../src/features/portfolio/service";
import { formatMoney, sumToman } from "../src/lib/format";

const RATE = "190000";

async function cleanAll() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(entryFxSnapshots);
  await db.delete(installments);
  await db.delete(debts);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(prices);
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
    .values({ name, username: name.toLowerCase(), role: "owner" } as any)
    .returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: RATE } as any);
  return user;
}

/** A Toman cash asset plus the money chart a user's workspace has. */
async function makeMoneyChart(userId: string) {
  const [usdCur] = await db
    .insert(currencies)
    .values({ code: "USD", name: "US Dollar", symbol: "$", decimals: 2, isFiat: true } as any)
    .returning();
  const [irtCur] = await db
    .insert(currencies)
    .values({ code: "IRT", name: "Toman", symbol: "T", decimals: 0, isFiat: true } as any)
    .returning();
  const [cashCls] = await db
    .insert(assetClasses)
    .values({ code: "cash", name: "نقد و بانک", sortOrder: 1 } as any)
    .returning();
  const [usdAsset] = await db
    .insert(assets)
    .values({ symbol: "USD", name: "USD Cash", classId: cashCls.id, currencyId: usdCur.id, decimals: 2, pricingMethod: "face_value" } as any)
    .returning();
  const [irtAsset] = await db
    .insert(assets)
    .values({ symbol: "IRT", name: "Toman", classId: cashCls.id, currencyId: irtCur.id, decimals: 0, pricingMethod: "manual" } as any)
    .returning();
  const [cash] = await db
    .insert(accounts)
    .values({ code: "1010", name: "بانک", type: "asset", assetId: irtAsset.id, userId } as any)
    .returning();
  const [equity] = await db
    .insert(accounts)
    .values({ code: "3010", name: "سرمایه افتتاحیه", type: "equity", assetId: usdAsset.id, userId } as any)
    .returning();
  const liability = await db
    .insert(accounts)
    .values({ code: "2010", name: "وام بانک", type: "liability", assetId: irtAsset.id, userId } as any)
    .returning();
  return { usdAsset, irtAsset, cash, equity, liability: liability[0] };
}

/**
 * Exactly what `createDebtAction` writes: a planning-only debt
 * (`accountId: null`) whose schedule carries contractual Toman.
 */
async function makePlanningDebt(opts: {
  userId: string;
  title: string;
  creditor: string;
  principalToman: string;
  count: number;
  paidCount?: number;
  accountId?: string | null;
}) {
  const [debt] = await db
    .insert(debts)
    .values({
      userId: opts.userId,
      creditor: opts.creditor,
      title: opts.title,
      principalToman: opts.principalToman,
      principalUsdCreated: D(opts.principalToman).div(RATE).toString(),
      principalBase: D(opts.principalToman).div(RATE).toString(),
      interestRate: "0",
      startDate: "2026-01-01",
      accountId: opts.accountId ?? null,
      status: "active",
    } as any)
    .returning();
  const per = D(opts.principalToman).div(String(opts.count)).toFixed(0);
  // A schedule that runs past December must still carry a VALID date.
  const dueDate = (i: number) =>
    `${2026 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`;
  await db.insert(installments).values(
    Array.from({ length: opts.count }, (_, i) => ({
      debtId: debt.id,
      seq: i + 1,
      dueDate: dueDate(i),
      amountToman: per,
      amountUsdCreated: D(per).div(RATE).toString(),
      amountBase: D(per).div(RATE).toString(),
      status: i < (opts.paidCount ?? 0) ? "paid" : "pending",
      ...(i < (opts.paidCount ?? 0)
        ? { paidAt: dueDate(i), paidToman: per, paidUsd: D(per).div(RATE).toString(), paidFxRate: RATE }
        : {}),
    })) as any,
  );
  return debt;
}

/** What the overview tile renders — kept in sync with OverviewDashboard. */
const tileToman = (nw: { totalDebtToman: string }) => formatMoney(D(nw.totalDebtToman).abs().toString(), "IRT");
/** What /debts renders as «مانده کل بدهی». */
const debtsPageToman = (rows: Array<{ outstandingToman: string | null }>) => sumToman(rows.map((d) => d.outstandingToman));

/* ══════════════════════════════════════════════════════════════════ */

test("regression — debts registered in the debt module are NOT zero on the overview", async () => {
  await cleanAll();
  const user = await makeUser("overview-zero-debt");
  await makeMoneyChart(user.id);

  await makePlanningDebt({
    userId: user.id,
    title: "قرض‌الحسنه مسکن",
    creditor: "بانک تجارت",
    principalToman: "4800000000",
    count: 24,
  });
  await makePlanningDebt({
    userId: user.id,
    title: "وام ودیعه مسکن",
    creditor: "بانک پاسارگاد",
    principalToman: "2400000000",
    count: 12,
    paidCount: 6,
  });

  const nw = await getCurrentNetWorth(user.id);
  const rows = await listDebts(user.id);

  // The ledger really does carry nothing for these debts — that was the bug.
  assert.equal(D(nw.totalLiabilitiesToman).toFixed(0), "0", "no liability account was ever booked");
  // …and the tile now answers the question it is labelled with.
  assert.ok(D(nw.totalDebtToman).gt(0), `totalDebtToman must be > 0, got ${nw.totalDebtToman}`);
  assert.notEqual(tileToman(nw), formatMoney("0", "IRT"), "the tile must not read ۰ تومان");
  // Cross-module agreement: overview == /debts, to the Toman.
  assert.equal(D(nw.totalDebtToman).toFixed(0), debtsPageToman(rows), "«کل بدهی‌ها» must equal «مانده کل بدهی»");
  // 4,800,000,000 still unpaid + half of 2,400,000,000 repaid → 6,000,000,000
  assert.equal(D(nw.totalDebtToman).toFixed(0), "6000000000");
  // USD is the derived display line and must be positive, never a −amount.
  assert.ok(D(nw.totalDebtUsd).gt(0), "the USD sub-line is positive");
  assert.ok(
    D(nw.totalDebtUsd).sub(D(nw.totalDebtToman).div(RATE)).abs().lt("0.01"),
    "USD == Toman ÷ rate — one conversion, no re-scaling",
  );
});

test("no double counting — a debt booked in the ledger contributes ONCE", async () => {
  await cleanAll();
  const user = await makeUser("overview-no-double-count");
  const { irtAsset, cash, liability } = await makeMoneyChart(user.id);

  // 1,900,000,000 Toman of cash received, booked against the liability account.
  await postEntry({
    entryDate: "2026-01-01",
    type: "debt",
    description: "دریافت وام",
    userId: user.id,
    postings: [
      { accountId: cash.id, assetId: irtAsset.id, quantity: "1900000000", baseValue: "10000" },
      { accountId: liability.id, assetId: irtAsset.id, quantity: "-1900000000", baseValue: "-10000" },
    ],
  });

  // Its schedule has 1,140,000,000 Toman still unpaid (19 installments of 60,000,000).
  await makePlanningDebt({
    userId: user.id,
    title: "وام کالا",
    creditor: "بانک سامان",
    principalToman: "1900000000",
    count: 20,
    paidCount: 1,
    accountId: liability.id,
  });

  const nw = await getCurrentNetWorth(user.id);
  const rows = await listDebts(user.id);
  assert.equal(D(nw.totalDebtToman).toFixed(0), debtsPageToman(rows), "booked debt counts once, at its contractual balance");
  assert.equal(D(nw.totalDebtToman).toFixed(0), "1805000000");
  // Accounting side untouched: net worth still subtracts the LEDGER liability.
  assert.equal(D(nw.totalLiabilitiesToman).toFixed(0), "1900000000", "accounting liability stays the ledger balance");
  assert.ok(
    D(nw.totalDebtToman).sub(D(nw.totalLiabilitiesToman)).abs().gt("1"),
    "the two figures measure different things and are exposed separately",
  );
});

test("a ledger liability no debt row owns is still counted", async () => {
  await cleanAll();
  const user = await makeUser("overview-unlinked-liability");
  const { irtAsset, cash, liability } = await makeMoneyChart(user.id);

  // A card balance booked by hand in the ledger — the planning module never
  // sees it, so a purely schedule-based total would drop it.
  await postEntry({
    entryDate: "2026-02-01",
    type: "debt",
    description: "بدهی کارت اعتباری",
    userId: user.id,
    postings: [
      { accountId: cash.id, assetId: irtAsset.id, quantity: "380000000", baseValue: "2000" },
      { accountId: liability.id, assetId: irtAsset.id, quantity: "-380000000", baseValue: "-2000" },
    ],
  });
  const nw = await getCurrentNetWorth(user.id);
  assert.equal(D(nw.totalDebtToman).toFixed(0), "380000000", "an unowned ledger liability reaches the tile");
  assert.equal(D(nw.totalDebtUsd).toFixed(2), "2000.00");
});

test("an empty debt book still reads zero — the fix never invents a liability", async () => {
  await cleanAll();
  const user = await makeUser("overview-no-debts");
  await makeMoneyChart(user.id);

  const nw = await getCurrentNetWorth(user.id);
  assert.equal(D(nw.totalDebtToman).toFixed(0), "0");
  assert.equal(tileToman(nw), formatMoney("0", "IRT"));
});
