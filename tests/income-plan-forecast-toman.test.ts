/**
 * A recurring income reaches the cash-flow forecast in TOMAN.
 *
 * planned_transactions.amount_base is contractual Toman — projectCashflow and
 * listPlanned read it that way. Income plans used to receive the entry's USD
 * amount, so a 45,000,000-Toman salary was forecast as 450. New plans store
 * Toman; drizzle/0042 converts the pending ones already written.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { D, Decimal } from "../src/domain/decimal";
import { accounts, assetClasses, assets, plannedTransactions, users, userFxSettings, wallexAssetCatalog } from "../src/db/schema";
import { todayIso } from "../src/lib/format";

const cookieJar: { value: string | null } = { value: null };
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) => (name === "pwos_session" && cookieJar.value ? { value: cookieJar.value } : undefined),
      set: () => {},
      delete: () => {},
    }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

test("recurring income: stored and forecast in Toman; legacy USD rows converted once", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { createSession } = await import("../src/lib/auth");
  const { ensureCategoryCatalog, listCategoryTree } = await import("../src/features/categories/service");
  const { createTransactionAction } = await import("../src/app/actions");
  const { projectCashflow } = await import("../src/features/planning/service");
  await createSchemaIfNotExists();
  await ensureCategoryCatalog();

  const [user] = await db.insert(users).values({ name: "Earner", username: `earner-${Date.now()}`, role: "owner" } as any).returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "100000" } as any);
  await db.insert(wallexAssetCatalog).values({ symbol: "USDT", displayName: "تتر", latinName: "Tether", kind: "stablecoin", priceTmn: "105000", priceUsdt: "1" } as any);
  const [cash] = await db.insert(assetClasses).values({ code: "cash", name: "نقد" } as any).returning();
  const [stable] = await db.insert(assetClasses).values({ code: "stable", name: "استیبل" } as any).returning();
  await db.insert(assets).values({ symbol: "USD", name: "دلار", classId: cash.id, decimals: 2 } as any);
  const [irt] = await db.insert(assets).values({ symbol: "IRT", name: "تومان", classId: cash.id, decimals: 0 } as any).returning();
  const [usdt] = await db.insert(assets).values({ symbol: "USDT", name: "تتر", classId: stable.id, decimals: 6 } as any).returning();
  const [bank] = await db.insert(accounts).values({ code: "1010", name: "بانک", type: "asset", assetId: irt.id, userId: user.id } as any).returning();
  const [wallet] = await db.insert(accounts).values({ code: "1110", name: "کیف تتر", type: "asset", assetId: usdt.id, userId: user.id } as any).returning();
  cookieJar.value = (await createSession(user.id)).token;
  const leaf = async (code: string) =>
    (await listCategoryTree(user.id, "income")).flatMap((g: any) => g.children).find((c: any) => c.code === code).id as string;

  const income = async (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ type: "income", entryDate: todayIso(), feeMode: "irt", recurring: "monthly", recurringDay: "1", ...fields })) fd.set(k, v);
    const r = await createTransactionAction(null, fd);
    assert.equal(r.ok, true, r.message);
  };
  await income({ description: "حقوق", primaryAccountId: bank.id, categoryId: await leaf("INC-SAL-NET"), nativeAmount: "45000000", irtAmount: "45000000" });
  await income({ description: "پروژه", primaryAccountId: wallet.id, categoryId: await leaf("INC-BIZ-FREELANCE"), nativeAmount: "250", irtAmount: "26250000" });

  const plans = await db.select().from(plannedTransactions).where(eq(plannedTransactions.userId, user.id));
  const byTitle = new Map(plans.map((p: any) => [p.title, p]));
  assert.equal(D(byTitle.get("حقوق").amountBase).toFixed(0), "45000000", "Toman, not 450 USD");
  assert.equal(D(byTitle.get("پروژه").amountBase).toFixed(0), "26250000", "a Tether income is forecast at its Toman value");
  assert.equal(D(byTitle.get("پروژه").amountNative).toString(), "250", "the native amount is still the reminder's figure");

  const projection = await projectCashflow(3, "base", user.id);
  const inflow = Decimal.sum(projection.points.map((p: any) => p.inflow));
  assert.equal(D(inflow).toFixed(0), "71250000", "45M + 26.25M in the forecast");

  // ── drizzle/0042 on rows written by the old code ──
  await db.delete(plannedTransactions);
  const legacy = (title: string, accountId: string, amountBase: string, amountNative: string, status = "pending") => ({
    userId: user.id,
    title,
    plannedDate: todayIso(),
    direction: "inflow",
    amountBase,
    amountNative,
    toAccountId: accountId,
    recurrence: "monthly",
    status,
    categoryId: byTitle.get("حقوق").categoryId,
    dayOfMonth: 1,
  });
  await db.insert(plannedTransactions).values([
    legacy("usd-scaled salary", bank.id, "450", "45000000"),
    legacy("usd-scaled tether", wallet.id, "250", "250"),
    legacy("already toman", bank.id, "45000000", "45000000"),
    legacy("executed stays", bank.id, "450", "45000000", "executed"),
  ] as any);
  // A plain planned transaction (no category) is not an income plan.
  await db.insert(plannedTransactions).values({ userId: user.id, title: "plain", plannedDate: todayIso(), direction: "inflow", amountBase: "7", toAccountId: bank.id } as any);

  const migration = readFileSync("drizzle/0042_income_plan_amount_toman.sql", "utf8");
  const run = async () => {
    for (const stmt of migration.split("--> statement-breakpoint")) if (stmt.trim()) await db.execute(sql.raw(stmt));
  };
  await run();
  const after = async () =>
    new Map((await db.select().from(plannedTransactions)).map((p: any) => [p.title, D(p.amountBase).toFixed(0)]));
  let m = await after();
  assert.equal(m.get("usd-scaled salary"), "45000000", "Toman account: exactly its native amount");
  assert.equal(m.get("usd-scaled tether"), "25000000", "250 USD × the user's 100,000 rate");
  assert.equal(m.get("already toman"), "45000000", "untouched");
  assert.equal(m.get("executed stays"), "450", "history is not rewritten");
  assert.equal(m.get("plain"), "7", "not an income plan");

  await run();
  m = await after();
  assert.equal(m.get("usd-scaled salary"), "45000000", "a second run changes nothing");
  assert.equal(m.get("usd-scaled tether"), "25000000");
});
