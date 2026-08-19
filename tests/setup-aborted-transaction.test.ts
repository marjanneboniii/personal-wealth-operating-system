import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  exchangeRates,
  lotConsumptions,
  lots,
  postings,
  journalEntries,
  settings,
  userFxSettings,
  userSetupState,
  users,
} from "../src/db/schema";
import { completeSetup } from "../src/features/setup/service";
import { rootCauseOf } from "../src/db/init-schema";

async function setupFreshDb() {
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

const input = {
  userName: "Test",
  baseCurrency: "USD",
  displayCurrency: "IRT",
  dateCalendar: "jalali" as const,
  digitStyle: "fa" as const,
  bankAccountName: "Bank",
  bankAssetSymbol: "IRT",
  bankOpeningBalance: "1000",
};

test("REGRESSION: duplicate CoA insert no longer aborts the setup transaction (no 'current transaction is aborted')", async () => {
  await setupFreshDb();

  // Tenant A completes setup on the clean baseline.
  const [userA] = await db
    .insert(users)
    .values({ name: "A", username: "repro-a", role: "user" } as any)
    .returning();
  await completeSetup({ ...input, userName: "A" }, userA.id);

  // Simulate legacy drift: a GLOBAL unique on code that migration 0003 drops.
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS accounts_code_key ON accounts(code)`);

  const [userB] = await db
    .insert(users)
    .values({ name: "B", username: "repro-b", role: "user" } as any)
    .returning();

  let caught: any = null;
  try {
    await completeSetup({ ...input, userName: "B" }, userB.id);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, "expected completeSetup to throw on drifted schema");

  const root = rootCauseOf(caught);
  // The REAL error must surface (duplicate key on the legacy global unique),
  // never the misleading "current transaction is aborted" (25P02).
  assert.notEqual(root.code, "25P02", `must not surface transaction-aborted; got: ${root.code}`);
  assert.match(root.message, /duplicate key|already exists/i);
  assert.ok(
    !/current transaction is aborted/i.test(caught?.message ?? ""),
    `message must not be the swallowed abort; got: ${caught?.message}`,
  );

  // Once migration 0003 is applied (global unique dropped), the SAME tenant's
  // setup must succeed and its chart must be fully created.
  await db.execute(sql`DROP INDEX IF EXISTS accounts_code_key`);
  const ok = await completeSetup({ ...input, userName: "B" }, userB.id);
  assert.equal(ok.ok, true);
  const chartB = await db.select().from(accounts).where(sql`user_id = ${userB.id}`);
  for (const code of ["1000", "1010", "2000", "3000", "3010", "4000", "5000"]) {
    assert.ok(chartB.some((a) => a.code === code), `userB missing account code ${code}`);
  }
  assert.equal((await getSetupStateValue(userB.id)), true);
});

async function getSetupStateValue(userId: string): Promise<boolean> {
  const [s] = await db.select().from(userSetupState).where(sql`user_id = ${userId}`);
  return s?.completed ?? false;
}

test("Control: IRT opening balance resolves FX inside the setup transaction", async () => {
  await setupFreshDb();
  const [userA] = await db
    .insert(users)
    .values({ name: "A", username: "repro-ctrl", role: "user" } as any)
    .returning();
  await completeSetup({ ...input, userName: "A" }, userA.id);
  const chart = await db.select().from(accounts).where(sql`user_id = ${userA.id}`);
  assert.ok(chart.length > 0);
});
