import assert from "node:assert/strict";
import { test } from "node:test";
import { sql, eq } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  journalEntries,
  lotConsumptions,
  lots,
  postings,
  settings,
  userSetupState,
  users,
} from "../src/db/schema";
import { completeSetup, getSetupState } from "../src/features/setup/service";
import { getAccountBalances, getHoldings } from "../src/features/ledger/queries";
import { D } from "../src/domain/decimal";

async function setupFreshDb() {
  await createSchemaIfNotExists();

  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(userSetupState);
  await db.delete(settings);
  await db.delete(users);
  await db.delete(accounts);
}

test("Phase 2.1 Requirement — Fresh user can complete setup wizard successfully", async () => {
  await setupFreshDb();

  let state = await getSetupState();
  assert.equal(state.completed, false);

  // Complete setup
  const result = await completeSetup({
    userName: "رضا و مریم",
    baseCurrency: "USD",
    displayCurrency: "IRT",
    dateCalendar: "jalali",
    digitStyle: "fa",
    bankAccountName: "بانک سامان — جاری",
    cashWalletName: "کیف نقد خانه",
    bankOpeningBalance: "5000",
    cashOpeningBalance: "1000",
    cryptoOpeningQty: "2",
    cryptoUnitPrice: "3000", // $6,000 value
    goldOpeningQty: "50",
    goldUnitPrice: "60", // $3,000 value
  });

  assert.equal(result.ok, true);

  // 1. Verify setup state completed
  state = await getSetupState();
  assert.equal(state.completed, true);

  // 2. Verify settings stored Accounting Currency & Display Currency separately
  const config = await db.select().from(settings);
  const configMap = Object.fromEntries(config.map((c) => [c.key, c.value]));
  assert.equal(configMap.base_currency, "USD");
  assert.equal(configMap.display_currency, "IRT");
  assert.equal(configMap.date_calendar, "jalali");

  // 3. Verify user created
  const userRows = await db.select().from(users);
  assert.equal(userRows.length, 1);
  assert.equal(userRows[0].name, "رضا و مریم");

  // 4. Verify opening journal entry created via postEntry
  const entries = await db.select().from(journalEntries);
  assert.equal(entries.length, 1); // 1 atomic opening entry for all assets
  assert.equal(entries[0].type, "opening");
  assert.equal(entries[0].status, "posted");

  // 5. Verify opening entries remain strictly balanced (Σ base_value = 0)
  for (const entry of entries) {
    const entryPostings = await db.select().from(postings).where(eq(postings.entryId, entry.id));
    const sumBase = entryPostings.reduce((s, p) => s.add(p.baseValue), D("0"));
    assert.equal(sumBase.toString(), "0");
  }

  // 6. Verify balances & holdings derived from opening entry
  const balances = await getAccountBalances();
  const bankBal = balances.find((b) => b.name === "بانک سامان — جاری");
  const cashBal = balances.find((b) => b.name === "کیف نقد خانه");
  const ethBal = balances.find((b) => b.code === "1200");
  const goldBal = balances.find((b) => b.code === "1300");
  const equityBal = balances.find((b) => b.code === "3010");

  assert.equal(D(bankBal?.baseValue ?? "0").toString(), "5000");
  assert.equal(D(cashBal?.baseValue ?? "0").toString(), "1000");
  assert.equal(D(ethBal?.quantity ?? "0").toString(), "2");
  assert.equal(D(goldBal?.quantity ?? "0").toString(), "50");

  // Total Equity = 5000 + 1000 + (2*3000) + (50*60) = 5000 + 1000 + 6000 + 3000 = 15000
  assert.equal(D(equityBal?.baseValue ?? "0").toString(), "-15000");

  // 7. Verify FIFO lot created for ETH
  const ethLots = await db.select().from(lots);
  assert.ok(ethLots.length >= 1);
  const ethLot = ethLots.find((l) => D(l.qtyOpened).toString() === "2");
  assert.ok(ethLot);
  assert.equal(D(ethLot.qtyRemaining).toString(), "2");
  assert.equal(D(ethLot.unitCostBase).toString(), "3000");
});

test("Phase 2.1 Requirement — Duplicate setup initialization is prevented", async () => {
  await setupFreshDb();

  // First completion
  await completeSetup({
    userName: "User 1",
    baseCurrency: "USD",
    displayCurrency: "IRT",
    dateCalendar: "jalali",
    digitStyle: "fa",
  });

  // Attempt duplicate completion
  await assert.rejects(
    async () => {
      await completeSetup({
        userName: "User 2",
        baseCurrency: "EUR",
        displayCurrency: "USD",
        dateCalendar: "gregorian",
        digitStyle: "en",
      });
    },
    (err: Error) => err.message.includes("قبلاً انجام شده است"),
  );
});

test("Authenticated tenants complete setup independently with isolated 3010 accounts", async () => {
  await setupFreshDb();
  const [userA, userB] = await db
    .insert(users)
    .values([
      { name: "Tenant A", username: "tenant-a", role: "user" },
      { name: "Tenant B", username: "tenant-b", role: "user" },
    ] as any)
    .returning();

  const input = {
    userName: "Tenant A configured",
    baseCurrency: "USD",
    displayCurrency: "IRT",
    dateCalendar: "jalali" as const,
    digitStyle: "fa" as const,
  };
  await completeSetup(input, userA.id);

  assert.equal((await getSetupState(userA.id)).completed, true);
  assert.equal((await getSetupState(userB.id)).completed, false);
  assert.equal((await db.select().from(users)).length, 2, "tenant setup must not create a shadow user");

  const accountsA = await db.select().from(accounts).where(eq(accounts.userId, userA.id));
  const accountsB = await db.select().from(accounts).where(eq(accounts.userId, userB.id));
  assert.equal(accountsA.some((a) => a.code === "3010" && a.type === "equity"), true);
  assert.equal(accountsB.some((a) => a.code === "3010"), false);

  await completeSetup({ ...input, userName: "Tenant B configured" }, userB.id);
  assert.equal((await getSetupState(userB.id)).completed, true);
  const afterB = await db.select().from(accounts).where(eq(accounts.userId, userB.id));
  assert.equal(afterB.some((a) => a.code === "3010" && a.type === "equity"), true);
});

test("Phase 2.1 Requirement — Setup never creates fake or demo transactions", async () => {
  await setupFreshDb();

  await completeSetup({
    userName: "Minimal User",
    baseCurrency: "USD",
    displayCurrency: "IRT",
    dateCalendar: "jalali",
    digitStyle: "fa",
  });

  const entries = await db.select().from(journalEntries);
  // No opening balances provided, so 0 journal entries should exist
  assert.equal(entries.length, 0);

  const holdings = await getHoldings();
  const activeHoldings = holdings.filter((h) => D(h.quantity).gt(0));
  assert.equal(activeHoldings.length, 0);
});

test("Only the bank account is mandatory — cash box is created only when requested or funded", async () => {
  await setupFreshDb();

  // Bank only: no cash wallet name, no cash opening balance.
  await completeSetup({
    userName: "Bank Only",
    baseCurrency: "USD",
    displayCurrency: "IRT",
    dateCalendar: "jalali",
    digitStyle: "fa",
    bankAccountName: "بانک ملت — جاری",
    bankOpeningBalance: "5000",
  });

  let chart = await db.select().from(accounts);
  assert.equal(chart.some((a) => a.code === "1010"), true, "bank account must exist");
  assert.equal(chart.some((a) => a.code === "1020"), false, "cash account must NOT exist when not requested");
  assert.equal(chart.some((a) => a.code === "1200"), true, "ETH container stays available for the buy flow");
  assert.equal(chart.some((a) => a.code === "1300"), true, "gold container stays available for the asset flow");

  // Funding the cash box (even without naming it) provisions the account.
  await setupFreshDb();
  await completeSetup({
    userName: "Cash Funded",
    baseCurrency: "USD",
    displayCurrency: "IRT",
    dateCalendar: "jalali",
    digitStyle: "fa",
    bankAccountName: "بانک ملت — جاری",
    cashOpeningBalance: "2500",
  });

  chart = await db.select().from(accounts);
  assert.equal(chart.some((a) => a.code === "1020"), true, "cash account must be provisioned when funded");
});
