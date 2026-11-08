import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { D } from "@/domain/decimal";
import { countUnreviewed, getAccountBalances, getCashflow, getSnapshotSeries, getTransactions, type TxRow } from "@/features/ledger/queries";
import { getFlowByCategory, getMiscCategory, type CategoryFlowRow } from "@/features/categories/service";
import { getCurrentNetWorth } from "@/features/portfolio/service";
import { listBudgets, listDebts, listGoals, projectCashflow, upcomingInstallments } from "@/features/planning/service";
import { isReceivable } from "@/features/planning/obligations";
import { listRecurringPayments } from "@/features/recurring/service";
import { reconcileMismatches } from "@/features/reconcile/service";
import { JALALI_MONTHS, recentJalaliMonths, todayIso, toJalali } from "@/lib/format";
import {
  analyze,
  categoryTrends,
  findDuplicateCandidates,
  findSmallFrequent,
  forecastBudget,
  type BudgetForecast,
  type CategoryTrend,
  type Finding,
  type TxLite,
} from "./analysis";

/**
 * The assistant's view of one user's finances, built ONLY from the app's
 * existing read services — the same primitives every page uses — so the
 * assistant can never disagree with the rest of the app about a number.
 *
 * DATA MINIMISATION: this is what may be sent to Gemini. It carries totals,
 * names the user gave their own accounts/debts/budgets, and category names.
 * It never carries card/account/IBAN numbers, national ids, notes, addresses,
 * or transaction descriptions (those reach the model only through a tool
 * call that asks for specific transactions, truncated).
 *
 * Money is Toman (rounded). USD appears only where the app's own canonical
 * figure is USD (net-worth history), and is labelled so.
 */

export type MonthFlow = { label: string; start: string; incomeToman: number; expenseToman: number; netToman: number };

export type FinancialSnapshot = {
  asOf: string;
  asOfJalali: string;
  usdToToman: number;
  netWorth: {
    totalAssetsToman: number;
    accountingLiabilitiesToman: number;
    totalDebtToman: number;
    receivablesToman: number;
    netWorthToman: number;
    liquidToman: number;
    availableCashToman: number;
    /** Stablecoins + Toman on Iranian exchanges: one trade and one transfer from the bank. */
    convertibleToman: number;
    stablecoinToman: number;
    exchangeTomanToman: number;
    futureObligationsToman: number;
    byClass: { name: string; sharePct: number; valueToman: number }[];
    history: { label: string; asOf: string; netWorthUsd: number; changeUsd: number; changePct: number | null }[];
    currentNetWorthUsd: number;
  };
  accounts: { name: string; kind: string; currency: string; balance: number; balanceToman: number; lastActivity: string | null }[];
  topAssets: { name: string; className: string; valueToman: number; costToman: number; unrealizedPnlToman: number; priceAsOf: string | null; valuation: string }[];
  cashflow: {
    months: MonthFlow[];
    currentMonth: MonthFlow & { daysElapsed: number; daysInMonth: number };
    avgMonthlyIncomeToman: number;
    avgMonthlyExpenseToman: number;
    savingsRatePct: number | null;
  };
  categories: { currentMonth: { name: string; group: string; toman: number; entries: number }[]; trends: CategoryTrend[]; incomeCurrentMonth: { name: string; toman: number }[] };
  budgets: BudgetForecast[];
  debts: {
    title: string;
    creditor: string;
    outstandingToman: number;
    interestRatePct: number | null;
    paidCount: number;
    totalCount: number;
    nextDueDate: string | null;
    nextDueToman: number | null;
    overdueCount: number;
    state: string;
  }[];
  receivables: { title: string; outstandingToman: number; nextDueDate: string | null }[];
  obligations: {
    next30Toman: number;
    overdue: { count: number; toman: number };
    upcoming: { date: string; title: string; toman: number; kind: "installment" | "premium" | "subscription" }[];
    monthly: { label: string; totalToman: number; installment: number; premium: number; subscription: number }[];
  };
  projection: { month: string; inflowToman: number; outflowToman: number; netToman: number; cumulativeToman: number; deficit: boolean }[];
  goals: { name: string; targetToman: number; savedToman: number; progressPct: number; targetDate: string | null; status: string }[];
  recurring: { label: string; monthlyToman: number; category: string | null; nextExpected: string }[];
  dataQuality: { unreviewedImports: number; reconcileMismatches: number; uncategorizedSharePct: number | null; transactionsLast30: number };
  findings: Finding[];
};

const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? Math.round(x) : 0;
};

function jalaliLabel(iso: string) {
  const { y, m } = toJalali(iso);
  return `${JALALI_MONTHS[m - 1]} ${y}`;
}

/** Toman of a transaction: the frozen commit-time figure when there is one, else its expense/income legs at today's rate. */
export function txToman(row: Pick<TxRow, "fxIrtAmount" | "lines" | "type">, rate: number): number {
  if (row.fxIrtAmount != null && row.fxIrtAmount !== "") return Math.abs(n(row.fxIrtAmount));
  const legType = row.type === "income" ? "income" : "expense";
  const usd = row.lines.filter((l) => l.accountType === legType).reduce((s, l) => s + Math.abs(Number(l.baseValue) || 0), 0);
  if (usd > 0) return Math.round(usd * rate);
  const anyLeg = row.lines.reduce((s, l) => Math.max(s, Math.abs(Number(l.baseValue) || 0)), 0);
  return Math.round(anyLeg * rate);
}

const categoryToman = (r: CategoryFlowRow, rate: number) =>
  r.entries > 0 && r.entriesWithSnap === r.entries ? n(r.totalToman) : Math.round(Number(r.total) * rate);

function addDays(iso: string, days: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const cache = new Map<string, { at: number; snap: FinancialSnapshot }>();
const TTL_MS = 30_000;

/** Drop the cached snapshot (after the user changes data through the assistant). */
export function invalidateSnapshot(userId: string) {
  cache.delete(userId);
}

export async function buildFinancialSnapshot(userId: string, opts: { fresh?: boolean } = {}): Promise<FinancialSnapshot> {
  const hit = cache.get(userId);
  if (!opts.fresh && hit && Date.now() - hit.at < TTL_MS) return hit.snap;
  const snap = await build(userId);
  cache.set(userId, { at: Date.now(), snap });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return snap;
}

async function build(userId: string): Promise<FinancialSnapshot> {
  const today = todayIso();
  const months = recentJalaliMonths(6, today);
  const current = months[months.length - 1];
  const prev3Start = months[Math.max(0, months.length - 4)].start;
  const tomorrow = addDays(today, 1);

  const safe = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);

  const [nw, balances, flow, catCurrent, catPrev, incomeCurrent, budgets, debts, upcoming, projection, goals, recurring, series, unreviewed, mismatches, recentTx, misc, lastActivity] =
    await Promise.all([
      getCurrentNetWorth(userId),
      getAccountBalances(userId),
      getCashflow(6, userId),
      getFlowByCategory(1, userId, "expense", { from: current.start, to: tomorrow }),
      getFlowByCategory(3, userId, "expense", { from: prev3Start, to: current.start }),
      getFlowByCategory(1, userId, "income", { from: current.start, to: tomorrow }),
      listBudgets(userId),
      listDebts(userId),
      upcomingInstallments(60, userId),
      projectCashflow(6, "base", userId),
      listGoals(userId),
      safe(listRecurringPayments(userId, today), null),
      getSnapshotSeries(400, userId),
      countUnreviewed(userId),
      safe(reconcileMismatches(userId), []),
      getTransactions({ userId, from: addDays(today, -30), type: "expense", limit: 500 }),
      safe(getMiscCategory(), null),
      safe(
        db.execute(sql`
          select p.account_id::text as "accountId", max(je.entry_date)::text as "last"
          from postings p join journal_entries je on je.id = p.entry_id
          where je.user_id = ${userId} and je.status = 'posted'
          group by p.account_id`),
        { rows: [] } as unknown as Awaited<ReturnType<typeof db.execute>>,
      ),
    ]);

  const rate = Number(nw.valuation?.currentFxRate ?? 0) || 0;
  const lastByAccount = new Map((lastActivity.rows as { accountId: string; last: string }[]).map((r) => [r.accountId, r.last]));

  /* ── accounts: where the money is ── */
  const accounts = balances
    .filter((b) => b.type === "asset" && b.isActive !== false && !D(b.quantity).isZero())
    .filter((b) => ["cash", "stable"].includes(b.classCode ?? "") || ["bank", "cash", "exchange", "fund"].includes(b.walletKind ?? "") || ["IRT", "IRR", "USD"].includes(b.symbol ?? ""))
    .map((b) => {
      const qty = Number(b.quantity);
      const balanceToman =
        b.symbol === "IRT" ? qty : b.symbol === "IRR" ? qty / 10 : b.symbol === "USD" ? qty * rate : Number(b.baseValue) * rate;
      return {
        name: b.name,
        kind: b.walletKind ?? b.className ?? "—",
        currency: b.symbol ?? "—",
        balance: Math.round(qty * 100) / 100,
        balanceToman: Math.round(balanceToman),
        lastActivity: lastByAccount.get(b.accountId) ?? null,
      };
    })
    .sort((a, b) => b.balanceToman - a.balanceToman)
    .slice(0, 30);

  const assets = (nw.valuation?.assetValuations ?? []) as Array<Record<string, any>>;
  /* ── convertible liquidity: not in the bank, but a trade + transfer away ── */
  const stablecoinToman = Math.round(
    assets.filter((a) => ["استیبل‌کوین", "Stablecoin"].includes(String(a.className))).reduce((sum, a) => sum + (Number(a.currentValueToman) || 0), 0),
  );
  const exchangeTomanToman = Math.round(
    balances
      .filter((b) => b.type === "asset" && b.isActive !== false && b.walletKind === "exchange" && (b.symbol === "IRT" || b.symbol === "IRR"))
      .reduce((sum, b) => sum + Math.max(0, b.symbol === "IRR" ? Number(b.quantity) / 10 : Number(b.quantity)), 0),
  );
  const topAssets = [...assets]
    .filter((a) => Number(a.currentValueToman) > 0)
    .sort((a, b) => Number(b.currentValueToman) - Number(a.currentValueToman))
    .slice(0, 15)
    .map((a) => ({
      name: String(a.name),
      className: String(a.className),
      valueToman: n(a.currentValueToman),
      costToman: n(a.costBasisToman),
      unrealizedPnlToman: n(a.unrealizedPnlToman),
      priceAsOf: a.priceObservedAt ?? null,
      valuation: String(a.valuationBasis ?? ""),
    }));

  /* ── cash flow by Jalali month ── */
  const flowByStart = new Map(flow.map((f) => [f.month, f]));
  const monthFlows: MonthFlow[] = months.map((m) => {
    const f = flowByStart.get(m.start);
    const inc = f ? (f.inflowEntries > 0 && f.inflowEntries === f.inflowEntriesSnap ? n(f.inflowToman) : Math.round(Number(f.inflow) * rate)) : 0;
    const exp = f ? (f.outflowEntries > 0 && f.outflowEntries === f.outflowEntriesSnap ? n(f.outflowToman) : Math.round(Number(f.outflow) * rate)) : 0;
    return { label: jalaliLabel(m.start), start: m.start, incomeToman: inc, expenseToman: exp, netToman: inc - exp };
  });
  const dayMs = 86_400_000;
  const daysInMonth = Math.round((Date.parse(current.end) - Date.parse(current.start)) / dayMs);
  const daysElapsed = Math.min(daysInMonth, Math.round((Date.parse(today) - Date.parse(current.start)) / dayMs) + 1);
  const complete = monthFlows.slice(0, -1).filter((m) => m.incomeToman > 0 || m.expenseToman > 0);
  const avgIncome = complete.length ? Math.round(complete.reduce((s, m) => s + m.incomeToman, 0) / complete.length) : 0;
  const avgExpense = complete.length ? Math.round(complete.reduce((s, m) => s + m.expenseToman, 0) / complete.length) : 0;
  const totIn = complete.reduce((s, m) => s + m.incomeToman, 0);
  const totOut = complete.reduce((s, m) => s + m.expenseToman, 0);

  /* ── categories ── */
  const curCats = catCurrent.map((r) => ({ name: r.name, group: r.parentName ?? r.name, toman: categoryToman(r, rate), entries: r.entries, id: r.categoryId }));
  const prevMonthsCount = Math.max(1, Math.min(3, months.length - 1));
  const trends = categoryTrends(
    curCats.map((c) => ({ name: c.group, toman: c.toman })),
    catPrev.map((r) => ({ name: r.parentName ?? r.name, toman: categoryToman(r, rate) })),
    prevMonthsCount,
    daysElapsed / Math.max(1, daysInMonth),
  );
  const curTotal = curCats.reduce((s, c) => s + c.toman, 0);
  const miscToman = misc ? curCats.filter((c) => c.id === misc.id).reduce((s, c) => s + c.toman, 0) : 0;

  /* ── budgets active today ── */
  const budgetForecasts = (budgets as Array<Record<string, any>>)
    .filter((b) => b.periodStart <= today && b.periodEnd >= today)
    .map((b) => forecastBudget({ name: b.name, limitToman: n(b.amountToman), spentToman: n(b.spentToman), periodStart: b.periodStart, periodEnd: b.periodEnd }, today));

  /* ── debts / receivables ── */
  const payables = (debts as Array<Record<string, any>>).filter((d) => !isReceivable(d.direction) && d.status !== "cancelled" && d.status !== "settled");
  const debtRows = payables
    .map((d) => {
      const own = (d.installments ?? []) as Array<Record<string, any>>;
      const overdueCount = own.filter((i) => i.status !== "paid" && i.dueDate < today).length;
      const rateNum = Number(d.interestRate);
      return {
        title: String(d.title),
        creditor: String(d.creditor ?? ""),
        outstandingToman: n(d.outstandingToman),
        interestRatePct: Number.isFinite(rateNum) && rateNum > 0 ? rateNum : null,
        paidCount: Number(d.paidCount ?? 0),
        totalCount: Number(d.totalCount ?? 0),
        nextDueDate: d.nextDue?.dueDate ?? null,
        nextDueToman: d.nextDue ? n(d.nextDue.amountToman ?? 0) || null : null,
        overdueCount,
        state: String(d.state ?? d.status ?? ""),
      };
    })
    .filter((d) => d.outstandingToman > 0 || d.overdueCount > 0)
    .sort((a, b) => b.outstandingToman - a.outstandingToman);
  const receivables = (debts as Array<Record<string, any>>)
    .filter((d) => isReceivable(d.direction) && d.status !== "cancelled" && d.status !== "settled" && n(d.outstandingToman) > 0)
    .map((d) => ({ title: String(d.title), outstandingToman: n(d.outstandingToman), nextDueDate: d.nextDue?.dueDate ?? null }));

  /* ── obligations: the money already promised ── */
  const horizon = addDays(today, 30);
  const upcomingRows: FinancialSnapshot["obligations"]["upcoming"] = [];
  let overdueCount = 0;
  let overdueToman = 0;
  for (const i of upcoming) {
    if (i.direction !== "payable") continue;
    const toman = n(i.dueToman ?? i.amountToman);
    if (i.dueDate < today) {
      overdueCount++;
      overdueToman += toman;
    }
    if (i.dueDate <= addDays(today, 60)) upcomingRows.push({ date: i.dueDate, title: i.debtTitle, toman, kind: "installment" });
  }
  for (const p of recurring?.premiums ?? []) {
    if (p.nextDate && p.nextDate >= today && p.nextDate <= addDays(today, 60)) upcomingRows.push({ date: p.nextDate, title: p.title, toman: n(p.perPaymentToman), kind: "premium" });
  }
  for (const s of recurring?.detected ?? []) {
    if (s.nextExpected >= today && s.nextExpected <= addDays(today, 60)) upcomingRows.push({ date: s.nextExpected, title: s.label, toman: n(s.monthlyToman), kind: "subscription" });
  }
  upcomingRows.sort((a, b) => a.date.localeCompare(b.date));
  const next30Toman = overdueToman + upcomingRows.filter((r) => r.date >= today && r.date <= horizon).reduce((s, r) => s + r.toman, 0);

  /* ── projection ── */
  const projectionRows = (projection.points ?? []).map((p) => ({
    month: jalaliLabel(p.month),
    inflowToman: n(p.inflow),
    outflowToman: n(p.outflow),
    netToman: n(p.net),
    cumulativeToman: n(p.cumulative),
    deficit: Boolean(p.deficit),
  }));
  const deficit = projectionRows.find((p) => p.deficit) ?? null;

  /* ── net-worth history (USD is the canonical snapshot currency) ── */
  const currentUsd = Number(nw.netWorth) || 0;
  const history = [
    { label: "هفته‌ی گذشته", days: 7 },
    { label: "ماه گذشته", days: 30 },
    { label: "سه ماه گذشته", days: 90 },
    { label: "سال گذشته", days: 365 },
  ].flatMap(({ label, days }) => {
    const target = addDays(today, -days);
    const s = series.find((r) => r.asOf <= target);
    if (!s) return [];
    const past = Number(s.netWorth) || 0;
    return [{ label, asOf: s.asOf, netWorthUsd: Math.round(past), changeUsd: Math.round(currentUsd - past), changePct: past !== 0 ? ((currentUsd - past) / Math.abs(past)) * 100 : null }];
  });

  /* ── transactions of the last 30 days (for pattern checks only; not sent wholesale) ── */
  const txLite: TxLite[] = recentTx.map((t) => ({
    id: t.id,
    date: t.entryDate,
    description: t.description ?? "",
    amountToman: txToman(t, rate),
    category: t.categoryName ?? null,
  }));

  const totalAssetsToman = n(nw.totalAssetsToman);
  const byClass = (nw.byClass ?? []).map((c: { className: string; share: string }) => ({
    name: c.className,
    sharePct: Math.round(Number(c.share) * 10) / 10,
    valueToman: Math.round((Number(c.share) / 100) * totalAssetsToman),
  }));

  const snapshot: Omit<FinancialSnapshot, "findings"> = {
    asOf: today,
    asOfJalali: (() => {
      const { y, m, d } = toJalali(today);
      return `${d} ${JALALI_MONTHS[m - 1]} ${y}`;
    })(),
    usdToToman: Math.round(rate),
    netWorth: {
      totalAssetsToman,
      accountingLiabilitiesToman: n(nw.totalLiabilitiesToman),
      totalDebtToman: n(nw.totalDebtToman),
      receivablesToman: n(nw.totalReceivableToman),
      netWorthToman: n(nw.netWorthToman),
      liquidToman: n(nw.liquidToman),
      availableCashToman: n(nw.availableCashToman),
      convertibleToman: stablecoinToman + exchangeTomanToman,
      stablecoinToman,
      exchangeTomanToman,
      futureObligationsToman: n(nw.futureObligationsToman),
      byClass,
      history,
      currentNetWorthUsd: Math.round(currentUsd),
    },
    accounts,
    topAssets,
    cashflow: {
      months: monthFlows,
      currentMonth: { ...monthFlows[monthFlows.length - 1], daysElapsed, daysInMonth },
      avgMonthlyIncomeToman: avgIncome,
      avgMonthlyExpenseToman: avgExpense,
      savingsRatePct: totIn > 0 ? Math.round(((totIn - totOut) / totIn) * 1000) / 10 : null,
    },
    categories: {
      currentMonth: curCats.map(({ id: _id, ...c }) => c),
      trends: trends.slice(0, 15),
      incomeCurrentMonth: incomeCurrent.map((r) => ({ name: r.name, toman: categoryToman(r, rate) })),
    },
    budgets: budgetForecasts,
    debts: debtRows,
    receivables,
    obligations: {
      next30Toman,
      overdue: { count: overdueCount, toman: overdueToman },
      upcoming: upcomingRows.slice(0, 25),
      monthly: (recurring?.months ?? []).slice(0, 6).map((m) => ({
        label: m.label,
        totalToman: n(m.totalToman),
        installment: n(m.parts.installment),
        premium: n(m.parts.premium),
        subscription: n(m.parts.subscription),
      })),
    },
    projection: projectionRows,
    goals: (goals as Array<Record<string, any>>).map((g) => ({
      name: String(g.name),
      targetToman: n(g.targetToman),
      savedToman: n(g.savedToman),
      progressPct: Math.round(Number(g.progress ?? 0)),
      targetDate: g.targetDate ?? null,
      status: String(g.status ?? "active"),
    })),
    recurring: (recurring?.detected ?? []).slice(0, 15).map((r) => ({ label: r.label, monthlyToman: n(r.monthlyToman), category: r.category, nextExpected: r.nextExpected })),
    dataQuality: {
      unreviewedImports: unreviewed,
      reconcileMismatches: mismatches.length,
      uncategorizedSharePct: curTotal > 0 ? Math.round((miscToman / curTotal) * 1000) / 10 : null,
      transactionsLast30: recentTx.length,
    },
  };

  const topClass = byClass[0] ? { name: byClass[0].name, pct: byClass[0].sharePct } : null;
  const findings = analyze({
    today,
    availableCashToman: snapshot.netWorth.availableCashToman,
    convertibleToman: snapshot.netWorth.convertibleToman,
    liquidToman: snapshot.netWorth.liquidToman,
    avgMonthlyExpenseToman: avgExpense,
    avgMonthlyIncomeToman: avgIncome,
    months: monthFlows,
    monthProgress: daysElapsed / Math.max(1, daysInMonth),
    budgets: budgetForecasts,
    categoryTrends: trends,
    obligationsNext30Toman: next30Toman,
    overdueInstallments: { count: overdueCount, toman: overdueToman },
    debts: debtRows,
    projectionDeficit: deficit ? { month: deficit.month, cumulativeToman: deficit.cumulativeToman } : null,
    duplicates: findDuplicateCandidates(txLite),
    smallFrequent: findSmallFrequent(txLite, avgExpense || monthFlows.at(-1)!.expenseToman),
    miscShare: snapshot.dataQuality.uncategorizedSharePct,
    unreviewed,
    reconcileMismatches: mismatches.length,
    topClassShare: topClass,
  });

  return { ...snapshot, findings };
}

/** Stable fingerprint of the data an analysis was made from — the cache key for stored AI analyses. */
export function snapshotHash(s: FinancialSnapshot): string {
  return crypto.createHash("sha256").update(JSON.stringify(s)).digest("hex").slice(0, 32);
}
