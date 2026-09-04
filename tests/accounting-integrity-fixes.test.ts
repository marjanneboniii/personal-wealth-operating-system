/**
 * Financial Accounting Integrity — P&L / Debt corrections (regression).
 *
 * Locks the targeted fixes:
 *
 *   1. QUICK PAY FX — an IRT-anchored installment created at one rate but paid
 *      at another posts the PAYMENT-rate USD equivalent to the ledger
 *      (amount_toman ÷ payment_fx_rate), never the stale creation-time USD
 *      (`amount_usd_created`). 909,090 Toman created at 280,000, paid at
 *      300,000 → ledger legs ±3.0303, while `amount_usd_created` ≈ 3.24675
 *      stays untouched.
 *
 *   2. REAL ASSET SALE — selling a property (5B → 7.2B Toman) books the
 *      realized gain (+2.2B Toman) through the ledger's realized-P&L account
 *      WITHOUT touching FIFO, removes the property from holdings/valuation so
 *      its unrealized P&L is exactly 0, and the unified `getRealizedPnl`
 *      includes the real-asset result.
 *
 *   3. NET WORTH = Assets − ACCOUNTING LIABILITIES only — a debt's future
 *      installment schedule (principal + future interest) is a contractual
 *      obligation, NOT a balance-sheet liability. Net worth must subtract only
 *      the ledger liability; the schedule is reported separately.
 *
 *   4. FX REVALUATION — an IRT-anchored balance keeps its Toman fixed while
 *      its USD equivalent moves; a USD-anchored balance keeps its USD fixed
 *      while its Toman equivalent moves.
 *
 *   5. Σ(base_value) = 0 is preserved on every entry the fixes create.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assetClasses,
  assets,
  cities,
  currencies,
  debts,
  entryFxSnapshots,
  installments,
  journalEntries,
  lotConsumptions,
  lots,
  neighborhoods,
  postings,
  prices,
  propertyTypes,
  realEstateProperties,
  realEstateValuationSnapshots,
  userFxSettings,
  users,
  exchangeRates,
  rwaOwnershipRecords,
  vehicleAssets,
} from "../src/db/schema";
import { postEntry } from "../src/features/ledger/service";
import {
  calculateInstallmentPayment,
  buildInstallmentPaymentSnapshot,
} from "../src/features/planning/installmentFx";
import { payInstallment } from "../src/features/planning/service";
import { getHoldings, getRealizedPnl } from "../src/features/ledger/queries";
import { getCurrentNetWorth, getPortfolioValuation } from "../src/features/portfolio/service";
import {
  createRealEstateAsset,
  listRealEstateAssets,
  sellRealEstateAsset,
} from "../src/features/rwa/realEstate/service";
import { seedRealEstateMasterData } from "../src/features/rwa/realEstate/masterData";
import { D } from "../src/domain/decimal";

async function cleanAll() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(entryFxSnapshots);
  await db.delete(installments);
  await db.delete(debts);
  await db.delete(realEstateValuationSnapshots);
  await db.delete(realEstateProperties);
  await db.delete(vehicleAssets);
  await db.delete(rwaOwnershipRecords);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(prices);
  await db.delete(accounts);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(exchangeRates);
  await db.delete(userFxSettings);
  await db.delete(users);
  await db.delete(neighborhoods);
  await db.delete(propertyTypes);
  await db.delete(cities);
}

async function makeUser(name: string, rate: string) {
  const [user] = await db
    .insert(users)
    .values({ name, username: name.toLowerCase().replace(/\s+/g, "-"), role: "owner" } as any)
    .returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: rate } as any);
  return user;
}

/** USD face-value cash asset + a tenant-owned asset/liability/equity account. */
async function makeMoneyChart(userId: string) {
  const [usdCur] = await db
    .insert(currencies)
    .values({ code: "USD", name: "US Dollar", symbol: "$", decimals: 2, isFiat: true } as any)
    .returning();
  const [cashCls] = await db
    .insert(assetClasses)
    .values({ code: "cash", name: "Cash", sortOrder: 1 } as any)
    .returning();
  const [usdAsset] = await db
    .insert(assets)
    .values({ symbol: "USD", name: "USD Cash", classId: cashCls.id, currencyId: usdCur.id, decimals: 2, pricingMethod: "face_value" } as any)
    .returning();
  const [cash] = await db
    .insert(accounts)
    .values({ code: "1010", name: "Cash USD", type: "asset", assetId: usdAsset.id, userId } as any)
    .returning();
  const [liability] = await db
    .insert(accounts)
    .values({ code: "2010", name: "Loan", type: "liability", assetId: usdAsset.id, userId } as any)
    .returning();
  const [equity] = await db
    .insert(accounts)
    .values({ code: "3010", name: "Opening Equity", type: "equity", assetId: usdAsset.id, userId } as any)
    .returning();
  return { usdAsset, cash, liability, equity };
}

async function sumPostings(entryId: string): Promise<number> {
  const lines = await db.select().from(postings).where(eq(postings.entryId, entryId));
  return Number(lines.reduce((s, l) => s.add(D(l.baseValue)), D("0")));
}

/* ────────────────────────────────────────────────────────────────────
   1. Quick Pay FX change — shared payment calculation
   ──────────────────────────────────────────────────────────────────── */

test("shared payment calc — Quick Pay and Payment Form agree on payment-rate USD", () => {
  const direct = calculateInstallmentPayment({ amountToman: "909090", fxRate: "300000" });
  assert.equal(direct.paidToman, "909090");
  assert.equal(direct.paidFxRate, "300000");
  assert.ok(D(direct.paidUsd).sub("3.0303").abs().lt("0.0001"), `paidUsd=${direct.paidUsd}`);

  // The legacy snapshot helper must produce the exact same arithmetic.
  const wrapper = buildInstallmentPaymentSnapshot({ paidToman: "909090", fxRate: "300000" });
  assert.deepEqual(wrapper, direct);
});

test("Quick Pay — ledger posts payment-rate USD, creation-time USD stays frozen", async () => {
  await cleanAll();
  const user = await makeUser("QuickPayOwner", "280000");
  const { cash, liability } = await makeMoneyChart(user.id);

  // Installment of 909,090 Toman created at 280,000 → amount_usd_created ≈ 3.24675.
  const [debt] = await db
    .insert(debts)
    .values({
      userId: user.id,
      title: "قسط تست",
      creditor: "بانک",
      principalBase: D("909090").div("280000").toString(),
      principalToman: "909090",
      principalUsdCreated: D("909090").div("280000").toString(),
      startDate: "2026-08-01",
      accountId: liability.id,
      status: "active",
    } as any)
    .returning();
  const [inst] = await db
    .insert(installments)
    .values({
      debtId: debt.id,
      seq: 1,
      dueDate: "2026-09-01",
      amountBase: D("909090").div("280000").toString(),
      amountToman: "909090",
      amountUsdCreated: D("909090").div("280000").toString(),
      originalFxRate: "280000",
      originalFxRateCapturedAt: new Date("2026-08-01T00:00:00Z"),
      status: "pending",
    } as any)
    .returning();

  // Rate moves 280k → 300k before the payment.
  await db.update(userFxSettings).set({ currentRate: "300000" }).where(eq(userFxSettings.userId, user.id));

  const entry = await payInstallment(inst.id, cash.id, user.id);
  assert.ok(entry.id);

  const [after] = await db.select().from(installments).where(eq(installments.id, inst.id));
  assert.equal(after.status, "paid");
  assert.equal(D(after.paidToman!).toFixed(0), "909090", "paid_toman is the frozen contractual Toman");
  assert.equal(D(after.paidFxRate!).toString(), "300000", "payment FX rate frozen at payment time");
  assert.ok(D(after.paidUsd!).sub("3.0303").abs().lt("0.0001"), `paid_usd=${after.paidUsd}`);
  // Creation-time USD snapshot is untouched.
  assert.ok(D(after.amountUsdCreated!).sub("3.24675").abs().lt("0.0001"), "amount_usd_created must stay frozen");
  assert.equal(D(after.amountToman!).toFixed(0), "909090", "amount_toman must not move with FX");

  // The ledger legs are the payment-rate USD (3.0303), NOT the stale 3.24675.
  const lines = await db.select().from(postings).where(eq(postings.entryId, entry.id));
  assert.equal(lines.length, 2);
  const cashLeg = lines.find((l) => D(l.baseValue).isNegative())!;
  const liabLeg = lines.find((l) => D(l.baseValue).isPositive())!;
  assert.ok(D(cashLeg.baseValue).sub("-3.0303").abs().lt("0.0001"), `cash base=${cashLeg.baseValue}`);
  assert.ok(D(liabLeg.baseValue).sub("3.0303").abs().lt("0.0001"), `liability base=${liabLeg.baseValue}`);
  assert.equal((await sumPostings(entry.id)).toFixed(6), "0.000000", "entry stays balanced");
});

/* ────────────────────────────────────────────────────────────────────
   2. Real asset sale — realized gain in ledger, unrealized → 0
   ──────────────────────────────────────────────────────────────────── */

test("Real Asset sale — 5B → 7.2B Toman books +2.2B realized, 0 unrealized", async () => {
  await cleanAll();
  await seedRealEstateMasterData();
  const user = await makeUser("Seller", "100000");
  const { cash } = await makeMoneyChart(user.id);

  const [cityRow] = await db.select().from(cities).where(eq(cities.code, "AHZ")).limit(1);
  const [hoodRow] = await db.select().from(neighborhoods).where(eq(neighborhoods.code, "KPE")).limit(1);
  const [typeRow] = await db.select().from(propertyTypes).where(eq(propertyTypes.code, "APT")).limit(1);
  assert.ok(cityRow && hoodRow && typeRow, "master data must be seeded");

  const created = await createRealEstateAsset({
    userId: user.id,
    cityId: cityRow.id,
    neighborhoodId: hoodRow.id,
    propertyTypeId: typeRow.id,
    acquisitionDate: "2025-08-11",
    acquisitionDatePersian: "1404/05/20",
    valuationDate: "2026-08-11",
    valuationDatePersian: "1405/05/20",
    purchasePriceToman: "5000000000",
    currentValueToman: "7200000000",
    purchaseFxRate: "100000",
    valuationFxRate: "100000",
  });
  assert.equal(created.symbol, "001");

  // Before sale the property contributes to the portfolio valuation.
  const before = await getPortfolioValuation(undefined, user.id);
  const propBefore = before.assetValuations.find((a) => a.assetId === created.assetId);
  assert.ok(propBefore, "property must be valued before the sale");

  const sale = await sellRealEstateAsset({
    propertyId: created.id,
    saleDate: "2026-08-20",
    salePriceToman: "7200000000",
    saleFxRate: "120000",
    saleAccountId: cash.id,
    userId: user.id,
  });

  // 7.2B − 5B = +2.2B realized Toman (the sale price drives the result).
  assert.equal(sale.realizedToman, "2200000000");
  // purchase USD = 5B ÷ 100k = 50,000 ; sale USD = 7.2B ÷ 120k = 60,000 → +10,000.
  assert.ok(D(sale.realizedUsd).sub("10000.00").abs().lt("0.01"), `realizedUsd=${sale.realizedUsd}`);

  // Ledger: a balanced "sell" entry with a 4100 realized-P&L leg.
  assert.equal((await sumPostings(sale.ledgerEntryId)).toFixed(6), "0.000000");
  const saleLines = await db.select().from(postings).where(eq(postings.entryId, sale.ledgerEntryId));
  const pnlLeg = saleLines.find((l) => D(l.baseValue).isNegative() && (l.memo ?? "").includes("سود/زیان"));
  assert.ok(pnlLeg, "a realized P&L leg must exist");
  assert.ok(D(pnlLeg.baseValue).sub("-10000.00").abs().lt("0.01"), `pnl leg=${pnlLeg.baseValue}`);
  const [saleEntry] = await db.select().from(journalEntries).where(eq(journalEntries.id, sale.ledgerEntryId)).limit(1);
  assert.equal(saleEntry.type, "sell");

  // The property is gone from holdings + valuation → unrealized contribution = 0.
  const holdings = await getHoldings(user.id);
  assert.ok(!holdings.some((h) => h.assetId === created.assetId), "sold property must leave holdings");
  const after = await getPortfolioValuation(undefined, user.id);
  assert.ok(
    !after.assetValuations.some((a) => a.assetId === created.assetId),
    "sold property must leave portfolio valuation",
  );
  assert.equal((await listRealEstateAssets(user.id)).length, 0, "property removed from registry");

  // Unified realized P&L now includes the real-asset gain.
  const pnl = await getRealizedPnl(user.id);
  assert.ok(D(pnl.total).sub("10000.00").abs().lt("0.01"), `unified realized=${pnl.total}`);

  // The sale froze its Toman + FX snapshot.
  const [snap] = await db
    .select()
    .from(entryFxSnapshots)
    .where(eq(entryFxSnapshots.entryId, sale.ledgerEntryId))
    .limit(1);
  assert.ok(snap, "sale must freeze an entry_fx_snapshots row");
  assert.equal(D(snap.irtAmount).toFixed(0), "7200000000");
  assert.equal(D(snap.fxRate).toString(), "120000");
});

/* ────────────────────────────────────────────────────────────────────
   3. Net Worth = Assets − Accounting Liabilities only
   ──────────────────────────────────────────────────────────────────── */

test("Net Worth subtracts only ACCOUNTING liabilities — the schedule is reported separately", async () => {
  await cleanAll();
  const user = await makeUser("NetWorthOwner", "280000");
  const { usdAsset, cash, liability, equity } = await makeMoneyChart(user.id);

  // Assets: 10,000 USD opening + 8,000 USD loan received = 18,000.
  await postEntry({
    entryDate: "2026-01-01",
    type: "opening",
    description: "opening cash",
    userId: user.id,
    postings: [
      { accountId: cash.id, assetId: usdAsset.id, quantity: "10000", baseValue: "10000" },
      { accountId: equity.id, assetId: usdAsset.id, quantity: "-10000", baseValue: "-10000" },
    ],
  });
  await postEntry({
    entryDate: "2026-01-02",
    type: "debt",
    description: "loan received",
    userId: user.id,
    postings: [
      { accountId: cash.id, assetId: usdAsset.id, quantity: "8000", baseValue: "8000" },
      { accountId: liability.id, assetId: usdAsset.id, quantity: "-8000", baseValue: "-8000" },
    ],
  });

  // A ledger-backed debt whose schedule (12 × 218,400,000 = 2,620,800,000 Toman)
  // EXCEEDS its principal (2,240,000,000 Toman = 8,000 USD) because of interest.
  const [debt] = await db
    .insert(debts)
    .values({
      userId: user.id,
      title: "وام",
      creditor: "بانک",
      principalBase: "8000",
      principalToman: "2240000000",
      principalUsdCreated: "8000",
      interestRate: "10",
      startDate: "2026-01-01",
      accountId: liability.id,
      status: "active",
    } as any)
    .returning();
  await db.insert(installments).values(
    Array.from({ length: 12 }, (_, i) => ({
      debtId: debt.id,
      seq: i + 1,
      dueDate: `2026-${String(i + 1).padStart(2, "0")}-01`,
      amountBase: D("218400000").div("280000").toString(),
      amountToman: "218400000",
      amountUsdCreated: D("218400000").div("280000").toString(),
      originalFxRate: "280000",
      originalFxRateCapturedAt: new Date("2026-01-01T00:00:00Z"),
      status: "pending",
    })),
  );

  const nw = await getCurrentNetWorth(user.id);

  // Accounting liabilities come from the LEDGER only (8,000), not the schedule.
  assert.equal(Number(nw.totalLiabilities).toFixed(2), "8000.00", "liabilities must be ledger-only");
  // Net worth = assets (18,000) − accounting liabilities (8,000).
  assert.equal(Number(nw.netWorth).toFixed(2), "10000.00", "net worth = assets − accounting liabilities");

  // The future contractual obligation (schedule) is exposed separately.
  assert.equal(D(nw.futureObligationsToman).toFixed(0), "2620800000");
  assert.ok(
    D(nw.futureObligationsUsd).sub(D("2620800000").div("280000")).abs().lt("0.0001"),
    "future obligations are reported separately, never folded into net worth",
  );
});

/* ────────────────────────────────────────────────────────────────────
   4. FX revaluation — IRT stays IRT, USD stays USD
   ──────────────────────────────────────────────────────────────────── */

test("FX revaluation — IRT balance keeps its Toman, USD balance keeps its USD", async () => {
  await cleanAll();
  const user = await makeUser("FxOwner", "200000");

  const [usdCur] = await db.insert(currencies).values({ code: "USD", name: "USD", symbol: "$", decimals: 2, isFiat: true } as any).returning();
  const [irtCur] = await db.insert(currencies).values({ code: "IRT", name: "Toman", symbol: "T", decimals: 0, isFiat: true } as any).returning();
  const [cashCls] = await db.insert(assetClasses).values({ code: "cash", name: "Cash", sortOrder: 1 } as any).returning();
  const [usdAsset] = await db.insert(assets).values({ symbol: "USD", name: "USD", classId: cashCls.id, currencyId: usdCur.id, decimals: 2, pricingMethod: "face_value" } as any).returning();
  const [irtAsset] = await db.insert(assets).values({ symbol: "IRT", name: "Toman", classId: cashCls.id, currencyId: irtCur.id, decimals: 0, pricingMethod: "manual" } as any).returning();
  const [usdAcct] = await db.insert(accounts).values({ code: "1020", name: "USD", type: "asset", assetId: usdAsset.id, userId: user.id } as any).returning();
  const [irtAcct] = await db.insert(accounts).values({ code: "1010", name: "IRT", type: "asset", assetId: irtAsset.id, userId: user.id } as any).returning();
  const [equity] = await db.insert(accounts).values({ code: "3010", name: "Equity", type: "equity", assetId: usdAsset.id, userId: user.id } as any).returning();

  const irtUsd = D("10000000000").div("200000"); // 50,000 USD book
  await postEntry({
    entryDate: "2026-01-01",
    type: "opening",
    description: "open USD + IRT",
    userId: user.id,
    postings: [
      { accountId: usdAcct.id, assetId: usdAsset.id, quantity: "50000", baseValue: "50000" },
      { accountId: irtAcct.id, assetId: irtAsset.id, quantity: "10000000000", baseValue: irtUsd.toString() },
      {
        accountId: equity.id,
        assetId: usdAsset.id,
        quantity: D("50000").add(irtUsd).neg().toString(),
        baseValue: D("50000").add(irtUsd).neg().toString(),
      },
    ],
  });

  const at200k = await getPortfolioValuation(undefined, user.id);
  const usd200 = at200k.assetValuations.find((a) => a.symbol === "USD")!;
  const irt200 = at200k.assetValuations.find((a) => a.symbol === "IRT")!;
  assert.ok(D(usd200.currentValue).sub("50000").isZero(), "USD value is USD-anchored");
  assert.equal(D(irt200.currentValueToman).toFixed(0), "10000000000", "IRT value is IRT-anchored (10B Toman)");

  // FX rises 200k → 250k.
  await db.update(userFxSettings).set({ currentRate: "250000" }).where(eq(userFxSettings.userId, user.id));
  const at250k = await getPortfolioValuation(undefined, user.id);
  const usd250 = at250k.assetValuations.find((a) => a.symbol === "USD")!;
  const irt250 = at250k.assetValuations.find((a) => a.symbol === "IRT")!;

  assert.ok(D(usd250.currentValue).sub("50000").isZero(), "USD stays $50k");
  assert.ok(D(usd250.currentValueToman).sub(D("50000").mul("250000")).abs().lt("1"), "USD Toman equivalent follows FX");
  assert.equal(D(irt250.currentValueToman).toFixed(0), "10000000000", "IRT stays 10B Toman");
  assert.ok(D(irt250.currentValue).sub(D("10000000000").div("250000")).abs().lt("0.001"), "IRT USD equivalent follows FX");
});
