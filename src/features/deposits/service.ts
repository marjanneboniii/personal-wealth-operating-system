/**
 * سپرده‌ها — bank term deposits and income funds that pay monthly.
 *
 * A deposit is metadata over money already in the ledger: its principal sits
 * in an account the user funded with an ordinary transfer, so registering,
 * closing or deleting a deposit never posts. What it adds is the schedule:
 * the monthly interest becomes a recurring income reminder (the same one the
 * income form makes), tied to the deposit by planned_transactions.deposit_id.
 * Reminders reach the forecast and the reminder centre, are recorded only on
 * a tap, and stop at maturity or when the deposit is closed.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets, deposits, expenseCategories, plannedTransactions } from "@/db/schema";
import { D, Decimal } from "@/domain/decimal";
import { jalaliDayOf, nextMonthlyDate } from "@/features/income/recurring";
import { scheduleNextIncome } from "@/features/income/service";
import { todayIso } from "@/lib/format";

export type DepositKind = "bank" | "fund";

export const INTEREST_CATEGORY: Record<DepositKind, string> = {
  bank: "INC-INV-INTEREST",
  fund: "INC-INV-DIVIDEND",
};

export type DepositInput = {
  kind: DepositKind;
  title: string;
  institution?: string | null;
  accountId: string;
  payoutAccountId?: string | null;
  principalToman: string;
  annualRate: string;
  startDate: string;
  maturityDate?: string | null;
  note?: string | null;
};

export type DepositRow = {
  id: string;
  kind: DepositKind;
  title: string;
  institution: string | null;
  accountId: string;
  accountName: string | null;
  payoutAccountId: string;
  payoutAccountName: string | null;
  principalToman: string;
  annualRate: string;
  monthlyInterestToman: string;
  startDate: string;
  maturityDate: string | null;
  status: "active" | "closed";
  note: string | null;
  /** The pending interest reminder, if any. */
  nextPayoutDate: string | null;
  nextPlanId: string | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

/** Principal × annual rate ÷ 12, whole Toman. PURE. */
export function monthlyInterest(principalToman: string, annualRate: string): string {
  return D(principalToman).mul(D(annualRate)).div("1200").toFixed(0);
}

/**
 * The first interest date on or after tomorrow, on the start date's Jalali
 * day of month — or null when that falls after maturity. PURE.
 */
export function firstPayoutDate(startDate: string, today: string, maturityDate?: string | null): string | null {
  const day = jalaliDayOf(startDate);
  let next = nextMonthlyDate(startDate, day);
  for (let guard = 0; next <= today && guard < 600; guard++) next = nextMonthlyDate(next, day);
  if (maturityDate && next > maturityDate) return null;
  return next;
}

async function ownAccount(userId: string, accountId: string) {
  const [acc] = await db
    .select({ userId: accounts.userId, type: accounts.type, deletedAt: accounts.deletedAt, symbol: assets.symbol, assetId: accounts.assetId })
    .from(accounts)
    .leftJoin(assets, eq(assets.id, accounts.assetId))
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!acc || acc.userId !== userId || acc.type !== "asset" || acc.deletedAt) throw new Error("حساب انتخاب‌شده متعلق به شما نیست.");
  return acc;
}

async function interestCategoryId(kind: DepositKind): Promise<string> {
  const [row] = await db
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(eq(expenseCategories.code, INTEREST_CATEGORY[kind]))
    .limit(1);
  if (!row) throw new Error("دسته‌ی درآمد سود پیدا نشد؛ یک بار صفحه‌ی ثبت درآمد را باز کنید.");
  return row.id;
}

export async function createDeposit(userId: string, input: DepositInput, today = todayIso()): Promise<string> {
  const title = clean(input.title);
  if (!title || title.length > 120) throw new Error("نام سپرده را وارد کنید.");
  if (input.kind !== "bank" && input.kind !== "fund") throw new Error("نوع سپرده معتبر نیست.");
  let principal: Decimal, rate: Decimal;
  try {
    principal = D(input.principalToman);
    rate = D(input.annualRate);
  } catch {
    throw new Error("مبلغ یا نرخ معتبر نیست.");
  }
  if (!principal.gt(0)) throw new Error("مبلغ سپرده باید بیشتر از صفر باشد.");
  if (!rate.gt(0) || rate.gt(100)) throw new Error("نرخ سود سالانه باید بین ۰ و ۱۰۰ درصد باشد.");
  if (!ISO.test(input.startDate)) throw new Error("تاریخ شروع معتبر نیست.");
  const maturity = clean(input.maturityDate);
  if (maturity && (!ISO.test(maturity) || maturity <= input.startDate)) throw new Error("تاریخ سررسید باید بعد از تاریخ شروع باشد.");

  await ownAccount(userId, input.accountId);
  const payoutId = clean(input.payoutAccountId) ?? input.accountId;
  const payout = await ownAccount(userId, payoutId);
  const unit = (payout.symbol ?? "").toUpperCase();
  if (unit !== "IRT" && unit !== "IRR") throw new Error("سود باید به یک حساب تومانی یا ریالی واریز شود.");
  const categoryId = await interestCategoryId(input.kind);

  const monthly = monthlyInterest(principal.toString(), rate.toString());
  const first = firstPayoutDate(input.startDate, today, maturity);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(deposits)
      .values({
        userId,
        kind: input.kind,
        title,
        institution: clean(input.institution)?.slice(0, 80) ?? null,
        accountId: input.accountId,
        payoutAccountId: payoutId,
        principalToman: principal.toFixed(0),
        annualRate: rate.toString(),
        startDate: input.startDate,
        maturityDate: maturity,
        note: clean(input.note)?.slice(0, 500) ?? null,
      })
      .returning({ id: deposits.id });
    if (first && D(monthly).gt(0)) {
      await scheduleNextIncome(
        {
          userId,
          title: `سود ${input.kind === "fund" ? "صندوق" : "سپرده"} «${title}»`,
          fromDate: input.startDate,
          at: first,
          dayOfMonth: jalaliDayOf(input.startDate),
          categoryId,
          accountId: payoutId,
          assetId: payout.assetId,
          amountNative: unit === "IRR" ? D(monthly).mul(10).toFixed(0) : monthly,
          amountBase: monthly,
          depositId: row.id,
          until: maturity,
        },
        tx,
      );
    }
    return row.id;
  });
}

export async function listDeposits(userId: string): Promise<DepositRow[]> {
  const rows = await db.execute(sql`
    select d.id, d.kind, d.title, d.institution,
           d.account_id as "accountId", a.name as "accountName",
           d.payout_account_id as "payoutAccountId", pa.name as "payoutAccountName",
           d.principal_toman::text as "principalToman", d.annual_rate::text as "annualRate",
           d.start_date::text as "startDate", d.maturity_date::text as "maturityDate",
           d.status, d.note,
           p.planned_date::text as "nextPayoutDate", p.id as "nextPlanId"
    from deposits d
      left join accounts a on a.id = d.account_id
      left join accounts pa on pa.id = d.payout_account_id
      left join lateral (
        select id, planned_date from planned_transactions pt
        where pt.deposit_id = d.id and pt.status = 'pending' and pt.deleted_at is null
        order by pt.planned_date asc limit 1
      ) p on true
    where d.user_id = ${userId}
    order by (d.status = 'active') desc, d.maturity_date asc nulls last, d.created_at asc
  `);
  return (rows.rows as Omit<DepositRow, "monthlyInterestToman">[]).map((r) => ({
    ...r,
    monthlyInterestToman: monthlyInterest(r.principalToman, r.annualRate),
  }));
}

/** Close: the pending interest reminder is cancelled, no new one is scheduled. Nothing posts. */
export async function closeDeposit(userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const res = await tx
      .update(deposits)
      .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(deposits.id, id), eq(deposits.userId, userId), eq(deposits.status, "active")))
      .returning({ id: deposits.id });
    if (!res.length) throw new Error("سپرده پیدا نشد یا قبلاً بسته شده است.");
    await cancelPendingInterest(tx, userId, [id]);
  });
}

/** Delete a deposit registered by mistake; recorded interest entries stay in the ledger. */
export async function deleteDeposit(userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await cancelPendingInterest(tx, userId, [id]);
    const res = await tx.delete(deposits).where(and(eq(deposits.id, id), eq(deposits.userId, userId))).returning({ id: deposits.id });
    if (!res.length) throw new Error("سپرده پیدا نشد.");
  });
}

async function cancelPendingInterest(tx: any, userId: string, depositIds: string[]) {
  await tx
    .update(plannedTransactions)
    .set({ status: "cancelled", recurrence: "none", updatedAt: new Date() })
    .where(
      and(
        inArray(plannedTransactions.depositId, depositIds),
        eq(plannedTransactions.userId, userId),
        eq(plannedTransactions.status, "pending"),
      ),
    );
}

/** Active deposits maturing before `until` (or already past maturity) — for reminders. */
export async function depositsNearMaturity(userId: string, until: string) {
  return db
    .select({ id: deposits.id, title: deposits.title, kind: deposits.kind, principalToman: deposits.principalToman, maturityDate: deposits.maturityDate })
    .from(deposits)
    .where(and(eq(deposits.userId, userId), eq(deposits.status, "active"), sql`${deposits.maturityDate} is not null and ${deposits.maturityDate} < ${until}`))
    .orderBy(asc(deposits.maturityDate));
}
