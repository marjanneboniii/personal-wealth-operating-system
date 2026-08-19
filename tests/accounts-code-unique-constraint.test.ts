import assert from "node:assert/strict";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists, rootCauseOf } from "../src/db/init-schema";
import {
  accounts,
  exchangeRates,
  journalEntries,
  lotConsumptions,
  lots,
  postings,
  settings,
  userFxSettings,
  userSetupState,
  users,
} from "../src/db/schema";
import { completeSetup, getSetupState } from "../src/features/setup/service";

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

/** Reproduce the exact leftover Neon/drizzle constraint name from the bug. */
async function installLegacyCodeUnique() {
  await db.execute(sql`ALTER TABLE accounts ADD CONSTRAINT accounts_code_unique UNIQUE (code)`);
}

/** Same statements as drizzle/0004_accounts_code_unique_drop.sql. */
async function applyMigration0004() {
  await db.execute(sql`ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_code_unique`);
  await db.execute(sql`ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_code_key`);
  await db.execute(sql`DROP INDEX IF EXISTS accounts_code_unique`);
  await db.execute(sql`DROP INDEX IF EXISTS accounts_code_key`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS accounts_user_code_uq ON accounts (user_id, code)`);
}

async function constraintNames(): Promise<string[]> {
  const res = await db.execute(sql`
    select c.conname as name
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'accounts' and c.contype = 'u'
  `);
  return (res.rows as { name: string }[]).map((r) => r.name);
}

async function uniqueIndexDefs(): Promise<{ name: string; def: string }[]> {
  const res = await db.execute(sql`
    select indexname as name, indexdef as def
    from pg_indexes
    where tablename = 'accounts'
  `);
  return res.rows as { name: string; def: string }[];
}

test("RCA: leftover accounts_code_unique is UNIQUE(code) and fails first on 1000 دارایی‌ها", async () => {
  await setupFreshDb();
  await installLegacyCodeUnique();

  const names = await constraintNames();
  assert.ok(names.includes("accounts_code_unique"), `expected leftover constraint, got ${names.join(",")}`);

  const [userA] = await db
    .insert(users)
    .values({ name: "User A", username: "coa-a", role: "user" } as any)
    .returning();
  await completeSetup({ ...input, userName: "User A" }, userA.id);

  const existing = await db.select().from(accounts).where(eq(accounts.userId, userA.id));
  const headerA = existing.find((a) => a.code === "1000");
  assert.equal(headerA?.name, "دارایی‌ها");
  assert.equal(headerA?.userId, userA.id);

  const [userB] = await db
    .insert(users)
    .values({ name: "User B", username: "coa-b", role: "user" } as any)
    .returning();

  let caught: unknown = null;
  try {
    await completeSetup({ ...input, userName: "User B" }, userB.id);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "second tenant must fail while UNIQUE(code) remains");
  const root = rootCauseOf(caught);
  assert.equal(root.code, "23505");
  assert.match(root.message, /accounts_code_unique/);
  assert.match((caught as Error).message, /accounts_code_unique|db:migrate/);

  const chartB = await db.select().from(accounts).where(eq(accounts.userId, userB.id));
  assert.equal(chartB.some((a) => a.code === "1000"), false, "failed setup must not leave a partial chart");
  assert.equal((await getSetupState(userB.id)).completed, false);
});

test("0004 drops accounts_code_unique and lets two tenants share code 1000", async () => {
  await setupFreshDb();
  await installLegacyCodeUnique();

  const [userA] = await db
    .insert(users)
    .values({ name: "User A", username: "fix-a", role: "user" } as any)
    .returning();
  await completeSetup({ ...input, userName: "User A" }, userA.id);

  const [userB] = await db
    .insert(users)
    .values({ name: "User B", username: "fix-b", role: "user" } as any)
    .returning();
  await assert.rejects(() => completeSetup({ ...input, userName: "User B" }, userB.id));

  await applyMigration0004();
  await applyMigration0004(); // idempotent

  const names = await constraintNames();
  assert.equal(names.includes("accounts_code_unique"), false);
  const indexes = await uniqueIndexDefs();
  const tenantUq = indexes.find((i) => i.name === "accounts_user_code_uq");
  assert.ok(tenantUq, "per-tenant unique index must exist");
  assert.match(tenantUq.def, /user_id/i);
  assert.match(tenantUq.def, /code/i);

  const ok = await completeSetup({ ...input, userName: "User B" }, userB.id);
  assert.equal(ok.ok, true);
  assert.equal((await getSetupState(userB.id)).completed, true);

  const chartA = await db.select().from(accounts).where(eq(accounts.userId, userA.id));
  const chartB = await db.select().from(accounts).where(eq(accounts.userId, userB.id));
  const headerA = chartA.find((a) => a.code === "1000");
  const headerB = chartB.find((a) => a.code === "1000");
  assert.equal(headerA?.name, "دارایی‌ها");
  assert.equal(headerB?.name, "دارایی‌ها");
  assert.notEqual(headerA?.id, headerB?.id);
  for (const code of ["1000", "1010", "2000", "3000", "3010", "4000", "5000"]) {
    assert.ok(chartA.some((a) => a.code === code), `user A missing ${code}`);
    assert.ok(chartB.some((a) => a.code === code), `user B missing ${code}`);
  }
});

test("Retry / double completeSetup does not duplicate CoA rows", async () => {
  await setupFreshDb();
  const [user] = await db
    .insert(users)
    .values({ name: "Retry", username: "retry-coa", role: "user" } as any)
    .returning();

  const first = await completeSetup({ ...input, userName: "Retry" }, user.id);
  assert.equal(first.ok, true);

  await assert.rejects(
    () => completeSetup({ ...input, userName: "Retry again" }, user.id),
    (err: Error) => /قبلاً انجام شده است/.test(err.message),
  );

  const chart = await db.select().from(accounts).where(eq(accounts.userId, user.id));
  const codes = chart.map((a) => a.code);
  assert.equal(codes.length, new Set(codes).size, "retry must not insert duplicate codes");
  assert.equal(chart.filter((a) => a.code === "1000").length, 1);
});

test("Fresh user setup on the intended (user_id, code) unique succeeds", async () => {
  await setupFreshDb();
  const names = await constraintNames();
  assert.equal(names.includes("accounts_code_unique"), false);
  const [user] = await db
    .insert(users)
    .values({ name: "Fresh", username: "fresh-coa", role: "user" } as any)
    .returning();
  const result = await completeSetup({ ...input, userName: "Fresh" }, user.id);
  assert.equal(result.ok, true);
  const header = (await db.select().from(accounts).where(eq(accounts.userId, user.id))).find((a) => a.code === "1000");
  assert.equal(header?.name, "دارایی‌ها");
  assert.equal(header?.assetId, null);
});
