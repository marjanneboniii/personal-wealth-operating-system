import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import {
  getAccountBalances,
  getCashflow,
  getHoldings,
  getRealizedPnl,
} from "@/features/ledger/queries";
import { listDebts, projectCashflow } from "@/features/planning/service";
import { Metric, PageHeader, Progress, Section, SectionLink } from "@/components/ui/Card";
import { BarsChart } from "@/components/charts/Charts";
import RowAction from "@/components/RowAction";
import PdfButton from "@/components/reports/PdfButton";
import { D, Decimal } from "@/domain/decimal";
import { currencyLabel, formatDualDate, formatMoney, formatPct, jalaliMonthKey, jalaliMonthLabel, faCount, inflowTone, outflowTone, toIrtMoney, trendTone } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
import { getCurrentNetWorth } from "@/features/portfolio/service";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await ensureAuth();
  await seedIfEmpty();
  const [nw, flow, pnl, balances, holdings, debts, projection, fx] = await Promise.all([
    getCurrentNetWorth(),
    getCashflow(12),
    getRealizedPnl(),
    getAccountBalances(),
    getHoldings(),
    listDebts(),
    projectCashflow(12),
    getLatestUsdIrtRate(),
  ]);

  const rate = fx.rate;
  const toIrt = (usd: string | number) => toIrtMoney(usd, rate);

  const expenses = balances.filter((b) => b.type === "expense" && !D(b.baseValue).isZero());
  const incomes = balances.filter((b) => b.type === "income" && !D(b.baseValue).isZero());
  const totalIncome = Decimal.sum(incomes.map((i) => D(i.baseValue).neg().toString()));
  const totalExpense = Decimal.sum(expenses.map((e) => e.baseValue));
  const unrealized = Decimal.sum(holdings.map((h) => D(h.quantity).mul(h.price ?? "0").sub(h.costBase).toString()));
  const savingsRate = totalIncome.isZero() ? "0" : totalIncome.sub(totalExpense).div(totalIncome).mul(100).toFixed(1);

  const monthly = flow.map((f) => ({
    month: f.month,
    jalaliLabel: jalaliMonthLabel(jalaliMonthKey(f.month)),
    inflow: f.inflow,
    outflow: f.outflow,
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
        <Metric label="کل هزینه ثبت‌شده" value={toIrt(totalExpense.toString()) ?? formatMoney(totalExpense.toString())} tone={outflowTone(totalExpense.toString())} hint={rate ? formatMoney(totalExpense.toString()) : undefined} />
        <Metric label="نرخ پس‌انداز" value={`${formatPct(savingsRate, 1)}`} tone={trendTone(savingsRate)} />
      </section>

      {/* Monthly report — printable */}
      <Section title="گزارش ماهانه">
        <div id="monthly-report">
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="دارایی" value={formatMoney(nw.totalAssetsToman, "IRT")} hint={formatMoney(nw.totalAssets)} />
            <Metric label="بدهی" value={formatMoney(nw.totalLiabilitiesToman, "IRT")} hint={formatMoney(nw.totalLiabilities)} />
            <Metric label="نقدشونده" value={formatMoney(nw.liquidToman, "IRT")} hint={formatMoney(nw.liquid)} />
            <Metric label="میانگین هزینه ماهانه" value={toIrt(monthly.length ? D(totalExpense.toString()).div(monthly.length).toString() : "0") ?? formatMoney(monthly.length ? D(totalExpense.toString()).div(monthly.length).toString() : "0")} hint={rate ? formatMoney(monthly.length ? D(totalExpense.toString()).div(monthly.length).toString() : "0") : undefined} />
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
                  <th>ماه</th>
                  <th className="td-num">درآمد</th>
                  <th className="td-num">هزینه</th>
                  <th className="td-num">خالص</th>
                  <th className="td-num hidden sm:table-cell">نسبت به ماه قبل</th>
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
                        <div>{toIrt(m.inflow) ?? formatMoney(m.inflow)}</div>
                        {rate && <div className="muted num text-[9.5px]">≈ {formatMoney(m.inflow)}</div>}
                      </td>
                      <td className="td-num" dir="rtl" style={{ color: "var(--negative)" }}>
                        <div>{toIrt(m.outflow) ?? formatMoney(m.outflow)}</div>
                        {rate && <div className="muted num text-[9.5px]">≈ {formatMoney(m.outflow)}</div>}
                      </td>
                      <td className="td-num font-bold" dir="rtl" style={{ color: D(m.net).gte(0) ? "var(--positive)" : "var(--negative)" }}>
                        <div>
                          {D(m.net).gte(0) ? "+" : "−"}
                          {toIrt(D(m.net).abs().toString()) ?? formatMoney(D(m.net).abs().toString())}
                        </div>
                        {rate && <div className="muted num text-[9.5px]">≈ {formatMoney(D(m.net).abs().toString())}</div>}
                      </td>
                      <td className="td-num hidden sm:table-cell num" dir="rtl" style={{ color: diff && diff.gt(0) ? "var(--negative)" : "var(--positive)" }}>
                        {diff ? `${diff.gte(0) ? "+" : "−"}${formatPct(diff.abs().toString(), 1)}` : "—"}
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
              value={`${D(pnl.total).gte(0) ? "+" : "−"}${toIrt(D(pnl.total).abs().toString()) ?? formatMoney(D(pnl.total).abs().toString())}`}
              tone={trendTone(pnl.total)}
              hint={rate ? `${D(pnl.total).gte(0) ? "+" : "−"}${formatMoney(D(pnl.total).abs().toString())}` : undefined}
            />
            <Metric
              label="تحقق‌نیافته"
              value={`${unrealized.gte(0) ? "+" : "−"}${toIrt(unrealized.abs().toString()) ?? formatMoney(unrealized.abs().toString())}`}
              tone={trendTone(unrealized.toString())}
              hint={rate ? `${unrealized.gte(0) ? "+" : "−"}${formatMoney(unrealized.abs().toString())}` : undefined}
            />
          </div>
          <ul className="mt-3 divide-y" style={{ borderColor: "var(--border)" }}>
            {pnl.bySymbol.map((s) => (
              <li key={s.symbol} className="flex items-center justify-between py-2 text-[12.5px]">
                <span className="font-bold" dir="rtl">
                  {currencyLabel(s.symbol)}
                </span>
                <span className="num" dir="rtl" style={{ color: D(s.pnl).gte(0) ? "var(--positive)" : "var(--negative)" }}>
                  {D(s.pnl).gte(0) ? "+" : "−"}
                  {formatMoney(D(s.pnl).abs().toString(), s.symbol)}
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
                <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="font-medium">{d.title}</span>
                  <span className="num font-bold" dir="rtl" style={{ color: d.status === "settled" ? "var(--positive)" : "var(--negative)" }}>
                    {d.outstandingToman != null
                      ? formatMoney(d.status === "settled" ? 0 : d.outstandingToman, "IRT")
                      : toIrt(d.status === "settled" ? 0 : d.outstandingBase) ?? formatMoney(d.status === "settled" ? 0 : d.outstandingBase)}
                  </span>
                </div>
                <Progress value={d.totalCount ? (d.paidCount / d.totalCount) * 100 : 0} color={d.status === "settled" ? "var(--positive)" : "var(--warning)"} />
                <p className="muted num mt-1.5 text-[10.5px]" dir="rtl">
                  {faCount(d.paidCount)} / {faCount(d.totalCount)} قسط
                  {d.nextDue && <span dir="rtl"> · قسط بعدی {formatDualDate(d.nextDue.dueDate)}</span>}
                </p>
              </li>
            ))}
            {!debts.length && <li className="muted py-4 text-center text-xs">بدهی‌ای ثبت نشده است</li>}
          </ul>
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
                <th>ماه</th>
                <th className="td-num">ورودی</th>
                <th className="td-num">خروجی</th>
                <th className="td-num">نقدینگی تجمعی</th>
              </tr>
            </thead>
            <tbody>
              {projection.points.map((p) => (
                <tr key={p.month}>
                  <td>{jalaliMonthLabel(jalaliMonthKey(p.month))}</td>
                  <td className="td-num" dir="rtl" style={{ color: "var(--positive)" }}>
                    <div>{formatMoney(p.inflow, "IRT")}</div>
                    {rate && p.inflowUsd != null && <div className="muted num text-[9.5px]">≈ {formatMoney(p.inflowUsd)}</div>}
                  </td>
                  <td className="td-num" dir="rtl" style={{ color: "var(--negative)" }}>
                    <div>{formatMoney(p.outflow, "IRT")}</div>
                    {rate && p.outflowUsd != null && <div className="muted num text-[9.5px]">≈ {formatMoney(p.outflowUsd)}</div>}
                  </td>
                  <td className="td-num font-bold" dir="rtl" style={{ color: p.deficit ? "var(--negative)" : undefined }}>
                    <div>{formatMoney(p.cumulative, "IRT")}</div>
                    {rate && p.cumulativeUsd != null && <div className="muted num text-[9.5px]">≈ {formatMoney(p.cumulativeUsd)}</div>}
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
          <a href="/api/backup" className="btn btn-soft !min-h-9 !px-3.5 !py-1.5 text-[12px]">
            دانلود پشتیبان
          </a>
          <Link href="/import" className="btn btn-ghost !min-h-9 !px-3.5 !py-1.5 text-[12px]">
            درون‌ریزی
          </Link>
        </div>
      </section>
    </div>
  );
}
