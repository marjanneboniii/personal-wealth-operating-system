/**
 * Cash Flow module — FROZEN Toman + tenant isolation.
 *
 * Pins the user-reported bug exactly:
 *   Recorded Toman expenses (cool 80,000,000 Toman ≈ $380.95 at 210,000;
 *   misc 15,000,000 ≈ $71.43; wedding gift 12,000,000 ≈ $57.14) drifted when
 *   the dollar rate rose to 220,000 — the UI re-derived Toman as
 *   USD × currentRate (80,000,000 → 83,809,524).
 *
 * Invariants verified here:
 *  1. FREEZE — every recorded Toman amount is rendered from the commit-time
 *     entry_fx_snapshots freeze; a later rate change moves NOTHING.
 *  2. LEDGER/FIFO CORE UNTOUCHED — journal entries, postings, lots and
 *     lot_consumptions are byte-identical before and after the rate change.
 *  3. DYNAMIC/ISOLATED PROCESSING — Toman aggregates are derived at READ time
 *     (SQL over the immutable snapshot); nothing new is stored or hard-coded.
 *  4. TENANT ISOLATION — in a multi-tenant database an unresolved identity
 *     fails closed (empty result, never a cross-user aggregate); each tenant
 *     sees exactly its own history.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assetClasses,
  assets,
  currencies,
  entryFxSnapshots,
  expenseCategories,
  journalEntries,
  lotConsumptions,
  lots,
  postings,
  prices,
  users,
  userFxSettings,
} from "../src/db/schema";
import {
  ensureCategoryCatalog,
  getCategoryByCode,
  getFlowByCategory,
} from "../src/features/categories/service";
import { getCashflow, getFlowByAccount, getLedger } from "../src/features/ledger/queries";
import { postEntry, recordExpense, recordIncome } from "../src/features/ledger/service";
import { D } from "../src/domain/decimal";
import { todayIso } from "../src/lib/format";

const OLD_RATE = "210000";
const NEW_RATE = "220000";

async function resetDb() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(entryFxSnapshots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(expenseCategories);
  await db.delete(userFxSettings);
  await db.delete(accounts);
  await db.delete(prices);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(users);
}

/** USD book value of a Toman amount at the given rate (full decimal precision). */
const usdOf = (irt: string, rate: string = OLD_RATE) => D(irt).div(rate).toString();

/**
 * Two-tenant fixture mirroring the report:
 *  - User A: 3 Toman expenses at 210,000 IRT/USD (80M / 15M / 12M) + 1 income
 *    (21M), each with its commit-time FX snapshot (what the transaction
 *    action writes atomically with the entry).
 *  - User B: 1 Toman expense (5M) with its own snapshot.
 */
async function fixture() {
  await resetDb();
  await ensureCategoryCatalog();

  const [userA] = await db.insert(users).values({ name: "کاربر الف", role: "user" }).returning();
  const [userB] = await db.insert(users).values({ name: "کاربر بی", role: "user" }).returning();

  const [cur] = await db
    .insert(currencies)
    .values({ code: "USD", name: "دلار آمریکا", symbol: "$", decimals: 2, isFiat: true })
    .returning();
  const [cls] = await db
    .insert(assetClasses)
    .values({ code: "cash", name: "نقد و بانک", color: "#6e6ff0" })
    .returning();
  const [usd] = await db
    .insert(assets)
    .values({ symbol: "USD", name: "دلار", classId: cls.id, currencyId: cur.id, decimals: 2 })
    .returning();
  await db.insert(prices).values({ assetId: usd.id, asOf: todayIso(), priceBase: "1", source: "manual" });

  const mkAccounts = async (userId: string, tag: string) => {
    const [bank] = await db
      .insert(accounts)
      .values({ userId, code: `1010${tag}`, name: "بانک", type: "asset", assetId: usd.id })
      .returning();
    const [expAcct] = await db
      .insert(accounts)
      .values({ userId, code: `5010${tag}`, name: "هزینه", type: "expense", assetId: usd.id })
      .returning();
    const [incAcct] = await db
      .insert(accounts)
      .values({ userId, code: `4010${tag}`, name: "درآمد", type: "income", assetId: usd.id })
      .returning();
    const [equity] = await db
      .insert(accounts)
      .values({ userId, code: `3010${tag}`, name: "سرمایه", type: "equity", assetId: usd.id })
      .returning();
    return { bank, expAcct, incAcct, equity };
  };

  const accA = await mkAccounts(userA.id, "_a");
  const accB = await mkAccounts(userB.id, "_b");

  const postOpening = (a: { bank: any; equity: any }, userId: string) =>
    postEntry({
      entryDate: todayIso(),
      type: "opening",
      description: "افتتاحیه",
      userId,
      postings: [
        { accountId: a.bank.id, assetId: usd.id, quantity: "100000", baseValue: "100000" },
        { accountId: a.equity.id, assetId: usd.id, quantity: "-100000", baseValue: "-100000" },
      ],
    });

  const freeze = (entryId: string, irt: string) =>
    db.insert(entryFxSnapshots).values({
      entryId,
      irtAmount: irt,
      usdAmount: usdOf(irt),
      fxRate: OLD_RATE,
      rateSource: "settings",
      rateDate: todayIso(),
    });

  await db.insert(userFxSettings).values([
    { userId: userA.id, currentRate: OLD_RATE },
    { userId: userB.id, currentRate: OLD_RATE },
  ]);

  // ── User A ────────────────────────────────────────────────────────────
  await postOpening(accA, userA.id);

  const cooler = await recordExpense({
    entryDate: todayIso(),
    description: "خرید کولر ۱۲ هزار ایوولی",
    cashAccountId: accA.bank.id,
    categoryAccountId: accA.expAcct.id,
    assetId: usd.id,
    quantity: usdOf("80000000"),
    baseValue: usdOf("80000000"),
    categoryId: (await getCategoryByCode("HSG-EQUIP"))!.id,
    userId: userA.id,
  });
  await freeze(cooler.id, "80000000");

  const misc = await recordExpense({
    entryDate: todayIso(),
    description: "خریدهای متفرقه",
    cashAccountId: accA.bank.id,
    categoryAccountId: accA.expAcct.id,
    assetId: usd.id,
    quantity: usdOf("15000000"),
    baseValue: usdOf("15000000"),
    categoryId: (await getCategoryByCode("MSC-MISC"))!.id,
    userId: userA.id,
  });
  await freeze(misc.id, "15000000");

  const gift = await recordExpense({
    entryDate: todayIso(),
    description: "کادوی عروسی",
    cashAccountId: accA.bank.id,
    categoryAccountId: accA.expAcct.id,
    assetId: usd.id,
    quantity: usdOf("12000000"),
    baseValue: usdOf("12000000"),
    categoryId: (await getCategoryByCode("MSC-EMERGENCY"))!.id,
    userId: userA.id,
  });
  await freeze(gift.id, "12000000");

  const income = await recordIncome({
    entryDate: todayIso(),
    description: "درآمد پروژه",
    cashAccountId: accA.bank.id,
    categoryAccountId: accA.incAcct.id,
    assetId: usd.id,
    quantity: usdOf("21000000"),
    baseValue: usdOf("21000000"),
    userId: userA.id,
  });
  await freeze(income.id, "21000000");

  // ── User B ────────────────────────────────────────────────────────────
  await postOpening(accB, userB.id);

  const bExpense = await recordExpense({
    entryDate: todayIso(),
    description: "خرید سوپراپلایر",
    cashAccountId: accB.bank.id,
    categoryAccountId: accB.expAcct.id,
    assetId: usd.id,
    quantity: usdOf("5000000"),
    baseValue: usdOf("5000000"),
    categoryId: (await getCategoryByCode("TRN-FUEL"))!.id,
    userId: userB.id,
  });
  await freeze(bExpense.id, "5000000");

  return { userA, userB, usd, accA, accB, entries: { cooler, misc, gift, income, bExpense } };
}

/** Snapshot of the immutable core for a user — used to prove it never moves. */
async function coreSnapshot(userId: string) {
  const [entries, postings, snapshots, lots, consumptions] = await Promise.all([
    db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.userId, userId))
      .orderBy(sql`id`),
    db.execute(sql`select p.entry_id, p.account_id, p.quantity::text, p.base_value::text, p.memo
                    from postings p join journal_entries je on je.id = p.entry_id
                    where je.user_id = ${userId} order by p.id`),
    db.execute(sql`select s.entry_id, s.irt_amount::text, s.usd_amount::text, s.fx_rate::text
                    from entry_fx_snapshots s join journal_entries je on je.id = s.entry_id
                    where je.user_id = ${userId} order by s.id`),
    db.execute(sql`select l.id, l.qty_remaining::text, l.unit_cost_base::text
                    from lots l where l.user_id = ${userId} order by l.id`),
    db.execute(sql`select lc.id, lc.quantity::text, lc.cost_base::text, lc.proceeds_base::text, lc.realized_pnl::text
                    from lot_consumptions lc join lots l on l.id = lc.lot_id
                    where l.user_id = ${userId} order by lc.id`),
  ]);
  return JSON.stringify([entries, postings.rows, snapshots.rows, lots.rows, consumptions.rows]);
}

/* ------------------------------------------------------------------ */

test("FROZEN — recorded Toman stays fixed when the dollar rate rises (210k → 220k)", async () => {
  const { userA, userB } = await fixture();

  const catBefore = await getFlowByCategory(6, userA.id);
  const acctBefore = await getFlowByAccount("expense", 6, userA.id);
  const cashBefore = await getCashflow(6, userA.id);

  // ── the reported scenario: rate change ─────────────────────────────
  await db.update(userFxSettings).set({ currentRate: NEW_RATE }).where(eq(userFxSettings.userId, userA.id));

  const catAfter = await getFlowByCategory(6, userA.id);
  const acctAfter = await getFlowByAccount("expense", 6, userA.id);
  const cashAfter = await getCashflow(6, userA.id);

  const byCode = <T extends { code: string }>(rows: T[]) => new Map(rows.map((r) => [r.code, r]));
  const cat = byCode(catAfter);

  // 1) Category leaves — the EXACT frozen Toman the user entered.
  for (const [code, irt] of [
    ["HSG-EQUIP", "80000000"],
    ["MSC-MISC", "15000000"],
    ["MSC-EMERGENCY", "12000000"],
  ] as const) {
    const row = cat.get(code)!;
    assert.ok(row, `category ${code} present`);
    assert.equal(D(row.totalToman).toString(), irt, `${code} frozen Toman`);
    assert.equal(row.entries, 1, `${code} entries`);
    assert.equal(row.entriesWithSnap, 1, `${code} entriesWithSnap`);
    // Before AND after the rate change — identical.
    assert.equal(D(byCode(catBefore).get(code)!.totalToman).toString(), irt, `${code} unchanged by rate change`);
    // And the buggy dynamic path WOULD have drifted — prove the fix matters:
    const drifted = D(row.total).mul(NEW_RATE).toFixed(0);
    assert.notEqual(drifted, irt, `${code} current-rate re-derivation differs (bug path)`);
  }
  // The reported number: 80,000,000/210,000 × 220,000 = 83,809,524 —
  // the category report must NOT show it.
  assert.equal(D(cat.get("HSG-EQUIP")!.total).mul(NEW_RATE).toFixed(0), "83809524", "bug-path value documented");
  assert.equal(D(cat.get("HSG-EQUIP")!.totalToman).toString(), "80000000", "frozen value wins");

  // 2) Expense-account breakdown — frozen aggregate.
  assert.equal(D(acctAfter[0].totalToman ?? "0").toString(), "107000000", "expense account frozen Toman");
  assert.equal(acctAfter[0].entries, 3);
  assert.equal(acctAfter[0].entriesWithSnap, 3);
  assert.equal(D(acctBefore[0].totalToman ?? "0").toString(), "107000000", "unchanged by rate change");

  // 3) Monthly cash flow — frozen Toman both sides + full coverage counters.
  const monthBefore = cashBefore.at(-1)!;
  const monthAfter = cashAfter.at(-1)!;
  assert.equal(D(monthAfter.outflowToman ?? "0").toString(), "107000000");
  assert.equal(D(monthAfter.inflowToman ?? "0").toString(), "21000000");
  assert.equal(monthAfter.outflowEntries, 3);
  assert.equal(monthAfter.outflowEntriesSnap, 3);
  assert.equal(monthAfter.inflowEntries, 1);
  assert.equal(monthAfter.inflowEntriesSnap, 1);
  assert.equal(D(monthBefore.outflowToman ?? "0").toString(), D(monthAfter.outflowToman ?? "0").toString());
  assert.equal(monthBefore.outflow, monthAfter.outflow, "USD book value is the accounting truth and never changes either");

  // 4) The other tenant's data is untouched by A's rate change.
  const bCash = await getCashflow(6, userB.id);
  assert.equal(D(bCash.at(-1)!.outflowToman ?? "0").toString(), "5000000");
});

test("LEDGER/FIFO CORE — journal, postings, snapshots, lots untouched by any rate change", async () => {
  const { userA } = await fixture();

  const before = await coreSnapshot(userA.id);
  await db.update(userFxSettings).set({ currentRate: NEW_RATE }).where(eq(userFxSettings.userId, userA.id));
  // Re-run every cash-flow read (the whole module's read surface).
  await Promise.all([getFlowByCategory(6, userA.id), getFlowByAccount("expense", 6, userA.id), getFlowByAccount("income", 6, userA.id), getCashflow(12, userA.id), getLedger(50, userA.id)]);
  const after = await coreSnapshot(userA.id);

  assert.equal(after, before, "immutable core byte-identical before/after rate change and reads");
});

test("TENANT ISOLATION — multi-tenant DB, no session: reads fail closed, never blend users", async () => {
  const { userA, userB } = await fixture();

  // No explicit identity + multi-tenant database → FAIL CLOSED (empty),
  // never a cross-tenant aggregate (the old getFlowByCategory leaked here).
  assert.deepEqual(await getFlowByCategory(6), []);
  assert.deepEqual(await getCashflow(6), []);
  assert.deepEqual(await getFlowByAccount("expense", 6), []);
  assert.deepEqual(await getFlowByAccount("income", 6), []);

  // B's view: exactly B's history — none of A's categories or amounts.
  const bCats = await getFlowByCategory(6, userB.id);
  assert.equal(bCats.length, 1, "B sees only his one category");
  assert.equal(bCats[0].code, "TRN-FUEL");
  assert.equal(D(bCats[0].totalToman).toString(), "5000000");
  assert.ok(!["HSG-EQUIP", "MSC-MISC", "MSC-EMERGENCY"].some((c) => bCats.some((r) => r.code === c)), "no A category leak");

  const bCash = await getCashflow(6, userB.id);
  assert.equal(D(bCash.at(-1)!.outflow).toString(), usdOf("5000000"));
  assert.ok(D(bCash.at(-1)!.outflow).lt("100"), "A's amounts never reach B");

  // A's view: exactly A's history.
  const aCats = await getFlowByCategory(6, userA.id);
  assert.equal(aCats.length, 3, "A sees only his three categories");
  assert.ok(!aCats.some((r) => r.code === "TRN-FUEL"), "no B category leak");
});

test("LEGACY PARTIAL COVERAGE — entries without a snapshot are flagged, never presented as frozen", async () => {
  const { userA, usd, accA } = await fixture();

  // A pre-snapshot (legacy) expense — no entry_fx_snapshots row at all.
  await postEntry({
    entryDate: todayIso(),
    type: "expense",
    description: "رستوران (داده قدیمی)",
    userId: userA.id,
    categoryId: (await getCategoryByCode("FOD-REST"))!.id,
    postings: [
      { accountId: accA.bank.id, assetId: usd.id, quantity: "-50", baseValue: "-50" },
      { accountId: accA.expAcct.id, assetId: usd.id, quantity: "50", baseValue: "50" },
    ],
  });

  const cats = await getFlowByCategory(6, userA.id);
  const byCode = new Map(cats.map((r) => [r.code, r]));

  // Legacy leaf: zero frozen Toman, coverage counter reveals the gap.
  const legacy = byCode.get("FOD-REST")!;
  assert.equal(legacy.entries, 1);
  assert.equal(legacy.entriesWithSnap, 0, "legacy entry has no snapshot");
  assert.equal(D(legacy.totalToman).toString(), "0");

  // Existing frozen leaves are unaffected.
  assert.equal(byCode.get("HSG-EQUIP")!.entriesWithSnap, 1);

  // Month is now only PARTIALLY covered → the page falls back to the dynamic
  // view instead of showing a partial sum as a freeze.
  const month = (await getCashflow(6, userA.id)).at(-1)!;
  assert.equal(month.outflowEntries, 4);
  assert.equal(month.outflowEntriesSnap, 3, "coverage incomplete");
  assert.notEqual(month.outflowEntries, month.outflowEntriesSnap);
});

test("SINGLE-USER LEGACY MODE — unresolved identity keeps the global view (no fail-closed)", async () => {
  await resetDb();
  await ensureCategoryCatalog();
  const [user] = await db.insert(users).values({ name: "کاربر تنها", role: "user" }).returning();
  const [cur] = await db.insert(currencies).values({ code: "USD", name: "دلار", symbol: "$", decimals: 2, isFiat: true }).returning();
  const [cls] = await db.insert(assetClasses).values({ code: "cash", name: "نقد و بانک", color: "#6e6ff0" }).returning();
  const [usd] = await db.insert(assets).values({ symbol: "USD", name: "دلار", classId: cls.id, currencyId: cur.id, decimals: 2 }).returning();
  await db.insert(prices).values({ assetId: usd.id, asOf: todayIso(), priceBase: "1", source: "manual" });
  const [bank] = await db.insert(accounts).values({ userId: user.id, code: "1010", name: "بانک", type: "asset", assetId: usd.id }).returning();
  const [exp] = await db.insert(accounts).values({ userId: user.id, code: "5010", name: "هزینه", type: "expense", assetId: usd.id }).returning();

  const entry = await recordExpense({
    entryDate: todayIso(),
    description: "خرید",
    cashAccountId: bank.id,
    categoryAccountId: exp.id,
    assetId: usd.id,
    quantity: "100",
    baseValue: "100",
    categoryId: (await getCategoryByCode("HSG-EQUIP"))!.id,
    userId: user.id,
  });
  await db.insert(entryFxSnapshots).values({
    entryId: entry.id,
    irtAmount: "21000000",
    usdAmount: "100",
    fxRate: OLD_RATE,
    rateSource: "settings",
    rateDate: todayIso(),
  });

  // Single-user database: session-less reads remain the legacy global view.
  const cats = await getFlowByCategory(6);
  assert.equal(cats.length, 1);
  assert.equal(cats[0].code, "HSG-EQUIP");
  assert.equal(D(cats[0].totalToman).toString(), "21000000");
});
