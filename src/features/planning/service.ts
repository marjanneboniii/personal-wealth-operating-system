import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
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
import { getAccountBalances, getNetWorth } from "@/features/ledger/queries";
import { addMonthsIso, todayIso } from "@/lib/format";

/* ---------------- Goals ---------------- */

export async function listGoals() {
  const balances = await getAccountBalances();
  const rows = await db
    .select()
    .from(goals)
    .where(sql`${goals.deletedAt} is null`)
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

export async function listFunds() {
  const balances = await getAccountBalances();
  const rows = await db.select().from(funds).where(sql`${funds.deletedAt} is null`);
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

/* ---------------- Debts & installments ---------------- */

export async function listDebts() {
  const balances = await getAccountBalances();
  const rows = await db.select().from(debts).where(sql`${debts.deletedAt} is null`);
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

export async function upcomingInstallments(limit = 8) {
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
    .where(eq(installments.status, "pending"))
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

export async function listPlanned() {
  return db
    .select()
    .from(plannedTransactions)
    .where(sql`${plannedTransactions.deletedAt} is null`)
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
    });
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

export async function projectCashflow(months = 12, scenario: "base" | "optimistic" | "pessimistic" = "base") {
  const [nw, planned, insts, obls, evs] = await Promise.all([
    getNetWorth(),
    listPlanned(),
    db.select().from(installments).where(eq(installments.status, "pending")),
    db.select().from(obligations).where(sql`${obligations.deletedAt} is null`),
    db.select().from(events).where(sql`${events.deletedAt} is null`),
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

export async function listEvents() {
  return db.select().from(events).where(sql`${events.deletedAt} is null`).orderBy(asc(events.eventDate));
}

export async function listObligations() {
  return db
    .select()
    .from(obligations)
    .where(sql`${obligations.deletedAt} is null`)
    .orderBy(asc(obligations.dueDate));
}
