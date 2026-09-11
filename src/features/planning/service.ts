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
} from "@/db/schema";
import { D, Decimal } from "@/domain/decimal";
import { postEntry, unitsFor } from "@/features/ledger/service";
import {
  ensureInstallmentPaymentAccount,
  ensureReceivableCollectionAccount,
  INSTALLMENT_PAYMENT_CODE,
  INSTALLMENT_PAYMENT_NAME,
  RECEIVABLE_COLLECTION_NAME,
} from "@/features/accounts/systemAccounts";
import { getAccountBalances, hasMultipleUsers } from "@/features/ledger/queries";
import { getCurrentNetWorth } from "@/features/portfolio/service";
import { readTenantState } from "@/lib/tenantState";
import { getLatestUsdIrtRateForUser } from "@/lib/fx";
import { addMonthsIso, jalaliToIso, toJalali, todayIso } from "@/lib/format";
import {
  buildInstallmentFxView,
  calculateInstallmentPayment,
  isInstallmentPaid,
  resolveInstallmentToman,
  summarizePendingUsdChange,
  type InstallmentFxView,
} from "@/features/planning/installmentFx";
import {
  INSTALLMENT_PARTIAL,
  PAYABLE,
  RECEIVABLE,
  applyPartialPayment,
  deriveObligationState,
  isInstallmentOutstanding,
  isReceivable,
  remainingToman,
  resolveDirection,
  settlementSign,
  type ObligationState,
} from "@/features/planning/obligations";

async function resolvePlanningUserId(explicitUserId?: string): Promise<string | undefined> {
  if (explicitUserId) return explicitUserId;
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const user = await getCurrentUser();
    if (user?.id) return user.id;
  } catch {}

  // Served from the shared tenant-state cache (60 s TTL) so planning reads
  // never spam the users table per request. Errors keep the old behaviour:
  // an unresolved identity degrades to undefined, and the caller's own
  // hasMultipleUsers() guard (also cached, fail-closed) decides afterwards.
  try {
    const state = await readTenantState();
    if (state.userCount === 1) {
      return state.singleUserId ?? undefined;
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
      select p.account_id as account_id, je.entry_date::text as entry_date, je.type::text as entry_type, p.base_value::text as val
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
    const postingRows = postingsRes.rows as {
      account_id: string;
      entry_date: string;
      entry_type: string;
      val: string;
    }[];
    for (const b of rows) {
      if (!b.accountId) continue;
      // AUDIT F-2 (2026-09-07): a debt repayment is NOT spend. Its contra leg
      // lives on an expense-type account (5960), so a posting-level SUM alone
      // counted it and a budget on «هزینه متفرقه» reported false overspend the
      // day an installment was paid. A repayment is measured only by a budget
      // that was DELIBERATELY bound to «پرداخت اقساط» — the one ceiling for
      // which installment outflow is the thing being capped.
      const installmentBudget = b.accountCode === INSTALLMENT_PAYMENT_CODE;
      let sumSpendUsd = Decimal.zero();
      for (const pr of postingRows) {
        if (pr.account_id !== b.accountId) continue;
        if (pr.entry_type === "debt_repayment" && !installmentBudget) continue;
        if (pr.entry_date >= b.periodStart && pr.entry_date <= b.periodEnd) {
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
  direction?: string | null;
}): boolean {
  // A «وام» is definitionally something the user TOOK. A receivable — even an
  // interest-bearing one the user lent out — is not a loan of theirs and must
  // never appear under «وام‌ها». The direction check lives here rather than at
  // the one call site so every future caller inherits it.
  if (isReceivable(d.direction)) return false;
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
  const today = todayIso();
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
    const paid = own.filter((i) => isInstallmentPaid(i.status));

    // Amount already repaid, in Toman. Exposed so views can show
    // «بازپرداخت‌شده» without re-deriving it from the principal (that identity
    // is false for an interest-bearing schedule — see below).
    const paidToman = own.reduce((sum, i) => {
      // A PARTIAL row has already contributed real money — `paid_toman` is a
      // running total, so it counts here too. Reading only fully-`paid` rows
      // was correct while `partial` did not exist and would now understate
      // «بازپرداخت‌شده» by every part payment the user has actually made.
      if (i.paidToman != null && i.paidToman !== "") return sum.add(D(i.paidToman));
      if (!isInstallmentPaid(i.status)) return sum;
      if (i.amountToman != null) return sum.add(D(i.amountToman));
      // Paid legacy installment without Toman: convert its frozen USD book
      // amount at the CURRENT rate only for residual math (display path).
      return sum.add(rate.gt(0) ? D(i.amountBase).mul(rate) : Decimal.zero());
    }, Decimal.zero());

    // «مانده قابل پرداخت» — what is still owed on this debt.
    //
    // The repayment schedule is the source of truth: the still-unpaid rows,
    // resolved with the SAME helper the «اقساط» page uses
    // (`resolveInstallmentToman`), so /debts, /debts/loans and /installments
    // can never disagree about a single debt's remaining balance.
    //
    // This deliberately replaced `principal_toman − Σ(paid)`, a *principal
    // amortisation* view that was wrong for three reasons:
    //   1. A schedule totals MORE than its principal (it carries interest), so
    //      the interest component silently vanished from the debt total.
    //   2. `principal_toman` is never written back on payment —
    //      `payInstallment` only flips the installment status and settles the
    //      debt — so the figure was not a maintained balance at all.
    //   3. Once Σ(paid) passed the principal, the subtraction went negative and
    //      was clamped to ZERO while unpaid installments were still outstanding.
    //
    // No double counting is possible: a debt contributes EITHER its schedule
    // OR (only when it has no schedule) its principal — never both.
    //
    // PARTIAL rows contribute only what is STILL owed on them
    // (`contractual − paid_so_far`), never their full contractual amount:
    // counting a 50M installment with 30M already paid as 50M would report a
    // balance the user does not owe and would contradict the card that shows
    // «۲۰ میلیون باقی‌مانده» right above it.
    const pendingRows = own.filter((i) => isInstallmentOutstanding(i.status));
    const scheduleRemainingToman = pendingRows.reduce((sum, i) => {
      const t = resolveInstallmentToman(i, fx.rate);
      if (t == null) return sum;
      return sum.add(remainingToman({ status: i.status, amountToman: t, paidToman: i.paidToman }));
    }, Decimal.zero());
    const hasSchedule = own.length > 0;
    const nextDue = own.find((i) => isInstallmentOutstanding(i.status)) ?? null;
    const direction = resolveDirection(d.direction);

    // Contractual Toman is the SOURCE OF TRUTH. USD is always live ÷ rate.
    // Never reconstruct Toman from USD × current rate for Phase-3+ rows.
    if (d.principalToman != null) {
      const principalToman = D(d.principalToman);
      // A debt without any schedule has nothing left to fall back on but its
      // own principal minus what has been repaid against it.
      const outstandingToman = hasSchedule
        ? scheduleRemainingToman
        : (() => {
            const remaining = principalToman.sub(paidToman);
            return remaining.isNegative() ? Decimal.zero() : remaining;
          })();
      const principalUsd = principalToman.div(rate).toString();
      const outstandingUsd = outstandingToman.div(rate).toString();
      return {
        ...d,
        principalToman: principalToman.toFixed(0),
        outstandingToman: outstandingToman.toFixed(0),
        paidToman: paidToman.toFixed(0),
        // USD fields are display-only equivalents at the live rate.
        principalBase: principalUsd,
        outstandingBase: outstandingUsd,
        principalUsd,
        outstandingUsd,
        installments: own,
        paidCount: paid.length,
        totalCount: own.length,
        nextDue,
        direction,
        // Derived, never stored — so «تسویه‌شده با اقساط پرداخت‌نشده» is not a
        // state this system can represent at all.
        state: deriveObligationState({
          status: d.status,
          deletedAt: d.deletedAt,
          installments: own,
          nextDueDate: nextDue?.dueDate ?? null,
          outstandingToman: outstandingToman.toFixed(0),
          todayIso: today,
        }),
      };
    }

    // Legacy records without principal_toman: keep USD planning math, but ALSO
    // surface a Toman display derived at the live rate so the UI never multiplies
    // a USD figure a second time (which would inflate Toman when FX rises).
    const paidScheduled = paid.reduce((sum, i) => sum.add(i.amountBase), Decimal.zero());
    const planningOutstanding = D(d.principalBase).sub(paidScheduled);
    // Same rule as the Toman branch above: a schedule wins over the
    // principal/ledger fallback, so «مانده اقساط» and «مانده کل بدهی» agree.
    const outstandingUsd = hasSchedule
      ? rate.gt(0)
        ? scheduleRemainingToman.div(rate)
        : Decimal.zero()
      : bal
        ? D(bal.baseValue).neg()
        : planningOutstanding.isNegative()
          ? Decimal.zero()
          : planningOutstanding;
    const principalUsd = D(d.principalBase);
    const principalTomanDisp = rate.gt(0) ? principalUsd.mul(rate).toFixed(0) : null;
    const outstandingTomanDisp = hasSchedule
      ? scheduleRemainingToman.toFixed(0)
      : rate.gt(0)
        ? outstandingUsd.mul(rate).toFixed(0)
        : null;
    return {
      ...d,
      principalToman: principalTomanDisp,
      outstandingToman: outstandingTomanDisp,
      paidToman: paidToman.toFixed(0),
      outstandingBase: outstandingUsd.toString(),
      principalUsd: principalUsd.toString(),
      outstandingUsd: outstandingUsd.toString(),
      installments: own,
      paidCount: paid.length,
      totalCount: own.length,
      nextDue,
      direction,
      state: deriveObligationState({
        status: d.status,
        deletedAt: d.deletedAt,
        installments: own,
        nextDueDate: nextDue?.dueDate ?? null,
        outstandingToman: outstandingTomanDisp,
        todayIso: today,
      }),
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
      paidToman: installments.paidToman,
      status: installments.status,
      debtTitle: debts.title,
      creditor: debts.creditor,
      debtAccountId: debts.accountId,
      direction: debts.direction,
    })
    .from(installments)
    .innerJoin(debts, eq(debts.id, installments.debtId))
    // `<> 'paid'` rather than `= 'pending'`: a PARTIAL installment is still
    // owed, and leaving it out of «قسط بعدی» would hide the very row the user
    // is part-way through settling.
    .where(and(sql`${installments.status} <> 'paid'`, u ? sql`(${debts.userId} = ${u} or ${debts.userId} is null)` : sql`1=1`))
    .orderBy(asc(installments.dueDate))
    .limit(limit);

  // Attach a resolved Toman figure so callers never have to do USD×rate
  // themselves — and the amount STILL OWED, which on a partly-settled row is
  // the only figure a «قسط بعدی» tile may legitimately show.
  return rows.map((r) => {
    const amountToman =
      r.amountToman != null
        ? D(r.amountToman).toFixed(0)
        : rate.gt(0)
          ? D(r.amountBase).mul(rate).toFixed(0)
          : null;
    const dueToman =
      amountToman != null
        ? remainingToman({ status: r.status, amountToman, paidToman: r.paidToman }).toFixed(0)
        : null;
    const amountUsd =
      amountToman != null && rate.gt(0) ? D(amountToman).div(rate).toString() : D(r.amountBase).toString();
    return {
      ...r,
      amountToman,
      /** Toman still owed on this row (== amountToman unless partly settled). */
      dueToman,
      amountUsd,
      direction: resolveDirection(r.direction),
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
      direction: debts.direction,
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

  const mapped: InstallmentScheduleRow[] = rows.map((r) => {
    const view = buildInstallmentFxView(r, fx.rate);
    return {
      ...r,
      direction: resolveDirection(r.direction),
      fx: view,
      // What is still owed on this row. Equal to the contractual amount unless
      // the row is partly settled; zero once it is `paid`. Resolved here, in
      // the backend, for the same reason the FX view is: so no page re-derives
      // a money figure and no two pages can disagree.
      dueToman: remainingToman({
        status: r.status,
        amountToman: view.amountToman,
        paidToman: r.paidToman,
      }).toFixed(0),
      paidSoFarToman: r.paidToman != null && r.paidToman !== "" ? D(r.paidToman).toFixed(0) : "0",
    };
  });

  return {
    rate: fx.rate,
    rows: mapped,
    // The rate is passed along purely so the UI can LABEL its arithmetic (which
    // IRT-per-USD figure each side of the comparison was divided by); the money
    // figures themselves already come from the views and are never re-derived.
    pendingUsdInsight: summarizePendingUsdChange(
      mapped.map((r) => r.fx),
      fx.rate,
    ),
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
  /** payable «بدهی من» | receivable «طلب من» — decides «پرداخت» vs «دریافت». */
  direction: string;
  fx: InstallmentFxView;
  /** Toman still owed on this row (0 when settled). */
  dueToman: string;
  /** Toman already settled against it (non-zero on a `partial` row). */
  paidSoFarToman: string;
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
export async function payInstallment(
  installmentId: string,
  cashAccountId: string,
  userId?: string,
  /**
   * Toman to settle. Omitted → the whole remaining balance (the historical
   * behaviour, unchanged for every existing caller). A smaller figure records
   * a PARTIAL settlement: the row keeps its contractual amount, accumulates
   * `paid_toman`, and stays outstanding at status `partial`.
   */
  payToman?: string,
) {
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
    if (inst.status === "paid") return { id: inst.paidEntryId ?? "", alreadyPaid: true, contra: null as string | null };

    // 2b) DIRECTION — «بدهی من» (payable) or «طلب من» (receivable).
    //     This decides the SIGN of the cash leg below, not a caption. The
    //     mapping lives in exactly one place (`settlementSign`), so a UI can
    //     never produce a «دریافت» that drains the wallet.
    const receivable = isReceivable(debt.direction);
    const sign = settlementSign(debt.direction);

    // 3) Resolve the CONTRA LEG — and never refuse the settlement over it.
    //
    //    • debt WITH a ledger liability account → cash ↓ / liability ↓,
    //      entry type `installment` (the classical settlement).
    //    • PLANNING-ONLY debt (`account_id IS NULL`) — which is how EVERY debt
    //      created in «بدهی‌ها» is stored, because createDebtAction deliberately
    //      leaves the ledger untouched until a real movement happens — has no
    //      liability to reduce. The money nevertheless left the wallet, so the
    //      outflow is classified against the dedicated «پرداخت اقساط» bucket
    //      (5960) with entry type `debt_repayment`: never 5900 «هزینه متفرقه»,
    //      because a repayment is not groceries. The type is excluded from every
    //      expense / cash-flow aggregation (getCashflow, getFlowByAccount,
    //      getFlowByCategory and the reports KPI via getExpenseIncomeTotals), so
    //      an installment payment can never be mistaken for consumption — and
    //      since 2026-09-07 neither can a budget eat it (see listBudgets).
    //
    //    Quick Pay used to throw «حساب بدهی تعریف نشده است» here, which made the
    //    one-click button on every UI-created installment dead on arrival.
    //
    //    For a RECEIVABLE the mirror applies: with no ledger receivable
    //    account, the credit side lands on the dedicated income-typed bucket
    //    4960 «دریافت مطالبات». Both directions post entry type
    //    `debt_repayment`, which the aggregations already exclude on BOTH the
    //    expense and the income side — so a collection is never counted as
    //    earnings, exactly as a repayment is never counted as consumption.
    let contraAccountId: string | null = debt.accountId;
    let contraIsExpense = false;
    let contraBucketName: string | null = null;
    if (!contraAccountId) {
      const bucket = receivable
        ? await ensureReceivableCollectionAccount(u ?? null, tx)
        : await ensureInstallmentPaymentAccount(u ?? null, tx);
      contraAccountId = bucket?.id ?? null;
      contraBucketName = bucket?.name ?? null;
      contraIsExpense = true;
      if (!contraAccountId) {
        // A genuine accounting precondition, not a design dead-end: with no
        // counter row at all the entry would post unbalanced.
        throw new Error(
          receivable
            ? "سرفصل «دریافت مطالبات» در دفتر این کاربر ساخته نشد؛ در «تنظیمات ← حساب‌ها» یک حساب درآمد بسازید."
            : "سرفصل «پرداخت اقساط» در دفتر این کاربر ساخته نشد؛ در «تنظیمات ← حساب‌ها» یک حساب هزینه بسازید.",
        );
      }
    }

    const amount = D(inst.amountBase);
    // 3b) Capture the FX rate valid AT THIS MOMENT, from the project's existing
    //     per-user FX source of truth and INSIDE this transaction, so the
    //     payment snapshot below can never be rebuilt from a later rate.
    const paymentFx = await getLatestUsdIrtRateForUser(u ?? null, tx);
    const paymentRate = D(paymentFx.rate);
    // The obligation on this row: contractual Toman (Phase 3+) or, for a
    // legacy USD-only row, its book amount converted once at the payment rate.
    const contractualToman =
      inst.amountToman != null
        ? D(inst.amountToman)
        : paymentRate.gt(0)
          ? amount.mul(paymentRate)
          : null;
    if (!contractualToman) throw new Error("نرخ تبدیل دلار به تومان برای ثبت پرداخت این قسط موجود نیست.");

    // 3c) PARTIAL SETTLEMENT.
    //
    //     `paid_toman` is a RUNNING TOTAL, so the amount still owed is
    //     `contractual − paid_so_far` — computed by the shared
    //     `remainingToman`, the same helper every read path uses, so the card,
    //     the schedule and this write can never disagree about what is left.
    //
    //     Omitting `payToman` settles the whole remaining balance, which is
    //     byte-for-byte the previous behaviour for a `pending` row (paid so far
    //     = 0 → remaining = contractual). No existing caller changes meaning.
    //
    //     An over-payment is REFUSED by `applyPartialPayment`, not absorbed:
    //     it is either a typo or money that belongs to another installment, and
    //     silently booking it would push Σ(paid) past the contract with no
    //     record of where the excess went.
    const balanceRow = {
      status: inst.status,
      amountToman: contractualToman.toFixed(0),
      paidToman: inst.paidToman,
    };
    const outstanding = remainingToman(balanceRow);
    if (!outstanding.gt(0)) {
      // Defensive: a row with nothing left but a status that is not `paid`.
      // Settling it again would double-post.
      return { id: inst.paidEntryId ?? "", alreadyPaid: true, contra: null as string | null };
    }
    const settledToman = payToman != null && payToman !== "" ? D(payToman) : outstanding;
    const nextState = applyPartialPayment(balanceRow, settledToman.toFixed(0));
    // Throws (and rolls the whole payment back) rather than leaving a `paid`
    // row without a USD snapshot.
    //
    // QUICK PAY FIX: the ledger base value of this settlement is the USD
    // equivalent AT THE PAYMENT RATE (`settled_toman ÷ payment_fx_rate`),
    // computed by the SAME shared `calculateInstallmentPayment` the Payment
    // Form uses. It is never the creation-time `amount_base` /
    // `amount_usd_created` (the stale 3.24675-USD figure) — a later FX move
    // must not change the 909,090-Toman obligation, only its USD equivalent.
    const paymentSnapshot = calculateInstallmentPayment({
      amountToman: settledToman.toString(),
      fxRate: paymentFx.rate,
    });
    const paymentUsd = D(paymentSnapshot.paidUsd);

    // Reference reads run INSIDE the transaction (single-connection drivers
    // hold an exclusive lock during it) — keeps the read set consistent too.
    const cashUnits = await unitsFor(cashAccountId, paymentUsd.toString(), tx, u);
    const contraUnits = await unitsFor(contraAccountId, paymentUsd.toString(), tx, u);

    // 4) Post the ledger movement through the EXISTING single write path,
    //    inside this same transaction so it commits or rolls back atomically.
    //    `debt_repayment` (not `installment`) whenever the counter leg is an
    //    EXPENSE bucket — that type is what keeps a planning-only debt payment
    //    out of the expense / cash-flow reports; the liability branch keeps the
    //    historical `installment` type so existing entries stay comparable.
    //
    //    DIRECTION drives the SIGN of both legs. For «بدهی من» the cash leg is
    //    negative (money leaves) and the contra positive; for «طلب من» the two
    //    are mirrored (money arrives). The legs still sum to zero either way,
    //    so double entry is preserved by construction rather than by two
    //    hand-written branches that could drift apart.
    const cashLeg = paymentUsd.mul(String(sign));
    const partialNote = nextState.status === INSTALLMENT_PARTIAL ? " (پرداخت بخشی)" : "";
    const entry = await postEntry(
      {
        entryDate: todayIso(),
        type: contraIsExpense ? "debt_repayment" : "installment",
        description: receivable
          ? `دریافت قسط ${inst.seq} — ${debt.title}${partialNote}`
          : `پرداخت قسط ${inst.seq} — ${debt.title}${partialNote}`,
        userId: u,
        postings: [
          {
            accountId: cashAccountId,
            assetId: cashUnits.assetId,
            quantity: D(cashUnits.quantity).mul(String(sign)).toString(),
            baseValue: cashLeg.toString(),
          },
          {
            accountId: contraAccountId,
            assetId: contraUnits.assetId,
            quantity: D(contraUnits.quantity).mul(String(-sign)).toString(),
            baseValue: cashLeg.neg().toString(),
            memo: contraIsExpense
              ? receivable
                ? `طلبِ بدون حساب دریافتنی — ورود وجه در سرفصل «${contraBucketName ?? RECEIVABLE_COLLECTION_NAME}»؛ وصول مطالبات است، نه درآمد، و در گزارش درآمد شمرده نمی‌شود`
                : `بدهیِ بدون حساب بدهی — خروج وجه در سرفصل «${contraBucketName ?? INSTALLMENT_PAYMENT_NAME}»، نه «هزینه متفرقه»؛ خارج از گزارش هزینه‌ها و خارج از بودجه‌ها`
              : receivable
                ? "کاهش مانده مطالبات"
                : "کاهش مانده بدهی",
          },
        ],
      },
      tx,
    );

    // 5) Update installment status + payment metadata (same transaction).
    //
    //    `paid_toman` carries the RUNNING TOTAL from `applyPartialPayment`, so
    //    two 30M settlements of a 50M installment leave 60M... which is exactly
    //    what that helper refuses: the second is capped by the remaining 20M
    //    and the row lands on 50M / `paid`.
    //
    //    The FX snapshot freezes the rate of THIS settlement. For a fully
    //    settled row that is the historical truth, once and forever. A row
    //    still `partial` keeps the latest settlement's rate; the earlier
    //    settlements remain recorded, immutably, as their own journal entries —
    //    the ledger, not this column, is the record of them all.
    await tx
      .update(installments)
      .set({
        status: nextState.status,
        paidAt: todayIso(),
        paidEntryId: entry.id,
        paidToman: nextState.paidToman,
        paidFxRate: paymentSnapshot.paidFxRate,
        paidUsd: paymentSnapshot.paidUsd,
      })
      .where(eq(installments.id, installmentId));

    // 6) Settle the obligation once NOTHING is outstanding on it.
    //    `partial` counts as outstanding — that is the whole point of the
    //    status — so a part-paid schedule can never mark its parent settled
    //    («paid debt with unpaid installments», brief §17).
    const pending = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(installments)
      .where(and(eq(installments.debtId, debt.id), sql`${installments.status} <> 'paid'`));
    if ((pending[0]?.c ?? 0) === 0) {
      await tx.update(debts).set({ status: "settled" }).where(eq(debts.id, debt.id));
    }
    // `.id` keeps every existing caller working (the entry is what they read);
    // `.contra` says which side absorbed the outflow so the UI can be explicit
    // about a classification the user never chose themselves, and `.contraName`
    // names the bucket that actually received it (the chart row's own name —
    // a renamed account must never be described by a hardcoded string).
    return {
      ...entry,
      contra: (contraIsExpense ? "expense" : "liability") as "expense" | "liability",
      contraName: contraBucketName,
      /** Which way the money moved, so the UI can word the confirmation. */
      direction: receivable ? RECEIVABLE : PAYABLE,
      /** `partial` when a balance is still owed on this installment. */
      status: nextState.status,
      settledToman: nextState.paidToman,
      remainingToman: nextState.remainingToman,
    };
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
      // `<> 'paid'` rather than `= 'pending'`: a PARTIAL installment is still
      // due and must stay in the forecast — dropping it would under-forecast
      // the month by the part that has NOT been settled.
      //
      // The obligation's DIRECTION rides along, because a receivable
      // installment is money coming IN. Forecasting it as an outflow would
      // push the projected liquidity down by an amount the user is about to
      // receive — the sign error the direction field exists to prevent.
      .select({ inst: installments, direction: debts.direction })
      .from(installments)
      .innerJoin(debts, eq(debts.id, installments.debtId))
      .where(
        and(
          sql`${installments.status} <> 'paid'`,
          sql`${debts.deletedAt} is null`,
          u ? sql`(${debts.userId} = ${u} or ${debts.userId} is null)` : sql`1=1`,
        ),
      )
      .then((rows) => rows.map((r) => ({ ...r.inst, direction: r.direction }))),
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
    const contractual =
      i.amountToman != null
        ? D(i.amountToman)
        : rate.gt(0)
          ? D(i.amountBase).mul(rate)
          : Decimal.zero();
    // Only what is STILL owed is forecast: a part-settled installment moves
    // its remainder, not its contractual amount, on its due date.
    const toman = remainingToman({
      status: i.status,
      amountToman: contractual.toFixed(0),
      paidToman: i.paidToman,
    });
    if (!toman.gt(0)) continue;
    push(i.dueDate, toman, isReceivable(i.direction) ? "inflow" : "outflow");
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
