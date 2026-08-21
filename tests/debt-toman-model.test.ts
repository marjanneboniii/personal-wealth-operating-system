/**
 * Phase 3 — Debt / Installment contractual Toman data model.
 *
 * Pins:
 *   - new debts/installments store the EXACT Toman amount (source of truth);
 *   - creation-time USD snapshot is stored but never authoritative;
 *   - an FX change never mutates the stored Toman; only the derived USD moves;
 *   - user isolation (debts are tenant-scoped);
 *   - positive-money validation;
 *   - no ledger rewrite on debt creation (planning-only);
 *   - installment sum == principal (no invented rounding).
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { eq } from "drizzle-orm";
import { D } from "../src/domain/decimal";

// ── Next.js runtime mocks (server actions read cookies via next/headers) ──
const cookieJar: { value: string | null } = { value: null };
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) =>
        name === "pwos_session" && cookieJar.value ? { value: cookieJar.value } : undefined,
      set: () => {},
      delete: () => {},
    }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", {
  namedExports: {
    revalidatePath: () => {},
  },
});

let db: any, createSchemaIfNotExists: any;
let debts: any, installments: any, users: any, userFxSettings: any, journalEntries: any;
let createSession: any, createDebtAction: any, listDebts: any;

async function loadModules() {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ debts, installments, users, userFxSettings, journalEntries } = await import("../src/db/schema"));
  ({ createSession } = await import("../src/lib/auth"));
  ({ createDebtAction } = await import("../src/app/actions"));
  ({ listDebts } = await import("../src/features/planning/service"));
}
const modulesReady = loadModules();

async function clean() {
  await createSchemaIfNotExists();
  await db.delete(installments);
  await db.delete(debts);
  await db.delete(userFxSettings);
  await db.delete(journalEntries);
  await db.delete(users);
}

function debtFormData(principal: string, count = "0", installment = "", firstDue = "") {
  const fd = new FormData();
  fd.set("title", "قسط فرش");
  fd.set("creditor", "فروشنده فرش");
  fd.set("principalIrt", principal);
  fd.set("interestRate", "0");
  fd.set("startDate", "2026-08-01");
  fd.set("installmentCount", count);
  fd.set("installmentIrt", installment);
  fd.set("firstDueDate", firstDue);
  return fd;
}

test("Phase3-A/B — new debt + installments store exact Toman (source of truth)", async () => {
  await modulesReady;
  await clean();
  const [user] = await db.insert(users).values({ name: "DebtOwner", username: "debt-owner", role: "owner" } as any).returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "280000" } as any);
  const { token } = await createSession(user.id);
  cookieJar.value = token;

  const res = await createDebtAction(null, debtFormData("6363630", "7", "909090", "2026-09-01"));
  assert.equal(res.ok, true, res.message);
  cookieJar.value = null;

  const [debtRow] = await db.select().from(debts).where(eq(debts.userId, user.id));
  assert.ok(D(debtRow.principalToman).sub("6363630").isZero(), `principal_toman stored exactly: ${debtRow.principalToman}`);
  assert.ok(
    D(debtRow.principalUsdCreated).sub(D("6363630").div("280000")).abs().lt("0.0000001"),
    `principal_usd_created=${debtRow.principalUsdCreated}`,
  );
  // Legacy dual-write equals the creation snapshot (USD).
  assert.ok(D(debtRow.principalBase).sub(D("6363630").div("280000")).abs().lt("0.0000001"));

  const rows = await db.select().from(installments).where(eq(installments.debtId, debtRow.id));
  assert.equal(rows.length, 7);
  for (const inst of rows) {
    assert.ok(D(inst.amountToman).sub("909090").isZero(), `installment amount_toman exact: ${inst.amountToman}`);
    assert.ok(D(inst.amountUsdCreated).sub(D("909090").div("280000")).abs().lt("0.0000001"));
  }

  // H: installment sum == principal (no invented rounding).
  const sumToman = rows.reduce((s: any, i: any) => s.add(D(i.amountToman)), D("0"));
  assert.ok(sumToman.sub("6363630").isZero(), `sum=${sumToman}`);

  // F: creating a debt is planning-only — zero ledger entries.
  const jeCount = await db.select({ c: journalEntries.id }).from(journalEntries);
  assert.equal(jeCount.length, 0, "debt creation must not post to the ledger");
});

test("Phase3-C/D — FX change does not mutate Toman; USD equivalent is dynamic", async () => {
  await modulesReady;
  await clean();
  const [user] = await db.insert(users).values({ name: "DebtOwner2", username: "debt-owner-2", role: "owner" } as any).returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "280000" } as any);
  const { token } = await createSession(user.id);
  cookieJar.value = token;
  await createDebtAction(null, debtFormData("909090", "0"));
  cookieJar.value = null;

  const before = await listDebts(user.id);
  assert.ok(D(before[0].principalToman).sub("909090").isZero());
  assert.ok(D(before[0].outstandingBase).sub(D("909090").div("280000")).abs().lt("0.000001"));

  // Change FX 280k -> 300k (bypassing the 24h throttle, as other tests do).
  await db.update(userFxSettings).set({ currentRate: "300000" }).where(eq(userFxSettings.userId, user.id));

  const after = await listDebts(user.id);
  assert.ok(D(after[0].principalToman).sub("909090").isZero(), "Toman MUST NOT change with FX");
  assert.ok(D(after[0].outstandingToman).sub("909090").isZero(), "outstanding Toman MUST NOT change");
  assert.ok(
    D(after[0].outstandingBase).sub(D("909090").div("300000")).abs().lt("0.000001"),
    `USD equivalent should be dynamic: ${after[0].outstandingBase}`,
  );

  // DB-level: Toman fields are byte-for-byte unchanged.
  const [row] = await db.select().from(debts).where(eq(debts.userId, user.id));
  assert.ok(D(row.principalToman).sub("909090").isZero());
});

test("Phase3-E — user isolation: debts are tenant-scoped", async () => {
  await modulesReady;
  await clean();
  const [userA] = await db.insert(users).values({ name: "A", username: "debt-a", role: "owner" } as any).returning();
  const [userB] = await db.insert(users).values({ name: "B", username: "debt-b", role: "owner" } as any).returning();
  await db.insert(userFxSettings).values([
    { userId: userA.id, currentRate: "280000" },
    { userId: userB.id, currentRate: "280000" },
  ] as any);

  const { token: tokA } = await createSession(userA.id);
  cookieJar.value = tokA;
  await createDebtAction(null, debtFormData("909090", "0"));
  cookieJar.value = null;
  const { token: tokB } = await createSession(userB.id);
  cookieJar.value = tokB;
  await createDebtAction(null, debtFormData("2000000", "0"));
  cookieJar.value = null;

  const debtsA = await listDebts(userA.id);
  const debtsB = await listDebts(userB.id);
  assert.equal(debtsA.length, 1);
  assert.equal(debtsB.length, 1);
  assert.ok(D(debtsA[0].principalToman).sub("909090").isZero());
  assert.ok(D(debtsB[0].principalToman).sub("2000000").isZero());
});

test("Phase3-I — positive money validation rejects non-positive principal", async () => {
  await modulesReady;
  await clean();
  const [user] = await db.insert(users).values({ name: "V", username: "debt-valid", role: "owner" } as any).returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "280000" } as any);
  const { token } = await createSession(user.id);
  cookieJar.value = token;

  const zero = await createDebtAction(null, debtFormData("0", "0"));
  assert.equal(zero.ok, false);
  assert.match(zero.message, /بزرگ‌تر از صفر/);

  cookieJar.value = null;
  const all = await db.select().from(debts);
  assert.equal(all.length, 0, "no debt row may be created for a non-positive principal");
});
