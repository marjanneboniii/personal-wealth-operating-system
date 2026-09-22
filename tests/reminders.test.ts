/**
 * یادآورها — derived on read, only the seen-marker is stored.
 *
 *  • overdue and next-7-day installments; a paid, far-off or cancelled one is not a reminder
 *  • a receivable reads as money to collect; a partial payment shows what is still owed
 *  • unreviewed imports are one reminder; a new batch is new again
 *  • seen-state is per user; a rescheduled installment is unread again
 *  • one tenant never sees another's reminders
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { eq } from "drizzle-orm";
import { debts, installments, journalEntries, users, userFxSettings } from "../src/db/schema";

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

const TODAY = "2026-09-23";

test("reminders: what is due, what is seen, and whose", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { createSession } = await import("../src/lib/auth");
  const { getReminders } = await import("../src/features/notifications/service");
  const { markRemindersReadAction } = await import("../src/app/actions/notifications");
  await createSchemaIfNotExists();

  const mk = async (name: string) => {
    const [u] = await db
      .insert(users)
      .values({ name, username: `${name}-${Math.random().toString(36).slice(2, 8)}`, role: "owner" } as any)
      .returning();
    await db.insert(userFxSettings).values({ userId: u.id, currentRate: "100000" } as any);
    return u;
  };
  const owner = await mk("owner");
  const other = await mk("other");

  const debt = async (userId: string, title: string, fields: Record<string, unknown> = {}) =>
    (
      await db
        .insert(debts)
        .values({ userId, creditor: "بانک", title, principalBase: "0", startDate: "2026-01-01", ...fields } as any)
        .returning()
    )[0];
  const inst = async (debtId: string, seq: number, dueDate: string, amountToman: string, fields: Record<string, unknown> = {}) =>
    (await db.insert(installments).values({ debtId, seq, dueDate, amountBase: "0", amountToman, ...fields } as any).returning())[0];

  const car = await debt(owner.id, "وام خودرو");
  const overdue = await inst(car.id, 3, "2026-09-20", "10000000");
  const soon = await inst(car.id, 4, "2026-09-26", "10000000", { status: "partial", paidToman: "4000000" });
  await inst(car.id, 5, "2026-10-20", "10000000"); // beyond 7 days
  await inst(car.id, 2, "2026-08-20", "10000000", { status: "paid", paidToman: "10000000" });
  const loanOut = await debt(owner.id, "قرض به علی", { direction: "receivable" });
  await inst(loanOut.id, 1, "2026-09-25", "5000000");
  const cancelled = await debt(owner.id, "لغوشده", { status: "cancelled" });
  await inst(cancelled.id, 1, "2026-09-24", "1000000");
  const foreignDebt = await debt(other.id, "وام دیگری");
  await inst(foreignDebt.id, 1, "2026-09-24", "7000000");

  // Two unreviewed imports of the owner, one of the other tenant.
  await db.insert(journalEntries).values([
    { userId: owner.id, entryDate: "2026-09-21", type: "expense", description: "پیامک ۱", source: "import", status: "posted" },
    { userId: owner.id, entryDate: "2026-09-22", type: "expense", description: "پیامک ۲", source: "import", status: "posted" },
    { userId: other.id, entryDate: "2026-09-22", type: "expense", description: "پیامک دیگری", source: "import", status: "posted" },
  ] as any);

  let list = await getReminders(owner.id, TODAY);
  assert.deepEqual(
    list.map((r: any) => [r.kind, r.title, r.days, r.amountToman]),
    [
      ["installment", "قسط ۳ «وام خودرو»", -3, "10000000"],
      ["receivable", "دریافت قسط ۱ «قرض به علی»", 2, "5000000"],
      ["installment", "قسط ۴ «وام خودرو»", 3, "6000000"],
      ["review", "۲ تراکنش درون‌ریزی‌شده بررسی نشده است", null, null],
    ],
    "overdue first; paid, far-off, cancelled and foreign rows are absent; partial shows what is left",
  );
  assert.ok(list.every((r: any) => !r.read));
  assert.equal(list.find((r: any) => r.kind === "receivable")?.href, "/debts/obligations");

  const otherList = await getReminders(other.id, TODAY);
  assert.deepEqual(otherList.map((r: any) => r.title), ["قسط ۱ «وام دیگری»", "۱ تراکنش درون‌ریزی‌شده بررسی نشده است"]);

  // Seen-state: only for the signed-in user, and only what they saw.
  assert.equal((await markRemindersReadAction(list.map((r: any) => r.key))).ok, false, "anonymous cannot mark");
  cookieJar.value = (await createSession(owner.id)).token;
  assert.equal((await markRemindersReadAction(list.map((r: any) => r.key))).ok, true);
  list = await getReminders(owner.id, TODAY);
  assert.ok(list.every((r: any) => r.read));
  assert.ok((await getReminders(other.id, TODAY)).every((r: any) => !r.read), "another user's seen-state is untouched");

  // A rescheduled installment and a new import batch are new again.
  await db.update(installments).set({ dueDate: "2026-09-27" }).where(eq(installments.id, soon.id));
  await db.insert(journalEntries).values({ userId: owner.id, entryDate: "2026-09-23", type: "expense", description: "پیامک ۳", source: "import", status: "posted" } as any);
  list = await getReminders(owner.id, TODAY);
  assert.deepEqual(
    list.filter((r: any) => !r.read).map((r: any) => r.title),
    ["قسط ۴ «وام خودرو»", "۳ تراکنش درون‌ریزی‌شده بررسی نشده است"],
  );

  // Paying the overdue installment removes its reminder — nothing to dismiss.
  await db.update(installments).set({ status: "paid", paidToman: "10000000" }).where(eq(installments.id, overdue.id));
  assert.ok(!(await getReminders(owner.id, TODAY)).some((r: any) => r.title === "قسط ۳ «وام خودرو»"));
});
