import { seedIfEmpty } from "@/db/seed";
import { ensureAuth } from "@/lib/authGuard";
import { getCashflow, getFlowByAccount } from "@/features/ledger/queries";
import { Metric, PageHeader, Section, SectionLink, EmptyState } from "@/components/ui/Card";
import { BarsChart } from "@/components/charts/Charts";
import { D, Decimal } from "@/domain/decimal";
import { formatMoney, toJalali } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

const FA_MONTHS = ["", "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

function FlowTable({
  hint,
  rows,
  total,
  color,
}: {
  hint: string;
  rows: { code: string; name: string; total: string }[];
  total: string;
  color: string;
}) {
  const sum = D(total);
  return (
    <Section hint={hint}>
      {rows.length === 0 ? (
        <EmptyState icon="cashflow" title="داده‌ای در این بازه نیست" body="با ثبت تراکنش‌های درآمد و هزینه، این تحلیل به‌طور خودکار ساخته می‌شود." />
      ) : (
        <ul className="space-y-3">
          {rows.slice(0, 8).map((r) => {
            const share = sum.isZero() ? 0 : D(r.total).div(sum).mul(100).toNumber();
            return (
              <li key={r.code}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
                  <span className="min-w-0 truncate font-medium">{r.name}</span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="num muted text-[10.5px]" dir="ltr">
                      {share.toFixed(1)}٪
                    </span>
                    <span className="num font-bold" dir="ltr">
                      {formatMoney(r.total)}
                    </span>
                  </span>
                </div>
                <div className="meter">
                  <i style={{ width: `${Math.min(100, share)}%`, background: color }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

export default async function CashFlowPage() {
  await ensureAuth();
  await seedIfEmpty();
  const [flow, expenses, incomes, fx] = await Promise.all([
    getCashflow(12),
    getFlowByAccount("expense", 6),
    getFlowByAccount("income", 6),
    getLatestUsdIrtRate(),
  ]);

  const month = flow.at(-1);
  const totalIncome12 = Decimal.sum(flow.map((f) => f.inflow));
  const totalExpense12 = Decimal.sum(flow.map((f) => f.outflow));
  const netMonth = month ? D(month.inflow).sub(month.outflow) : Decimal.zero();
  const savingsRate = month && !D(month.inflow).isZero() ? netMonth.div(month.inflow).mul(100).toFixed(0) : null;
  const expTotal = Decimal.sum(expenses.map((e) => e.total));
  const incTotal = Decimal.sum(incomes.map((i) => i.total));

  return (
    <div className="space-y-8">
      <PageHeader
        title="جریان نقدی"
        action={<SectionLink href="/planning" label="پیش‌بینی آینده" />}
      />

      {/* KPI strip — borderless metrics with dividers */}
      <section className="rise grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-4" style={{ borderColor: "var(--border)" }}>
        <Metric label="درآمد این ماه" value={formatMoney(month?.inflow ?? 0)} tone="up" />
        <Metric label="هزینه این ماه" value={formatMoney(month?.outflow ?? 0)} tone="down" />
        <Metric
          label="خالص این ماه"
          value={`${netMonth.gte(0) ? "+" : "−"}${formatMoney(netMonth.abs().toString())}`}
          tone={netMonth.gte(0) ? "up" : "down"}
          hint={savingsRate != null ? `${savingsRate}٪ نرخ پس‌انداز` : undefined}
        />
        <Metric
          label="خالص ۱۲ ماه"
          value={`${D(totalIncome12.sub(totalExpense12).toString()).gte(0) ? "+" : "−"}${formatMoney(totalIncome12.sub(totalExpense12).abs().toString())}`}
          hint={`درآمد ${formatMoney(totalIncome12.toString())} · هزینه ${formatMoney(totalExpense12.toString())}`}
        />
      </section>

      <Section title="درآمد در برابر هزینه — ۱۲ ماه اخیر">
        <div className="card p-4 sm:p-5">
          {flow.length ? (
            <BarsChart
              height={160}
              data={flow.map((f) => ({
                label: FA_MONTHS[toJalali(f.month).m],
                positive: Number(f.inflow),
                negative: Number(f.outflow),
              }))}
            />
          ) : (
            <EmptyState
              icon="cashflow"
              title="هنوز جریان نقدی‌ای ثبت نشده است"
              body="با ثبت درآمدها و هزینه‌ها، این نمودار ماه‌به‌ماه ساخته می‌شود."
            />
          )}
        </div>
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        <FlowTable hint="هزینه‌ها بر اساس دسته — ۶ ماه اخیر" rows={expenses} total={expTotal.toString()} color="var(--negative)" />
        <FlowTable hint="درآمدها بر اساس منبع — ۶ ماه اخیر" rows={incomes} total={incTotal.toString()} color="var(--positive)" />
      </div>

      <p className="muted text-[10.5px]">
        نرمال‌سازی ارز: {fx.rate ? <>هر $1 ≈ <span className="num">{formatMoney(fx.rate, "IRT")}</span></> : "ثبت نشده"} · منبع داده: دفترکل دوطرفه — همان حقیقت حسابداری.
      </p>
    </div>
  );
}
