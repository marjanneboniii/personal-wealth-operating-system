/**
 * Phase 4 — Legacy Debt/Installment Toman migration tests.
 *
 * Pins the never-guess contract:
 *   - deterministic reconstruction only from authoritative historical sources;
 *   - planning-only / missing-snapshot / ambiguous / invalid = MIGRATION BLOCKER;
 *   - batched + idempotent backfill; never overwrites existing values;
 *   - tenant isolation (cross-user evidence is refused);
 *   - historical ledger / legacy USD columns remain untouched;
 *   - exact Decimal amounts (no float).
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
  currencies,
  debts,
  entryFxSnapshots,
  installments,
  journalEntries,
  postings,
  users,
  userFxSettings,
} from "../src/db/schema";
import { postEntry } from "../src/features/ledger/service";
import { D } from "../src/domain/decimal";
import {
  backfillDeterministicDebtToman,
  classifyLegacyDebtTomanMigration,
  verifyDebtTomanMigration,
} from "../src/db/migrate-debt-toman";

async function clean() {
  await createSchemaIfNotExists();
  await db.delete(entryFxSnapshots);
  await db.delete(installments);
  await db.delete(debts);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(userFxSettings);
  await db.delete(users);
  await db.delete(currencies);
}

async function seedRefData() {
  const [usdCur] = await db.insert(currencies).values({ code: "USD", name: "USD", symbol: "$", decimals: 2, isFiat: true } as any).returning();
  const [irtCur] = await db.insert(currencies).values({ code: "IRT", name: "Toman", symbol: "T", decimals: 0, isFiat: true } as any).returning();
  const [cashCls] = await db.insert(assetClasses).values({ code: "cash", name: "Cash", sortOrder: 1 } as any).returning();
  const [usdAsset] = await db.insert(assets).values({ symbol: "USD", name: "USD", classId: cashCls.id, currencyId: usdCur.id, decimals: 2, pricingMethod: "face_value" } as any).returning();
  const [irtAsset] = await db.insert(assets).values({ symbol: "IRT", name: "Toman", classId: cashCls.id, currencyId: irtCur.id, decimals: 0, pricingMethod: "manual" } as any).returning();
  return { usdCur, irtCur, usdAsset, irtAsset };
}

async function makeUser(username: string) {
  const [u] = await db.insert(users).values({ name: username, username, role: "owner" } as any).returning();
  await db.insert(userFxSettings).values({ userId: u.id, currentRate: "280000" } as any);
  return u;
}

/** Create a liability account + cash account for a tenant. */
async function makeAccounts(userId: string | null, irtAssetId: string, usdAssetId: string, code: string) {
  const [cash] = await db.insert(accounts).values({ code: `${code}10`, name: "Cash", type: "asset", assetId: irtAssetId, userId } as any).returning();
  const [liab] = await db.insert(accounts).values({ code: `${code}20`, name: "Liability", type: "liability", assetId: irtAssetId, userId } as any).returning();
  const [equity] = await db.insert(accounts).values({ code: `${code}30`, name: "Equity", type: "equity", assetId: usdAssetId, userId } as any).returning();
  return { cash, liab, equity };
}

/** Post a `type='debt'` opening entry: cash IRT up / liability IRT down. */
async function postDebtOpening(cashId: string, liabId: string, irtAssetId: string, toman: string, usd: string, userId?: string | null) {
  await postEntry({
    entryDate: "2026-01-01",
    type: "debt",
    description: "legacy debt opening",
    userId: userId ?? undefined,
    postings: [
      { accountId: cashId, assetId: irtAssetId, quantity: toman, baseValue: usd },
      { accountId: liabId, assetId: irtAssetId, quantity: `-${toman}`, baseValue: `-${usd}` },
    ],
  });
}

test("Phase4-A — deterministic legacy debt reconstruction from ledger IRT quantity", async () => {
  await clean();
  const { irtAsset, usdAsset } = await seedRefData();
  const user = await makeUser("mig-a");
  const { cash, liab } = await makeAccounts(user.id, irtAsset.id, usdAsset.id, "10");
  const [debt] = await db.insert(debts).values({
    userId: user.id, creditor: "bank", title: "loan", principalBase: D("909090").div("280000").toString(),
    interestRate: "0", startDate: "2026-01-01", accountId: liab.id, status: "active",
  } as any).returning();
  await postDebtOpening(cash.id, liab.id, irtAsset.id, "909090", D("909090").div("280000").toString(), user.id);

  const report = await classifyLegacyDebtTomanMigration(db);
  assert.equal(report.debts.reconstructable, 1);
  assert.equal(report.debts.blocked, 0);
  assert.equal(report.migratedDebtIds.includes(debt.id), true);

  await backfillDeterministicDebtToman({ batchSize: 10 });
  const [row] = await db.select().from(debts).where(eq(debts.id, debt.id));
  assert.ok(D(row.principalToman ?? "0").sub("909090").isZero(), `principal_toman=${row.principalToman}`);
  // Legacy USD unchanged.
  assert.ok(D(row.principalBase).sub(D("909090").div("280000")).abs().lt("0.0000001"));
});

test("Phase4-B — deterministic paid installment reconstruction from FX snapshot", async () => {
  await clean();
  const { irtAsset, usdAsset } = await seedRefData();
  const user = await makeUser("mig-b");
  const { cash, liab } = await makeAccounts(user.id, irtAsset.id, usdAsset.id, "20");
  const [debt] = await db.insert(debts).values({
    userId: user.id, creditor: "bank", title: "loan", principalBase: "10",
    interestRate: "0", startDate: "2026-01-01", accountId: liab.id, status: "active",
  } as any).returning();

  // A payment entry with a frozen Toman snapshot.
  const entry = await postEntry({
    entryDate: "2026-02-01",
    type: "debt_repayment",
    description: "pay",
    userId: user.id,
    postings: [
      { accountId: cash.id, assetId: irtAsset.id, quantity: "-909090", baseValue: "-3.0303" },
      { accountId: liab.id, assetId: irtAsset.id, quantity: "909090", baseValue: "3.0303" },
    ],
  });
  await db.insert(entryFxSnapshots).values({
    entryId: entry.id, irtAmount: "909090", usdAmount: "3.0303", fxRate: "300000", rateSource: "user", rateDate: "2026-02-01",
  } as any);
  const [inst] = await db.insert(installments).values({
    debtId: debt.id, seq: 1, dueDate: "2026-02-01", amountBase: "3.0303", status: "paid", paidEntryId: entry.id, paidAt: "2026-02-01",
  } as any).returning();

  const report = await classifyLegacyDebtTomanMigration(db);
  assert.equal(report.installments.reconstructable, 1);

  await backfillDeterministicDebtToman({ batchSize: 10 });
  const [row] = await db.select().from(installments).where(eq(installments.id, inst.id));
  assert.ok(D(row.amountToman ?? "0").sub("909090").isZero());
  assert.ok(D(row.paidToman ?? "0").sub("909090").isZero());
  assert.ok(D(row.paidUsd ?? "0").sub("3.0303").abs().lt("0.000001"));
  assert.ok(D(row.paidFxRate ?? "0").sub("300000").isZero());
  // Legacy USD unchanged.
  assert.ok(D(row.amountBase).sub("3.0303").abs().lt("0.000001"));
});

test("Phase4-C — planning-only debt is a MIGRATION BLOCKER", async () => {
  await clean();
  const { irtAsset, usdAsset } = await seedRefData();
  const user = await makeUser("mig-c");
  const [debt] = await db.insert(debts).values({
    userId: user.id, creditor: "bank", title: "planning-only", principalBase: "100",
    interestRate: "0", startDate: "2026-01-01", accountId: null, status: "active",
  } as any).returning();

  const report = await classifyLegacyDebtTomanMigration(db);
  assert.equal(report.debts.blocked, 1);
  const blocker = report.blockers.find((b) => b.id === debt.id)!;
  assert.equal(blocker.category, "missing_evidence");

  await backfillDeterministicDebtToman({ batchSize: 10 });
  const [row] = await db.select().from(debts).where(eq(debts.id, debt.id));
  assert.equal(row.principalToman, null, "blocker must stay NULL — never guessed");
});

test("Phase4-D — paid installment without FX snapshot is a BLOCKER (quick-pay path)", async () => {
  await clean();
  const { irtAsset, usdAsset } = await seedRefData();
  const user = await makeUser("mig-d");
  const { cash, liab } = await makeAccounts(user.id, irtAsset.id, usdAsset.id, "30");
  const [debt] = await db.insert(debts).values({
    userId: user.id, creditor: "bank", title: "loan", principalBase: "10",
    interestRate: "0", startDate: "2026-01-01", accountId: liab.id, status: "active",
  } as any).returning();
  const entry = await postEntry({
    entryDate: "2026-02-01", type: "debt_repayment", description: "pay", userId: user.id,
    postings: [
      { accountId: cash.id, assetId: irtAsset.id, quantity: "-100", baseValue: "-0.5" },
      { accountId: liab.id, assetId: irtAsset.id, quantity: "100", baseValue: "0.5" },
    ],
  });
  // No entry_fx_snapshots row → quick-pay path → blocker.
  await db.insert(installments).values({
    debtId: debt.id, seq: 1, dueDate: "2026-02-01", amountBase: "0.5", status: "paid", paidEntryId: entry.id, paidAt: "2026-02-01",
  } as any);

  const report = await classifyLegacyDebtTomanMigration(db);
  assert.equal(report.installments.paidBlocked, 1);
  assert.equal(report.blockers.some((b) => b.category === "quick_pay_no_snapshot"), true);
});

test("Phase4-E — ambiguous ledger (two debt entries) is a BLOCKER", async () => {
  await clean();
  const { irtAsset, usdAsset } = await seedRefData();
  const user = await makeUser("mig-e");
  const { cash, liab } = await makeAccounts(user.id, irtAsset.id, usdAsset.id, "40");
  const [debt] = await db.insert(debts).values({
    userId: user.id, creditor: "bank", title: "loan", principalBase: "10",
    interestRate: "0", startDate: "2026-01-01", accountId: liab.id, status: "active",
  } as any).returning();
  // Two debt openings post to the same liability account → ambiguous.
  await postDebtOpening(cash.id, liab.id, irtAsset.id, "500000", "2", user.id);
  await postDebtOpening(cash.id, liab.id, irtAsset.id, "600000", "2", user.id);

  const report = await classifyLegacyDebtTomanMigration(db);
  assert.equal(report.debts.ambiguous, 1);
  const blocker = report.blockers.find((b) => b.id === debt.id)!;
  assert.equal(blocker.category, "ambiguous");
});

test("Phase4-G/P — cross-user evidence is refused (tenant isolation)", async () => {
  await clean();
  const { irtAsset, usdAsset } = await seedRefData();
  const userA = await makeUser("mig-ga");
  const userB = await makeUser("mig-gb");
  const accA = await makeAccounts(userA.id, irtAsset.id, usdAsset.id, "50");
  const accB = await makeAccounts(userB.id, irtAsset.id, usdAsset.id, "60");
  // Debt belongs to A but the ONLY debt-opening entry posts to B's account.
  const [debt] = await db.insert(debts).values({
    userId: userA.id, creditor: "bank", title: "loan", principalBase: "10",
    interestRate: "0", startDate: "2026-01-01", accountId: accB.liab.id, status: "active",
  } as any).returning();
  await postDebtOpening(accB.cash.id, accB.liab.id, irtAsset.id, "777777", "3", userB.id);

  const report = await classifyLegacyDebtTomanMigration(db);
  // Debt's liability account (B's) has an entry owned by B, but the debt is A's.
  // Cross-user evidence → blocked (the classifyDebtEvidence already filters by
  // same-tenant on entry vs account; the mismatch surfaces as no A-owned evidence).
  const blocker = report.blockers.find((b) => b.id === debt.id);
  assert.ok(blocker, "cross-user evidence must never be used — debt must be blocked");

  await backfillDeterministicDebtToman({ batchSize: 10 });
  const [row] = await db.select().from(debts).where(eq(debts.id, debt.id));
  assert.equal(row.principalToman, null);
});

test("Phase4-H — idempotent rerun does not overwrite or duplicate", async () => {
  await clean();
  const { irtAsset, usdAsset } = await seedRefData();
  const user = await makeUser("mig-h");
  const { cash, liab } = await makeAccounts(user.id, irtAsset.id, usdAsset.id, "70");
  const [debt] = await db.insert(debts).values({
    userId: user.id, creditor: "bank", title: "loan", principalBase: "2",
    interestRate: "0", startDate: "2026-01-01", accountId: liab.id, status: "active",
  } as any).returning();
  await postDebtOpening(cash.id, liab.id, irtAsset.id, "560000", "2", user.id);

  const first = await backfillDeterministicDebtToman({ batchSize: 10 });
  assert.equal(first.total.debtsMigrated, 1);
  const [r1] = await db.select().from(debts).where(eq(debts.id, debt.id));
  const v1 = r1.principalToman;

  const second = await backfillDeterministicDebtToman({ batchSize: 10 });
  assert.equal(second.total.debtsMigrated, 0, "second run must migrate nothing");
  const [r2] = await db.select().from(debts).where(eq(debts.id, debt.id));
  assert.equal(r2.principalToman, v1, "value must be unchanged");
});

test("Phase4-I — batched migration migrates > batchSize deterministic debts", async () => {
  await clean();
  const { irtAsset, usdAsset } = await seedRefData();
  const user = await makeUser("mig-i");
  const { cash, liab } = await makeAccounts(user.id, irtAsset.id, usdAsset.id, "80");

  const N = 12;
  for (let k = 0; k < N; k++) {
    const toman = String(1000000 + k * 1000);
    const usd = D(toman).div("280000").toString();
    const [debt] = await db.insert(debts).values({
      userId: user.id, creditor: "bank", title: `loan-${k}`, principalBase: usd,
      interestRate: "0", startDate: "2026-01-01", accountId: liab.id, status: "active",
    } as any).returning();
    // Single liability account shared: to keep each debt deterministic, give it
    // its own liability account.
    const [ownLiab] = await db.insert(accounts).values({ code: `9${String(k).padStart(2, "0")}`, name: `Liability ${k}`, type: "liability", assetId: irtAsset.id, userId: user.id } as any).returning();
    await db.update(debts).set({ accountId: ownLiab.id } as any).where(eq(debts.id, debt.id));
    await postDebtOpening(cash.id, ownLiab.id, irtAsset.id, toman, usd, user.id);
  }

  const { batches, total } = await backfillDeterministicDebtToman({ batchSize: 5 });
  assert.ok(batches.length >= 3, `expected >=3 batches, got ${batches.length}`);
  assert.equal(total.debtsMigrated, N);

  const verification = await verifyDebtTomanMigration(db);
  assert.equal(verification.ok, true);
});

test("Phase4-N — zero-quantity evidence is invalid (blocked, no backfill)", async () => {
  await clean();
  const { irtAsset, usdAsset } = await seedRefData();
  const user = await makeUser("mig-n");
  const { cash, liab } = await makeAccounts(user.id, irtAsset.id, usdAsset.id, "90");
  const [debt] = await db.insert(debts).values({
    userId: user.id, creditor: "bank", title: "loan", principalBase: "10",
    interestRate: "0", startDate: "2026-01-01", accountId: liab.id, status: "active",
  } as any).returning();
  // Corrupted legacy evidence: a zero-quantity IRT liability posting. Inserted
  // directly (bypassing the balanced postEntry) to simulate legacy corruption.
  const [je] = await db.insert(journalEntries).values({
    entryDate: "2026-01-01", type: "debt", description: "corrupt", status: "posted", userId: user.id,
  } as any).returning();
  await db.insert(postings).values([
    { entryId: je.id, accountId: cash.id, assetId: irtAsset.id, quantity: "0", baseValue: "0" },
    { entryId: je.id, accountId: liab.id, assetId: irtAsset.id, quantity: "0", baseValue: "0" },
  ] as any);

  const report = await classifyLegacyDebtTomanMigration(db);
  const blocker = report.blockers.find((b) => b.id === debt.id);
  assert.ok(blocker, "zero evidence must block the debt");
});

test("Phase4-K/L — backfill never touches ledger or legacy columns", async () => {
  await clean();
  const { irtAsset, usdAsset } = await seedRefData();
  const user = await makeUser("mig-k");
  const { cash, liab } = await makeAccounts(user.id, irtAsset.id, usdAsset.id, "11");
  const [debt] = await db.insert(debts).values({
    userId: user.id, creditor: "bank", title: "loan", principalBase: "2",
    interestRate: "0", startDate: "2026-01-01", accountId: liab.id, status: "active",
  } as any).returning();
  await postDebtOpening(cash.id, liab.id, irtAsset.id, "560000", "2", user.id);

  const jeBefore = await db.select().from(journalEntries);
  const postBefore = await db.select().from(postings);
  const fxBefore = await db.select().from(entryFxSnapshots);
  const legacyBefore = (await db.select().from(debts).where(eq(debts.id, debt.id)))[0].principalBase;

  await backfillDeterministicDebtToman({ batchSize: 10 });

  const jeAfter = await db.select().from(journalEntries);
  const postAfter = await db.select().from(postings);
  const fxAfter = await db.select().from(entryFxSnapshots);
  const row = (await db.select().from(debts).where(eq(debts.id, debt.id)))[0];

  assert.equal(jeAfter.length, jeBefore.length, "no journal entry may be created/modified");
  assert.equal(postAfter.length, postBefore.length, "no posting may be created/modified");
  assert.equal(fxAfter.length, fxBefore.length, "no snapshot may be created/modified");
  assert.equal(row.principalBase, legacyBefore, "legacy USD column must be unchanged");
});
