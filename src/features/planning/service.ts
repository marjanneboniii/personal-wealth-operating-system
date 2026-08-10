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
import { getAccountBalances, getNetWorth } from "@/features/ledger/queries";
import { addMonthsIso, todayIso } from "@/lib/format";

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

/* ---------------- Goals ---------------- */

export async function listGoals(userId?: string) {
  const u = await resolvePlanningUserId(userId);
  const balances = await getAccountBalances(userId);
  const rows = await db
    .select()
    .from(goals)
    .where(and(sql`${goals.deletedAt} is null`, u ? eq(goals.userId, u) : sql`1=1`))
    .orderBy(asc(goals.priority), asc(goals.targetDate));

  return rows.map((g) => {
    const bal = balances.find((b) => b.accountId === g.fundAccountId);
    const saved = bal ? D(bal.baseValue) : Decimal.zero();
    const target = D(g.targetBase);
    const progress = target.isZero() ? Decimal.zero() : saved.div(target).mul(100);
    return {
      ...g,
      savedBase: saved.toString(),
      remainingBase: target.sub(saved).toString(),
      progress: Math.max(0, Math.min(100, progress.toNumber())),
    };
  });
}

/* ---------------- Funds ---------------- */

export async function listFunds(userId?: string) {
  const u = await resolvePlanningUserId(userId);
  const balances = await getAccountBalances(userId);
  const rows = await db
    .select()
    .from(funds)
    .where(and(sql`${funds.deletedAt} is null`, u ? eq(funds.userId, u) : sql`1=1`));
  return rows.map((f) => {
    const bal = balances.find((b) => b.accountId === f.accountId);
    const saved = bal ? D(bal.baseValue) : Decimal.zero();
    const target = D(f.targetBase);
    return {
      ...f,
      savedBase: saved.toString(),
      progress: target.isZero() ? 0 : Math.min(100, saved.div(target).mul(100).toNumber()),
    };
  });
}

/* ---------------- Budgets ---------------- */

/** Budgets with actual spend derived from the ledger (never stored balances). */
export async function listBudgets(userId?: string) {
  const u = await resolvePlanningUserId(userId);
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
      let sumSpend = Decimal.zero();
      for (const pr of postingRows) {
        if (pr.account_id === b.accountId && pr.entry_date >= b.periodStart && pr.entry_date <= b.periodEnd) {
          sumSpend = sumSpend.add(D(pr.val));
        }
      }
      spendMap.set(b.id, sumSpend.toString());
    }
  }

  const result = [];
  for (const b of rows) {
    const spentInPeriod = spendMap.get(b.id) ?? "0";
    const limit = D(b.amountBase);
    const used = D(spentInPeriod);
    const remaining = limit.sub(used);
    result.push({
      ...b,
      spentBase: used.toString(),
      remainingBase: remaining.toString(),
      usage: limit.isZero() ? 0 : Math.max(0, used.div(limit).mul(100).toNumber()),
      over: remaining.isNegative(),
    });
  }
  return result;
}

/* ---------------- Debts & installments ---------------- */

export async function listDebts(userId?: string) {
  const u = await resolvePlanningUserId(userId);
  const balances = await getAccountBalances(userId);
  const rows = await db
    .select()
    .from(debts)
    .where(and(sql`${debts.deletedAt} is null`, u ? eq(debts.userId, u) : sql`1=1`));
  const inst = await db.select().from(installments).orderBy(asc(installments.dueDate));

  return rows.map((d) => {
    const bal = balances.find((b) => b.accountId === d.accountId);
    const outstanding = bal ? D(bal.baseValue).neg() : D(d.principalBase);
    const own = inst.filter((i) => i.debtId === d.id);
    const paid = own.filter((i) => i.status === "paid");
    return {
      ...d,
      outstandingBase: outstanding.toString(),
      installments: own,
      paidCount: paid.length,
      totalCount: own.length,
      nextDue: own.find((i) => i.status === "pending") ?? null,
    };
  });
}

export async function upcomingInstallments(limit = 8, userId?: string) {
  const u = await resolvePlanningUserId(userId);
  return db
    .select({
      id: installments.id,
      seq: installments.seq,
      dueDate: installments.dueDate,
      amountBase: installments.amountBase,
      status: installments.status,
      debtTitle: debts.title,
      creditor: debts.creditor,
      debtAccountId: debts.accountId,
    })
    .from(installments)
    .innerJoin(debts, eq(debts.id, installments.debtId))
    .where(and(eq(installments.status, "pending"), u ? eq(debts.userId, u) : sql`1=1`))
    .orderBy(asc(installments.dueDate))
    .limit(limit);
}

export async function payInstallment(installmentId: string, cashAccountId: string) {
  const row = await db
    .select({ inst: installments, debt: debts })
    .from(installments)
    .innerJoin(debts, eq(debts.id, installments.debtId))
    .where(eq(installments.id, installmentId))
    .limit(1);
  if (!row.length) throw new Error("قسط یافت نشد");
  const { inst, debt } = row[0];
  if (inst.status === "paid") return { id: inst.paidEntryId ?? "", alreadyPaid: true };
  if (!debt.accountId) throw new Error("حساب بدهی تعریف نشده است");

  const amount = D(inst.amountBase);
  const cashUnits = await unitsFor(cashAccountId, amount.toString());
  const debtUnits = await unitsFor(debt.accountId, amount.toString());

  const entry = await postEntry({
    entryDate: todayIso(),
    type: "installment",
    description: `پرداخت قسط ${inst.seq} — ${debt.title}`,
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
  });

  await db
    .update(installments)
    .set({ status: "paid", paidAt: todayIso(), paidEntryId: entry.id })
    .where(eq(installments.id, installmentId));

  const pending = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(installments)
    .where(and(eq(installments.debtId, debt.id), eq(installments.status, "pending")));
  if ((pending[0]?.c ?? 0) === 0) {
    await db.update(debts).set({ status: "settled" }).where(eq(debts.id, debt.id));
  }
  return entry;
}

/* ---------------- Planned transactions ---------------- */

export async function listPlanned(userId?: string) {
  const u = await resolvePlanningUserId(userId);
  return db
    .select()
    .from(plannedTransactions)
    .where(and(sql`${plannedTransactions.deletedAt} is null`, u ? eq(plannedTransactions.userId, u) : sql`1=1`))
    .orderBy(asc(plannedTransactions.plannedDate));
}

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
  const cashUnits = await unitsFor(cashId, amount.toString());
  const counterUnits = await unitsFor(counterId, amount.toString());

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

export type ProjectionPoint = {
  month: string;
  inflow: string;
  outflow: string;
  net: string;
  cumulative: string;
  deficit: boolean;
};

export async function projectCashflow(months = 12, scenario: "base" | "optimistic" | "pessimistic" = "base", userId?: string) {
  const u = await resolvePlanningUserId(userId);
  const [nw, planned, insts, obls, evs] = await Promise.all([
    getNetWorth(userId),
    listPlanned(userId),
    db
      .select({ inst: installments })
      .from(installments)
      .innerJoin(debts, eq(debts.id, installments.debtId))
      .where(and(eq(installments.status, "pending"), u ? eq(debts.userId, u) : sql`1=1`))
      .then((rows) => rows.map((r) => r.inst)),
    db
      .select()
      .from(obligations)
      .where(and(sql`${obligations.deletedAt} is null`, u ? eq(obligations.userId, u) : sql`1=1`)),
    db
      .select()
      .from(events)
      .where(and(sql`${events.deletedAt} is null`, u ? eq(events.userId, u) : sql`1=1`)),
  ]);

  const factorIn = scenario === "optimistic" ? 1.1 : scenario === "pessimistic" ? 0.9 : 1;
  const factorOut = scenario === "optimistic" ? 0.95 : scenario === "pessimistic" ? 1.15 : 1;

  const start = todayIso().slice(0, 8) + "01";
  const buckets = new Map<string, { inflow: Decimal; outflow: Decimal }>();
  for (let i = 0; i < months; i++) {
    buckets.set(addMonthsIso(start, i), { inflow: Decimal.zero(), outflow: Decimal.zero() });
  }
  const bucketKey = (iso: string) => iso.slice(0, 8) + "01";
  const push = (iso: string, amount: Decimal, dir: "inflow" | "outflow") => {
    const key = bucketKey(iso);
    const b = buckets.get(key);
    if (!b) return;
    if (dir === "inflow") b.inflow = b.inflow.add(amount.mul(String(factorIn)));
    else b.outflow = b.outflow.add(amount.mul(String(factorOut)));
  };

  for (const p of planned) {
    if (p.status !== "pending") continue;
    push(p.plannedDate, D(p.amountBase), p.direction === "inflow" ? "inflow" : "outflow");
  }
  for (const i of insts) push(i.dueDate, D(i.amountBase), "outflow");
  for (const o of obls) {
    if (o.status !== "pending") continue;
    if (o.recurrence === "monthly") {
      for (let k = 0; k < months; k++) push(addMonthsIso(bucketKey(o.dueDate), k), D(o.amountBase), "outflow");
    } else {
      push(o.dueDate, D(o.amountBase), "outflow");
    }
  }
  for (const e of evs) {
    if (e.status !== "planned") continue;
    push(e.eventDate, D(e.budgetBase), "outflow");
  }

  let cumulative = D(nw.liquid);
  const points: ProjectionPoint[] = [];
  for (const [month, b] of buckets) {
    const net = b.inflow.sub(b.outflow);
    cumulative = cumulative.add(net);
    points.push({
      month,
      inflow: b.inflow.toString(),
      outflow: b.outflow.toString(),
      net: net.toString(),
      cumulative: cumulative.toString(),
      deficit: cumulative.isNegative(),
    });
  }
  return { startingLiquidity: nw.liquid, netWorth: nw.netWorth, points, scenario };
}

export async function listEvents(userId?: string) {
  const u = await resolvePlanningUserId(userId);
  return db
    .select()
    .from(events)
    .where(and(sql`${events.deletedAt} is null`, u ? eq(events.userId, u) : sql`1=1`))
    .orderBy(asc(events.eventDate));
}

export async function listObligations(userId?: string) {
  const u = await resolvePlanningUserId(userId);
  return db
    .select()
    .from(obligations)
    .where(and(sql`${obligations.deletedAt} is null`, u ? eq(obligations.userId, u) : sql`1=1`))
    .orderBy(asc(obligations.dueDate));
}
