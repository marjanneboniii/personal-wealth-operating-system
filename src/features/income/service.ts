/**
 * Recurring income — reminders, never silent postings.
 *
 * An income marked «هر ماه» becomes a pending `planned_transactions` row
 * (inflow, with its category, receiving account, amount in that account's
 * unit and Jalali day). When it is due, «نمای کلی» offers it; the user records
 * it with one tap (or edits the amount first), or says it did not arrive this
 * month. Either way the next occurrence is scheduled. Nothing is written to the
 * ledger without the user's tap.
 */
import { and, asc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets, deposits, expenseCategories, plannedTransactions } from "@/db/schema";
import { todayIso } from "@/lib/format";
import { clampDayOfMonth, jalaliDayOf, nextMonthlyDate } from "./recurring";

export type IncomePlan = {
  id: string;
  title: string;
  plannedDate: string;
  categoryId: string;
  categoryName: string;
  accountId: string;
  accountName: string;
  symbol: string;
  amountNative: string;
  dayOfMonth: number;
};

const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

function planSelect() {
  return db
    .select({
      id: plannedTransactions.id,
      title: plannedTransactions.title,
      plannedDate: plannedTransactions.plannedDate,
      categoryId: plannedTransactions.categoryId,
      categoryName: expenseCategories.name,
      accountId: plannedTransactions.toAccountId,
      accountName: accounts.name,
      symbol: assets.symbol,
      amountNative: plannedTransactions.amountNative,
      dayOfMonth: plannedTransactions.dayOfMonth,
    })
    .from(plannedTransactions)
    .innerJoin(expenseCategories, eq(expenseCategories.id, plannedTransactions.categoryId))
    .innerJoin(accounts, eq(accounts.id, plannedTransactions.toAccountId))
    .leftJoin(assets, eq(assets.id, accounts.assetId));
}

const toPlan = (row: any): IncomePlan => ({
  id: row.id,
  title: row.title,
  plannedDate: row.plannedDate,
  categoryId: row.categoryId,
  categoryName: row.categoryName,
  accountId: row.accountId,
  accountName: row.accountName,
  symbol: (row.symbol ?? "IRT").toUpperCase(),
  amountNative: String(row.amountNative ?? "0"),
  dayOfMonth: row.dayOfMonth ?? jalaliDayOf(row.plannedDate),
});

/** Pending recurring incomes of this user due within `horizonDays` (overdue included). */
export async function listDueIncomePlans(userId: string, horizonDays = 3): Promise<IncomePlan[]> {
  const rows = await planSelect()
    .where(
      and(
        eq(plannedTransactions.userId, userId),
        eq(plannedTransactions.direction, "inflow"),
        eq(plannedTransactions.status, "pending"),
        isNull(plannedTransactions.deletedAt),
        isNotNull(plannedTransactions.categoryId),
        isNotNull(plannedTransactions.amountNative),
        lte(plannedTransactions.plannedDate, addDays(todayIso(), horizonDays)),
      ),
    )
    .orderBy(asc(plannedTransactions.plannedDate));
  return rows.map(toPlan);
}

/** One pending recurring income of this user, or null. */
export async function getIncomePlan(planId: string, userId: string): Promise<IncomePlan | null> {
  const [row] = await planSelect()
    .where(
      and(
        eq(plannedTransactions.id, planId),
        eq(plannedTransactions.userId, userId),
        eq(plannedTransactions.direction, "inflow"),
        eq(plannedTransactions.status, "pending"),
        isNull(plannedTransactions.deletedAt),
      ),
    )
    .limit(1);
  return row ? toPlan(row) : null;
}

export type NewIncomePlan = {
  userId: string;
  title: string;
  /** date of the occurrence just recorded — the next one is a month later */
  fromDate: string;
  dayOfMonth: number;
  categoryId: string;
  accountId: string;
  assetId: string | null;
  amountNative: string;
  /** Toman — what the forecast reads (planned_transactions.amount_base is contractual Toman). */
  amountBase: string;
  /** A deposit's interest: carried to every later occurrence. */
  depositId?: string | null;
  /** Last date an occurrence may fall on (a deposit's maturity); none after it. */
  until?: string | null;
  /** The exact date of this occurrence, instead of one month after `fromDate`. */
  at?: string | null;
};

/** Schedule the next monthly occurrence — or none, when it would fall after `until`. */
export async function scheduleNextIncome(plan: NewIncomePlan, client: any = db): Promise<string | null> {
  const day = clampDayOfMonth(plan.dayOfMonth);
  const plannedDate = plan.at ?? nextMonthlyDate(plan.fromDate, day);
  if (plan.until && plannedDate > plan.until) return null;
  const [row] = await client
    .insert(plannedTransactions)
    .values({
      userId: plan.userId,
      title: plan.title,
      plannedDate,
      direction: "inflow",
      amountBase: plan.amountBase,
      toAccountId: plan.accountId,
      assetId: plan.assetId,
      recurrence: "monthly",
      status: "pending",
      categoryId: plan.categoryId,
      amountNative: plan.amountNative,
      dayOfMonth: day,
      depositId: plan.depositId ?? null,
    })
    .returning({ id: plannedTransactions.id });
  return row.id;
}

/**
 * Close one occurrence — `executed` with its entry, or `cancelled` when the
 * income did not arrive — and schedule the next one with the SAME amount
 * unless `amountNative` says otherwise. Only this user's pending row qualifies.
 */
export async function closeIncomeOccurrence(
  input: { planId: string; userId: string; entryId: string | null; amountNative?: string; amountBase?: string },
  client: any = db,
): Promise<void> {
  const [plan] = await client
    .select()
    .from(plannedTransactions)
    .where(
      and(
        eq(plannedTransactions.id, input.planId),
        eq(plannedTransactions.userId, input.userId),
        eq(plannedTransactions.status, "pending"),
        isNull(plannedTransactions.deletedAt),
      ),
    )
    .limit(1);
  if (!plan) throw new Error("یادآوری درآمد یافت نشد یا قبلاً ثبت شده است.");

  await client
    .update(plannedTransactions)
    .set({
      status: input.entryId ? "executed" : "cancelled",
      executedEntryId: input.entryId,
      updatedAt: new Date(),
    })
    .where(eq(plannedTransactions.id, plan.id));

  if (!plan.categoryId || !plan.toAccountId) return;
  // A deposit's interest stops once it is closed or past maturity.
  let until: string | null = null;
  if (plan.depositId) {
    const [deposit] = await client
      .select({ status: deposits.status, maturityDate: deposits.maturityDate })
      .from(deposits)
      .where(eq(deposits.id, plan.depositId))
      .limit(1);
    if (!deposit || deposit.status !== "active") return;
    until = deposit.maturityDate ?? null;
  }
  await scheduleNextIncome(
    {
      userId: input.userId,
      title: plan.title,
      fromDate: plan.plannedDate,
      dayOfMonth: plan.dayOfMonth ?? jalaliDayOf(plan.plannedDate),
      categoryId: plan.categoryId,
      accountId: plan.toAccountId,
      assetId: plan.assetId,
      amountNative: input.amountNative ?? String(plan.amountNative ?? "0"),
      amountBase: input.amountBase ?? String(plan.amountBase),
      depositId: plan.depositId ?? null,
      until,
    },
    client,
  );
}

/** Stop a recurring income entirely (its pending occurrence is cancelled, nothing new is scheduled). */
export async function stopIncomePlan(planId: string, userId: string): Promise<void> {
  await db
    .update(plannedTransactions)
    .set({ status: "cancelled", recurrence: "none", updatedAt: new Date() })
    .where(and(eq(plannedTransactions.id, planId), eq(plannedTransactions.userId, userId), eq(plannedTransactions.status, "pending")));
}

export const _test = { addDays, sql };
