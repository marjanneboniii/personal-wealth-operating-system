import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import {
  getCashflow,
  getExpenseIncomeTotals,
  getRealizedPnl,
} from "@/features/ledger/queries";
import { listDebts, projectCashflow } from "@/features/planning/service";
import { Metric, PageHeader, Progress, Section, SectionLink } from "@/components/ui/Card";
import { BarsChart } from "@/components/charts/Charts";
import RowAction from "@/components/RowAction";
import PdfButton from "@/components/reports/PdfButton";
import { D, Decimal } from "@/domain/decimal";
import { currencyLabel, faCount, formatJalaliIso, formatMoney, formatPct, formatPercent, formatSignedMoney, formatSignedMoneyFromUsd, inflowTone, jalaliMonthKey, jalaliMonthLabel, outflowTone, toIrtMoney, trendTone } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
import { getCurrentNetWorth } from "@/features/portfolio/service";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await ensureAuth();
  await seedIfEmpty();
  const [nw, flow, pnl, totals, debts, projection, fx] = await Promise.all([
    getCurrentNetWorth(),
    getCashflow(12),
    getRealizedPnl(),
    getExpenseIncomeTotals(),
    listDebts(),
    projectCashflow(12),
    getLatestUsdIrtRate(),
  ]);

  const rate = fx.rate;
  const toIrt = (usd: string | number) => toIrtMoney(usd, rate);

  /* EXPENSE / INCOME KPIs — from ENTRIES, not from account balances (audit
     F-1, 2026-09-07). A repayment of a debt that has no ledger liability
     account is booked onto the expense-typed «پرداخت اقساط» bucket, so summing
     expense balances turned every installment paid into household consumption
     and deflated «نرخ پس‌انداز». `getExpenseIncomeTotals` applies the same
     `debt_repayment` exclusion the cash-flow page already uses, so the two
     reports finally share ONE definition of "expense"; what it excludes is
     disclosed under «بدهی و بازپرداخت» instead of disappearing. */
  const totalIncome = D(totals.income);
  const totalExpense = D(totals.expense);
  /* WHAT THE EXCLUSION WAS WORTH, disclosed under «بدهی و بازپرداخت» so a
     filtered-out number never just vanishes. Prefer the CONTRACTUAL Toman
     frozen at payment time (`installments.paid_toman`, read by
     getExpenseIncomeTotals) — it cannot drift with the dollar. When the excluded
     entries are not all backed by such a row (e.g. a hand-written repayment),
     the ledger's own USD base value is shown INSTEAD, unconverted: multiplying
     it by today's rate would invent a Toman figure that no one ever agreed to. */
  const repaymentsExcluded = totals.repaymentEntries > 0 && !D(totals.repayments).isZero();
  const repaymentsFullyFrozen =
    totals.repaymentsTomanEntries > 0 && totals.repaymentsTomanEntries === totals.repaymentEntries;
  const repaymentsTomanValue = repaymentsFullyFrozen ? totals.repaymentsToman : null;
  // SSOT: portfolio valuation already excludes orphaned/deleted RWA assets
  // and never treats a missing price as zero (which would fake a full write-off).
  const unrealized = D(nw.valuation.totalUnrealizedPnl);
  const unrealizedToman = nw.valuation.totalUnrealizedPnlToman;
  const savingsRate = totalIncome.isZero() ? "0" : totalIncome.sub(totalExpense).div(totalIncome).mul(100).toFixed(1);

  // Expense Toman is authoritative from the immutable entry FX snapshot.
  // Never convert the historical USD book total with today's rate: doing so
  // changes a recorded expense when the dollar rate rises. The frozen sum is
  // valid only when EVERY outflow entry of the window carries its commit-time
  // snapshot (full coverage); a partial cover would understate the total, so
  // legacy rows without a snapshot retain the dynamic current-rate fallback.
  const outflowCovered = flow.length > 0 && flow.every((f) => f.outflowEntries === f.outflowEntriesSnap);
  const frozenExpenseToman = outflowCovered
    ? Decimal.sum(flow.map((f) => f.outflowToman ?? "0"))
    : null;
  const expenseToman = frozenExpenseToman
    ? frozenExpenseToman.toString()
    : rate
      ? D(totalExpense).mul(rate).toString()
      : totalExpense.toString();

  const monthly = flow.map((f) => ({
    month: f.month,
    jalaliLabel: jalaliMonthLabel(jalaliMonthKey(f.month)),
    inflow: f.inflow,
    outflow: f.outflow,
    inflowToman: f.inflowToman,
    outflowToman: f.outflowToman,
    // Frozen Toman for the month is valid only under full snapshot coverage —
    // a dollar rate change can never move a fully covered month.
    inflowFrozen: f.inflowEntries === f.inflowEntriesSnap,
    outflowFrozen: f.outflowEntries === f.outflowEntriesSnap,
    net: D(f.inflow).sub(f.outflow).toString(),
  }));

  return (
    <div className="space-y-9">
      <PageHeader
        title="گزارش‌های مالی"
        action={
          <>
            <RowAction kind="snapshot" label="ثبت اسنپ‌شات" />
            <PdfButton />
          </>
        }
      />

      {/* KPI strip */}
      <section className="grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-4" style={{ borderColor: "var(--border)" }}>
        <Metric label="ارزش خالص" value={formatMoney(nw.netWorthToman, "IRT")} hint={formatMoney(nw.netWorth)} />
        <Metric label="کل درآمد ثبت‌شده" value={toIrt(totalIncome.toString()) ?? formatMoney(totalIncome.toString())} tone={inflowTone(totalIncome.toString())} hint={rate ? formatMoney(totalIncome.toString()) : undefined} />
        <Metric label="کل هزینه ثبت‌شده" value={rate ? formatMoney(expenseToman, "IRT") : formatMoney(totalExpense.toString())} tone={outflowTone(totalExpense.toString())} hint={rate ? formatMoney(totalExpense.toString()) : undefined} />
        <Metric label="نرخ پس‌انداز" value={`${formatPct(savingsRate, 1)}`} tone={trendTone(savingsRate)} />
      </section>

      {/* Monthly report — printable */}
      <Section title="گزارش ماهانه">
        <div id="monthly-report">
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="دارایی" value={formatMoney(nw.totalAssetsToman, "IRT")} hint={formatMoney(nw.totalAssets)} />
            <Metric label="بدهی" value={formatMoney(nw.totalLiabilitiesToman, "IRT")} hint={formatMoney(nw.totalLiabilities)} />
            <Metric label="نقدشونده" value={formatMoney(nw.liquidToman, "IRT")} hint={formatMoney(nw.liquid)} />
            <Metric label="میانگین هزینه ماهانه" value={rate ? formatMoney(monthly.length ? D(expenseToman).div(monthly.length).toString() : "0", "IRT") : formatMoney(monthly.length ? D(totalExpense.toString()).div(monthly.length).toString() : "0")} hint={rate ? formatMoney(monthly.length ? D(totalExpense.toString()).div(monthly.length).toString() : "0") : undefined} />
          </div>
          <div className="card mb-4 p-4 sm:p-5">
            <BarsChart
              height={140}
              data={monthly.map((m) => ({
                label: m.jalaliLabel,
                positive: Number(m.inflow),
                negative: Number(m.outflow),
              }))}
            />
          </div>
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">ماه</th>
                  <th scope="col" className="td-num">درآمد</th>
                  <th scope="col" className="td-num">هزینه</th>
                  <th scope="col" className="td-num">خالص</th>
                  <th scope="col" className="td-num hidden sm:table-cell">نسبت به ماه قبل</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((m, idx) => {
                  const prev = idx > 0 ? monthly[idx - 1] : null;
                  const diff = prev && D(prev.outflow).gt(0) ? D(m.outflow).sub(prev.outflow).div(prev.outflow).mul(100) : null;
                  return (
                    <tr key={m.month}>
                      <td className="font-medium">{m.jalaliLabel}</td>
                      <td className="td-num" dir="rtl" style={{ color: "var(--positive)" }}>
                        <div>
                          {m.inflowFrozen && m.inflowToman != null && D(m.inflowToman).gt(0)
                            ? formatMoney(m.inflowToman, "IRT")
                            : toIrt(m.inflow) ?? formatMoney(m.inflow)}
                        </div>
                        {rate && <div className="muted num text-[length:var(--fs-xs)]">≈ {formatMoney(m.inflow)}</div>}
                      </td>
                      <td className="td-num" dir="rtl" style={{ color: "var(--negative)" }}>
                        <div>
                          {m.outflowFrozen && m.outflowToman != null && D(m.outflowToman).gt(0)
                            ? formatMoney(m.outflowToman, "IRT")
                            : rate
                              ? formatMoney(D(m.outflow).mul(rate).toString(), "IRT")
                              : formatMoney(m.outflow)}
                        </div>
                        {rate && <div className="muted num text-[length:var(--fs-xs)]">≈ {formatMoney(m.outflow)}</div>}
                      </td>
                      <td className="td-num font-bold" dir="rtl" style={{ color: D(m.net).gte(0) ? "var(--positive)" : "var(--negative)" }}>
                        <div>
                          {m.inflowFrozen && m.outflowFrozen
                            ? formatSignedMoney(D(m.inflowToman ?? "0").sub(D(m.outflowToman ?? "0")).toString(), "IRT")
                            : formatSignedMoneyFromUsd(m.net, rate)}
                        </div>
                        {rate && <div className="muted num text-[length:var(--fs-xs)]">≈ {formatMoney(D(m.net).abs().toString())}</div>}
                      </td>
                      <td className="td-num hidden sm:table-cell num" dir="rtl" style={{ color: diff && diff.gt(0) ? "var(--negative)" : "var(--positive)" }}>
                        {diff ? formatPercent(diff.toString()) : "—"}
                      </td>
                    </tr>
                  );
                })}
                {!monthly.length && (
                  <tr>
                    <td colSpan={5} className="muted py-8 text-center">
                      داده‌ای در ۱۲ ماه اخیر نیست.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        {/* Investment P&L */}
        <Section title="سود و زیان سرمایه‌گذاری">
          <div className="grid grid-cols-2 gap-6 border-b pb-5" style={{ borderColor: "var(--border)" }}>
            <Metric
              label="تحقق‌یافته"
              value={formatSignedMoneyFromUsd(pnl.total, rate)}
              tone={trendTone(pnl.total)}
              hint={rate ? formatSignedMoney(pnl.total, "USD") : undefined}
            />
            <Metric
              label="تحقق‌نیافته"
              value={unrealizedToman ? formatSignedMoney(unrealizedToman, "IRT") : formatSignedMoneyFromUsd(unrealized.toString(), rate)}
              tone={trendTone(unrealized.toString())}
              hint={rate ? formatSignedMoney(unrealized.toString(), "USD") : undefined}
            />
          </div>
          <ul className="mt-3 divide-y" style={{ borderColor: "var(--border)" }}>
            {pnl.bySymbol.map((s) => (
              <li key={s.symbol} className="flex items-center justify-between py-2 text-[length:var(--fs-xs)]">
                <span className="font-bold" dir="rtl">
                  {currencyLabel(s.symbol)}
                </span>
                <span className="num" dir="rtl" style={{ color: D(s.pnl).gte(0) ? "var(--positive)" : "var(--negative)" }}>
                  {formatSignedMoney(s.pnl, s.symbol)}
                </span>
              </li>
            ))}
            {!pnl.bySymbol.length && <li className="muted py-4 text-center text-xs">فروشی ثبت نشده است</li>}
          </ul>
          <div className="mt-2">
            <SectionLink href="/portfolio" label="جزئیات سبد" />
          </div>
        </Section>

        {/* Debt report */}
        <Section title="بدهی و بازپرداخت" action={<SectionLink href="/debts" label="مدیریت بدهی‌ها" />}>
          <ul className="space-y-4">
            {debts.map((d) => (
              <li key={d.id}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[length:var(--fs-sm)]">
                  <span className="font-medium">{d.title}</span>
                  <span className="num font-bold" dir="rtl" style={{ color: d.status === "settled" ? "var(--positive)" : "var(--negative)" }}>
                    {d.outstandingToman != null
                      ? formatMoney(d.status === "settled" ? 0 : d.outstandingToman, "IRT")
                      : toIrt(d.status === "settled" ? 0 : d.outstandingBase) ?? formatMoney(d.status === "settled" ? 0 : d.outstandingBase)}
                  </span>
                </div>
                <Progress value={d.totalCount ? (d.paidCount / d.totalCount) * 100 : 0} color={d.status === "settled" ? "var(--positive)" : "var(--warning)"} />
                <p className="muted num mt-1.5 text-[length:var(--fs-xs)]" dir="rtl">
                  {faCount(d.paidCount)} / {faCount(d.totalCount)} قسط
                  {d.nextDue && <span dir="rtl"> · قسط بعدی {formatJalaliIso(d.nextDue.dueDate)}</span>}
                </p>
              </li>
            ))}
            {!debts.length && <li className="muted py-4 text-center text-xs">بدهی‌ای ثبت نشده است</li>}
          </ul>
          {repaymentsExcluded && (
            <p className="muted num mt-3 text-[length:var(--fs-xs)] leading-5" dir="rtl">
              {repaymentsTomanValue
                ? `${formatMoney(repaymentsTomanValue, "IRT")} از پرداخت اقساط، از «کل هزینه ثبت‌شده» خارج شد`
                : `${formatMoney(totals.repayments)} از پرداخت اقساط (ارز پایهٔ دفتر، بدون تبدیل به نرخ امروز)، از «کل هزینه ثبت‌شده» خارج شد`}{" "}
              — چون بازپرداخت بدهی، مصرف نیست. این مبلغ در سرفصل «پرداخت اقساط»
              بایگانی می‌شود و در سقف بودجه‌های خرج ماه هم شمرده نمی‌شود؛ تنها
              بودجه‌ای آن را می‌سنجد که عمداً به همین سرفصل بسته شده باشد.
            </p>
          )}
        </Section>
      </div>

      {/* Forward liquidity — projection figures are ALREADY Toman (see
          projectCashflow: "Projection unit = Toman"). Never pass them through
          toIrt/usd→irt: that multiplies by the live rate a second time and
          mislabels the Toman figure as "≈ USD". */}
      <Section title="نقدینگی پیش‌رو" hint="۱۲ ماه آینده — برنامه‌ها، اقساط و تعهدات — مبالغ به تومان">
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">ماه</th>
                <th scope="col" className="td-num">ورودی</th>
                <th scope="col" className="td-num">خروجی</th>
              </tr>
            </thead>
            <tbody>
              {projection.points.map((p) => (
                <tr key={p.month}>
                  <td>{jalaliMonthLabel(jalaliMonthKey(p.month))}</td>
                  <td className="td-num" dir="rtl" style={{ color: "var(--positive)" }}>
                    <div>{formatMoney(p.inflow, "IRT")}</div>
                    {rate && p.inflowUsd != null && <div className="muted num text-[length:var(--fs-xs)]">≈ {formatMoney(p.inflowUsd)}</div>}
                  </td>
                  <td className="td-num" dir="rtl" style={{ color: "var(--negative)" }}>
                    <div>{formatMoney(p.outflow, "IRT")}</div>
                    {rate && p.outflowUsd != null && <div className="muted num text-[length:var(--fs-xs)]">≈ {formatMoney(p.outflowUsd)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Recovery & exports */}
      <section className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex gap-2">
          <a href="/api/backup" className="btn btn-soft !min-h-9 !px-3.5 !py-1.5 text-[length:var(--fs-xs)]">
            دانلود پشتیبان
          </a>
          <Link href="/import" className="btn btn-ghost !min-h-9 !px-3.5 !py-1.5 text-[length:var(--fs-xs)]">
            درون‌ریزی
          </Link>
        </div>
      </section>
    </div>
  );
}
