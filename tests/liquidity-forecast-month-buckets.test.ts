/**
 * «نقدینگی پیش‌رو» — due date must land in the month of its own due_date.
 *
 * Reproduces and pins the reported off-by-one month bug:
 *   due_date = ۱۴۰۵/۰۸/۰۱ (2026-10-23, کد ISO)
 * The old engine bucketed by the GREGORIAN month start (`YYYY-MM-01`):
 *   2026-10-23 → bucket 2026-10-01 → Jalali label مهر 1405 (month 07) ✗
 * The fix buckets by the JALALI calendar month of the due date itself:
 *   2026-10-23 → 1405/08 → آبان ✓
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { eq } from "drizzle-orm";
import { D } from "../src/domain/decimal";
import { jalaliMonthLabel, jalaliMonthKey, toJalali } from "../src/lib/format";
import { jalaliMonthBucketKey, jalaliMonthStarts } from "../src/features/planning/service";

/* ── Pure calendar-bucket tests (no DB) ── */

test("due date ۱۴۰۵/۰۸/۰۱ buckets into آبان (1405/08), never مهر", () => {
  const iso = "2026-10-23"; // 1405/08/01
  const key = jalaliMonthBucketKey(iso);
  assert.equal(key, "1405/08");
  assert.equal(jalaliMonthLabel(jalaliMonthKey(iso), "en"), "آبان 1405");
  assert.notEqual(key, "1405/07");
});

test("obligation on the LAST day of a month stays in that month (no rollover)", () => {
  // آبان 1405 runs 2026-10-23 … 2026-11-21.
  assert.equal(jalaliMonthBucketKey("2026-11-21"), "1405/08", "Aban 30 must stay آبان");
  assert.equal(jalaliMonthBucketKey("2026-11-22"), "1405/09", "Azar 1 starts آذر");
  // آخرین روز تیر (1405/04/31 = 2026-07-22).
  assert.equal(jalaliMonthBucketKey("2026-07-22"), "1405/04");
  assert.equal(jalaliMonthBucketKey("2026-07-23"), "1405/05");
});

test("UTC/local boundary timestamps are sliced to the date — no timezone month shift", () => {
  // String forms with time components must not move the month.
  assert.equal(jalaliMonthBucketKey("2026-10-23T00:00:00.000Z"), "1405/08");
  assert.equal(jalaliMonthBucketKey("2026-10-23T23:59:59.000Z"), "1405/08");
  assert.equal(jalaliMonthStarts(1, "2026-10-22T23:59:59.000Z")[0].key, "1405/07");
});

test("month starts advance in strict Jalali order and wrap years correctly", () => {
  const starts = jalaliMonthStarts(14, "2026-09-23"); // مهر 1405 (1405/07/01)
  assert.equal(starts[0].key, "1405/07");
  assert.equal(starts[0].iso, "2026-09-23");
  assert.equal(starts[1].key, "1405/08");
  assert.equal(starts[1].iso, "2026-10-23");
  assert.equal(starts[5].key, "1405/12"); // اسفند
  assert.equal(starts[6].key, "1406/01"); // year wrap
  assert.equal(starts[13].key, "1406/08");
  // Every start is the FIRST day of its own Jalali month.
  for (const s of starts) {
    const j = toJalali(s.iso);
    assert.equal(j.d, 1, `${s.key} start must be day 1`);
    assert.equal(`${j.y}/${String(j.m).padStart(2, "0")}`, s.key);
  }
});

/* ── Integration: projectCashflow puts the installment in آبان ── */

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
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

let db: any, createSchemaIfNotExists: any;
let debts: any, installments: any, users: any, userFxSettings: any, projectCashflow: any;

async function loadModules() {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ debts, installments, users, userFxSettings } = await import("../src/db/schema"));
  ({ projectCashflow } = await import("../src/features/planning/service"));
}
const modulesReady = loadModules();

test("projectCashflow: ۱۴۰۵/۰۸/۰۱ installment appears in آبان — not مهر", async () => {
  await modulesReady;
  await createSchemaIfNotExists();
  await db.delete(installments);
  await db.delete(debts);
  await db.delete(userFxSettings);
  await db.delete(users);

  const [user] = await db
    .insert(users)
    .values({ name: "ForecastOwner", username: "forecast-owner", role: "owner" } as any)
    .returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "210000" } as any);

  const [debt] = await db
    .insert(debts)
    .values({
      userId: user.id,
      creditor: "فروشگاه سرای فرش",
      title: "قسط فرش",
      principalBase: "142.857",
      principalToman: "30000000",
      principalUsdCreated: "142.857",
      interestRate: "0",
      startDate: "2026-08-01",
      accountId: null,
      status: "active",
    } as any)
    .returning();
  await db.insert(installments).values({
    debtId: debt.id,
    seq: 1,
    // ۱۴۰۵/۰۸/۰۱ — the exact date from the report.
    dueDate: "2026-10-23",
    amountBase: "142.857",
    amountToman: "30000000",
    amountUsdCreated: "142.857",
    originalFxRate: "210000",
    status: "pending",
  } as any);

  const projection = await projectCashflow(12, "base", user.id);
  const points = projection.points as any[];

  // The 30,000,000-Toman obligation lives under month key 1405/08 (آبان)…
  const aban = points.find((p) => jalaliMonthKey(p.month) === "1405/08");
  assert.ok(aban, "an آبان bucket must exist in the 12-month window");
  assert.ok(D(aban.outflow).gte("30000000"), `Aban outflow must contain the installment: ${aban.outflow}`);
  assert.equal(toJalali(aban.month).m, 8, "bucket month must be آبان (08)");

  // …and it must NOT appear under مهر (1405/07) or any other month.
  for (const p of points) {
    const key = jalaliMonthKey(p.month);
    if (key !== "1405/08") {
      assert.ok(
        D(p.outflow).lt("30000000"),
        `installment leaked into ${key} (outflow=${p.outflow})`,
      );
    }
  }

  // Display label of the bucket is آبان (the month of the due date itself).
  assert.equal(jalaliMonthLabel(jalaliMonthKey(aban.month), "en"), "آبان 1405");
});
