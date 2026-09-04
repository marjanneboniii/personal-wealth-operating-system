import Link from "next/link";
import { seedIfEmpty } from "@/db/seed";
import { ensureAuth } from "@/lib/authGuard";
import { getCashflow, getFlowByAccount } from "@/features/ledger/queries";
import { getFlowByCategory, type CategoryFlowRow } from "@/features/categories/service";
import { MISC_PARENT_CODE } from "@/features/categories/catalog";
import { Metric, PageHeader, Section, SectionLink, EmptyState } from "@/components/ui/Card";
import { BarsChart } from "@/components/charts/Charts";
import { D, Decimal } from "@/domain/decimal";
import { formatMoney, formatPct, formatSignedMoney, formatSignedMoneyFromUsd, inflowTone, outflowTone, toJalali, toIrtMoney, trendTone } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

const FA_MONTHS = ["", "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

/* ──────────────────────────────────────────────────────────────────────────
   FROZEN-TOMAN RULE (Global System Directive §1 — «مانده تومانی = داده
   قطعی و ثابت»):

   The Toman amount of a RECORDED past transaction is rendered ONLY from its
   commit-time freeze (`entry_fx_snapshots.irt_amount`, read through the
   per-entry snapshot columns of the read queries). A change of the dollar
   rate can NEVER move a rendered frozen Toman figure — the dynamic
   equivalent (USD × current rate, marked «≈») is a one-way PREVIEW used only
   where no freeze exists at all (legacy rows), and never overwrites one.

   A Toman aggregate is "frozen" only when EVERY underlying entry carries its
   snapshot (full coverage). A partial cover would understate the total, so
   in that case the UI falls back to the dynamic current-rate view — it never
   presents an incomplete sum as a freeze.
   ────────────────────────────────────────────────────────────────────────── */
const isFrozenCover = (entries: number, withSnap: number) => entries > 0 && entries === withSnap;

function FlowTable({
  hint,
  rows,
  total,
  color,
  toIrt,
}: {
  hint: string;
  rows: { code: string; name: string; total: string; totalToman?: string | null; entries?: number; entriesWithSnap?: number }[];
  total: string;
  color: string;
  toIrt: (usd: string | number) => string | null;
}) {
  const sum = D(total);
  return (
    <Section hint={hint}>
      {rows.length === 0 ? (
        <EmptyState icon="cashflow" title="داده‌ای در این بازه نیست" body="با ثبت تراکنش‌های درآمد و هزینه، این تحلیل به‌طور خودکار ساخته می‌شود." />
      ) : (
        <ul className="space-y-3">
          {rows.slice(0, 8).map((r: any) => {
            const share = sum.isZero() ? 0 : D(r.total).div(sum).mul(100).toNumber();
            // Frozen Toman only under full snapshot coverage — otherwise the
            // dynamic current-rate equivalent (never a partial freeze).
            const frozen = isFrozenCover(r.entries ?? 0, r.entriesWithSnap ?? 0) && r.totalToman != null && D(r.totalToman).gt(0);
            const toman = frozen ? r.totalToman : toIrt(r.total);
            return (
              <li key={r.code}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
                  <span className="min-w-0 truncate font-medium">{r.name}</span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="num muted text-[10.5px]" dir="rtl">
                      {formatPct(share, 1)}
                    </span>
                    <span className="flex flex-col items-end">
                      <span className="num font-bold" dir="rtl">
                        {toman ? formatMoney(toman, "IRT") : formatMoney(r.total)}
                      </span>
                      {toman && (
                        <span className="muted num text-[9.5px]" dir="rtl">
                          ≈ {formatMoney(r.total)}
                        </span>
                      )}
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

function CategoryBreakdown({ rows, toIrt }: { rows: CategoryFlowRow[]; toIrt: (usd: string | number) => string | null }) {
  if (!rows.length) return null;
  const groups = new Map<string, { name: string; parentId: string; total: Decimal; totalToman: Decimal; nonCash: Decimal; leaves: CategoryFlowRow[] }>();
  for (const r of rows) {
    const key = r.parentId ?? r.categoryId;
    const g = groups.get(key) ?? { name: r.parentName ?? r.name, parentId: key, total: Decimal.zero(), totalToman: Decimal.zero(), nonCash: Decimal.zero(), leaves: [] };
    g.total = g.total.add(r.total);
    g.totalToman = g.totalToman.add(r.totalToman);
    if (r.nature === "non_cash") g.nonCash = g.nonCash.add(r.total);
    g.leaves.push(r);
    groups.set(key, g);
  }
  const sorted = [...groups.values()].sort((a, b) => Number(b.total.toString()) - Number(a.total.toString()));
  const grand = sorted.reduce((s, g) => s.add(g.total), Decimal.zero());
  const misc = sorted.find((g) => rows.some((r) => r.parentId === g.parentId && r.parentCode === MISC_PARENT_CODE)) ?? null;

  /** Frozen Toman of a group — only when every leaf entry is snapshot-covered. */
  const frozenTomanOf = (g: { totalToman: Decimal; leaves: CategoryFlowRow[] }): string | null =>
    g.leaves.length > 0 && g.leaves.every((l) => isFrozenCover(l.entries, l.entriesWithSnap)) ? g.totalToman.toFixed(0) : null;
  const miscToman = misc ? frozenTomanOf(misc) : null;

  return (
    <Section title="هزینه‌ها به تفکیک دسته‌های استاندارد — ۶ ماه اخیر" hint="ساختار درختی دسته‌ها: جمع هر دسته اصلی، مجموع زیردسته‌های آن است.">
      <div className="card space-y-4 p-4 sm:p-5">
        {misc && misc.total.gt(0) && (
          <div className="soft flex flex-wrap items-center justify-between gap-2 rounded-[var(--r-md)] p-3 text-[11.5px]">
            <span>
              <strong>{miscToman ? formatMoney(miscToman, "IRT") : toIrt(misc.total.toString()) ?? formatMoney(misc.total.toString())}</strong> در دسته «متفرقه» ثبت شده است — فقط وقتی هیچ دسته مناسبی نیست.
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
            const gToman = frozenTomanOf(g);
            const gDyn = toIrt(g.total.toString());
            return (
              <li key={g.parentId}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
                  <span className="min-w-0 truncate font-semibold">{g.name}</span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="num muted text-[10.5px]" dir="rtl">{formatPct(share, 1)}</span>
                    <span className="flex flex-col items-end">
                      <span className="num font-bold" dir="rtl">
                        {gToman ? formatMoney(gToman, "IRT") : gDyn ?? formatMoney(g.total.toString())}
                      </span>
                      {(gToman || gDyn) && (
                        <span className="muted num text-[9.5px]" dir="rtl">
                          ≈ {formatMoney(g.total.toString())}
                        </span>
                      )}
                    </span>
                  </span>
                </div>
                <div className="meter"><i style={{ width: `${Math.min(100, share)}%`, background: "var(--negative)" }} /></div>
                <ul className="mt-1.5 space-y-0.5">
                  {g.leaves
                    .slice()
                    .sort((a, b) => Number(b.total) - Number(a.total))
                    .map((l) => {
                      const lToman = isFrozenCover(l.entries, l.entriesWithSnap) && D(l.totalToman).gt(0) ? formatMoney(l.totalToman, "IRT") : null;
                      return (
                        <li key={l.categoryId} className="muted flex items-center justify-between gap-2 text-[11px]">
                          <span className="min-w-0 truncate">
                            • {l.name}
                            {l.nature === "non_cash" && <span className="badge ms-1.5">غیرنقدی — بدون خروج وجه</span>}
                          </span>
                          <span className="num shrink-0" dir="rtl">{lToman ?? toIrt(l.total) ?? formatMoney(l.total)}</span>
                        </li>
                      );
                    })}
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
  const toIrt = (usd: string | number) => toIrtMoney(usd, fx.rate);

  const month = flow.at(-1) as any;
  const totalIncome12 = Decimal.sum(flow.map((f) => f.inflow));
  const totalExpense12 = Decimal.sum(flow.map((f) => f.outflow));
  const netMonth = month ? D(month.inflow).sub(month.outflow) : Decimal.zero();
  const savingsRate = month && !D(month.inflow).isZero() ? netMonth.div(month.inflow).mul(100).toFixed(0) : null;
  const expTotal = Decimal.sum(expenses.map((e) => e.total));
  const incTotal = Decimal.sum(incomes.map((i) => i.total));

  /* FROZEN Toman — current month.
   * Complete only when EVERY cash-flow entry of the month carries its
   * commit-time FX snapshot; otherwise the KPI shows the dynamic current-rate
   * equivalent (never a partial sum masquerading as a freeze). */
  const monthCovered = !!month && month.inflowEntries === month.inflowEntriesSnap && month.outflowEntries === month.outflowEntriesSnap;
  const monthInflowToman = monthCovered && D(month.inflowToman ?? "0").gt(0) ? month.inflowToman : null;
  const monthOutflowToman = monthCovered && D(month.outflowToman ?? "0").gt(0) ? month.outflowToman : null;
  const monthNetToman = monthCovered ? D(month.inflowToman ?? "0").sub(D(month.outflowToman ?? "0")) : null;

  /* FROZEN Toman — 12-month window (same full-coverage rule across all months). */
  const windowCovered =
    flow.length > 0 && flow.every((f) => f.inflowEntries === f.inflowEntriesSnap && f.outflowEntries === f.outflowEntriesSnap);
  const net12Toman = windowCovered
    ? flow.reduce((s, f) => s.add(D(f.inflowToman ?? "0")).sub(D(f.outflowToman ?? "0")), Decimal.zero())
    : null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="جریان نقدی"
        action={<SectionLink href="/planning" label="پیش‌بینی آینده" />}
      />

      <section className="rise grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-4" style={{ borderColor: "var(--border)" }}>
        <Metric
          label="درآمد این ماه"
          value={monthInflowToman ? formatMoney(monthInflowToman, "IRT") : toIrt(month?.inflow ?? 0) ?? formatMoney(month?.inflow ?? 0)}
          tone={inflowTone(month?.inflow ?? 0)}
          hint={fx.rate ? formatMoney(month?.inflow ?? 0) : undefined}
        />
        <Metric
          label="هزینه این ماه"
          value={monthOutflowToman ? formatMoney(monthOutflowToman, "IRT") : toIrt(month?.outflow ?? 0) ?? formatMoney(month?.outflow ?? 0)}
          tone={outflowTone(month?.outflow ?? 0)}
          hint={fx.rate ? formatMoney(month?.outflow ?? 0) : undefined}
        />
        <Metric
          label="خالص این ماه"
          value={monthNetToman ? formatSignedMoney(monthNetToman.toString(), "IRT") : formatSignedMoneyFromUsd(netMonth.toString(), fx.rate)}
          tone={trendTone(netMonth.toString())}
          hint={fx.rate ? `≈ ${formatMoney(netMonth.abs().toString())}${savingsRate != null ? ` · ${formatPct(savingsRate, 0)} نرخ پس‌انداز` : ""}` : savingsRate != null ? `${formatPct(savingsRate, 0)} نرخ پس‌انداز` : undefined}
        />
        <Metric
          label="خالص ۱۲ ماه"
          value={net12Toman ? formatSignedMoney(net12Toman.toString(), "IRT") : formatSignedMoneyFromUsd(totalIncome12.sub(totalExpense12).toString(), fx.rate)}
          hint={fx.rate ? `≈ ${formatMoney(totalIncome12.sub(totalExpense12).abs().toString())} · درآمد ${formatMoney(totalIncome12.toString())} · هزینه ${formatMoney(totalExpense12.toString())}` : `درآمد ${formatMoney(totalIncome12.toString())} · هزینه ${formatMoney(totalExpense12.toString())}`}
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
        <FlowTable hint="هزینه‌ها بر اساس دسته‌بندی — ۶ ماه اخیر" rows={expenses as any} total={expTotal.toString()} color="var(--negative)" toIrt={toIrt} />
        <FlowTable hint="درآمدها بر اساس منبع — ۶ ماه اخیر" rows={incomes as any} total={incTotal.toString()} color="var(--positive)" toIrt={toIrt} />
      </div>

      <CategoryBreakdown rows={categoryFlows} toIrt={toIrt} />

      <p className="muted text-[10.5px]">
        نرمال‌سازی ارز: {fx.rate ? <>هر ۱ دلار ≈ <span className="num">{formatMoney(fx.rate, "IRT")}</span></> : "ثبت نشده"} · مبالغ تومانی ثبت‌شده، فریز زمان ثبت‌اند و با تغییر نرخ دلار تغییر نمی‌کنند (نمایش ≈، معادل دلاری لحظه‌ای است) · منبع داده: دفترکل دوطرفه — همان حقیقت حسابداری.
      </p>
    </div>
  );
}
