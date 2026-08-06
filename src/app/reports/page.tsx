import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { snapshots } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import {
  getAccountBalances,
  getCashflow,
  getHoldings,
  getNetWorth,
  getRealizedPnl,
} from "@/features/ledger/queries";
import { listDebts, listFunds, listGoals, projectCashflow } from "@/features/planning/service";
import { Card, Money, PageHeader, Progress, Stat } from "@/components/ui/Card";
import { AreaChart, BarsChart, Donut } from "@/components/charts/Charts";
import RowAction from "@/components/RowAction";
import { D, Decimal } from "@/domain/decimal";
import { formatMoney, formatShortDate, getDualDate, jalaliMonthKey, jalaliMonthLabel } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
import PdfButton from "@/components/reports/PdfButton";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await seedIfEmpty();
  const [nw, snaps, flow, pnl, balances, holdings, goals, funds, debts, projection, fxSnap] = await Promise.all([
    getNetWorth(),
    db.select().from(snapshots).orderBy(desc(snapshots.asOf)).limit(24),
    getCashflow(12),
    getRealizedPnl(),
    getAccountBalances(),
    getHoldings(),
    listGoals(),
    listFunds(),
    listDebts(),
    projectCashflow(12),
    getLatestUsdIrtRate(),
  ]);

  const rate = fxSnap.rate;
  const toIrt = (usd: string) => (rate ? D(usd).mul(rate).toFixed(0) : "—");
  const series = [...snaps].reverse().map((s) => ({ date: s.asOf, value: Number(s.netWorth) }));
  const expenses = balances.filter((b) => b.type === "expense" && !D(b.baseValue).isZero());
  const incomes = balances.filter((b) => b.type === "income" && !D(b.baseValue).isZero());
  const totalIncome = Decimal.sum(incomes.map((i) => D(i.baseValue).neg().toString()));
  const totalExpense = Decimal.sum(expenses.map((e) => e.baseValue));
  const unrealized = Decimal.sum(
    holdings.map((h) => D(h.quantity).mul(h.price ?? "0").sub(h.costBase).toString()),
  );
  const savingsRate = totalIncome.isZero()
    ? "0"
    : totalIncome.sub(totalExpense).div(totalIncome).mul(100).toFixed(1);

  const monthly = flow.map((f) => ({
    month: f.month,
    jalaliKey: jalaliMonthKey(f.month),
    jalaliLabel: jalaliMonthLabel(jalaliMonthKey(f.month)),
    dual: getDualDate(f.month),
    inflow: f.inflow,
    outflow: f.outflow,
    inflowIrt: toIrt(f.inflow),
    outflowIrt: toIrt(f.outflow),
    net: D(f.inflow).sub(f.outflow).toString(),
    netIrt: toIrt(D(f.inflow).sub(f.outflow).toString()),
  }));

  // Monthly report aggregates — organized by Jalali months (spec 6)
  const avgExpense = monthly.length ? D(totalExpense.toString()).div(monthly.length).toString() : "0";
  const avgExpenseIrt = toIrt(avgExpense);
  // Trend: last vs prev month
  const last = monthly[monthly.length - 1];
  const prev = monthly[monthly.length - 2];
  const trend = last && prev ? D(last.outflow).sub(prev.outflow) : null;
  const trendPct = last && prev && D(prev.outflow).gt(0) ? D(last.outflow).sub(prev.outflow).div(prev.outflow).mul(100).toFixed(1) : null;

  return (
    <div className="space-y-4" id="monthly-report">
      <PageHeader
        title="گزارش‌ها"
        action={<div className="flex gap-2"><RowAction kind="snapshot" label="ثبت عکس لحظه‌ای" primary /><PdfButton /></div>}
      />

      <div className="soft rounded-2xl p-3 text-[11px] flex flex-wrap items-center justify-between gap-2">
        <span>نرخ دلار مرجع برای گزارش ماهانه: <strong dir="ltr" className="num">{formatMoney(rate, "IRT")}</strong> ≈ $1</span>

      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="ارزش خالص" value={formatMoney(nw.netWorth, "USD")} hint={formatMoney(toIrt(nw.netWorth), "IRT")} />
        <Stat label="کل درآمد ثبت‌شده" value={formatMoney(totalIncome.toString(), "USD")} hint={formatMoney(toIrt(totalIncome.toString()), "IRT")} tone="up" />
        <Stat label="کل هزینه ثبت‌شده" value={formatMoney(totalExpense.toString(), "USD")} hint={formatMoney(toIrt(totalExpense.toString()), "IRT")} tone="down" />
        <Stat label="نرخ پس‌انداز" value={`${savingsRate}٪`} tone={Number(savingsRate) >= 0 ? "up" : "down"} />
      </div>

      {/* 6. Monthly reports organized by Jalali months */}
      <Card title="گزارش ماهانه" action={<PdfButton />}>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-[11px]">
            <thead className="muted">
              <tr>
                <th className="py-1 font-normal">ماه شمسی</th>
                <th className="py-1 font-normal">ماه میلادی</th>
                <th className="py-1 font-normal">مجموع هزینه (IRT)</th>
                <th className="py-1 font-normal">مجموع هزینه (USD)</th>
                <th className="py-1 font-normal">درآمد</th>
                <th className="py-1 font-normal">خالص</th>
                <th className="py-1 font-normal">میانگین</th>
                <th className="py-1 font-normal">مقایسه با ماه قبل</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m, idx) => {
                const prevOut = idx > 0 ? monthly[idx - 1].outflow : null;
                const diff = prevOut ? D(m.outflow).sub(prevOut) : null;
                const diffPct = prevOut && D(prevOut).gt(0) && diff ? diff.div(prevOut).mul(100).toFixed(1) : null;
                return (
                  <tr key={m.month} className="border-t" style={{ borderColor: "var(--line)" }}>
                    <td className="py-1.5 font-bold" dir="rtl">{m.jalaliLabel} <span className="muted text-[10px]">({m.jalaliKey})</span></td>
                    <td className="num py-1.5" dir="ltr">{m.dual.gregorian}</td>
                    <td className="num py-1.5 font-bold" dir="rtl" style={{ color: "var(--danger)" }}>{formatMoney(m.outflowIrt, "IRT")}</td>
                    <td className="num py-1.5" dir="ltr">{formatMoney(m.outflow, "USD")}</td>
                    <td className="num py-1.5" dir="ltr">{formatMoney(m.inflow, "USD")}</td>
                    <td className="num py-1.5" dir="ltr"><Money value={m.net} tone /></td>
                    <td className="num py-1.5" dir="ltr">{formatMoney(avgExpense, "USD")}</td>
                    <td className="num py-1.5" dir="ltr" style={{ color: diff && D(diff).gt(0) ? "var(--danger)" : "var(--accent)" }}>
                      {diff ? `${diffPct}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3 text-xs">
          <div className="soft rounded-2xl p-3">
            <div className="muted text-[10px]">میانگین هزینه ماهانه</div>
            <div className="num font-bold" dir="ltr">{formatMoney(avgExpense, "USD")} <span className="muted">/</span> <span dir="rtl">{formatMoney(avgExpenseIrt, "IRT")}</span></div>
          </div>
          <div className="soft rounded-2xl p-3">
            <div className="muted text-[10px]">روند تغییرات (آخرین ماه)</div>
            <div className="num font-bold" dir="ltr" style={{ color: trend && D(trend).gt(0) ? "var(--danger)" : "var(--accent)" }}>{trend ? formatMoney(trend.toString(), "USD") : "—"} {trendPct ? `(${trendPct}٪)` : ""}</div>
          </div>
          <div className="soft rounded-2xl p-3">
            <div className="muted text-[10px]">نمودار ماهانه</div>
            <BarsChart
              data={monthly.map((m) => ({
                label: m.jalaliLabel,
                positive: Number(m.inflow),
                negative: Number(m.outflow),
              }))}
            />
          </div>
        </div>

      </Card>

      {/* Existing cards — now with dual display where relevant */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="۱) رشد تاریخی ارزش خالص">
          <AreaChart data={series} />
        </Card>
        <Card title="۲) تخصیص دارایی">
          <Donut data={nw.byClass.map((c) => ({ label: c.className, value: Number(c.value), color: c.color }))} />
        </Card>
      </div>

      <Card title="۳) جریان نقدی ماهانه — نمایش دوگانه">
        <BarsChart
          data={monthly.map((m) => ({
            label: m.jalaliLabel,
            positive: Number(m.inflow),
            negative: Number(m.outflow),
          }))}
        />
        <table className="mt-3 w-full text-right text-[11px]">
          <thead className="muted">
            <tr>
              <th className="py-1 font-normal">ماه شمسی</th>
              <th className="py-1 font-normal">ماه میلادی</th>
              <th className="py-1 font-normal">درآمد (IRT/USD)</th>
              <th className="py-1 font-normal">هزینه (IRT/USD)</th>
              <th className="py-1 font-normal">خالص</th>
            </tr>
          </thead>
          <tbody>
            {monthly.map((m) => (
              <tr key={m.month} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className="py-1.5 font-bold" dir="rtl">{m.jalaliLabel}</td>
                <td className="num py-1.5" dir="ltr">{m.dual.gregorian}</td>
                <td className="py-1.5"><span dir="rtl" className="num">{formatMoney(m.inflowIrt, "IRT")}</span> <span className="muted">≈</span> <span dir="ltr" className="num">{formatMoney(m.inflow, "USD")}</span></td>
                <td className="py-1.5"><span dir="rtl" className="num" style={{ color:"var(--danger)" }}>{formatMoney(m.outflowIrt, "IRT")}</span> <span className="muted">≈</span> <span dir="ltr" className="num">{formatMoney(m.outflow, "USD")}</span></td>
                <td className="num py-1.5" dir="ltr"><Money value={m.net} tone /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="۴) سود و زیان سرمایه‌گذاری — دوگانه">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="soft rounded-2xl p-3">
              <div className="muted text-[10px]">تحقق‌یافته (FIFO)</div>
              <div className="num font-bold" dir="ltr">{formatMoney(pnl.total, "USD")}</div>
              <div className="num text-[10px]" dir="rtl">{formatMoney(toIrt(pnl.total), "IRT")}</div>
            </div>
            <div className="soft rounded-2xl p-3">
              <div className="muted text-[10px]">تحقق‌نیافته</div>
              <div className="num font-bold" dir="ltr">{formatMoney(unrealized.toString(), "USD")}</div>
              <div className="num text-[10px]" dir="rtl">{formatMoney(toIrt(unrealized.toString()), "IRT")}</div>
            </div>
          </div>
          <ul className="mt-3 divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {pnl.bySymbol.map((s) => (
              <li key={s.symbol} className="flex items-center justify-between py-2">
                <span>{s.symbol}</span>
                <span className="num" dir="ltr">{formatMoney(s.pnl, "USD")} <span className="muted text-[10px]">≈ {formatMoney(toIrt(s.pnl), "IRT")}</span></span>
              </li>
            ))}
            {!pnl.bySymbol.length && <li className="muted py-4 text-center">فروشی ثبت نشده است</li>}
          </ul>
        </Card>

        <Card title="۵) گزارش بدهی و تقویم اقساط — دوگانه">
          <ul className="divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {debts.map((d) => {
              const dual = d.nextDue ? getDualDate(d.nextDue.dueDate) : null;
              return (
                <li key={d.id} className="py-2.5">
                  <div className="flex items-center justify-between">
                    <span>{d.title}</span>
                    <span style={{ color: "var(--danger)" }}><span dir="ltr" className="num">{formatMoney(d.outstandingBase, "USD")}</span> <span dir="rtl" className="num text-[10px]">{formatMoney(toIrt(d.outstandingBase), "IRT")}</span></span>
                  </div>
                  <div className="muted mt-1 text-[10px]">
                    {d.paidCount} از {d.totalCount} قسط پرداخت شده
                    {dual && ` · قسط بعدی شمسی ${dual.jalali} / میلادی ${dual.gregorian}`}
                  </div>
                  <div className="mt-1">
                    <Progress value={d.totalCount ? (d.paidCount / d.totalCount) * 100 : 0} color="var(--warn)" />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="۶) هزینه به تفکیک دسته — دوگانه">
          <ul className="divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {expenses
              .sort((a, b) => Number(b.baseValue) - Number(a.baseValue))
              .map((e) => (
                <li key={e.accountId} className="flex items-center justify-between py-2">
                  <span>{e.name}</span>
                  <span className="num" dir="ltr">{formatMoney(e.baseValue, "USD")} <span className="muted text-[10px]">≈ {formatMoney(toIrt(e.baseValue), "IRT")}</span></span>
                </li>
              ))}
          </ul>
        </Card>

        <Card title="۷) پیشرفت اهداف و صندوق‌ها — دوگانه">
          <ul className="space-y-3 text-xs">
            {[...goals.map((g) => ({ name: g.name, saved: g.savedBase, target: g.targetBase, p: g.progress })),
              ...funds.map((f) => ({ name: f.name, saved: f.savedBase, target: f.targetBase, p: f.progress }))].map(
              (row) => (
                <li key={row.name}>
                  <div className="mb-1 flex justify-between">
                    <span>{row.name}</span>
                    <span className="num muted" dir="ltr">
                      {formatMoney(row.saved, "USD")} / {formatMoney(row.target, "USD")} <span className="muted text-[10px]">≈ {formatMoney(toIrt(row.saved), "IRT")} / {formatMoney(toIrt(row.target), "IRT")}</span>
                    </span>
                  </div>
                  <Progress value={row.p} />
                </li>
              ),
            )}
          </ul>
        </Card>
      </div>

      <Card title="۸) هزینه‌های آینده و پیش‌بینی نقدینگی — دوگانه و شمسی">
        <table className="w-full text-right text-[11px]">
          <thead className="muted">
            <tr>
              <th className="py-1 font-normal">ماه شمسی</th>
              <th className="py-1 font-normal">ماه میلادی</th>
              <th className="py-1 font-normal">تعهدات و برنامه‌ها</th>
              <th className="py-1 font-normal">نقدینگی تجمعی</th>
            </tr>
          </thead>
          <tbody>
            {projection.points.map((p) => {
              const dual = getDualDate(p.month);
              return (
                <tr key={p.month} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="py-1.5" dir="rtl">{dual.jalali}</td>
                  <td className="num py-1.5" dir="ltr">{dual.gregorian}</td>
                  <td className="num py-1.5" dir="ltr">{formatMoney(p.outflow, "USD")} <span className="muted text-[10px]">≈ {formatMoney(toIrt(p.outflow), "IRT")}</span></td>
                  <td className="num py-1.5" dir="ltr" style={{ color: p.deficit ? "var(--danger)" : undefined }}>
                    {formatMoney(p.cumulative, "USD")} <span className="muted text-[10px]">≈ {formatMoney(toIrt(p.cumulative), "IRT")}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card title="۹) خلاصه سالانه — دوگانه">
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div className="soft rounded-2xl p-3">
            <div className="muted text-[10px]">دارایی</div>
            <div className="num font-bold" dir="ltr">{formatMoney(nw.totalAssets, "USD")}</div>
            <div className="num text-[10px]" dir="rtl">{formatMoney(toIrt(nw.totalAssets), "IRT")}</div>
          </div>
          <div className="soft rounded-2xl p-3">
            <div className="muted text-[10px]">بدهی</div>
            <div className="num font-bold" dir="ltr">{formatMoney(nw.totalLiabilities, "USD")}</div>
            <div className="num text-[10px]" dir="rtl">{formatMoney(toIrt(nw.totalLiabilities), "IRT")}</div>
          </div>
          <div className="soft rounded-2xl p-3">
            <div className="muted text-[10px]">ارزش خالص</div>
            <div className="num font-bold" dir="ltr">{formatMoney(nw.netWorth, "USD")}</div>
            <div className="num text-[10px]" dir="rtl">{formatMoney(toIrt(nw.netWorth), "IRT")}</div>
          </div>
          <div className="soft rounded-2xl p-3">
            <div className="muted text-[10px]">نقدشوندگی</div>
            <div className="num font-bold" dir="ltr">{formatMoney(nw.liquid, "USD")}</div>
            <div className="num text-[10px]" dir="rtl">{formatMoney(toIrt(nw.liquid), "IRT")}</div>
          </div>
        </div>
      </Card>

      <div className="card soft p-3 text-[11px] leading-6">
        <strong>خروجی PDF شامل:</strong> عنوان گزارش، بازه زمانی، تاریخ‌های شمسی/میلادی، مجموع هزینه به تومان/دلار، تفکیک دسته‌بندی، مقایسه، میانگین، روند و نمودارها — بر اساس همان تراکنش‌های دفترکل، بدون ایجاد Summary موازی.
        <div className="mt-2"><PdfButton /></div>
      </div>
    </div>
  );
}
