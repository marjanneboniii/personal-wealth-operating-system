import Link from "next/link";
import { seedIfEmpty } from "@/db/seed";
import { ensureAuth } from "@/lib/authGuard";
import { getCashflow, getFlowByAccount } from "@/features/ledger/queries";
import { getFlowByCategory, type CategoryFlowRow } from "@/features/categories/service";
import { MISC_PARENT_CODE } from "@/features/categories/catalog";
import { Metric, PageHeader, Section, SectionLink, EmptyState } from "@/components/ui/Card";
import { BarsChart } from "@/components/charts/Charts";
import { D, Decimal } from "@/domain/decimal";
import { formatMoney, formatPct, toJalali } from "@/lib/format";
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
                    <span className="num muted text-[10.5px]" dir="rtl">
                      {formatPct(share, 1)}
                    </span>
                    <span className="num font-bold" dir="rtl">
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

/**
 * Hierarchical expense breakdown: parents roll up their leaves, leaves keep
 * their detail. Non-cash rows (depreciation/reserves) are shown separately —
 * they are expenses but never a cash outflow.
 */
function CategoryBreakdown({ rows }: { rows: CategoryFlowRow[] }) {
  if (!rows.length) return null;
  const groups = new Map<string, { name: string; parentId: string; total: Decimal; nonCash: Decimal; leaves: CategoryFlowRow[] }>();
  for (const r of rows) {
    const key = r.parentId ?? r.categoryId;
    const g = groups.get(key) ?? { name: r.parentName ?? r.name, parentId: key, total: Decimal.zero(), nonCash: Decimal.zero(), leaves: [] };
    g.total = g.total.add(r.total);
    if (r.nature === "non_cash") g.nonCash = g.nonCash.add(r.total);
    g.leaves.push(r);
    groups.set(key, g);
  }
  const sorted = [...groups.values()].sort((a, b) => Number(b.total.toString()) - Number(a.total.toString()));
  const grand = sorted.reduce((s, g) => s.add(g.total), Decimal.zero());
  const misc = sorted.find((g) => rows.some((r) => r.parentId === g.parentId && r.parentCode === MISC_PARENT_CODE)) ?? null;

  return (
    <Section title="هزینه‌ها به تفکیک دسته‌های استاندارد — ۶ ماه اخیر" hint="ساختار درختی دسته‌ها: جمع هر دسته اصلی، مجموع زیردسته‌های آن است.">
      <div className="card space-y-4 p-4 sm:p-5">
        {misc && misc.total.gt(0) && (
          <div className="soft flex flex-wrap items-center justify-between gap-2 rounded-[var(--r-md)] p-3 text-[11.5px]">
            <span>
              <strong>{formatMoney(misc.total.toString())}</strong> در دسته «متفرقه» ثبت شده است — فقط وقتی هیچ دسته مناسبی نیست.
              در صورت تکرار یک نوع هزینه، برای آن زیردسته مستقل بسازید.
            </span>
            <Link href={`/transactions?category=${misc.parentId}`} className="btn btn-soft !min-h-8 !px-3 text-[11px]">
              بررسی تراکنش‌های متفرقه
            </Link>
          </div>
        )}
        <ul className="space-y-4">
          {sorted.map((g) => {
            const share = grand.isZero() ? 0 : g.total.div(grand).mul(100).toNumber();
            return (
              <li key={g.parentId}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
                  <span className="min-w-0 truncate font-semibold">{g.name}</span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="num muted text-[10.5px]" dir="rtl">{formatPct(share, 1)}</span>
                    <span className="num font-bold" dir="rtl">{formatMoney(g.total.toString())}</span>
                  </span>
                </div>
                <div className="meter"><i style={{ width: `${Math.min(100, share)}%`, background: "var(--negative)" }} /></div>
                <ul className="mt-1.5 space-y-0.5">
                  {g.leaves
                    .slice()
                    .sort((a, b) => Number(b.total) - Number(a.total))
                    .map((l) => (
                      <li key={l.categoryId} className="muted flex items-center justify-between gap-2 text-[11px]">
                        <span className="min-w-0 truncate">
                          • {l.name}
                          {l.nature === "non_cash" && <span className="badge ms-1.5">غیرنقدی — بدون خروج وجه</span>}
                        </span>
                        <span className="num shrink-0" dir="rtl">{formatMoney(l.total)}</span>
                      </li>
                    ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>
    </Section>
  );
}

export default async function CashFlowPage() {
  await ensureAuth();
  await seedIfEmpty();
  const [flow, expenses, incomes, fx, categoryFlows] = await Promise.all([
    getCashflow(12),
    getFlowByAccount("expense", 6),
    getFlowByAccount("income", 6),
    getLatestUsdIrtRate(),
    getFlowByCategory(6),
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
          hint={savingsRate != null ? `${formatPct(savingsRate, 0)} نرخ پس‌انداز` : undefined}
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
        <FlowTable hint="هزینه‌ها بر اساس حساب معین — ۶ ماه اخیر" rows={expenses} total={expTotal.toString()} color="var(--negative)" />
        <FlowTable hint="درآمدها بر اساس منبع — ۶ ماه اخیر" rows={incomes} total={incTotal.toString()} color="var(--positive)" />
      </div>

      <CategoryBreakdown rows={categoryFlows} />

      <p className="muted text-[10.5px]">
        نرمال‌سازی ارز: {fx.rate ? <>هر ۱ دلار ≈ <span className="num">{formatMoney(fx.rate, "IRT")}</span></> : "ثبت نشده"} · منبع داده: دفترکل دوطرفه — همان حقیقت حسابداری.
      </p>
    </div>
  );
}
