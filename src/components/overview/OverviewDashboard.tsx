import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import { countUnreviewed, getCashflow, getSnapshotSeries, getRecent, type TxRow } from "@/features/ledger/queries";
import { getEntryFxSnapshots, type EntryFxSnapshot } from "@/features/ledger/fxSnapshots";
import { projectCashflow, upcomingInstallments } from "@/features/planning/service";
import { getSetupState } from "@/features/setup/service";
import { getCurrentNetWorth } from "@/features/portfolio/service";
import { ActionItem, Alert, EmptyState, Metric, Section, SectionLink } from "@/components/ui/Card";
import { AreaChart, BarsChart } from "@/components/charts/Charts";
import Icon from "@/components/ui/Icon";
import AllocationBar from "@/components/assets/AllocationBar";
import FlowIcon from "@/components/transactions/FlowIcon";
import { humanizeEntry, moneyFlowLabel, txAmountLabel } from "@/lib/tx";
import { monthToman } from "@/lib/cashflowToman";
import { D, Decimal } from "@/domain/decimal";
import {
  faCount,
  formatDaysUntil,
  formatMoney,
  formatPct,
  formatShortDate,
  formatSignedMoney,
  inflowTone,
  outflowTone,
  toJalali,
  toneColor,
  trendArrow,
  trendTone,
  usdToIrt,
} from "@/lib/format";
import { getLatestUsdIrtRateForUser } from "@/lib/fx";
import { listDueIncomePlans, type IncomePlan } from "@/features/income/service";
import { recordPlannedIncomeFormAction, skipPlannedIncomeFormAction } from "@/app/actions/income";
import { currencyLabel, formatQty } from "@/lib/format";
import { listTemplates, quickActionUsage, type TemplateRow } from "@/features/templates/service";
import ShortcutChips from "@/components/overview/ShortcutChips";
import CoverageRing from "@/components/ui/CoverageRing";
import { dataCoverage, type Coverage } from "@/features/coverage/service";

export const dynamic = "force-dynamic";

const QUICK = [
  { href: "/new?type=expense", label: "هزینه", icon: "arrow-down" as const },
  { href: "/new?type=income", label: "درآمد", icon: "arrow-up" as const },
  { href: "/new?type=transfer", label: "انتقال", icon: "swap" as const },
  { href: "/new?type=buy", label: "خرید دارایی", short: "خرید", icon: "plus" as const },
  { href: "/new?type=sell", label: "فروش دارایی", short: "فروش", icon: "arrow-down" as const },
];

const FA_MONTHS = ["", "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

function daysUntil(iso: string) {
  return Math.ceil((new Date(iso + "T00:00:00Z").getTime() - Date.now()) / 86_400_000);
}

type CashflowRows = Awaited<ReturnType<typeof getCashflow>>;
type InstallmentRows = Awaited<ReturnType<typeof upcomingInstallments>>;

function RecentActivity({ rows, frozen, rate }: { rows: TxRow[]; frozen: Map<string, EntryFxSnapshot>; rate: string }) {
  if (rows.length === 0) {
    return <p className="card muted text-center text-[length:var(--fs-sm)]">هنوز تراکنشی ثبت نشده است</p>;
  }
  return (
    <ul className="card list-card" role="list">
      {rows.map((e) => {
        const h = humanizeEntry(e);
        const flow = moneyFlowLabel(h.from, h.to);
        return (
          <li key={e.id} className="list-row">
            <FlowIcon sign={h.sign} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[length:var(--fs-sm)] font-medium">{e.description}</p>
              <p className="muted truncate text-[length:var(--fs-xs)]">
                {formatShortDate(e.entryDate)} · {flow ?? h.typeLabel}
              </p>
            </div>
            <span
              className="num shrink-0 text-[length:var(--fs-sm)] font-semibold money-nowrap"
              dir="rtl"
              style={h.sign > 0 ? { color: "var(--positive)" } : undefined}
            >
              {txAmountLabel(h, frozen.get(e.id)?.irtAmount, rate)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default async function OverviewDashboard() {
  const user = await ensureAuth();
  await seedIfEmpty();

  const userId = (user as { id?: string } | null)?.id;

  const nw = await getCurrentNetWorth(userId);
  const unavailableWidgets: string[] = [];
  const optionalRead = async <T,>(widget: string, fallback: T, read: () => Promise<T>): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      unavailableWidgets.push(widget);
      console.error(`[overview] ${widget} could not be loaded`, error);
      return fallback;
    }
  };

  const [setupState, snaps, tx, insts, flow, projection, unreviewed, fx] = await Promise.all([
    optionalRead("setup state", { completed: false, currentStep: 1 }, () => getSetupState(userId)),
    optionalRead("net-worth history", [], () => getSnapshotSeries(40, userId)),
    optionalRead("recent activity", [], () => getRecent(6, userId)),
    optionalRead("upcoming installments", [] as InstallmentRows, () => upcomingInstallments(3, userId)),
    optionalRead("cash flow", [] as CashflowRows, () => getCashflow(6, userId)),
    optionalRead("cash-flow projection", { startingLiquidity: "0", netWorth: "0", startingLiquidityToman: "0", netWorthToman: "0", startingLiquidityUsd: "0", netWorthUsd: "0", points: [], scenario: "base" as const, unit: "IRT" as const }, () => projectCashflow(6, "base", userId)),
    optionalRead("unreviewed transactions", 0, () => countUnreviewed(userId)),
    optionalRead("exchange rate", { rate: "", effectiveDate: "", source: "unavailable" }, () => getLatestUsdIrtRateForUser(userId)),
  ]);
  // The recent rows show their frozen commit-time Toman, exactly like the
  // transactions page — not a current-rate guess.
  const frozenByEntry = await optionalRead("recent activity", new Map<string, EntryFxSnapshot>(), () =>
    getEntryFxSnapshots(tx.map((e) => e.id)),
  );

  // Saved shortcuts, and the quick actions in the order the user reaches for them.
  const [templates, usage] = userId
    ? await Promise.all([
        optionalRead("shortcuts", [] as TemplateRow[], () => listTemplates(userId)),
        optionalRead("shortcuts", {} as Record<string, number>, () => quickActionUsage(userId)),
      ])
    : [[] as TemplateRow[], {} as Record<string, number>];
  const quick = QUICK.map((q, i) => ({ q, i, n: usage[new URLSearchParams(q.href.split("?")[1]).get("type") ?? ""] ?? 0 }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.q);

  // Recurring incomes due within three days (or overdue) — recorded only on a tap.
  const dueIncome = userId
    ? await optionalRead("recurring income", [] as IncomePlan[], () => listDueIncomePlans(userId))
    : [];

  const rate = fx.rate && D(fx.rate).gt(0) ? fx.rate : "";
  const staleCount = nw.valuation.priceStatus.stale + nw.valuation.priceStatus.unavailable;
  // How complete and current the books are — shown only while something is missing.
  const coverage = userId
    ? await optionalRead("data coverage", null as Coverage | null, () => dataCoverage(userId, { stalePrices: staleCount }))
    : null;

  const series = [...snaps]
    .reverse()
    .map((s) => ({ date: s.asOf, value: Number(s.netWorth) }))
    .concat([{ date: new Date().toISOString().slice(0, 10), value: Number(nw.netWorth) }]);

  // Snapshots are stored in USD, so the change is stated as a DOLLAR change,
  // next to the dollar equivalent — never glued onto the Toman headline.
  const lastSnap = snaps[0];
  const deltaUsd = lastSnap ? D(nw.netWorth).sub(lastSnap.netWorth) : null;
  const deltaPct =
    deltaUsd && lastSnap && !D(lastSnap.netWorth).isZero()
      ? deltaUsd.div(D(lastSnap.netWorth).abs()).mul(100).toFixed(1)
      : null;

  // This month — Toman under the shared frozen-Toman rule, and every colour is
  // taken from the figure that is actually printed (a Toman gain is never red
  // because its USD equivalent fell).
  const monthRow = flow.at(-1);
  const month = monthToman(monthRow, rate);
  const monthInflow = month ? formatMoney(month.inflow, "IRT") : formatMoney(monthRow?.inflow ?? 0);
  const monthOutflow = month ? formatMoney(month.outflow, "IRT") : formatMoney(monthRow?.outflow ?? 0);
  const monthNetValue = month ? month.net : D(monthRow?.inflow ?? 0).sub(monthRow?.outflow ?? 0).toString();
  const monthNet = formatSignedMoney(monthNetValue, month ? "IRT" : "USD");
  const flowToman = flow.map((f) => monthToman(f, rate));
  const barsInToman = flowToman.length > 0 && flowToman.every((m) => m != null);
  const nextDeficit = projection.points.find((p) => p.deficit);

  const attention: { icon: "alert" | "clock" | "refresh" | "check"; tone: "warn" | "neg" | "info" | "pos"; text: string; detail?: string; href: string; action: string }[] = [];
  if (unreviewed > 0)
    attention.push({
      icon: "check",
      tone: "warn",
      text: `${faCount(unreviewed)} تراکنش بررسی‌نشده`,
      href: "/transactions?review=unreviewed",
      action: "بررسی",
    });
  const soonInst = insts.find((i) => daysUntil(i.dueDate) <= 14);
  if (soonInst) {
    const d = daysUntil(soonInst.dueDate);
    // amountToman is contractual (authoritative). Never rebuild Toman from USD×rate.
    const contractual = (soonInst as { amountToman?: string | number | null }).amountToman;
    const instToman = contractual != null ? String(contractual) : rate ? usdToIrt(soonInst.amountBase, rate) : null;
    attention.push({
      icon: "clock",
      tone: d < 0 ? "neg" : "info",
      text: `قسط ${faCount(soonInst.seq)} «${soonInst.debtTitle}» · ${formatDaysUntil(d)}`,
      detail: instToman ? formatMoney(instToman, "IRT") : undefined,
      href: "/debts/installments",
      action: "مشاهده",
    });
  }
  if (nextDeficit)
    attention.push({
      icon: "alert",
      tone: "neg",
      text: "کسری نقدینگی در راه است",
      detail: `از ${formatShortDate(nextDeficit.month)}`,
      href: "/planning",
      action: "پیش‌بینی",
    });
  if (staleCount > 0)
    attention.push({
      icon: "refresh",
      tone: "warn",
      text: `قیمت ${faCount(staleCount)} دارایی به‌روز نیست`,
      href: "/portfolio",
      action: "مشاهده",
    });

  const hasAnything = !D(nw.totalAssets).isZero();
  // Receivables surface only for a user who has one. The figure comes from the
  // backend, already direction-filtered.
  const receivableToman = nw.totalReceivableToman ?? "0";
  const hasReceivables = D(receivableToman).gt(0);

  // «کل بدهی‌ها» is `totalDebt*` — ledger liabilities AND planning debts, the
  // same figure «تعهدات مالی» shows. «کل مطالبات» is never netted against it
  // and is not part of net worth.
  // Debts carry the negative colour so they never read like an asset figure;
  // a zero debt stays neutral.
  const tiles: { label: string; toman: string; usd: string; tone?: "up" | "down" }[] = [
    { label: "کل دارایی‌ها", toman: nw.totalAssetsToman, usd: nw.totalAssets },
    {
      label: "کل بدهی‌ها",
      toman: nw.totalDebtToman,
      usd: nw.totalDebtUsd,
      tone: D(nw.totalDebtToman ?? "0").isZero() ? undefined : "down",
    },
    ...(hasReceivables
      ? [{ label: "کل مطالبات", toman: receivableToman, usd: nw.totalReceivableUsd ?? "0", tone: "up" as const }]
      : []),
    { label: "نقدشونده", toman: nw.liquidToman, usd: nw.liquid },
  ];

  // Per-class Toman from the valuation rows (the class aggregate is USD only).
  const tomanByClass = new Map<string, Decimal>();
  for (const a of nw.valuation.assetValuations) {
    tomanByClass.set(a.className, (tomanByClass.get(a.className) ?? Decimal.zero()).add(D(a.currentValueToman)));
  }
  const slices = nw.byClass.map((c) => {
    const toman = tomanByClass.get(c.className);
    return {
      key: c.className,
      label: c.className,
      percent: Number(c.share),
      color: c.color,
      value: toman ? formatMoney(toman.toFixed(0), "IRT") : formatMoney(c.value),
    };
  });

  return (
    <div className="space-y-7">
      {unavailableWidgets.length > 0 && (
        <Alert tone="warn" icon="alert" title="بخشی از داده‌ها بارگذاری نشد — چند لحظه بعد تازه‌سازی کنید" />
      )}
      {!setupState.completed && (
        <Alert
          tone="brand"
          icon="info"
          title="راه‌اندازی اولیه کامل نشده است"
          action={
            <Link href="/setup" className="btn btn-soft !px-4 text-[length:var(--fs-xs)]">
              شروع
            </Link>
          }
        />
      )}

      <section className="overview-hero">
        <div className="min-w-0">
          <p className="muted text-[length:var(--fs-xs)] font-medium">ارزش خالص</p>
          <p className="overview-hero-value num money-nowrap" dir="rtl">
            {nw.netWorthToman ? formatMoney(nw.netWorthToman, "IRT") : formatMoney(nw.netWorth)}
          </p>
          <p className="overview-hero-sub">
            <span className="num money-nowrap" dir="rtl">
              ≈ {formatMoney(nw.netWorth)}
            </span>
            {deltaUsd && deltaPct != null && lastSnap && (
              <span className="money-nowrap" title="تغییر ارزش دلاری نسبت به آخرین ثبت">
                <span className="num font-semibold" dir="rtl" style={{ color: toneColor(trendTone(deltaUsd.toString())) }}>
                  {trendArrow(deltaUsd.toString())} {formatPct(D(deltaPct).abs().toString(), 1)}
                </span>{" "}
                از {formatShortDate(lastSnap.asOf)}
              </span>
            )}
          </p>
        </div>
        <nav className="quick-row" aria-label="ثبت سریع">
          {quick.map((q) => (
            <Link key={q.href} href={q.href} className="quick-pill" aria-label={q.label}>
              <Icon name={q.icon} size={14} />
              {"short" in q ? (
                <>
                  <span className="quick-full">{q.label}</span>
                  <span className="quick-short" aria-hidden="true">{q.short}</span>
                </>
              ) : (
                q.label
              )}
            </Link>
          ))}
        </nav>
        <ShortcutChips
          items={templates.map((t) => ({
            id: t.id,
            label: t.label,
            type: t.type,
            amountLabel: t.amountToman ? formatMoney(t.amountToman, "IRT") : null,
          }))}
        />
      </section>

      <section className="metric-strip">
        {tiles.map((t) => (
          <Metric
            key={t.label}
            label={t.label}
            value={formatMoney(D(t.toman).abs().toString(), "IRT")}
            tone={t.tone ?? "neutral"}
            hint={`≈ ${formatMoney(D(t.usd).abs().toString())}`}
          />
        ))}
      </section>

      {coverage && coverage.percent < 100 && (
        <Link href="/insights#data-coverage" className="coverage-strip">
          <CoverageRing percent={coverage.percent} size={40} />
          <span className="min-w-0 flex-1">
            <b className="block text-[length:var(--fs-sm)]">پوشش داده {coverage.percent.toLocaleString("fa-IR")}٪</b>
            <span className="muted block truncate text-[length:var(--fs-xs)]">
              {coverage.checks.find((c) => !c.ok)?.detail ?? "چند مورد کامل نیست"}
            </span>
          </span>
          <Icon name="chevronLeft" size={15} />
        </Link>
      )}

      {hasAnything && attention.length > 0 && (
        <Section title="نیاز به توجه">
          <ul className="list-none" role="list">
            {attention.map((a) => (
              <ActionItem
                key={`${a.href}-${a.text}`}
                icon={a.icon}
                tone={a.tone}
                text={a.text}
                detail={a.detail}
                href={a.href}
                action={a.action}
              />
            ))}
          </ul>
        </Section>
      )}

      {dueIncome.length > 0 && (
        <Section title="درآمدهای پیش‌رو" action={<SectionLink href="/new?type=income" label="ثبت درآمد" />}>
          <ul className="card list-card" role="list">
            {dueIncome.map((plan) => {
              const d = daysUntil(plan.plannedDate);
              const isToman = plan.symbol === "IRT" || plan.symbol === "IRR";
              return (
                <li key={plan.id} className="list-row flex-wrap">
                  <span className="flow-icon is-in" aria-hidden="true">
                    <Icon name="arrow-up" size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[length:var(--fs-sm)] font-medium">{plan.title}</p>
                    <p className="muted truncate text-[length:var(--fs-xs)]">
                      {plan.categoryName} · {plan.accountName} · {formatDaysUntil(d)}
                    </p>
                  </div>
                  <span className="num shrink-0 text-[length:var(--fs-sm)] font-semibold money-nowrap" dir="rtl" style={{ color: "var(--positive)" }}>
                    {isToman ? formatMoney(D(plan.amountNative).toFixed(0), "IRT") : `${formatQty(plan.amountNative, 6)} ${currencyLabel(plan.symbol)}`}
                  </span>
                  <div className="flex w-full flex-wrap justify-end gap-2">
                    <form action={recordPlannedIncomeFormAction}>
                      <input type="hidden" name="planId" value={plan.id} />
                      <button className="btn btn-primary !min-h-9 !px-3 text-[length:var(--fs-xs)]">ثبت دریافت</button>
                    </form>
                    <Link href={`/new?type=income&planId=${plan.id}`} className="btn btn-ghost !min-h-9 !px-3 text-[length:var(--fs-xs)]">
                      ویرایش مبلغ
                    </Link>
                    <form action={skipPlannedIncomeFormAction}>
                      <input type="hidden" name="planId" value={plan.id} />
                      <button className="btn btn-ghost !min-h-9 !px-3 text-[length:var(--fs-xs)]">این ماه دریافت نشد</button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {!hasAnything ? (
        <div className="card">
          <EmptyState
            icon="networth"
            title="هنوز دارایی‌ای ثبت نشده است"
            action={
              <Link href="/setup" className="btn btn-primary">
                شروع راه‌اندازی
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <Section title="روند ارزش خالص (دلاری)" action={<SectionLink href="/net-worth" label="تحلیل" />}>
              <div className="card p-3 sm:p-4">
                <AreaChart data={series} />
              </div>
            </Section>

            <Section title="این ماه" action={<SectionLink href="/cash-flow" label="جریان نقدی" />}>
              <div className="card p-3 sm:p-4">
                <dl className="month-figures">
                  <div>
                    <dt>درآمد</dt>
                    <dd className="num money-nowrap" dir="rtl" style={{ color: toneColor(inflowTone(month?.inflow ?? monthRow?.inflow ?? 0)) }}>
                      {monthInflow}
                    </dd>
                  </div>
                  <div>
                    <dt>هزینه</dt>
                    <dd className="num money-nowrap" dir="rtl" style={{ color: toneColor(outflowTone(month?.outflow ?? monthRow?.outflow ?? 0)) }}>
                      {monthOutflow}
                    </dd>
                  </div>
                  <div>
                    <dt>خالص</dt>
                    <dd className="num money-nowrap" dir="rtl" style={{ color: toneColor(trendTone(monthNetValue)) }}>
                      {monthNet}
                    </dd>
                  </div>
                </dl>
                <BarsChart
                  height={120}
                  currency={barsInToman ? "IRT" : "USD"}
                  data={flow.map((f, i) => ({
                    label: FA_MONTHS[toJalali(f.month).m],
                    positive: Number(barsInToman ? flowToman[i]!.inflow : f.inflow),
                    negative: Number(barsInToman ? flowToman[i]!.outflow : f.outflow),
                  }))}
                />
              </div>
            </Section>
          </div>

          <div className="grid items-start gap-7 lg:grid-cols-2">
            {slices.length > 0 && (
              <Section title="ترکیب دارایی‌ها" action={<SectionLink href="/assets" label="دارایی‌ها" />}>
                <AllocationBar slices={slices} label="ترکیب دارایی‌ها بر اساس کلاس" />
              </Section>
            )}

            <Section title="پرداخت‌های پیش‌رو" action={<SectionLink href="/debts/installments" label="اقساط" />}>
              {insts.length === 0 ? (
                <p className="card muted text-center text-[length:var(--fs-sm)]">پرداختی در راه نیست</p>
              ) : (
                <ul className="card list-card" role="list">
                  {insts.map((i) => {
                    const d = daysUntil(i.dueDate);
                    const contractual = (i as { amountToman?: string | number | null }).amountToman;
                    const toman = contractual != null ? String(contractual) : rate ? usdToIrt(i.amountBase, rate) : null;
                    return (
                      <li key={i.id} className="list-row">
                        <span className="flow-icon" aria-hidden="true">
                          <Icon name="calendar" size={15} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[length:var(--fs-sm)] font-medium">{i.debtTitle}</p>
                          <p className="muted truncate text-[length:var(--fs-xs)]">
                            قسط {faCount(i.seq)} ·{" "}
                            <span style={d < 0 ? { color: "var(--negative)" } : undefined}>{formatDaysUntil(d)}</span>
                          </p>
                        </div>
                        <span className="num shrink-0 text-[length:var(--fs-sm)] font-semibold money-nowrap" dir="rtl">
                          {toman ? formatMoney(toman, "IRT") : formatMoney(i.amountBase)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          </div>

          <Section title="فعالیت اخیر" action={<SectionLink href="/transactions" label="همه تراکنش‌ها" />}>
            <RecentActivity rows={tx} frozen={frozenByEntry} rate={rate} />
          </Section>
        </>
      )}
    </div>
  );
}
