import Link from "next/link";
import type { ReactNode } from "react";
import { seedIfEmpty } from "@/db/seed";
import { ensureAuth } from "@/lib/authGuard";
import { getCashflow, getFlowByAccount } from "@/features/ledger/queries";
import { getFlowByCategory, type CategoryFlowRow } from "@/features/categories/service";
import { MISC_PARENT_CODE } from "@/features/categories/catalog";
import { EmptyState, Metric, PageHeader, Section, SectionLink } from "@/components/ui/Card";
import { BarsChart } from "@/components/charts/Charts";
import ModuleTabs, { MONEY_TABS } from "@/components/ui/ModuleTabs";
import { D, Decimal } from "@/domain/decimal";
import { monthToman, windowToman } from "@/lib/cashflowToman";
import {
  faCount,
  formatMoney,
  formatPct,
  formatSignedMoney,
  inflowTone,
  outflowTone,
  toJalali,
  trendTone,
  usdToIrt,
} from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export const metadata = { title: "جریان نقدی" };

const FA_MONTHS = ["", "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

/* ──────────────────────────────────────────────────────────────────────────
   FROZEN-TOMAN RULE (Global System Directive §1 — «مانده تومانی = داده
   قطعی و ثابت»):

   The Toman amount of a RECORDED past transaction is rendered ONLY from its
   commit-time freeze (`entry_fx_snapshots.irt_amount`). A change of the dollar
   rate can NEVER move a rendered frozen Toman figure — the dynamic equivalent
   (USD × current rate) is used only where no freeze exists at all.

   A Toman aggregate is "frozen" only when EVERY underlying entry carries its
   snapshot (full coverage). A partial cover would understate the total, so
   the UI then falls back to the dynamic current-rate view.
   ────────────────────────────────────────────────────────────────────────── */
const isFrozenCover = (entries: number, withSnap: number) => entries > 0 && entries === withSnap;

type FlowRow = {
  code: string;
  name: string;
  total: string;
  totalToman?: string | null;
  entries?: number;
  entriesWithSnap?: number;
};

/**
 * Raw (unformatted) Toman of one breakdown line: the freeze under full
 * coverage, otherwise USD × rate. The old code passed an ALREADY-FORMATTED
 * «… تومان» string back into the money formatter on that dynamic path.
 */
function lineToman(row: { total: string; totalToman?: string | null; entries?: number; entriesWithSnap?: number }, rate: string | null) {
  if (isFrozenCover(row.entries ?? 0, row.entriesWithSnap ?? 0) && row.totalToman != null && D(row.totalToman).gt(0)) {
    return D(row.totalToman).toFixed(0);
  }
  return rate ? usdToIrt(row.total, rate) : null;
}

/** Total of a breakdown: frozen only when every line is frozen, else dynamic. */
function totalLabel(rows: FlowRow[], rate: string | null) {
  const usd = Decimal.sum(rows.map((r) => r.total));
  const allFrozen =
    rows.length > 0 &&
    rows.every((r) => isFrozenCover(r.entries ?? 0, r.entriesWithSnap ?? 0) && r.totalToman != null);
  if (allFrozen) return formatMoney(Decimal.sum(rows.map((r) => r.totalToman ?? "0")).toFixed(0), "IRT");
  return rate ? formatMoney(usdToIrt(usd.toString(), rate), "IRT") : formatMoney(usd.toString());
}

function BreakdownRow({
  name,
  share,
  toman,
  usd,
  color,
  extra,
  children,
}: {
  name: string;
  share: number;
  toman: string | null;
  usd: string;
  color: string;
  extra?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="breakdown-row">
      <div className="breakdown-head">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[length:var(--fs-sm)] font-medium">{name}</span>
          {extra}
        </span>
        <span className="flex shrink-0 items-baseline gap-2.5">
          <span className="muted num text-[length:var(--fs-xs)]" dir="rtl">
            {formatPct(share, 0)}
          </span>
          <span className="text-left">
            <span className="num block text-[length:var(--fs-sm)] font-semibold money-nowrap" dir="rtl">
              {toman ? formatMoney(toman, "IRT") : formatMoney(usd)}
            </span>
            {toman && (
              <span className="muted num block text-[length:var(--fs-xs)] money-nowrap" dir="rtl">
                ≈ {formatMoney(usd)}
              </span>
            )}
          </span>
        </span>
      </div>
      <div className="meter" aria-hidden="true">
        <i style={{ width: `${Math.min(100, Math.max(0, share))}%`, background: color }} />
      </div>
      {children}
    </li>
  );
}

const VISIBLE_LINES = 6;

function FlowList({ rows, color, rate, empty }: { rows: FlowRow[]; color: string; rate: string | null; empty: string }) {
  if (rows.length === 0) return <p className="card muted text-center text-[length:var(--fs-sm)]">{empty}</p>;
  const sum = Decimal.sum(rows.map((r) => r.total));
  const shown = rows.slice(0, VISIBLE_LINES);
  return (
    <div className="card breakdown">
      <ul>
        {shown.map((r) => (
          <BreakdownRow
            key={r.code}
            name={r.name}
            share={sum.isZero() ? 0 : D(r.total).div(sum).mul(100).toNumber()}
            toman={lineToman(r, rate)}
            usd={r.total}
            color={color}
          />
        ))}
      </ul>
      {rows.length > shown.length && <p className="breakdown-more">و {faCount(rows.length - shown.length)} مورد دیگر</p>}
    </div>
  );
}

/** Expense categories grouped under their parent — the tree the user files spending in. */
function categoryGroups(rows: CategoryFlowRow[], rate: string | null) {
  const groups = new Map<string, { name: string; parentId: string; total: Decimal; totalToman: Decimal; isMisc: boolean; leaves: CategoryFlowRow[] }>();
  for (const r of rows) {
    const key = r.parentId ?? r.categoryId;
    const g = groups.get(key) ?? { name: r.parentName ?? r.name, parentId: key, total: Decimal.zero(), totalToman: Decimal.zero(), isMisc: false, leaves: [] };
    g.total = g.total.add(r.total);
    g.totalToman = g.totalToman.add(r.totalToman);
    g.isMisc = g.isMisc || r.parentCode === MISC_PARENT_CODE;
    g.leaves.push(r);
    groups.set(key, g);
  }
  const sorted = [...groups.values()].sort((a, b) => Number(b.total.sub(a.total).toString()));
  const grand = sorted.reduce((s, g) => s.add(g.total), Decimal.zero());

  /** Frozen Toman of a group — only when every leaf entry is snapshot-covered. */
  const frozenOf = (g: { totalToman: Decimal; leaves: CategoryFlowRow[] }) =>
    g.leaves.length > 0 && g.leaves.every((l) => isFrozenCover(l.entries, l.entriesWithSnap)) ? g.totalToman.toFixed(0) : null;

  const allFrozen = sorted.length > 0 && sorted.every((g) => frozenOf(g) != null);
  const total = allFrozen
    ? formatMoney(sorted.reduce((s, g) => s.add(g.totalToman), Decimal.zero()).toFixed(0), "IRT")
    : rate
      ? formatMoney(usdToIrt(grand.toString(), rate), "IRT")
      : formatMoney(grand.toString());

  return {
    total,
    groups: sorted.map((g) => ({
      key: g.parentId,
      name: g.name,
      isMisc: g.isMisc,
      share: grand.isZero() ? 0 : g.total.div(grand).mul(100).toNumber(),
      usd: g.total.toString(),
      toman: frozenOf(g) ?? (rate ? usdToIrt(g.total.toString(), rate) : null),
      leaves: g.leaves
        .slice()
        .sort((a, b) => Number(D(b.total).sub(a.total).toString()))
        .map((l) => ({
          key: l.categoryId,
          name: l.name,
          nonCash: l.nature === "non_cash",
          label:
            isFrozenCover(l.entries, l.entriesWithSnap) && D(l.totalToman).gt(0)
              ? formatMoney(D(l.totalToman).toFixed(0), "IRT")
              : rate
                ? formatMoney(usdToIrt(l.total, rate), "IRT")
                : formatMoney(l.total),
        })),
    })),
  };
}

export default async function CashFlowPage() {
  await ensureAuth();
  await seedIfEmpty();
  const [flow, expenses, incomes, fx, categoryFlows, incomeCategoryFlows] = await Promise.all([
    getCashflow(12),
    getFlowByAccount("expense", 6),
    getFlowByAccount("income", 6),
    getLatestUsdIrtRate(),
    getFlowByCategory(6),
    getFlowByCategory(6, undefined, "income"),
  ]);
  const rate = fx.rate && D(fx.rate).gt(0) ? String(fx.rate) : null;

  // KPIs — Toman under the shared frozen-Toman rule. Every tone is taken from
  // the figure that is printed, never from its USD twin.
  const monthRow = flow.at(-1);
  const month = monthToman(monthRow, rate);
  const year = windowToman(flow, rate);
  const monthInflow = month?.inflow ?? monthRow?.inflow ?? "0";
  const monthOutflow = month?.outflow ?? monthRow?.outflow ?? "0";
  const monthNet = month?.net ?? D(monthInflow).sub(monthOutflow).toString();
  const unit = month ? "IRT" : monthRow ? "USD" : "IRT";
  const yearNet = year?.net ?? Decimal.sum(flow.map((f) => f.inflow)).sub(Decimal.sum(flow.map((f) => f.outflow))).toString();
  const savingsRate = D(monthInflow).gt(0) ? D(monthNet).div(monthInflow).mul(100).toFixed(0) : null;

  const flowToman = flow.map((f) => monthToman(f, rate));
  const barsInToman = flowToman.length > 0 && flowToman.every((m) => m != null);

  const categories = categoryGroups(categoryFlows, rate);
  const incomeSources = categoryGroups(incomeCategoryFlows, rate);
  const noData =
    flow.length === 0 && expenses.length === 0 && incomes.length === 0 && categoryFlows.length === 0 && incomeCategoryFlows.length === 0;

  return (
    <div className="space-y-7">
      <div>
        <PageHeader title="جریان نقدی" action={<SectionLink href="/planning" label="پیش‌بینی" />} />
        <ModuleTabs tabs={MONEY_TABS} active="/cash-flow" label="بخش‌های پول" />
      </div>

      <section className="metric-strip">
        <Metric label="درآمد این ماه" value={formatMoney(monthInflow, unit)} tone={inflowTone(monthInflow)} />
        <Metric label="هزینه این ماه" value={formatMoney(monthOutflow, unit)} tone={outflowTone(monthOutflow)} />
        <Metric
          label="خالص این ماه"
          value={formatSignedMoney(monthNet, unit)}
          tone={trendTone(monthNet)}
          hint={savingsRate != null ? `نرخ پس‌انداز ${formatPct(savingsRate, 0)}` : undefined}
        />
        <Metric label="خالص ۱۲ ماه" value={formatSignedMoney(yearNet, year ? "IRT" : "USD")} tone={trendTone(yearNet)} />
      </section>

      {noData ? (
        <div className="card">
          <EmptyState
            icon="cashflow"
            title="هنوز درآمد یا هزینه‌ای ثبت نشده است"
            action={
              <Link href="/new?type=expense" className="btn btn-soft">
                ثبت هزینه
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <Section title="درآمد و هزینه" action={<span className="muted text-[length:var(--fs-xs)]">۱۲ ماه اخیر</span>}>
            <div className="card p-3 sm:p-4">
              <BarsChart
                height={160}
                currency={barsInToman ? "IRT" : "USD"}
                data={flow.map((f, i) => ({
                  label: FA_MONTHS[toJalali(f.month).m],
                  positive: Number(barsInToman ? flowToman[i]!.inflow : f.inflow),
                  negative: Number(barsInToman ? flowToman[i]!.outflow : f.outflow),
                }))}
              />
              {rate && (
                <p className="muted mt-2 text-[length:var(--fs-xs)]">
                  هر دلار ≈{" "}
                  <span className="num" dir="rtl">
                    {formatMoney(rate, "IRT")}
                  </span>
                </p>
              )}
            </div>
          </Section>

          <div className="grid items-start gap-7 lg:grid-cols-2">
            <Section
              title="هزینه‌های ۶ ماه اخیر"
              action={
                <span className="muted num text-[length:var(--fs-xs)]" dir="rtl">
                  {categoryFlows.length > 0 ? categories.total : totalLabel(expenses, rate)}
                </span>
              }
            >
              {categoryFlows.length > 0 ? (
                <div className="card breakdown">
                  <ul>
                    {categories.groups.map((g) => (
                      <BreakdownRow
                        key={g.key}
                        name={g.name}
                        share={g.share}
                        toman={g.toman}
                        usd={g.usd}
                        color="var(--negative)"
                        extra={
                          g.isMisc ? (
                            <Link href={`/transactions?category=${g.key}`} className="badge badge-warn">
                              بررسی
                            </Link>
                          ) : undefined
                        }
                      >
                        {(g.leaves.length > 1 || g.leaves.some((l) => l.nonCash)) && (
                          <ul className="breakdown-leaves">
                            {g.leaves.map((l) => (
                              <li key={l.key} className="flex items-center justify-between gap-2">
                                <span className="min-w-0 truncate">
                                  {l.name}
                                  {l.nonCash && <span className="badge badge-neutral ms-1.5">غیرنقدی</span>}
                                </span>
                                <span className="num shrink-0 money-nowrap" dir="rtl">
                                  {l.label}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </BreakdownRow>
                    ))}
                  </ul>
                </div>
              ) : (
                <FlowList rows={expenses} color="var(--negative)" rate={rate} empty="هزینه‌ای ثبت نشده است" />
              )}
            </Section>

            <Section
              title="درآمدهای ۶ ماه اخیر"
              action={
                incomeCategoryFlows.length > 0 || incomes.length > 0 ? (
                  <span className="muted num text-[length:var(--fs-xs)]" dir="rtl">
                    {incomeCategoryFlows.length > 0 ? incomeSources.total : totalLabel(incomes, rate)}
                  </span>
                ) : undefined
              }
            >
              {incomeCategoryFlows.length > 0 ? (
                <div className="card breakdown">
                  <ul>
                    {incomeSources.groups.map((g) => (
                      <BreakdownRow key={g.key} name={g.name} share={g.share} toman={g.toman} usd={g.usd} color="var(--positive)">
                        {g.leaves.length > 1 && (
                          <ul className="breakdown-leaves">
                            {g.leaves.map((l) => (
                              <li key={l.key} className="flex items-center justify-between gap-2">
                                <span className="min-w-0 truncate">{l.name}</span>
                                <span className="num shrink-0 money-nowrap" dir="rtl">
                                  {l.label}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </BreakdownRow>
                    ))}
                  </ul>
                </div>
              ) : (
                <FlowList rows={incomes} color="var(--positive)" rate={rate} empty="درآمدی ثبت نشده است" />
              )}
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
