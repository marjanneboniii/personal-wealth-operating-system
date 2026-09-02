import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  budgets,
  debts,
  events,
  funds,
  goals,
  installments,
  obligations,
  plannedTransactions,
  users,
} from "@/db/schema";
import { D, Decimal } from "@/domain/decimal";
import { postEntry, unitsFor } from "@/features/ledger/service";
import { getAccountBalances, hasMultipleUsers } from "@/features/ledger/queries";
import { getCurrentNetWorth } from "@/features/portfolio/service";
import { getLatestUsdIrtRateForUser } from "@/lib/fx";
import { addMonthsIso, jalaliToIso, toJalali, todayIso } from "@/lib/format";
import {
  buildInstallmentFxView,
  buildInstallmentPaymentSnapshot,
  summarizePendingUsdChange,
  type InstallmentFxView,
} from "@/features/planning/installmentFx";

async function resolvePlanningUserId(explicitUserId?: string): Promise<string | undefined> {
  if (explicitUserId) return explicitUserId;
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const user = await getCurrentUser();
    if (user?.id) return user.id;
  } catch {}

  try {
    const res = await db.execute(sql`select id from users limit 2`);
    if (res.rows.length === 1) {
      return (res.rows[0] as { id?: string })?.id;
    }
  } catch {}
  return undefined;
}

/**
 * Resolve a fund/goal linked account balance in Toman.
 * IRT-denominated accounts keep quantity as the fixed Toman truth;
 * USD/USDT (and other) accounts convert quantity × current rate for display
 * only — never the reverse path that would inflate a stored Toman target.
 */
function balanceAsToman(
  bal: { quantity: string; baseValue: string; symbol: string | null } | undefined,
  rate: Decimal,
): Decimal {
  if (!bal) return Decimal.zero();
  const sym = (bal.symbol ?? "").toUpperCase();
  if (sym === "IRT" || sym === "IRR") return D(bal.quantity);
  // Non-IRT cash: book value is USD; convert to Toman at the live rate for display.
  if (rate.gt(0)) return D(bal.baseValue).mul(rate);
  return Decimal.zero();
}

/* ---------------- Goals ---------------- */

export async function listGoals(userId?: string) {
  const u = await resolvePlanningUserId(userId);
  if (!u && (await hasMultipleUsers())) return [];
  const [balances, fx] = await Promise.all([
    getAccountBalances(userId),
    getLatestUsdIrtRateForUser(u ?? null),
  ]);
  const rate = D(fx.rate).gt(0) ? D(fx.rate) : D("0");
  const rows = await db
    .select()
    .from(goals)
    .where(and(sql`${goals.deletedAt} is null`, u ? eq(goals.userId, u) : sql`1=1`))
    .orderBy(asc(goals.priority), asc(goals.targetDate));

  return rows.map((g) => {
    const bal = balances.find((b) => b.accountId === g.fundAccountId);
    // targetBase stores the contractual Toman amount entered by the user.
    const targetToman = D(g.targetBase);
    const savedToman = balanceAsToman(bal, rate);
    const progress = targetToman.isZero() ? Decimal.zero() : savedToman.div(targetToman).mul(100);
    const remainingToman = targetToman.sub(savedToman);
    // USD equivalents are display-only and move with the live rate.
    const targetUsd = rate.gt(0) ? targetToman.div(rate).toString() : "0";
    const savedUsd = rate.gt(0) ? savedToman.div(rate).toString() : "0";
    const remainingUsd = rate.gt(0) ? remainingToman.div(rate).toString() : "0";
    return {
      ...g,
      targetToman: targetToman.toFixed(0),
      savedToman: savedToman.toFixed(0),
      remainingToman: remainingToman.toFixed(0),
      // Legacy field names kept for callers; values are now Toman (authoritative).
      savedBase: savedToman.toFixed(0),
      remainingBase: remainingToman.toFixed(0),
      targetUsd,
      savedUsd,
      remainingUsd,
      progress: Math.max(0, Math.min(100, progress.toNumber())),
    };
  });
}

/* ---------------- Funds ---------------- */

export async function listFunds(userId?: string) {
  const u = await resolvePlanningUserId(userId);
  if (!u && (await hasMultipleUsers())) return [];
  const [balances, fx] = await Promise.all([
    getAccountBalances(userId),
    getLatestUsdIrtRateForUser(u ?? null),
  ]);
  const rate = D(fx.rate).gt(0) ? D(fx.rate) : D("0");
  const rows = await db
    .select()
    .from(funds)
    .where(and(sql`${funds.deletedAt} is null`, u ? eq(funds.userId, u) : sql`1=1`));
  return rows.map((f) => {
    const bal = balances.find((b) => b.accountId === f.accountId);
    const targetToman = D(f.targetBase);
    const savedToman = balanceAsToman(bal, rate);
    const targetUsd = rate.gt(0) ? targetToman.div(rate).toString() : "0";
    const savedUsd = rate.gt(0) ? savedToman.div(rate).toString() : "0";
    return {
      ...f,
      targetToman: targetToman.toFixed(0),
      savedToman: savedToman.toFixed(0),
      savedBase: savedToman.toFixed(0),
      targetUsd,
      savedUsd,
      progress: targetToman.isZero() ? 0 : Math.min(100, savedToman.div(targetToman).mul(100).toNumber()),
    };
  });
}

/* ---------------- Budgets ---------------- */

/** Budgets with actual spend derived from the ledger (never stored balances). */
export async function listBudgets(userId?: string) {
  const u = await resolvePlanningUserId(userId);
  if (!u && (await hasMultipleUsers())) return [];
  const fx = await getLatestUsdIrtRateForUser(u ?? null);
  const rate = D(fx.rate).gt(0) ? D(fx.rate) : D("0");
  const rows = await db
    .select({
      id: budgets.id,
      name: budgets.name,
      periodStart: budgets.periodStart,
      periodEnd: budgets.periodEnd,
      amountBase: budgets.amountBase,
      accountId: budgets.accountId,
      accountName: accounts.name,
      accountCode: accounts.code,
    })
    .from(budgets)
    .leftJoin(accounts, eq(accounts.id, budgets.accountId))
    .where(and(sql`${budgets.deletedAt} is null`, u ? eq(budgets.userId, u) : sql`1=1`))
    .orderBy(asc(budgets.periodStart));

  // Spend must respect each budget's own period — derive per budget without N+1 query loop.
  // Budget ceilings are contractual Toman. Ledger expense postings book USD base_value;
  // convert spend → Toman at the live rate for comparison only (display). The ceiling
  // itself never moves with FX.
  const spendMap = new Map<string, string>();
  const activeAccountIds = Array.from(new Set(rows.map((r) => r.accountId).filter(Boolean))) as string[];
  if (rows.length > 0 && activeAccountIds.length > 0) {
    const minStart = rows.reduce((min, r) => (r.periodStart < min ? r.periodStart : min), rows[0].periodStart);
    const maxEnd = rows.reduce((max, r) => (r.periodEnd > max ? r.periodEnd : max), rows[0].periodEnd);
    const postingsRes = await db.execute(sql`
      select p.account_id as account_id, je.entry_date::text as entry_date, p.base_value::text as val
      from postings p
        join journal_entries je on je.id = p.entry_id
      where je.status = 'posted'
        and p.account_id in (${sql.join(
          activeAccountIds.map((id) => sql`${id}`),
          sql`, `,
        )})
        ${u ? sql`and (je.user_id = ${u} or je.user_id is null)` : sql``}
        and je.entry_date >= ${minStart}
        and je.entry_date <= ${maxEnd}
    `);
    const postingRows = postingsRes.rows as { account_id: string; entry_date: string; val: string }[];
    for (const b of rows) {
      if (!b.accountId) continue;
      let sumSpendUsd = Decimal.zero();
      for (const pr of postingRows) {
        if (pr.account_id === b.accountId && pr.entry_date >= b.periodStart && pr.entry_date <= b.periodEnd) {
          sumSpendUsd = sumSpendUsd.add(D(pr.val));
        }
      }
      // Convert USD book spend → Toman at live rate for apples-to-apples with Toman ceiling.
      const spendToman = rate.gt(0) ? sumSpendUsd.mul(rate) : Decimal.zero();
      spendMap.set(b.id, spendToman.toFixed(0));
    }
  }

  const result = [];
  for (const b of rows) {
    const spentToman = D(spendMap.get(b.id) ?? "0");
    // amountBase is the contractual Toman ceiling entered by the user.
    const limitToman = D(b.amountBase);
    const remainingToman = limitToman.sub(spentToman);
    const limitUsd = rate.gt(0) ? limitToman.div(rate).toString() : "0";
    const spentUsd = rate.gt(0) ? spentToman.div(rate).toString() : "0";
    const remainingUsd = rate.gt(0) ? remainingToman.div(rate).toString() : "0";
    result.push({
      ...b,
      amountToman: limitToman.toFixed(0),
      spentToman: spentToman.toFixed(0),
      remainingToman: remainingToman.toFixed(0),
      // Legacy field names now carry Toman (authoritative for the planning UI).
      spentBase: spentToman.toFixed(0),
      remainingBase: remainingToman.toFixed(0),
      amountUsd: limitUsd,
      spentUsd,
      remainingUsd,
      usage: limitToman.isZero() ? 0 : Math.max(0, spentToman.div(limitToman).mul(100).toNumber()),
      over: remainingToman.isNegative(),
    });
  }
  return result;
}

/* ---------------- Debts & installments ---------------- */

/**
 * Loan-vs-installment separation («قسط ≠ وام»).
 *
 * A record that is ONLY an installment / repayment schedule / payment
 * commitment is NOT a loan and must never appear in the Loans UI, no matter
 * how many installments it has. A real Loan / Facility is one of:
 *   • a debt with financing (interestRate > 0), or
 *   • a debt already booked in the double-entry ledger against a liability
 *     account (accountId set — the money was actually received).
 *
 * Planning-only debts (created with `accountId = null` and 0% interest, e.g.
 * a store installment plan for a rug) remain visible in «بدهیها» and their
 * schedule stays in «اقساط»; no data is hidden or deleted.
 */
export function isRealLoanDebt(d: {
  interestRate?: string | number | null;
  accountId?: string | null;
  totalCount?: number | null;
}): boolean {
  return Number(d.interestRate ?? 0) > 0 || (d.accountId != null && d.accountId !== "");
}

export async function listDebts(userId?: string) {
  const u = await resolvePlanningUserId(userId);
  if (!u && (await hasMultipleUsers())) return [];
  const [balances, fx] = await Promise.all([
    getAccountBalances(userId),
    getLatestUsdIrtRateForUser(u ?? null),
  ]);
  const rate = D(fx.rate).gt(0) ? D(fx.rate) : D("1");
  const rows = await db
    .select()
    .from(debts)
    // Legacy/demo debt rows predate user IDs. They remain visible while the
    // single-user workspace is being claimed, just like ledger reference rows.
    .where(and(sql`${debts.deletedAt} is null`, u ? sql`(${debts.userId} = ${u} or ${debts.userId} is null)` : sql`1=1`));
  const inst = await db.select().from(installments).orderBy(asc(installments.dueDate));

  return rows.map((d) => {
    const bal = balances.find((b) => b.accountId === d.accountId);
    const own = inst.filter((i) => i.debtId === d.id);
    const paid = own.filter((i) => i.status === "paid");

    // Contractual Toman is the SOURCE OF TRUTH. USD is always live ÷ rate.
    // Never reconstruct Toman from USD × current rate for Phase-3+ rows.
    if (d.principalToman != null) {
      const principalToman = D(d.principalToman);
      const paidToman = paid.reduce((sum, i) => {
        if (i.amountToman != null) return sum.add(D(i.amountToman));
        // Paid legacy installment without Toman: convert its frozen USD book
        // amount at the CURRENT rate only for residual math (display path).
        return sum.add(rate.gt(0) ? D(i.amountBase).mul(rate) : Decimal.zero());
      }, Decimal.zero());
      const remaining = principalToman.sub(paidToman);
      const outstandingToman = remaining.isNegative() ? Decimal.zero() : remaining;
      const principalUsd = principalToman.div(rate).toString();
      const outstandingUsd = outstandingToman.div(rate).toString();
      return {
        ...d,
        principalToman: principalToman.toFixed(0),
        outstandingToman: outstandingToman.toFixed(0),
        // USD fields are display-only equivalents at the live rate.
        principalBase: principalUsd,
        outstandingBase: outstandingUsd,
        principalUsd,
        outstandingUsd,
        installments: own,
        paidCount: paid.length,
        totalCount: own.length,
        nextDue: own.find((i) => i.status === "pending") ?? null,
      };
    }

    // Legacy records without principal_toman: keep USD planning math, but ALSO
    // surface a Toman display derived at the live rate so the UI never multiplies
    // a USD figure a second time (which would inflate Toman when FX rises).
    const paidScheduled = paid.reduce((sum, i) => sum.add(i.amountBase), Decimal.zero());
    const planningOutstanding = D(d.principalBase).sub(paidScheduled);
    const outstandingUsd = bal
      ? D(bal.baseValue).neg()
      : planningOutstanding.isNegative()
        ? Decimal.zero()
        : planningOutstanding;
    const principalUsd = D(d.principalBase);
    const principalTomanDisp = rate.gt(0) ? principalUsd.mul(rate).toFixed(0) : null;
    const outstandingTomanDisp = rate.gt(0) ? outstandingUsd.mul(rate).toFixed(0) : null;
    return {
      ...d,
      principalToman: principalTomanDisp,
      outstandingToman: outstandingTomanDisp,
      outstandingBase: outstandingUsd.toString(),
      principalUsd: principalUsd.toString(),
      outstandingUsd: outstandingUsd.toString(),
      installments: own,
      paidCount: paid.length,
      totalCount: own.length,
      nextDue: own.find((i) => i.status === "pending") ?? null,
    };
  });
}

export async function upcomingInstallments(limit = 8, userId?: string) {
  const u = await resolvePlanningUserId(userId);
  if (!u && (await hasMultipleUsers())) return [];
  const fx = await getLatestUsdIrtRateForUser(u ?? null);
  const rate = D(fx.rate).gt(0) ? D(fx.rate) : D("0");
  const rows = await db
    .select({
      id: installments.id,
      seq: installments.seq,
      dueDate: installments.dueDate,
      amountBase: installments.amountBase,
      amountToman: installments.amountToman,
      status: installments.status,
      debtTitle: debts.title,
      creditor: debts.creditor,
      debtAccountId: debts.accountId,
    })
    .from(installments)
    .innerJoin(debts, eq(debts.id, installments.debtId))
    .where(and(eq(installments.status, "pending"), u ? sql`(${debts.userId} = ${u} or ${debts.userId} is null)` : sql`1=1`))
    .orderBy(asc(installments.dueDate))
    .limit(limit);

  // Attach a resolved Toman figure so callers never have to do USD×rate themselves.
  return rows.map((r) => {
    const amountToman =
      r.amountToman != null
        ? D(r.amountToman).toFixed(0)
        : rate.gt(0)
          ? D(r.amountBase).mul(rate).toFixed(0)
          : null;
    const amountUsd =
      amountToman != null && rate.gt(0) ? D(amountToman).div(rate).toString() : D(r.amountBase).toString();
    return {
      ...r,
      amountToman,
      amountUsd,
    };
  });
}

/**
 * Full installment schedule for one tenant, with the state-aware FX view
 * resolved in the BACKEND (§ business rule):
 *
 *   pending → Toman frozen, USD equivalent derived from the CURRENT rate
 *   paid    → Toman and USD both read from the payment snapshot (immutable)
 *
 * The UI only formats what this returns; it never re-derives a USD figure.
 */
export async function listInstallmentSchedule(userId?: string) {
  const u = await resolvePlanningUserId(userId);
  if (!u && (await hasMultipleUsers())) {
    return { rate: null as string | null, rows: [] as InstallmentScheduleRow[], pendingUsdInsight: null };
  }
  const fx = await getLatestUsdIrtRateForUser(u ?? null);
  const rows = await db
    .select({
      id: installments.id,
      seq: installments.seq,
      dueDate: installments.dueDate,
      amountBase: installments.amountBase,
      amountToman: installments.amountToman,
      amountUsdCreated: installments.amountUsdCreated,
      originalFxRate: installments.originalFxRate,
      originalFxRateCapturedAt: installments.originalFxRateCapturedAt,
      paidToman: installments.paidToman,
      paidUsd: installments.paidUsd,
      paidFxRate: installments.paidFxRate,
      paidAt: installments.paidAt,
      status: installments.status,
      debtId: debts.id,
      title: debts.title,
      creditor: debts.creditor,
    })
    .from(installments)
    .innerJoin(debts, eq(debts.id, installments.debtId))
    .where(
      and(
        sql`${debts.deletedAt} is null`,
        u ? sql`(${debts.userId} = ${u} or ${debts.userId} is null)` : sql`1=1`,
      ),
    )
    .orderBy(asc(installments.dueDate));

  const mapped: InstallmentScheduleRow[] = rows.map((r) => ({
    ...r,
    fx: buildInstallmentFxView(r, fx.rate),
  }));

  return {
    rate: fx.rate,
    rows: mapped,
    pendingUsdInsight: summarizePendingUsdChange(mapped.map((r) => r.fx)),
  };
}

export type InstallmentScheduleRow = {
  id: string;
  seq: number;
  dueDate: string;
  amountBase: string;
  amountToman: string | null;
  amountUsdCreated: string | null;
  originalFxRate: string | null;
  originalFxRateCapturedAt: Date | string | null;
  paidToman: string | null;
  paidUsd: string | null;
  paidFxRate: string | null;
  paidAt: string | null;
  status: string;
  debtId: string;
  title: string;
  creditor: string;
  fx: InstallmentFxView;
};

/**
 * SECURITY (M-03): atomic installment payment.
 *
 * Before the fix the sequence was: read installment -> post ledger entry (own
 * transaction) -> update the installment row in a SECOND, unrelated write. A
 * crash between the two moved money while the installment stayed "pending",
 * and two concurrent payments could both pass the status check and post twice.
 *
 * Now the whole flow runs in ONE database transaction:
 *   BEGIN
 *     SELECT installment FOR UPDATE         (row lock closes the race)
 *     validate installment (tenant-scoped)  (WHERE user_id = :currentUserId)
 *     validate accounting preconditions
 *     postEntry(tx)                         (existing single write path)
 *     update installment status + metadata
 *     settle debt when no pending rows left
 *   COMMIT (ROLLBACK automatically on any failure)
 *
 * The ledger write itself is delegated, unchanged, to the existing postEntry.
 */
export async function payInstallment(installmentId: string, cashAccountId: string, userId?: string) {
  const u = userId ?? (await resolvePlanningUserId(undefined));
  // Fail-closed: a settlement write must never target a shared/NULL tenant.
  if (!u && (await hasMultipleUsers())) {
    throw new Error("Authentication/Database error: Access denied");
  }
  return db.transaction(async (tx) => {
    // 1) Validate installment - row lock first so a concurrent payment of the
    //    same installment serializes behind us and sees the updated status.
    await tx.execute(sql`SELECT id FROM installments WHERE id = ${installmentId} FOR UPDATE`);

    // 2) Validate ownership at the DB query level (never trust caller input):
    //    the debt owning this installment must belong to the current tenant.
    const row = await tx
      .select({ inst: installments, debt: debts })
      .from(installments)
      .innerJoin(debts, eq(debts.id, installments.debtId))
      .where(
        and(
          eq(installments.id, installmentId),
          u ? sql`(${debts.userId} = ${u} or ${debts.userId} is null)` : sql`1=1`,
        ),
      )
      .limit(1);
    if (!row.length) throw new Error("قسط یافت نشد یا متعلق به شما نیست");
    const { inst, debt } = row[0];
    if (inst.status === "paid") return { id: inst.paidEntryId ?? "", alreadyPaid: true };

    // 3) Validate accounting preconditions.
    if (!debt.accountId) throw new Error("حساب بدهی تعریف نشده است");

    const amount = D(inst.amountBase);
    // 3b) Capture the FX rate valid AT THIS MOMENT, from the project's existing
    //     per-user FX source of truth and INSIDE this transaction, so the
    //     payment snapshot below can never be rebuilt from a later rate.
    const paymentFx = await getLatestUsdIrtRateForUser(u ?? null, tx);
    const paymentRate = D(paymentFx.rate);
    // The obligation being settled: contractual Toman (Phase 3+) or, for a
    // legacy USD-only row, its book amount converted once at the payment rate.
    const settledToman =
      inst.amountToman != null
        ? D(inst.amountToman)
        : paymentRate.gt(0)
          ? amount.mul(paymentRate)
          : null;
    if (!settledToman) throw new Error("نرخ تبدیل دلار به تومان برای ثبت پرداخت این قسط موجود نیست.");
    // Throws (and rolls the whole payment back) rather than leaving a `paid`
    // row without a USD snapshot.
    const paymentSnapshot = buildInstallmentPaymentSnapshot({
      paidToman: settledToman.toString(),
      fxRate: paymentFx.rate,
    });

    // Reference reads run INSIDE the transaction (single-connection drivers
    // hold an exclusive lock during it) — keeps the read set consistent too.
    const cashUnits = await unitsFor(cashAccountId, amount.toString(), tx, u);
    const debtUnits = await unitsFor(debt.accountId, amount.toString(), tx, u);

    // 4) Post the ledger movement through the EXISTING single write path,
    //    inside this same transaction so it commits or rolls back atomically.
    const entry = await postEntry(
      {
        entryDate: todayIso(),
        type: "installment",
        description: `پرداخت قسط ${inst.seq} — ${debt.title}`,
        userId: u,
        postings: [
          {
            accountId: cashAccountId,
            assetId: cashUnits.assetId,
            quantity: D(cashUnits.quantity).neg().toString(),
            baseValue: amount.neg().toString(),
          },
          {
            accountId: debt.accountId,
            assetId: debtUnits.assetId,
            quantity: debtUnits.quantity,
            baseValue: amount.toString(),
            memo: "کاهش مانده بدهی",
          },
        ],
      },
      tx,
    );

    // 5) Update installment status + payment metadata (same transaction).
    //    Toman, FX rate and USD equivalent are frozen here, once, forever.
    await tx
      .update(installments)
      .set({
        status: "paid",
        paidAt: todayIso(),
        paidEntryId: entry.id,
        paidToman: paymentSnapshot.paidToman,
        paidFxRate: paymentSnapshot.paidFxRate,
        paidUsd: paymentSnapshot.paidUsd,
      })
      .where(eq(installments.id, installmentId));

    // 6) Settle the debt once its last pending installment is paid.
    const pending = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(installments)
      .where(and(eq(installments.debtId, debt.id), eq(installments.status, "pending")));
    if ((pending[0]?.c ?? 0) === 0) {
      await tx.update(debts).set({ status: "settled" }).where(eq(debts.id, debt.id));
    }
    return entry;
  });
}

/* ---------------- Planned transactions ---------------- */

/**
 * A plan only touches the ledger when it is explicitly executed.
 * Execution is idempotent: an already-executed plan is never posted twice.
 */
export async function executePlanned(id: string) {
  const rows = await db.select().from(plannedTransactions).where(eq(plannedTransactions.id, id));
  if (!rows.length) throw new Error("برنامه یافت نشد");
  const plan = rows[0];
  if (plan.status === "executed") return { id: plan.executedEntryId ?? "", already: true };

  const cashId = plan.direction === "outflow" ? plan.fromAccountId : plan.toAccountId;
  if (!cashId) throw new Error("حساب نقدی برنامه مشخص نیست");

  const counterCode = plan.direction === "outflow" ? "5900" : "4900";
  const counter = await db.select().from(accounts).where(eq(accounts.code, counterCode)).limit(1);
  const counterId =
    plan.direction === "outflow"
      ? plan.toAccountId ?? counter[0]?.id
      : plan.fromAccountId ?? counter[0]?.id;
  if (!counterId) throw new Error("حساب طرف مقابل یافت نشد");

  const amount = D(plan.amountBase);
  const outflow = plan.direction === "outflow";
  const cashUnits = await unitsFor(cashId, amount.toString(), undefined, plan.userId ?? null);
  const counterUnits = await unitsFor(counterId, amount.toString(), undefined, plan.userId ?? null);

  const entry = await postEntry({
    entryDate: plan.plannedDate,
    type: outflow ? "expense" : "income",
    description: `اجرای برنامه: ${plan.title}`,
    source: "plan",
    userId: plan.userId ?? undefined,
    postings: [
      {
        accountId: cashId,
        assetId: cashUnits.assetId,
        quantity: (outflow ? D(cashUnits.quantity).neg() : D(cashUnits.quantity)).toString(),
        baseValue: (outflow ? amount.neg() : amount).toString(),
      },
      {
        accountId: counterId,
        assetId: counterUnits.assetId,
        quantity: (outflow ? D(counterUnits.quantity) : D(counterUnits.quantity).neg()).toString(),
        baseValue: (outflow ? amount : amount.neg()).toString(),
      },
    ],
  });

  await db
    .update(plannedTransactions)
    .set({ status: "executed", executedEntryId: entry.id, updatedAt: new Date() })
    .where(eq(plannedTransactions.id, id));

  if (plan.recurrence !== "none") {
    await db.insert(plannedTransactions).values({
      title: plan.title,
      plannedDate: addMonthsIso(plan.plannedDate, plan.recurrence === "monthly" ? 1 : 12),
      direction: plan.direction,
      amountBase: plan.amountBase,
      fromAccountId: plan.fromAccountId,
      toAccountId: plan.toAccountId,
      assetId: plan.assetId,
      recurrence: plan.recurrence,
      goalId: plan.goalId,
      eventId: plan.eventId,
      note: plan.note,
      userId: plan.userId,
    } as any);
  }
  return entry;
}

/* ---------------- Projection engine ---------------- */

/**
 * KEY OF THE CASH-FLOW MONTH BUCKET FOR A DUE DATE.
 *
 * A projection bucket is the JALALI calendar month containing the due date:
 *
 *   due_date → calendar month of due_date → that month's bucket
 *
 * Bucketing by the Gregorian month start (`YYYY-MM-01`) is WRONG: Jalali
 * months begin ~11 days after each Gregorian month start, so a due date such
 * as ۱۴۰۵/۰۸/۰۱ (2026-10-23) landed in the Gregorian bucket 2026-10-01 and
 * was displayed under مهر (1405/07) instead of آبان (1405/08) — the off-by-one
 * month bug. The key below is derived from the due date's own conventional
 * calendar month, with no rounding, no ±1-day shift and no timezone
 * conversion (dates are plain ISO date strings).
 */
export function jalaliMonthBucketKey(iso: string): string {
  const { y, m } = toJalali(iso);
  return `${y}/${String(m).padStart(2, "0")}`;
}

/** ISO first-days of the next `months` Jalali months (starting at `fromIso`'s own month). */
export function jalaliMonthStarts(months: number, fromIso?: string): { key: string; iso: string }[] {
  const { y, m } = toJalali(fromIso ?? todayIso());
  const out: { key: string; iso: string }[] = [];
  let yy = y;
  let mm = m;
  for (let i = 0; i < months; i++) {
    const iso = jalaliToIso(yy, mm, 1);
    out.push({ key: `${yy}/${String(mm).padStart(2, "0")}`, iso });
    mm += 1;
    if (mm > 12) {
      mm = 1;
      yy += 1;
    }
  }
  return out;
}

export type ProjectionPoint = {
  month: string;
  /** Toman (authoritative for the planning module). */
  inflow: string;
  outflow: string;
  net: string;
  cumulative: string;
  /** USD display-only companions at the live rate. */
  inflowUsd?: string;
  outflowUsd?: string;
  netUsd?: string;
  cumulativeUsd?: string;
  deficit: boolean;
};

export async function projectCashflow(months = 12, scenario: "base" | "optimistic" | "pessimistic" = "base", userId?: string) {
  const u = await resolvePlanningUserId(userId);
  // Fail-closed: never blend tenants' projections.
  if (!u && (await hasMultipleUsers())) {
    return {
      startingLiquidity: "0",
      netWorth: "0",
      startingLiquidityToman: "0",
      netWorthToman: "0",
      points: [],
      scenario,
      unit: "IRT" as const,
    };
  }
  const [nw, planned, insts, obls, evs, fx] = await Promise.all([
    getCurrentNetWorth(userId),
    listPlanned(userId),
    db
      .select({ inst: installments })
      .from(installments)
      .innerJoin(debts, eq(debts.id, installments.debtId))
      .where(and(eq(installments.status, "pending"), u ? sql`(${debts.userId} = ${u} or ${debts.userId} is null)` : sql`1=1`))
      .then((rows) => rows.map((r) => r.inst)),
    db
      .select()
      .from(obligations)
      .where(and(sql`${obligations.deletedAt} is null`, u ? eq(obligations.userId, u) : sql`1=1`)),
    db
      .select()
      .from(events)
      .where(and(sql`${events.deletedAt} is null`, u ? eq(events.userId, u) : sql`1=1`)),
    getLatestUsdIrtRateForUser(u ?? null),
  ]);

  const rate = D(fx.rate).gt(0) ? D(fx.rate) : D("0");
  const factorIn = scenario === "optimistic" ? 1.1 : scenario === "pessimistic" ? 0.9 : 1;
  const factorOut = scenario === "optimistic" ? 0.95 : scenario === "pessimistic" ? 1.15 : 1;

  /**
   * Projection unit = Toman.
   * Planning amounts (planned txns, obligations, events, installment.amount_toman)
   * are contractual Toman and enter the buckets unchanged. Only the starting
   * liquidity (ledger USD book) is converted once at the live rate for the
   * opening balance. FX changes therefore move the USD preview of the opening
   * line — never the Toman scheduled outflows.
   *
   * MONTH BUCKETING: each obligation is bucketed into the JALALI calendar
   * month of its own due_date (see jalaliMonthBucketKey). `month` on each
   * point is the ISO first day of that Jalali month, so every label derives
   * the correct month (۱۴۰۵/۰۸/۰۱ → آبان, never مهر).
   */
  const buckets = new Map<string, { iso: string; inflow: Decimal; outflow: Decimal }>();
  for (const def of jalaliMonthStarts(months)) {
    buckets.set(def.key, { iso: def.iso, inflow: Decimal.zero(), outflow: Decimal.zero() });
  }
  const push = (iso: string, amountToman: Decimal, dir: "inflow" | "outflow") => {
    const b = buckets.get(jalaliMonthBucketKey(iso));
    if (!b) return;
    if (dir === "inflow") b.inflow = b.inflow.add(amountToman.mul(String(factorIn)));
    else b.outflow = b.outflow.add(amountToman.mul(String(factorOut)));
  };

  for (const p of planned) {
    if (p.status !== "pending") continue;
    // amountBase on planned transactions stores the user-entered Toman amount.
    push(p.plannedDate, D(p.amountBase), p.direction === "inflow" ? "inflow" : "outflow");
  }
  for (const i of insts) {
    // Prefer contractual amount_toman; legacy USD installments convert once.
    const toman =
      i.amountToman != null
        ? D(i.amountToman)
        : rate.gt(0)
          ? D(i.amountBase).mul(rate)
          : Decimal.zero();
    push(i.dueDate, toman, "outflow");
  }
  for (const o of obls) {
    if (o.status !== "pending") continue;
    // amountBase stores contractual Toman.
    if (o.recurrence === "monthly") {
      // Recurrence follows JALALI calendar months of the obligation (same
      // month-arithmetic as the buckets — never Gregorian month shifting).
      for (const { iso } of jalaliMonthStarts(months, o.dueDate)) push(iso, D(o.amountBase), "outflow");
    } else {
      push(o.dueDate, D(o.amountBase), "outflow");
    }
  }
  for (const e of evs) {
    if (e.status !== "planned") continue;
    // budgetBase stores contractual Toman.
    push(e.eventDate, D(e.budgetBase), "outflow");
  }

  // Opening liquidity: ledger reports USD book; convert once → Toman for the axis.
  const startingLiquidityToman = rate.gt(0) ? D(nw.liquid).mul(rate) : Decimal.zero();
  const netWorthToman = rate.gt(0) ? D(nw.netWorth).mul(rate) : Decimal.zero();
  let cumulative = startingLiquidityToman;
  const points: ProjectionPoint[] = [];
  for (const [, b] of buckets) {
    const net = b.inflow.sub(b.outflow);
    cumulative = cumulative.add(net);
    const inflowT = b.inflow;
    const outflowT = b.outflow;
    points.push({
      // ISO first day of the JALALI month this bucket represents (e.g.
      // 1405/08/01 → 2026-10-23), so toJalali()/jalaliMonthKey() never shift
      // an obligation into the previous Jalali month.
      month: b.iso,
      // Primary figures are Toman (authoritative for the planning module).
      inflow: inflowT.toFixed(0),
      outflow: outflowT.toFixed(0),
      net: net.toFixed(0),
      cumulative: cumulative.toFixed(0),
      // USD display-only companions (live rate).
      inflowUsd: rate.gt(0) ? inflowT.div(rate).toString() : "0",
      outflowUsd: rate.gt(0) ? outflowT.div(rate).toString() : "0",
      netUsd: rate.gt(0) ? net.div(rate).toString() : "0",
      cumulativeUsd: rate.gt(0) ? cumulative.div(rate).toString() : "0",
      deficit: cumulative.isNegative(),
    } as ProjectionPoint);
  }
  return {
    startingLiquidity: startingLiquidityToman.toFixed(0),
    netWorth: netWorthToman.toFixed(0),
    startingLiquidityToman: startingLiquidityToman.toFixed(0),
    netWorthToman: netWorthToman.toFixed(0),
    startingLiquidityUsd: nw.liquid,
    netWorthUsd: nw.netWorth,
    points,
    scenario,
    unit: "IRT" as const,
  };
}

export async function listEvents(userId?: string) {
  const u = await resolvePlanningUserId(userId);
  if (!u && (await hasMultipleUsers())) return [];
  const fx = await getLatestUsdIrtRateForUser(u ?? null);
  const rate = D(fx.rate).gt(0) ? D(fx.rate) : D("0");
  const rows = await db
    .select()
    .from(events)
    .where(and(sql`${events.deletedAt} is null`, u ? eq(events.userId, u) : sql`1=1`))
    .orderBy(asc(events.eventDate));
  // budgetBase is contractual Toman; attach a live USD preview only.
  return rows.map((e) => ({
    ...e,
    budgetToman: D(e.budgetBase).toFixed(0),
    budgetUsd: rate.gt(0) ? D(e.budgetBase).div(rate).toString() : "0",
  }));
}

export async function listObligations(userId?: string) {
  const u = await resolvePlanningUserId(userId);
  if (!u && (await hasMultipleUsers())) return [];
  const fx = await getLatestUsdIrtRateForUser(u ?? null);
  const rate = D(fx.rate).gt(0) ? D(fx.rate) : D("0");
  const rows = await db
    .select()
    .from(obligations)
    .where(and(sql`${obligations.deletedAt} is null`, u ? eq(obligations.userId, u) : sql`1=1`))
    .orderBy(asc(obligations.dueDate));
  // amountBase is contractual Toman; attach a live USD preview only.
  return rows.map((o) => ({
    ...o,
    amountToman: D(o.amountBase).toFixed(0),
    amountUsd: rate.gt(0) ? D(o.amountBase).div(rate).toString() : "0",
  }));
}

export async function listPlanned(userId?: string) {
  const u = await resolvePlanningUserId(userId);
  if (!u && (await hasMultipleUsers())) return [];
  const fx = await getLatestUsdIrtRateForUser(u ?? null);
  const rate = D(fx.rate).gt(0) ? D(fx.rate) : D("0");
  const rows = await db
    .select()
    .from(plannedTransactions)
    .where(and(sql`${plannedTransactions.deletedAt} is null`, u ? eq(plannedTransactions.userId, u) : sql`1=1`))
    .orderBy(asc(plannedTransactions.plannedDate));
  // amountBase is contractual Toman entered by the user.
  return rows.map((p) => ({
    ...p,
    amountToman: D(p.amountBase).toFixed(0),
    amountUsd: rate.gt(0) ? D(p.amountBase).div(rate).toString() : "0",
  }));
}
