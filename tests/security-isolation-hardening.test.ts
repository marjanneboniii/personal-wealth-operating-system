/**
 * Security Isolation Hardening — regression tests for the 2026-08 security
 * remediation mission (H-01, H-02, M-01, M-02 Ledger/Accounts, M-03, M-04 +
 * multi-user read isolation enforced at the DB query level).
 *
 * Scenario (mission §14): two real authenticated users USER_A and USER_B.
 * USER_A owns 1 transaction, 1 account, 1 property, 1 vehicle, 1 ownership
 * record and 1 valuation. USER_B must not be able to GET / UPDATE / DELETE /
 * REVERSE / VALUATE any of them (§15: every ID-manipulation attempt from B's
 * session must end DENIED — never 200).
 *
 * The Accounting Core itself (FIFO / postings / balances / reverseEntry
 * semantics) is exercised as UNCHANGED behaviour: reversals keep history and
 * net the balance back to zero; double-pay / double-reverse races are closed
 * purely by transaction boundaries and row locks.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assetClasses,
  assets,
  auditLog,
  backupRuns,
  currencies,
  debts,
  entryFxSnapshots,
  installments,
  journalEntries,
  lotConsumptions,
  lots,
  postings,
  prices,
  realEstateProperties,
  rwaOwnershipRecords,
  sessions,
  userFxSettings,
  users,
  vehicleAssets,
  vehicleBrands,
  vehicleCatalog,
  vehicleValuationSnapshots,
  wallets,
} from "../src/db/schema";
import { eq, inArray } from "drizzle-orm";
import { recordIncome, reverseEntry } from "../src/features/ledger/service";
import { getAccountBalances } from "../src/features/ledger/queries";
import { payInstallment } from "../src/features/planning/service";
import {
  listRealEstateAssets,
  recordRealEstateValuation,
} from "../src/features/rwa/realEstate/service";
import {
  listUserVehicles,
  listVehicleAssets,
} from "../src/features/rwa/vehicle/service";
import { recordVehicleValuationSnapshot } from "../src/features/rwa/vehicle/valuation";
import { listOwnershipRecords } from "../src/features/rwa/ownership/service";
import { createSession } from "../src/lib/auth";
import { GET as backupApi } from "../src/app/api/backup/route";
import { GET as accGet, PUT as accPut, DELETE as accDel } from "../src/app/api/accounts/route";
import { DELETE as txDel } from "../src/app/api/transactions/route";

/* ------------------------------------------------------------------ */
/* scenario builders                                                    */
/* ------------------------------------------------------------------ */

async function cleanAll() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(entryFxSnapshots);
  await db.delete(installments);
  await db.delete(debts);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(vehicleValuationSnapshots);
  await db.delete(vehicleAssets);
  await db.delete(realEstateProperties);
  await db.delete(rwaOwnershipRecords);
  await db.delete(vehicleCatalog);
  await db.delete(vehicleBrands);
  await db.delete(prices);
  await db.delete(accounts);
  await db.delete(wallets);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(userFxSettings);
  await db.delete(backupRuns);
  await db.delete(auditLog);
  await db.delete(sessions);
  await db.delete(users);
}

async function setupScenario() {
  await cleanAll();

  const [usd] = await db
    .insert(currencies)
    .values({ code: "USD", name: "US Dollar", symbol: "$", decimals: 2, isFiat: true } as any)
    .returning();
  const [cashClass] = await db
    .insert(assetClasses)
    .values({ code: "cash", name: "Cash", valuationMethod: "fifo" } as any)
    .returning();
  const [rwaClass] = await db
    .insert(assetClasses)
    .values({ code: "RWA", name: "Real World Asset", valuationMethod: "fifo" } as any)
    .returning();

  const [usdCash] = await db
    .insert(assets)
    .values({ symbol: "USD_CASH", name: "USD Cash", classId: cashClass.id, currencyId: usd.id } as any)
    .returning();
  const [propAssetA] = await db
    .insert(assets)
    .values({ symbol: "PROP-A", name: "Property A", classId: rwaClass.id, currencyId: usd.id } as any)
    .returning();
  const [propAssetB] = await db
    .insert(assets)
    .values({ symbol: "PROP-B", name: "Property B", classId: rwaClass.id, currencyId: usd.id } as any)
    .returning();
  const [propAssetLegacy] = await db
    .insert(assets)
    .values({ symbol: "PROP-L", name: "Legacy Property", classId: rwaClass.id, currencyId: usd.id } as any)
    .returning();
  const [vehAssetA] = await db
    .insert(assets)
    .values({ symbol: "VEH-A", name: "Vehicle A", classId: rwaClass.id, currencyId: usd.id } as any)
    .returning();
  const [vehAssetB] = await db
    .insert(assets)
    .values({ symbol: "VEH-B", name: "Vehicle B", classId: rwaClass.id, currencyId: usd.id } as any)
    .returning();

  // USER_A with credential material that must never leak through backups
  const [userA] = await db
    .insert(users)
    .values({
      name: "User A",
      username: "usera",
      role: "owner",
      passwordHash: "scrypt$SECRET_HASH_A",
      pinHash: "SECRET_PIN_A",
    } as any)
    .returning();
  const [userB] = await db
    .insert(users)
    .values({
      name: "User B",
      username: "userb",
      role: "owner",
      passwordHash: "scrypt$SECRET_HASH_B",
      pinHash: "SECRET_PIN_B",
    } as any)
    .returning();

  const [cashAccA] = await db
    .insert(accounts)
    .values({ code: "1010", name: "Cash A", type: "asset", assetId: usdCash.id, userId: userA.id } as any)
    .returning();
  const [incomeAccA] = await db
    .insert(accounts)
    .values({ code: "4110", name: "Income A", type: "income", assetId: usdCash.id, userId: userA.id } as any)
    .returning();
  const [liabAccA] = await db
    .insert(accounts)
    .values({ code: "2110", name: "Debt A", type: "liability", assetId: usdCash.id, userId: userA.id } as any)
    .returning();
  const [cashAccB] = await db
    .insert(accounts)
    .values({ code: "1010", name: "Cash B", type: "asset", assetId: usdCash.id, userId: userB.id } as any)
    .returning();

  const [brand] = await db.insert(vehicleBrands).values({ name: "ایران‌خودرو", brandKey: "ikco" } as any).returning();
  const [catalog] = await db
    .insert(vehicleCatalog)
    .values({ brandId: brand.id, modelName: "سمند", modelKey: "samand" } as any)
    .returning();

  const [vehicleA] = await db
    .insert(vehicleAssets)
    .values({ assetId: vehAssetA.id, userId: userA.id, catalogId: catalog.id, brand: "ایران‌خودرو", model: "سمند", year: 1402 } as any)
    .returning();
  const [vehicleB] = await db
    .insert(vehicleAssets)
    .values({ assetId: vehAssetB.id, userId: userB.id, catalogId: catalog.id, brand: "ایران‌خودرو", model: "دنا", year: 1403 } as any)
    .returning();

  const [propertyA] = await db
    .insert(realEstateProperties)
    .values({ assetId: propAssetA.id, userId: userA.id, city: "Tehran", propertyType: "apartment" } as any)
    .returning();
  const [propertyB] = await db
    .insert(realEstateProperties)
    .values({ assetId: propAssetB.id, userId: userB.id, city: "Shiraz", propertyType: "villa" } as any)
    .returning();
  // Legacy NULL-owned rows: they predate auth and must NOT be exposed to
  // either authenticated tenant (NULL user_id ≠ shared).
  const [propertyLegacy] = await db
    .insert(realEstateProperties)
    .values({ assetId: propAssetLegacy.id, userId: null, city: "Ahvaz", propertyType: "apartment" } as any)
    .returning();

  const [ownA] = await db
    .insert(rwaOwnershipRecords)
    .values({ assetId: propAssetA.id, userId: userA.id, acquisitionDate: "2026-01-01", ownershipPercentage: "100" } as any)
    .returning();
  const [ownB] = await db
    .insert(rwaOwnershipRecords)
    .values({ assetId: propAssetB.id, userId: userB.id, acquisitionDate: "2026-01-02", ownershipPercentage: "50" } as any)
    .returning();

  const { token: tokenA } = await createSession(userA.id);
  const { token: tokenB } = await createSession(userB.id);

  return {
    usd,
    usdCash,
    userA,
    userB,
    cashAccA,
    incomeAccA,
    liabAccA,
    cashAccB,
    catalog,
    vehicleA,
    vehicleB,
    propertyA,
    propertyB,
    propertyLegacy,
    ownA,
    ownB,
    tokenA,
    tokenB,
  };
}

function authedReq(url: string, token: string, init: RequestInit = {}) {
  return new Request(`http://localhost${url}`, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie: `pwos_session=${token}` },
  });
}

/* ------------------------------------------------------------------ */
/* §14/§15 — read isolation enforced at the DB query level              */
/* ------------------------------------------------------------------ */

test("SEC — Multi-user read isolation: properties, vehicles, ownership records scoped in SQL", async () => {
  const { userA, userB, propertyA, propertyB, propertyLegacy, vehicleA, vehicleB, ownA } = await setupScenario();

  const propsA = await listRealEstateAssets(userA.id);
  const propsB = await listRealEstateAssets(userB.id);
  assert.deepEqual(propsA.map((p) => p.id), [propertyA.id]);
  assert.deepEqual(propsB.map((p) => p.id), [propertyB.id]);
  // NULL-owned legacy rows are NOT shared data: invisible to both tenants
  assert.ok(!propsA.some((p) => p.id === propertyLegacy.id));
  assert.ok(!propsB.some((p) => p.id === propertyLegacy.id));
  // …while the legacy unscoped call (no tenant identity at all) sees all 3.
  assert.equal((await listRealEstateAssets()).length, 3);

  const vehsA = await listUserVehicles(userA.id);
  const vehsB = await listVehicleAssets(userB.id);
  assert.deepEqual(vehsA.map((v) => v.id), [vehicleA.id]);
  assert.deepEqual(vehsB.map((v) => v.id), [vehicleB.id]);

  const ownListA = await listOwnershipRecords(userA.id);
  const ownListB = await listOwnershipRecords(userB.id);
  assert.deepEqual(ownListA.map((o) => o.id), [ownA.id]);
  assert.equal(ownListB.length, 1);
  assert.notEqual(ownListB[0].id, ownA.id);
});

/* ------------------------------------------------------------------ */
/* H-01 — real-estate valuation IDOR                                    */
/* ------------------------------------------------------------------ */

test("SEC/H-01 — recordRealEstateValuation: cross-user valuation REJECTED at DB level; owner accepted", async () => {
  const { userA, userB, propertyA, propertyB } = await setupScenario();

  // USER_B tries to revalue USER_A's property by guessing the id
  await assert.rejects(
    recordRealEstateValuation({
      propertyId: propertyA.id,
      userId: userB.id,
      valuationDate: "2026-08-01",
      currentValueToman: "9000000000",
      valuationFxRate: "60000",
    }),
    /متعلق به شما نیست/,
  );
  // Symmetric check: USER_A cannot mutate USER_B's property either.
  await assert.rejects(
    recordRealEstateValuation({
      propertyId: propertyB.id,
      userId: userA.id,
      valuationDate: "2026-08-01",
      currentValueToman: "9100000000",
      valuationFxRate: "60000",
    }),
    /متعلق به شما نیست/,
  );

  // Nothing mutated
  const [prop] = await db.select().from(realEstateProperties).where(eq(realEstateProperties.id, propertyA.id));
  assert.equal(prop.currentValueToman, null);

  // USER_A (legitimate owner) can revalue — functionality preserved
  const res = await recordRealEstateValuation({
    propertyId: propertyA.id,
    userId: userA.id,
    valuationDate: "2026-08-01",
    currentValueToman: "9000000000",
    valuationFxRate: "60000",
  });
  assert.equal(res.currentValueToman, "9000000000");
});

/* ------------------------------------------------------------------ */
/* H-02 — vehicle valuation snapshot IDOR                               */
/* ------------------------------------------------------------------ */

test("SEC/H-02 — recordVehicleValuationSnapshot: snapshot on ANOTHER user's vehicle REJECTED; own vehicle accepted", async () => {
  const { userA, userB, catalog, vehicleA, vehicleB } = await setupScenario();

  await assert.rejects(
    recordVehicleValuationSnapshot({
      catalogId: catalog.id,
      userVehicleId: vehicleA.id, // belongs to USER_A
      snapshotDate: "2026-08-01",
      currentValueToman: "800000000",
      usdRate: "60000",
      createdByUserId: userB.id, // attacker tenant
    }),
    /متعلق به شما نیست/,
  );
  // Symmetric check: USER_A cannot attach a snapshot to USER_B's vehicle.
  await assert.rejects(
    recordVehicleValuationSnapshot({
      catalogId: catalog.id,
      userVehicleId: vehicleB.id,
      snapshotDate: "2026-08-01",
      currentValueToman: "810000000",
      usdRate: "60000",
      createdByUserId: userA.id,
    }),
    /متعلق به شما نیست/,
  );

  const leaked = await db
    .select()
    .from(vehicleValuationSnapshots)
    .where(inArray(vehicleValuationSnapshots.userVehicleId, [vehicleA.id, vehicleB.id]));
  assert.equal(leaked.length, 0, "no snapshot may be attached cross-tenant");

  // Owner path keeps working
  const snap = await recordVehicleValuationSnapshot({
    catalogId: catalog.id,
    userVehicleId: vehicleA.id,
    snapshotDate: "2026-08-01",
    currentValueToman: "800000000",
    usdRate: "60000",
    createdByUserId: userA.id,
  });
  assert.equal(snap.userVehicleId, vehicleA.id);
});

/* ------------------------------------------------------------------ */
/* M-01 — backup must never export credential hashes                    */
/* ------------------------------------------------------------------ */

test("SEC/M-01 — backup export: users table exported WITHOUT password_hash / pin_hash", async () => {
  const { tokenA } = await setupScenario();

  const res = await backupApi(authedReq("/api/backup", tokenA, { method: "GET" }));
  assert.equal(res.status, 200);
  const bodyText = await res.text();
  assert.ok(!bodyText.includes("SECRET_HASH_A"), "password hash value must not leak");
  assert.ok(!bodyText.includes("SECRET_PIN_A"), "pin hash value must not leak");
  assert.ok(!bodyText.includes("SECRET_HASH_B"));
  assert.ok(!bodyText.includes("SECRET_PIN_B"));

  const json = JSON.parse(bodyText);
  assert.ok(Array.isArray(json.data.users), "users table still exported");
  assert.equal(json.data.users.length, 2);
  for (const row of json.data.users) {
    assert.equal(Object.prototype.hasOwnProperty.call(row, "password_hash"), false, "password_hash ABSENT");
    assert.equal(Object.prototype.hasOwnProperty.call(row, "pin_hash"), false, "pin_hash ABSENT");
    assert.ok(row.id && row.username, "non-secret columns remain");
  }
});

/* ------------------------------------------------------------------ */
/* M-02 Ledger — immutable ledger: DELETE reverses, never deletes        */
/* ------------------------------------------------------------------ */

test("SEC/M-02 Ledger — DELETE /api/transactions voids via existing reverseEntry; history preserved; net-zero", async () => {
  const { usdCash, userA, tokenA, tokenB, cashAccA, incomeAccA } = await setupScenario();

  const entry = await recordIncome({
    entryDate: "2026-08-01",
    description: "Transaction of A",
    cashAccountId: cashAccA.id,
    categoryAccountId: incomeAccA.id,
    assetId: usdCash.id,
    quantity: "100",
    baseValue: "100",
    userId: userA.id,
  });

  // USER_B cannot destroy A's entry (IDOR) — 404, entry untouched
  const resB = await txDel(authedReq(`/api/transactions?id=${entry.id}`, tokenB, { method: "DELETE" }));
  assert.equal(resB.status, 404);
  let [check] = await db.select().from(journalEntries).where(eq(journalEntries.id, entry.id));
  assert.equal(check.status, "posted");

  // USER_A: DELETE now performs a proper REVERSAL instead of physical DELETE
  const resA = await txDel(authedReq(`/api/transactions?id=${entry.id}`, tokenA, { method: "DELETE" }));
  assert.equal(resA.status, 200);

  // 1) original row still exists, marked void (immutable ledger)
  [check] = await db.select().from(journalEntries).where(eq(journalEntries.id, entry.id));
  assert.equal(check.status, "void");

  // 2) its postings are preserved
  const originalPostings = await db.select().from(postings).where(eq(postings.entryId, entry.id));
  assert.equal(originalPostings.length, 2);

  // 3) exactly one mirrored reversal entry exists
  const reversals = await db.select().from(journalEntries).where(eq(journalEntries.reversalOf, entry.id));
  assert.equal(reversals.length, 1);
  const reversalPostings = await db.select().from(postings).where(eq(postings.entryId, reversals[0].id));
  assert.equal(reversalPostings.length, 2);

  // 4) balance net-zero after reversal (balances ignore 'void' entries,
  //    original voided + reversal entry is void-status too)
  const bal = await getAccountBalances(userA.id);
  const cash = bal.find((b) => b.accountId === cashAccA.id);
  assert.equal(parseFloat(cash?.baseValue ?? "0"), 0);

  // 5) second DELETE: rejected — already reversed (409), nothing new created
  const resAgain = await txDel(authedReq(`/api/transactions?id=${entry.id}`, tokenA, { method: "DELETE" }));
  assert.equal(resAgain.status, 409);
  const reversalsAfter = await db.select().from(journalEntries).where(eq(journalEntries.reversalOf, entry.id));
  assert.equal(reversalsAfter.length, 1);
});

/* ------------------------------------------------------------------ */
/* M-02 Accounts — no destructive delete of financial history            */
/* ------------------------------------------------------------------ */

test("SEC/M-02 Accounts — DELETE: used account archived (never deleted), unused account physically removed, cross-user DENIED", async () => {
  const { usdCash, userA, tokenA, tokenB, cashAccA, incomeAccA } = await setupScenario();

  // cross-user read/update/delete attempts on A's account → DENIED (404)
  const gB = await accGet(authedReq(`/api/accounts?id=${cashAccA.id}`, tokenB, { method: "GET" }));
  assert.equal(gB.status, 404);
  const pB = await accPut(
    authedReq(`/api/accounts?id=${cashAccA.id}`, tokenB, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "hacked" }),
    }),
  );
  assert.equal(pB.status, 404);
  const dB = await accDel(authedReq(`/api/accounts?id=${cashAccA.id}`, tokenB, { method: "DELETE" }));
  assert.equal(dB.status, 404);

  // give the CASH account financial history
  await recordIncome({
    entryDate: "2026-08-01",
    description: "history",
    cashAccountId: cashAccA.id,
    categoryAccountId: incomeAccA.id,
    assetId: usdCash.id,
    quantity: "50",
    baseValue: "50",
    userId: userA.id,
  });

  // DELETE on used account → ARCHIVE (soft), row preserved
  const resUsed = await accDel(authedReq(`/api/accounts?id=${cashAccA.id}`, tokenA, { method: "DELETE" }));
  assert.equal(resUsed.status, 200);
  const usedBody = await resUsed.json();
  assert.equal(usedBody.archived, true);
  const [accAfter] = await db.select().from(accounts).where(eq(accounts.id, cashAccA.id));
  assert.ok(accAfter, "account with financial history must survive DELETE");
  assert.equal(accAfter.isActive, false);
  assert.ok(accAfter.deletedAt, "soft-delete marker set");

  // DELETE on unused account (incomeAccA has only posting side-effects...
  // it HAS postings too) → create a truly unused one
  const [unusedAcc] = await db
    .insert(accounts)
    .values({ code: "9999", name: "Unused A", type: "asset", assetId: usdCash.id, userId: userA.id } as any)
    .returning();
  const resUnused = await accDel(authedReq(`/api/accounts?id=${unusedAcc.id}`, tokenA, { method: "DELETE" }));
  assert.equal(resUnused.status, 200);
  const unusedBody = await resUnused.json();
  assert.equal(unusedBody.archived, false);
  const gone = await db.select().from(accounts).where(eq(accounts.id, unusedAcc.id));
  assert.equal(gone.length, 0, "account with zero financial usage may be physically removed");
});

/* ------------------------------------------------------------------ */
/* M-03 — atomic installment payment                                    */
/* ------------------------------------------------------------------ */

test("SEC/M-03 — payInstallment: atomic success, idempotent replay, rollback on precondition failure, tenant-scoped", async () => {
  const { userA, userB, cashAccA, cashAccB, liabAccA } = await setupScenario();

  const [debt] = await db
    .insert(debts)
    .values({
      userId: userA.id,
      title: "وام A",
      creditor: "Bank",
      principalBase: "100",
      startDate: "2026-01-01",
      accountId: liabAccA.id,
    } as any)
    .returning();
  const [inst] = await db
    .insert(installments)
    .values({ debtId: debt.id, seq: 1, dueDate: "2026-08-01", amountBase: "100" } as any)
    .returning();

  // USER_B cannot pay A's installment (ownership inside the transaction)
  await assert.rejects(payInstallment(inst.id, cashAccB.id, userB.id), /متعلق به شما نیست|یافت نشد/);
  let [instCheck] = await db.select().from(installments).where(eq(installments.id, inst.id));
  assert.equal(instCheck.status, "pending");

  // Success path: one atomic commit — entry + paid flags + debt settled
  const paid = await payInstallment(inst.id, cashAccA.id, userA.id);
  assert.ok(paid.id);
  [instCheck] = await db.select().from(installments).where(eq(installments.id, inst.id));
  assert.equal(instCheck.status, "paid");
  assert.equal(instCheck.paidEntryId, paid.id);
  const [debtAfter] = await db.select().from(debts).where(eq(debts.id, debt.id));
  assert.equal(debtAfter.status, "settled");
  const entries = await db.select().from(journalEntries).where(eq(journalEntries.id, paid.id));
  assert.equal(entries.length, 1);
  const lines = await db.select().from(postings).where(eq(postings.entryId, paid.id));
  assert.equal(lines.length, 2);

  // Replay / concurrent retry: alreadyPaid, NO second ledger entry
  const replay = await payInstallment(inst.id, cashAccA.id, userA.id);
  assert.equal((replay as any).alreadyPaid, true);
  const allEntries = await db.select().from(journalEntries);
  assert.equal(allEntries.length, 1, "double payment must never post twice");

  // Failure path: debt without ledger account → precondition fails INSIDE the
  // transaction → installment untouched, zero accounting side-effects
  const [debt2] = await db
    .insert(debts)
    .values({ userId: userA.id, title: "وام دستی", creditor: "X", principalBase: "10", startDate: "2026-01-01" } as any)
    .returning();
  const [inst2] = await db
    .insert(installments)
    .values({ debtId: debt2.id, seq: 1, dueDate: "2026-08-02", amountBase: "10" } as any)
    .returning();
  await assert.rejects(payInstallment(inst2.id, cashAccA.id, userA.id), /حساب بدهی تعریف نشده/);
  [instCheck] = await db.select().from(installments).where(eq(installments.id, inst2.id));
  assert.equal(instCheck.status, "pending");
  assert.equal(instCheck.paidEntryId, null);
  const entriesAfterFail = await db.select().from(journalEntries);
  assert.equal(entriesAfterFail.length, 1, "failed payment must leave no ledger rows (atomic rollback)");
});

/* ------------------------------------------------------------------ */
/* M-04 — concurrent reversal: exactly ONE reversal                     */
/* ------------------------------------------------------------------ */

test("SEC/M-04 — reverseEntry race: 5 concurrent reversals → exactly 1 succeeds, 1 reversal entry", async () => {
  const { usdCash, userA, cashAccA, incomeAccA } = await setupScenario();

  const entry = await recordIncome({
    entryDate: "2026-08-01",
    description: "to be reversed",
    cashAccountId: cashAccA.id,
    categoryAccountId: incomeAccA.id,
    assetId: usdCash.id,
    quantity: "10",
    baseValue: "10",
    userId: userA.id,
  });

  const results = await Promise.allSettled([
    reverseEntry(entry.id),
    reverseEntry(entry.id),
    reverseEntry(entry.id),
    reverseEntry(entry.id),
    reverseEntry(entry.id),
  ]);
  const ok = results.filter((r) => r.status === "fulfilled");
  const ko = results.filter((r) => r.status === "rejected");
  assert.equal(ok.length, 1, "exactly one reversal may succeed");
  assert.equal(ko.length, 4);
  for (const r of ko) assert.match(String((r as PromiseRejectedResult).reason), /قبلاً ابطال/);

  const reversals = await db.select().from(journalEntries).where(eq(journalEntries.reversalOf, entry.id));
  assert.equal(reversals.length, 1);
  const [orig] = await db.select().from(journalEntries).where(eq(journalEntries.id, entry.id));
  assert.equal(orig.status, "void");

  // Sequential re-reverse still rejected
  await assert.rejects(reverseEntry(entry.id), /قبلاً ابطال/);
});
