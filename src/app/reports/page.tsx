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
import { formatMoney, formatShortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await seedIfEmpty();
  const [nw, snaps, flow, pnl, balances, holdings, goals, funds, debts, projection] = await Promise.all([
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
  ]);

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
    inflow: f.inflow,
    outflow: f.outflow,
    net: D(f.inflow).sub(f.outflow).toString(),
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="گزارش‌ها"
        subtitle="همه اعداد مشتق‌شده از دفترکل هستند؛ هیچ مقداری جداگانه ذخیره نمی‌شود."
        action={<RowAction kind="snapshot" label="ثبت عکس لحظه‌ای" primary />}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="ارزش خالص" value={formatMoney(nw.netWorth)} />
        <Stat label="کل درآمد ثبت‌شده" value={formatMoney(totalIncome.toString())} tone="up" />
        <Stat label="کل هزینه ثبت‌شده" value={formatMoney(totalExpense.toString())} tone="down" />
        <Stat label="نرخ پس‌انداز" value={`${savingsRate}٪`} tone={Number(savingsRate) >= 0 ? "up" : "down"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="۱) رشد تاریخی ارزش خالص">
          <AreaChart data={series} />
        </Card>
        <Card title="۲) تخصیص دارایی">
          <Donut data={nw.byClass.map((c) => ({ label: c.className, value: Number(c.value), color: c.color }))} />
        </Card>
      </div>

      <Card title="۳) جریان نقدی ماهانه">
        <BarsChart
          data={monthly.map((m) => ({
            label: formatShortDate(m.month),
            positive: Number(m.inflow),
            negative: Number(m.outflow),
          }))}
        />
        <table className="mt-3 w-full text-right text-[11px]">
          <thead className="muted">
            <tr>
              <th className="py-1 font-normal">ماه</th>
              <th className="py-1 font-normal">درآمد</th>
              <th className="py-1 font-normal">هزینه</th>
              <th className="py-1 font-normal">خالص</th>
            </tr>
          </thead>
          <tbody>
            {monthly.map((m) => (
              <tr key={m.month} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className="py-1.5">{formatShortDate(m.month)}</td>
                <td className="num py-1.5" dir="ltr">{formatMoney(m.inflow)}</td>
                <td className="num py-1.5" dir="ltr">{formatMoney(m.outflow)}</td>
                <td className="num py-1.5" dir="ltr"><Money value={m.net} tone /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="۴) سود و زیان سرمایه‌گذاری">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="soft rounded-2xl p-3">
              <div className="muted text-[10px]">تحقق‌یافته (FIFO)</div>
              <Money value={pnl.total} tone />
            </div>
            <div className="soft rounded-2xl p-3">
              <div className="muted text-[10px]">تحقق‌نیافته</div>
              <Money value={unrealized.toString()} tone />
            </div>
          </div>
          <ul className="mt-3 divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {pnl.bySymbol.map((s) => (
              <li key={s.symbol} className="flex items-center justify-between py-2">
                <span>{s.symbol}</span>
                <Money value={s.pnl} tone />
              </li>
            ))}
            {!pnl.bySymbol.length && <li className="muted py-4 text-center">فروشی ثبت نشده است</li>}
          </ul>
        </Card>

        <Card title="۵) گزارش بدهی و تقویم اقساط">
          <ul className="divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {debts.map((d) => (
              <li key={d.id} className="py-2.5">
                <div className="flex items-center justify-between">
                  <span>{d.title}</span>
                  <span style={{ color: "var(--danger)" }}><Money value={d.outstandingBase} /></span>
                </div>
                <div className="muted mt-1 text-[10px]">
                  {d.paidCount} از {d.totalCount} قسط پرداخت شده
                  {d.nextDue && ` · قسط بعدی ${formatShortDate(d.nextDue.dueDate)}`}
                </div>
                <div className="mt-1">
                  <Progress value={d.totalCount ? (d.paidCount / d.totalCount) * 100 : 0} color="var(--warn)" />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="۶) هزینه به تفکیک دسته">
          <ul className="divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {expenses
              .sort((a, b) => Number(b.baseValue) - Number(a.baseValue))
              .map((e) => (
                <li key={e.accountId} className="flex items-center justify-between py-2">
                  <span>{e.name}</span>
                  <Money value={e.baseValue} />
                </li>
              ))}
          </ul>
        </Card>

        <Card title="۷) پیشرفت اهداف و صندوق‌ها">
          <ul className="space-y-3 text-xs">
            {[...goals.map((g) => ({ name: g.name, saved: g.savedBase, target: g.targetBase, p: g.progress })),
              ...funds.map((f) => ({ name: f.name, saved: f.savedBase, target: f.targetBase, p: f.progress }))].map(
              (row) => (
                <li key={row.name}>
                  <div className="mb-1 flex justify-between">
                    <span>{row.name}</span>
                    <span className="num muted" dir="ltr">
                      {formatMoney(row.saved)} / {formatMoney(row.target)}
                    </span>
                  </div>
                  <Progress value={row.p} />
                </li>
              ),
            )}
          </ul>
        </Card>
      </div>

      <Card title="۸) هزینه‌های آینده و پیش‌بینی نقدینگی">
        <table className="w-full text-right text-[11px]">
          <thead className="muted">
            <tr>
              <th className="py-1 font-normal">ماه</th>
              <th className="py-1 font-normal">تعهدات و برنامه‌ها</th>
              <th className="py-1 font-normal">نقدینگی تجمعی</th>
            </tr>
          </thead>
          <tbody>
            {projection.points.map((p) => (
              <tr key={p.month} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className="py-1.5">{formatShortDate(p.month)}</td>
                <td className="num py-1.5" dir="ltr">{formatMoney(p.outflow)}</td>
                <td className="num py-1.5" dir="ltr" style={{ color: p.deficit ? "var(--danger)" : undefined }}>
                  {formatMoney(p.cumulative)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="۹) خلاصه سالانه">
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div className="soft rounded-2xl p-3">
            <div className="muted text-[10px]">دارایی</div>
            <Money value={nw.totalAssets} />
          </div>
          <div className="soft rounded-2xl p-3">
            <div className="muted text-[10px]">بدهی</div>
            <Money value={nw.totalLiabilities} />
          </div>
          <div className="soft rounded-2xl p-3">
            <div className="muted text-[10px]">ارزش خالص</div>
            <Money value={nw.netWorth} />
          </div>
          <div className="soft rounded-2xl p-3">
            <div className="muted text-[10px]">نقدشوندگی</div>
            <Money value={nw.liquid} />
          </div>
        </div>
      </Card>
    </div>
  );
}
