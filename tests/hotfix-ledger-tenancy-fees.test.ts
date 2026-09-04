/**
 * Hotfix regression suite — ledger multi-tenancy, fee application and the
 * Liquid/Investment separation (audit report
 * docs/AUDIT-BUY-SELL-ACCOUNTS-ASSETS-2026-09-04.md, findings F-01…F-11).
 *
 * Every test here pins a number the OLD code got wrong, so the file is the
 * executable definition of "fixed":
 *   F-01 a sell commission is applied EXACTLY ONCE;
 *   F-02 a buy with a commission never produces an unbalanced entry, the 5040
 *        row is provisioned for the tenant that needs it;
 *   F-03 system counter-legs (4100 / 5040) are resolved per tenant — a foreign
 *        tenant's row can never receive them;
 *   F-04 the shared-chart balance read (`getAccountBalances`) is scoped through
 *        `journal_entries.user_id`;
 *   F-05 the asset account of a fully liquidated position returns to EXACTLY 0;
 *   F-07 a purchase cannot push the paying wallet below zero;
 *   F-11 liquid vs investment classification;
 *   DCA  a mixed-currency average buy price uses the rate FROZEN at each buy.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assetClasses,
  assets,
  currencies,
  entryFxSnapshots,
  journalEntries,
  lotConsumptions,
  lots,
  postings,
  users,
  userFxSettings,
} from "../src/db/schema";
import { D } from "../src/domain/decimal";
import { postEntry, recordBuy, recordSell } from "../src/features/ledger/service";
import { getAccountBalances, getRealizedPnl } from "../src/features/ledger/queries";
import {
  classifyAccountFamily,
  type AccountFamily,
  type AccountFamilyInput,
} from "../src/features/accounts/classification";
import { loadDcaForAssets } from "../src/features/portfolio/dca";

/* ──────────────────────────────────────────────────────────────── harness */

async function freshDb() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(entryFxSnapshots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(userFxSettings);
  await db.delete(users);
}

type Fixture = {
  ethId: string;
  usdCashId: string;
  irtId: string;
  userA: { id: string };
  userB: { id: string };
  assetA: { id: string };
  cashA: { id: string };
  assetB: { id: string };
  cashB: { id: string };
};

/**
 * Two tenants, each owning a crypto position account and a USD cash account.
 * No 4100 / 5040 rows are created on purpose unless a test asks for them: the
 * ledger must provision them itself (F-02).
 */
async function twoTenants(withSharedFee = false): Promise<Fixture> {
  await freshDb();

  const [usd] = await db
    .insert(currencies)
    .values({ code: "USD", name: "USD", symbol: "$", decimals: 2, isFiat: true } as any)
    .returning();

  const cryptoClass = await db
    .insert(assetClasses)
    .values({ code: "crypto", name: "رمزارز", color: "#c9cafa", sortOrder: 3 } as any)
    .returning();
  const cashClass = await db
    .insert(assetClasses)
    .values({ code: "cash", name: "نقد و بانک", color: "#6e6ff0", sortOrder: 1 } as any)
    .returning();
  const goldClass = await db
    .insert(assetClasses)
    .values({ code: "gold", name: "طلا", color: "#363850", sortOrder: 4 } as any)
    .returning();

  const [eth] = await db
    .insert(assets)
    .values({ symbol: "ETH", name: "Ethereum", classId: cryptoClass[0].id, currencyId: usd.id } as any)
    .returning();
  const [usdCash] = await db
    .insert(assets)
    .values({ symbol: "USD", name: "USD Cash", classId: cashClass[0].id, currencyId: usd.id } as any)
    .returning();
  const [irt] = await db
    .insert(assets)
    .values({ symbol: "IRT", name: "Toman", classId: cashClass[0].id, currencyId: usd.id } as any)
    .returning();
  await db
    .insert(assets)
    .values({ symbol: "GOLD18", name: "طلای ۱۸ عیار", classId: goldClass[0].id, currencyId: usd.id } as any);

  const [userA] = await db
    .insert(users)
    .values({ name: "Ali", username: "hotfix-ali", role: "user" } as any)
    .returning();
  const [userB] = await db
    .insert(users)
    .values({ name: "Sara", username: "hotfix-sara", role: "user" } as any)
    .returning();
  for (const u of [userA, userB]) {
    await db.insert(userFxSettings).values({ userId: u.id, currentRate: "190000" } as any).onConflictDoNothing();
  }

  const [assetA] = await db
    .insert(accounts)
    .values({ userId: userA.id, code: "1100-A", name: "Nobitex — ETH", type: "asset", assetId: eth.id } as any)
    .returning();
  const [cashA] = await db
    .insert(accounts)
    .values({ userId: userA.id, code: "1010-A", name: "Bank A", type: "asset", assetId: usdCash.id } as any)
    .returning();
  const [assetB] = await db
    .insert(accounts)
    .values({ userId: userB.id, code: "1100-B", name: "Nobitex — ETH", type: "asset", assetId: eth.id } as any)
    .returning();
  const [cashB] = await db
    .insert(accounts)
    .values({ userId: userB.id, code: "1010-B", name: "Bank B", type: "asset", assetId: usdCash.id } as any)
    .returning();

  if (withSharedFee) {
    // A legacy / seeded SHARED fee row (user_id IS NULL) both tenants may use.
    await db
      .insert(accounts)
      .values({ code: "5040", name: "کارمزد و بانک", type: "expense", assetId: usdCash.id } as any);
  }

  return {
    ethId: eth.id,
    usdCashId: usdCash.id,
    irtId: irt.id,
    userA,
    userB,
    assetA,
    cashA,
    assetB,
    cashB,
  };
}

const balanceOf = async (accountId: string, userId: string) => {
  const rows = await getAccountBalances(userId);
  const row = rows.find((r) => r.accountId === accountId);
  return { baseValue: row?.baseValue ?? "0", quantity: row?.quantity ?? "0" };
};

/** Σ over every posting in the database — the invariant that may never break. */
const globalSum = async (): Promise<string> => {
  const res = await db.execute(sql`select coalesce(sum(base_value),0)::text as s from postings`);
  return (res.rows[0] as { s: string }).s;
};

/** Fund a cash account without touching the trade path (opening document). */
async function fund(accountId: string, assetId: string, amount: string, userId: string) {
  const [equity] = await db
    .insert(accounts)
    .values({ userId, code: "3010", name: "سرمایه افتتاحیه", type: "equity", assetId } as any)
    .onConflictDoNothing({ target: [accounts.userId, accounts.code] })
    .returning();
  const row =
    equity ??
    (
      await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.userId, userId), eq(accounts.code, "3010")))
        .limit(1)
    )[0];
  await postEntry({
    entryDate: "2026-08-01",
    type: "opening",
    description: "موجودی افتتاحیه",
    userId,
    postings: [
      { accountId, assetId, quantity: amount, baseValue: amount },
      { accountId: row.id, assetId, quantity: D(amount).neg().toString(), baseValue: D(amount).neg().toString() },
    ],
  });
}

/* ───────────────────────────────── F-01 / F-05 — fees and the full exit */

test("F-01 + F-05 — fee-bearing buy/sell round trip: cash gets gross − fee once, asset account returns to exactly 0", async () => {
  const f = await twoTenants();

  // Buy 0.5 ETH for 1 000 USD + 10 USD commission → wallet pays 1 010.
  const buy = await recordBuy({
    entryDate: "2026-08-02",
    description: "خرید ۰٫۵ اتریوم",
    assetAccountId: f.assetA.id,
    cashAccountId: f.cashA.id,
    assetId: f.ethId,
    quantity: "0.5",
    cashAssetId: f.usdCashId,
    cashQuantity: "1000",
    baseValue: "1000",
    feeBase: "10",
    userId: f.userA.id,
  });
  assert.ok(buy.id);

  const afterBuy = await balanceOf(f.cashA.id, f.userA.id);
  assert.equal(Number(afterBuy.baseValue), -1010, "the wallet pays value + fee once at buy time");

  // The commission is an expense of its own — never capitalised into the lot.
  const lot = (await db.select().from(lots).where(eq(lots.openEntryId, buy.id)))[0];
  assert.equal(Number(lot.unitCostBase), 2000, "unit cost = trade value ÷ qty (fee excluded)");

  // Sell the whole position for 2 000 with a 100 commission.
  const sell = await recordSell({
    entryDate: "2026-08-09",
    description: "فروش ۰٫۵ اتریوم",
    assetAccountId: f.assetA.id,
    cashAccountId: f.cashA.id,
    pnlAccountId: "",
    assetId: f.ethId,
    quantity: "0.5",
    cashAssetId: f.usdCashId,
    cashQuantity: "2000",
    baseValue: "2000",
    feeBase: "100",
    userId: f.userA.id,
  });
  assert.ok(sell.id);

  const afterSell = await balanceOf(f.cashA.id, f.userA.id);
  assert.equal(
    Number(afterSell.baseValue),
    890,
    "cash = −(1000+10) + (2000−100): the commission is deducted exactly once",
  );

  const assetBal = await balanceOf(f.assetA.id, f.userA.id);
  assert.equal(Number(assetBal.baseValue), 0, "F-05: a full liquidation leaves no ghost balance");
  assert.equal(Number(assetBal.quantity), 0, "F-05: and no ghost quantity either");

  // Realized = (gross − fee) − cost = 1900 − 1000.
  const pnl = await getRealizedPnl(f.userA.id);
  assert.equal(Number(pnl.total), 900, "realized P&L is net of the commission");

  assert.equal(Number(await globalSum()), 0, "Σ of all postings stays 0");
});

test("F-01 — the sell document has exactly 3 legs and no duplicated fee/cash pair", async () => {
  const f = await twoTenants();
  await fund(f.cashA.id, f.usdCashId, "5000", f.userA.id);

  await recordBuy({
    entryDate: "2026-08-02",
    description: "buy",
    assetAccountId: f.assetA.id,
    cashAccountId: f.cashA.id,
    assetId: f.ethId,
    quantity: "1",
    cashAssetId: f.usdCashId,
    cashQuantity: "1000",
    baseValue: "1000",
    feeBase: "0",
    userId: f.userA.id,
  });
  const sell = await recordSell({
    entryDate: "2026-08-09",
    description: "sell with fee",
    assetAccountId: f.assetA.id,
    cashAccountId: f.cashA.id,
    pnlAccountId: "",
    assetId: f.ethId,
    quantity: "1",
    cashAssetId: f.usdCashId,
    cashQuantity: "2000",
    baseValue: "2000",
    feeBase: "100",
    userId: f.userA.id,
  });

  const legs = await db.select().from(postings).where(eq(postings.entryId, sell.id));
  assert.equal(legs.length, 3, "asset out + cash in + realized P&L — the old code added two fee legs");
  const cashLegs = legs.filter((p) => p.accountId === f.cashA.id);
  assert.equal(cashLegs.length, 1, "the cash account is touched once by a sale");
  assert.equal(Number(cashLegs[0].baseValue), 1900);
  const sum = legs.reduce((acc, p) => acc + Number(p.baseValue), 0);
  assert.equal(Math.abs(sum) < 1e-9, true, "the entry balances");
});

/* ──────────────────────────────────────────────── F-02 — 5040 provisioning */

test("F-02 — a buy with a commission on a chart without 5040 provisions it for the tenant instead of failing", async () => {
  const f = await twoTenants();
  await fund(f.cashA.id, f.usdCashId, "5000", f.userA.id);

  const none = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.code, "5040"), isNull(accounts.userId)));
  assert.equal(none.length, 0, "no shared fee account in this fixture");

  await recordBuy({
    entryDate: "2026-08-03",
    description: "خرید با کارمزد روی نمودار بدون ۵۰۴۰",
    assetAccountId: f.assetA.id,
    cashAccountId: f.cashA.id,
    assetId: f.ethId,
    quantity: "1",
    cashAssetId: f.usdCashId,
    cashQuantity: "1000",
    baseValue: "1000",
    feeBase: "10",
    userId: f.userA.id,
  });

  const [feeAccount] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.code, "5040"), eq(accounts.userId, f.userA.id)))
    .limit(1);
  assert.ok(feeAccount, "5040 was created for THIS tenant");
  assert.equal(feeAccount.type, "expense");

  const bal = await balanceOf(feeAccount.id, f.userA.id);
  assert.equal(Number(bal.baseValue), 10, "the commission was booked, not dropped");
  assert.equal(Number(await globalSum()), 0);
});

/* ───────────────────────────────── F-03 — system legs never cross tenants */

test("F-03 — a foreign tenant's 4100/5040 can never receive the counter-leg", async () => {
  const f = await twoTenants();

  const [pnlOfA] = await db
    .insert(accounts)
    .values({ userId: f.userA.id, code: "4100", name: "سود سرمایه‌ای A", type: "income", assetId: f.usdCashId } as any)
    .returning();
  const [feeOfA] = await db
    .insert(accounts)
    .values({ userId: f.userA.id, code: "5040", name: "کارمزد A", type: "expense", assetId: f.usdCashId } as any)
    .returning();

  // Tenant B buys and sells, and (as a hostile/legacy payload) NAMES A's rows.
  await recordBuy({
    entryDate: "2026-08-02",
    description: "B buy",
    assetAccountId: f.assetB.id,
    cashAccountId: f.cashB.id,
    assetId: f.ethId,
    quantity: "1",
    cashAssetId: f.usdCashId,
    cashQuantity: "1000",
    baseValue: "1000",
    feeBase: "10",
    feeAccountId: feeOfA.id,
    userId: f.userB.id,
  });
  await recordSell({
    entryDate: "2026-08-10",
    description: "B sell",
    assetAccountId: f.assetB.id,
    cashAccountId: f.cashB.id,
    pnlAccountId: pnlOfA.id,
    assetId: f.ethId,
    quantity: "1",
    cashAssetId: f.usdCashId,
    cashQuantity: "2000",
    baseValue: "2000",
    feeBase: "0",
    userId: f.userB.id,
  });

  const aPnl = await balanceOf(pnlOfA.id, f.userA.id);
  const aFee = await balanceOf(feeOfA.id, f.userA.id);
  assert.equal(Number(aPnl.baseValue), 0, "A's 4100 stayed untouched");
  assert.equal(Number(aFee.baseValue), 0, "A's 5040 stayed untouched");

  const [bPnl] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.code, "4100"), eq(accounts.userId, f.userB.id)))
    .limit(1);
  assert.ok(bPnl, "B's own 4100 was provisioned instead");
  const bPnlBal = await balanceOf(bPnl.id, f.userB.id);
  assert.equal(Number(bPnlBal.baseValue), -1000, "B's gain is credited to B (2000 − 1000)");

  const [bFee] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.code, "5040"), eq(accounts.userId, f.userB.id)))
    .limit(1);
  assert.ok(bFee, "B's own 5040 was provisioned instead");
  assert.equal(Number((await balanceOf(bFee.id, f.userB.id)).baseValue), 10);

  assert.equal(Number((await getRealizedPnl(f.userA.id)).total), 0, "A's realized P&L is untouched");
  assert.equal(Number((await getRealizedPnl(f.userB.id)).total), 1000, "B's realized P&L is B's own");
});

/* ───────────────────────── F-04 — balances of SHARED chart rows per tenant */

test("F-04 — getAccountBalances scopes a shared system account through journal_entries.user_id", async () => {
  const f = await twoTenants(true); // a single GLOBAL 5040 row, shared by design

  for (const t of [
    { user: f.userA, asset: f.assetA, cash: f.cashA, fee: "10" },
    { user: f.userB, asset: f.assetB, cash: f.cashB, fee: "250" },
  ]) {
    await recordBuy({
      entryDate: "2026-08-04",
      description: "buy with fee into the shared 5040",
      assetAccountId: t.asset.id,
      cashAccountId: t.cash.id,
      assetId: f.ethId,
      quantity: "1",
      cashAssetId: f.usdCashId,
      cashQuantity: "1000",
      baseValue: "1000",
      feeBase: t.fee,
      userId: t.user.id,
    });
  }

  const [sharedFee] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.code, "5040"), isNull(accounts.userId)))
    .limit(1);
  assert.ok(sharedFee, "the fixture uses the shared global row");

  const aView = await getAccountBalances(f.userA.id);
  const bView = await getAccountBalances(f.userB.id);
  const aFee = aView.find((r) => r.accountId === sharedFee.id)?.baseValue;
  const bFee = bView.find((r) => r.accountId === sharedFee.id)?.baseValue;

  assert.equal(Number(aFee), 10, "A sees only its own commission on the shared row");
  assert.equal(Number(bFee), 250, "B sees only its own commission on the shared row");
});

/* ───────────────────────────────── F-07 — no purchase below zero */

test("F-07 — a buy cannot push the paying wallet below zero", async () => {
  const f = await twoTenants();
  await fund(f.cashA.id, f.usdCashId, "100", f.userA.id);

  await assert.rejects(
    () =>
      recordBuy({
        entryDate: "2026-08-05",
        description: "خرید بزرگ‌تر از موجودی",
        assetAccountId: f.assetA.id,
        cashAccountId: f.cashA.id,
        assetId: f.ethId,
        quantity: "1",
        cashAssetId: f.usdCashId,
        cashQuantity: "1000",
        baseValue: "1000",
        feeBase: "10",
        userId: f.userA.id,
        preventOverdraft: true,
      }),
    /کافی نیست/,
  );

  // Nothing was written by the rejected attempt.
  assert.equal(Number(await globalSum()), 0);
  const entries = await db.select().from(journalEntries);
  assert.equal(entries.length, 1, "only the funding entry survived the rollback");
});

/* ───────────────────────────────── F-11 — liquid vs investment separation */

test("F-11 — classification: banks, cash and stablecoin wallets are money; positions are assets", async () => {
  const cases: Array<[string, AccountFamily, AccountFamilyInput]> = [
    ["IRT bank", "liquid", { symbol: "IRT", classCode: "cash", walletKind: "bank" }],
    ["USD bank", "liquid", { symbol: "USD", classCode: "cash", walletKind: "bank" }],
    ["USDT hot wallet", "liquid", { symbol: "USDT", classCode: "stable", walletKind: "hot" }],
    ["USDC cold wallet", "liquid", { symbol: "USDC", classCode: "stable", walletKind: "cold" }],
    ["cash box", "liquid", { symbol: "IRT", className: "نقد و بانک", walletKind: "cash" }],
    ["BTC on an exchange", "investment", { symbol: "BTC", classCode: "crypto", walletKind: "exchange" }],
    ["ETH position", "investment", { symbol: "ETH", classCode: "crypto" }],
    ["gold", "investment", { symbol: "GOLD18", classCode: "gold", walletKind: "cash" }],
    ["apartment", "investment", { symbol: "PROP-001", className: "املاک" }],
    ["vehicle", "investment", { symbol: "VEH-001", classCode: "vehicle" }],
    ["fund units", "investment", { symbol: "FUND-LOT", classCode: "fund" }],
    ["unknown ticker", "investment", { symbol: "XYZ", classCode: "other" }],
    ["unknown ticker in a bank account", "liquid", { symbol: "XYZ", walletKind: "bank" }],
    ["unknown ticker on an exchange", "investment", { symbol: "QTUM", walletKind: "exchange" }],
    ["legacy 3-letter fiat without class", "liquid", { symbol: "AED" }],
  ];

  for (const [label, expected, input] of cases) {
    assert.equal(classifyAccountFamily(input), expected, label);
  }
});

/* ───────────────────────────────────── DCA — mixed-currency average cost */

test("DCA — average buy price uses the rate frozen at each purchase, never today's", async () => {
  const f = await twoTenants();
  await fund(f.cashA.id, f.usdCashId, "10000000", f.userA.id);

  // 1) 0.5 ETH bought with dollars when USD = 190 000 Toman → 950 USD.
  const buy1 = await recordBuy({
    entryDate: "2026-01-10",
    description: "buy with USD",
    assetAccountId: f.assetA.id,
    cashAccountId: f.cashA.id,
    assetId: f.ethId,
    quantity: "0.5",
    cashAssetId: f.usdCashId,
    cashQuantity: "950",
    baseValue: "950",
    userId: f.userA.id,
  });
  // 2) 0.5 ETH bought later when USD = 250 000 Toman → 1 250 USD.
  const buy2 = await recordBuy({
    entryDate: "2026-06-20",
    description: "buy later",
    assetAccountId: f.assetA.id,
    cashAccountId: f.cashA.id,
    assetId: f.ethId,
    quantity: "0.5",
    cashAssetId: f.usdCashId,
    cashQuantity: "1250",
    baseValue: "1250",
    userId: f.userA.id,
  });

  // The unified transaction path freezes the rate on the entry; reproduce it.
  for (const snap of [
    { entryId: buy1.id, irtAmount: "180500000", usdAmount: "950", fxRate: "190000" },
    { entryId: buy2.id, irtAmount: "312500000", usdAmount: "1250", fxRate: "250000" },
  ]) {
    await db.insert(entryFxSnapshots).values({
      ...snap,
      rateSource: "settings",
      rateDate: "2026-08-01",
    } as any);
  }

  const dca = (await loadDcaForAssets([f.ethId], f.userA.id, "999999"))!.get(f.ethId)!;

  // Σ qty × unit cost, in USD and in Toman AT THE TIME OF EACH BUY.
  assert.equal(Number(dca.quantityHeld), 1);
  assert.equal(Number(dca.totalCostUsd), 2200, "950 + 1250");
  assert.equal(Number(dca.totalCostToman), 180500000 + 312500000, "frozen rates, never today's");
  assert.equal(Number(dca.dcaUnitPriceUsd), 2200, "TotalCost(USD) ÷ Σ qty");
  assert.equal(Number(dca.dcaUnitPriceToman), 493000000, "TotalCost(IRT) ÷ Σ qty");
  assert.equal(dca.hasEstimatedFx, false, "both buys had a frozen rate");
  // TODAY's rate (999 999) must not appear anywhere in the numbers.
  assert.notEqual(Number(dca.totalCostToman), 2200 * 999999);

  // Selling half does not rewrite what was invested; it only shrinks the held cost.
  await recordSell({
    entryDate: "2026-08-25",
    description: "sell half",
    assetAccountId: f.assetA.id,
    cashAccountId: f.cashA.id,
    pnlAccountId: "",
    assetId: f.ethId,
    quantity: "0.5",
    cashAssetId: f.usdCashId,
    cashQuantity: "1500",
    baseValue: "1500",
    feeBase: "0",
    userId: f.userA.id,
  });

  const after = (await loadDcaForAssets([f.ethId], f.userA.id, "999999"))!.get(f.ethId)!;
  assert.equal(Number(after.quantityHeld), 0.5, "held quantity follows the FIFO consumption");
  assert.equal(Number(after.quantityBought), 1, "lifetime bought quantity is immutable history");
  assert.equal(Number(after.totalInvestedUsd), 2200, "lifetime invested amount never shrinks");
  // FIFO consumed the FIRST lot (950) — what remains is the later, dearer one.
  assert.equal(Number(after.totalCostUsd), 1250, "the first lot (FIFO) was the one consumed");
  assert.equal(Number(after.totalCostToman), 312500000, "and its Toman cost stays frozen");

  // A lot with no frozen rate is reported as an estimate, never as history.
  await db.delete(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, buy2.id));
  const estimated = (await loadDcaForAssets([f.ethId], f.userA.id, "999999"))!.get(f.ethId)!;
  assert.equal(estimated.hasEstimatedFx, true, "a missing snapshot is flagged");
});

/* ─────────────────────────────────────────── F-08 — unified registry write */

test("F-08 — the unified disposal entry books proceeds through postEntry and stays balanced", async () => {
  const f = await twoTenants();
  await fund(f.cashA.id, f.usdCashId, "1", f.userA.id);

  const { recordRegistryDisposal } = await import("../src/features/ledger/service");
  const res = await recordRegistryDisposal({
    entryDate: "2026-08-30",
    description: "فروش خودرو (ثبت یکپارچه)",
    assetId: f.ethId,
    cashAccountId: f.cashA.id,
    cashAssetId: f.usdCashId,
    cashQuantity: "4100000000",
    proceedsBase: "4100",
    irtAmount: "4100000000",
    fxRate: "1000000",
    userId: f.userA.id,
    idempotencyKey: "vehicle-sale:test-1",
  });

  assert.ok(res.id, "a journal document exists for the liquidation");
  const legs = await db.select().from(postings).where(eq(postings.entryId, res.id));
  assert.equal(legs.length, 2, "no ledger carrying value ⇒ cash + opening equity, no phantom P&L");
  const [equityRow] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.code, "3010"), eq(accounts.userId, f.userA.id)));
  const equityLeg = legs.find((l) => l.accountId === equityRow?.id);
  assert.ok(equityLeg, "the proceeds are credited to opening equity, NOT booked as income");
  const pnlRows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.code, "4100"), eq(accounts.userId, f.userA.id)));
  const pnlLeg = legs.find((l) => l.accountId === pnlRows[0]?.id);
  assert.equal(pnlLeg, undefined, "no realized-P&L leg for a position that was never carried");
  assert.equal(Math.abs(legs.reduce((a, p) => a + Number(p.baseValue), 0)) < 1e-9, true);
  assert.equal(Number((await balanceOf(f.cashA.id, f.userA.id)).baseValue), 4101, "proceeds arrived");
  assert.equal(Number(await globalSum()), 0);

  // Idempotent: the same key replays the entry instead of duplicating it.
  const again = await recordRegistryDisposal({
    entryDate: "2026-08-30",
    description: "فروش خودرو (ثبت یکپارچه)",
    assetId: f.ethId,
    cashAccountId: f.cashA.id,
    cashAssetId: f.usdCashId,
    cashQuantity: "4100000000",
    proceedsBase: "4100",
    userId: f.userA.id,
    idempotencyKey: "vehicle-sale:test-1",
  });
  assert.equal(again.id, res.id, "replay is idempotent");
  assert.equal(Number((await balanceOf(f.cashA.id, f.userA.id)).baseValue), 4101, "no double credit");

  // A lot-less asset never touches the FIFO engine: nothing was opened or
  // consumed by a registry disposal.
  const anyLots = await db.select().from(lots);
  assert.equal(anyLots.length, 0, "a registry disposal must not create or consume a lot");
});
