import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import {
  countUnreviewed,
  getCashflow,
  getSnapshotSeries,
  getRecent,
} from "@/features/ledger/queries";
import { projectCashflow, upcomingInstallments } from "@/features/planning/service";
import { getSetupState } from "@/features/setup/service";
import { Alert, Delta, EmptyState, Section, SectionLink } from "@/components/ui/Card";
import { AreaChart, BarsChart, Donut } from "@/components/charts/Charts";
import Icon from "@/components/ui/Icon";
import { humanizeEntry, moneyFlowLabel } from "@/lib/tx";
import { D } from "@/domain/decimal";
import {
  formatMoney,
  formatPct,
  formatShortDate,
  formatSignedMoney,
  toJalali,
  faCount,
  inflowTone,
  outflowTone,
  toneColor,
  trendColor,
  usdToIrt,
  irtToUsd,
} from "@/lib/format";
import { getLatestUsdIrtRateForUser } from "@/lib/fx";
import { getCurrentNetWorth } from "@/features/portfolio/service";

export const dynamic = "force-dynamic";

const QUICK = [
  { href: "/new?type=expense", label: "هزینه", icon: "arrow-down" as const },
  { href: "/new?type=income", label: "درآمد", icon: "arrow-up" as const },
  { href: "/new?type=transfer", label: "انتقال", icon: "swap" as const },
  { href: "/new?type=buy", label: "خرید دارایی", icon: "plus" as const },
  { href: "/new?type=sell", label: "فروش دارایی", icon: "arrow-down" as const },
];

function daysUntil(iso: string) {
  return Math.ceil((new Date(iso + "T00:00:00Z").getTime() - Date.now()) / 86_400_000);
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
    optionalRead("upcoming installments", [], () => upcomingInstallments(3, userId)),
    optionalRead("cash flow", [], () => getCashflow(6, userId)),
    optionalRead("cash-flow projection", { startingLiquidity: "0", netWorth: "0", startingLiquidityToman: "0", netWorthToman: "0", startingLiquidityUsd: "0", netWorthUsd: "0", points: [], scenario: "base" as const, unit: "IRT" as const }, () => projectCashflow(6, "base", userId)),
    optionalRead("unreviewed transactions", 0, () => countUnreviewed(userId)),
    optionalRead("exchange rate", { rate: "", effectiveDate: "", source: "unavailable" }, () => getLatestUsdIrtRateForUser(userId)),
  ]);

  const staleCount = nw.valuation.priceStatus.stale + nw.valuation.priceStatus.unavailable;
  const rate = fx.rate && D(fx.rate).gt(0) ? fx.rate : "";
  const toIrt = (usd: string | number) => (rate ? usdToIrt(usd, rate) : null);
  const toUsd = (irt: string | number) => (rate ? irtToUsd(irt, rate) : null);

  const series = [...snaps]
    .reverse()
    .map((s) => ({ date: s.asOf, value: Number(s.netWorth) }))
    .concat([{ date: new Date().toISOString().slice(0, 10), value: Number(nw.netWorth) }]);

  const lastSnap = snaps[0];
  const deltaAbs = lastSnap ? D(nw.netWorth).sub(lastSnap.netWorth).toString() : "0";
  const deltaPct = lastSnap && !D(lastSnap.netWorth).isZero()
    ? D(deltaAbs).div(lastSnap.netWorth).abs().mul(100).toFixed(2)
    : null;

  const monthFlow = flow.at(-1) as any;
  const monthInflowToman = monthFlow?.inflowToman && D(monthFlow.inflowToman).gt(0) ? monthFlow.inflowToman : toIrt(monthFlow?.inflow ?? 0);
  const monthOutflowToman = monthFlow?.outflowToman && D(monthFlow.outflowToman).gt(0) ? monthFlow.outflowToman : toIrt(monthFlow?.outflow ?? 0);
  const monthNetToman = monthInflowToman && monthOutflowToman ? D(monthInflowToman).sub(monthOutflowToman).toString() : toIrt((Number(monthFlow?.inflow ?? 0) - Number(monthFlow?.outflow ?? 0)).toString());
  const netMonthUsd = monthFlow ? Number(monthFlow.inflow) - Number(monthFlow.outflow) : 0;
  const nextDeficit = projection.points.find((p) => p.deficit);

  const attention: { icon: "alert" | "clock" | "refresh" | "check"; tone: "warn" | "neg" | "info" | "pos"; text: string; detail: string; href: string; action: string }[] = [];
  if (unreviewed > 0)
    attention.push({
      icon: "check",
      tone: "warn",
      text: `${faCount(unreviewed)} تراکنش بررسی‌نشده`,
      detail: "قبل از اعتماد به گزارش‌ها، این رکوردها را تأیید کنید.",
      href: "/transactions?review=unreviewed",
      action: "بررسی",
    });
  const soonInst = insts.find((i) => daysUntil(i.dueDate) <= 14);
  if (soonInst) {
    const d = daysUntil(soonInst.dueDate);
    // amountToman is contractual (authoritative). Never rebuild Toman from USD×rate.
    const instToman =
      (soonInst as any).amountToman != null
        ? String((soonInst as any).amountToman)
        : toIrt(soonInst.amountBase);
    attention.push({
      icon: "clock",
      tone: d < 0 ? "neg" : "info",
      text: d < 0 ? `قسط ${faCount(soonInst.seq)} «${soonInst.debtTitle}» سررسید گذشته است` : `قسط ${faCount(soonInst.seq)} «${soonInst.debtTitle}» ${d === 0 ? "امروز" : `${faCount(d)} روز دیگر`} سر می‌رسد`,
      detail: `${instToman ? formatMoney(instToman, "IRT") : "—"} — ${soonInst.creditor}`,
      href: "/installments",
      action: "مشاهده",
    });
  }
  if (nextDeficit)
    attention.push({
      icon: "alert",
      tone: "neg",
      text: `کسری نقدینگی در راه است`,
      detail: `اگر برنامه‌ها همان‌طور اجرا شوند، در ${formatShortDate(nextDeficit.month)} نقدینگی شما منفی می‌شود.`,
      href: "/planning",
      action: "دیدن پیش‌بینی",
    });
  if (staleCount > 0)
    attention.push({
      icon: "refresh",
      tone: "warn",
      text: `${faCount(staleCount)} دارایی قیمت تازه ندارد`,
      detail: "ارزش‌گذاری این دارایی‌ها ممکن است قدیمی باشد.",
      href: "/portfolio",
      action: "تحلیل",
    });

  const hasAnything = !D(nw.totalAssets).isZero();

  return (
    <div className="space-y-6 sm:space-y-8">
      {unavailableWidgets.length > 0 && (
        <Alert tone="warn" icon="alert" title="بخشی از نمای کلی فعلاً در دسترس نیست">
          اطلاعات اصلی دارایی‌های شما نمایش داده می‌شود، اما برخی کارت‌ها بارگذاری نشدند. این موضوع هیچ تغییری در دفترکل شما ایجاد نکرده است؛ چند لحظه دیگر صفحه را تازه‌سازی کنید.
        </Alert>
      )}
      {!setupState.completed && (
        <Alert
          tone="brand"
          icon="info"
          title="راه‌اندازی اولیه انجام نشده است"
          action={
            <Link href="/setup" className="btn btn-primary !min-h-9 !px-4 !py-1.5 text-xs">
              شروع راه‌اندازی
            </Link>
          }
        >
          ارز پایه، حساب‌های اصلی و موجودی اولیه را پیکربندی کنید تا اعداد دقیق شوند.
        </Alert>
      )}

      {/* ═══ HERO — compact, tidy, no huge fonts on mobile PWA ═══ */}
      <section className="pt-1">
        <div className="flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-x-8 sm:gap-y-6">
          <div className="min-w-0 flex-1">
            <p className="muted text-[11px] font-medium">ارزش خالص دارایی</p>
            <div className="mt-1.5 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3 sm:gap-y-2">
              <span className="money-hero text-[24px] sm:text-[28px] lg:text-[32px] font-bold leading-[1.15] tracking-tight money-nowrap" dir="rtl">
                {nw.netWorthToman ? formatMoney(nw.netWorthToman, "IRT") : formatMoney(nw.netWorth)}
              </span>
              {lastSnap && (
                <Delta
                  value={deltaAbs}
                  pct={deltaPct}
                  suffix={lastSnap ? `از ${formatShortDate(lastSnap.asOf)}` : undefined}
                  className="text-[12px] sm:text-[13px]"
                />
              )}
            </div>
            {nw.netWorthToman && (
              <p className="muted mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] sm:text-[12px]">
                <span className="money-nowrap">≈ <span className="num">{formatMoney(nw.netWorth)}</span></span>
                <span className="opacity-40 hidden sm:inline">·</span>
                <span className="money-nowrap">نرخ مرجع <span className="num" dir="rtl">{formatMoney(rate, "IRT")}</span> ≈ ۱ دلار</span>
              </p>
            )}
          </div>

          <div className="shrink-0">
            <p className="muted mb-2 text-[10.5px] font-medium">ثبت سریع</p>
            <div className="quick-actions flex gap-1.5">
              {QUICK.map((q) => (
                <Link
                  key={q.href}
                  href={q.href}
                  className="card interactive-card flex min-h-12 w-[62px] flex-col items-center gap-1 py-2 text-[10px] font-medium sm:min-h-[52px] sm:gap-1.5 sm:py-2.5 sm:text-[10.5px]"
                  style={{ color: "var(--text-2)" }}
                >
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full sm:h-7 sm:w-7"
                    style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
                  >
                    <Icon name={q.icon} size={13} />
                  </span>
                  {q.label}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="overview-summary mt-5 grid grid-cols-3 divide-x divide-x-reverse border-t pt-3 sm:mt-6 sm:pt-4" style={{ borderColor: "var(--border)" }}>
            {[
              { label: "کل دارایی‌ها", value: nw.totalAssets, toman: nw.totalAssetsToman, tone: "var(--color-module-wealth)" },
              // «کل بدهی‌ها» is the DEBT the user can see and pay — `totalDebt*`,
              // which unifies the ledger liability accounts with the debts the
              // planning module owns. It used to read `totalLiabilities*` (the
              // ledger only) and flipped its sign twice: a debt registered in
              // «بدهی‌ها» never created a ledger account, so this tile showed
              // ۰, and its USD line rendered a negative amount.
              { label: "کل بدهی‌ها", value: nw.totalDebtUsd, toman: nw.totalDebtToman, tone: "var(--color-module-commitments)" },
              { label: "نقدشونده", value: nw.liquid, toman: nw.liquidToman, tone: "var(--color-module-expenses)" },
            ].map((m) => (
            <div
              key={m.label}
              className="min-w-0 px-2.5 first:pr-0 last:pl-0 sm:px-4"
              style={{ borderColor: "var(--border)" }}
              title={
                m.label === "کل بدهی‌ها"
                  ? "مانده قابل پرداخت همه بدهی‌ها — همان عددی که در «بدهی‌ها» با برچسب «مانده کل بدهی» می‌بینید. ارزش خالص دارایی مطابق اصول دوطرفه فقط بدهی ثبت‌شده در سوابق مالی را کم می‌کند."
                  : undefined
              }
            >
              <p className="muted truncate text-[10px] sm:text-[11px]">{m.label}</p>
              <p className="num mt-1 text-[12px] font-bold leading-[1.3] money-nowrap sm:text-[14px]" dir="rtl" style={{ color: m.tone }}>
                {formatMoney(D(m.toman).abs().toString(), "IRT")}
              </p>
              <p className="muted num mt-0.5 hidden text-[10px] money-nowrap sm:block sm:text-[10.5px]" dir="rtl">
                ≈ {formatMoney(D(m.value).abs().toString())}
              </p>
            </div>
          ))}
        </div>
      </section>

      {!hasAnything ? (
        <div className="card">
          <EmptyState
            icon="networth"
            title="هنوز هیچ دارایی‌ای ثبت نشده است"
            body="با ثبت اولین تراکنش یا اجرای راه‌اندازی اولیه، تصویر کامل ثروت شما اینجا ساخته می‌شود."
            action={
              <Link href="/new" className="btn btn-primary">
                ثبت اولین تراکنش
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <Section title="ثروت شما چگونه تغییر کرده است؟" action={<SectionLink href="/net-worth" label="تحلیل ارزش خالص" />}>
            <div className="card p-3 sm:p-4">
              <AreaChart data={series} />
            </div>
          </Section>

          <div className="grid items-start gap-6 sm:gap-8 lg:grid-cols-2">
            <Section title="ثروت شما کجا قرار دارد؟" action={<SectionLink href="/portfolio" label="سبد دارایی" />}>
              {nw.byClass.length === 0 ? (
                <p className="muted py-6 text-xs">دارایی‌ای ثبت نشده است.</p>
              ) : (
                <div className="card relative z-0 overflow-visible p-3 sm:p-4">
                  <Donut
                    data={nw.byClass.map((c) => ({ label: c.className, value: Number(c.value), color: c.color }))}
                    centerLabel="مجموع"
                  />
                </div>
              )}
            </Section>

            <Section title="پول این ماه چه کرد؟" action={<SectionLink href="/cash-flow" label="جریان نقدی" />}>
              <div className="card p-3 sm:p-4">
                <div className="kpi-grid mb-3 grid grid-cols-3 gap-2 sm:mb-4">
                  <div className="min-w-0">
                    <p className="muted truncate text-[10px] sm:text-[10.5px]">درآمد</p>
                    <p className="num mt-0.5 text-[12px] font-bold money-nowrap sm:text-[13px]" dir="rtl" style={{ color: toneColor(inflowTone(monthFlow?.inflow ?? 0)) }}>
                      {monthInflowToman ? formatMoney(monthInflowToman, "IRT") : formatMoney(monthFlow?.inflow ?? 0)}
                    </p>
                    {rate && <p className="muted num mt-0.5 text-[9px] money-nowrap sm:text-[10px]" dir="rtl" style={{ color: "var(--text-2)" }}>≈ {formatMoney(monthFlow?.inflow ?? 0)}</p>}
                  </div>
                  <div className="min-w-0">
                    <p className="muted truncate text-[10px] sm:text-[10.5px]">هزینه</p>
                    <p className="num mt-0.5 text-[12px] font-bold money-nowrap sm:text-[13px]" dir="rtl" style={{ color: toneColor(outflowTone(monthFlow?.outflow ?? 0)) }}>
                      {monthOutflowToman ? formatMoney(monthOutflowToman, "IRT") : formatMoney(monthFlow?.outflow ?? 0)}
                    </p>
                    {rate && <p className="muted num mt-0.5 text-[9px] money-nowrap sm:text-[10px]" dir="rtl" style={{ color: "var(--text-2)" }}>≈ {formatMoney(monthFlow?.outflow ?? 0)}</p>}
                  </div>
                  <div className="min-w-0">
                    <p className="muted truncate text-[10px] sm:text-[10.5px]">خالص</p>
                    <p className="num mt-0.5 text-[12px] font-bold money-nowrap sm:text-[13px]" dir="rtl" style={{ color: trendColor(netMonthUsd) }}>
                      {monthNetToman ? formatSignedMoney(monthNetToman, "IRT") : formatSignedMoney(netMonthUsd)}
                    </p>
                    {rate && <p className="muted num mt-0.5 text-[9px] money-nowrap sm:text-[10px]" dir="rtl" style={{ color: "var(--text-2)" }}>≈ {formatMoney(Math.abs(netMonthUsd))}</p>}
                  </div>
                </div>
                <BarsChart
                  height={160}
                  data={flow.map((f: any) => ({
                    label: (() => {
                      const j = toJalali(f.month);
                      return ["", "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"][j.m];
                    })(),
                    positive: Number(f.inflow),
                    negative: Number(f.outflow),
                  }))}
                />
              </div>
            </Section>
          </div>

          <Section title="فعالیت اخیر" action={<SectionLink href="/transactions" label="همه تراکنش‌ها" />}>
            <ul className="divide-y border-t border-b" style={{ borderColor: "var(--border)" }} role="list">
              {tx.map((e) => {
                const h = humanizeEntry(e);
                const hasNativeIrt = h.nativeIrt != null && D(h.nativeIrt).gt(0);
                const displayToman = hasNativeIrt ? h.nativeIrt! : (rate ? usdToIrt(h.amountExact, rate) : null);
                // The USD figure shown is the ledger's canonical base value
                // (frozen). Never re-derive it from the Toman at today's FX —
                // that would distort a frozen purchase (e.g. a historical real
                // estate acquisition booked in USD) into a current-rate guess.
                const displayUsd = h.amountExact;
                return (
                  <li key={e.id} className="flex items-center gap-2.5 py-2.5 sm:gap-3 sm:py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium sm:text-[13px]">{e.description}</p>
                      <p className="muted mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] sm:text-[11px]">
                        <span>{formatShortDate(e.entryDate)}</span>
                        <span className="opacity-40">·</span>
                        <span>{h.typeLabel}</span>
                        {moneyFlowLabel(h.from, h.to) && (
                          <>
                            <span className="opacity-40">·</span>
                            <span className="truncate">{moneyFlowLabel(h.from, h.to)}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="shrink-0 text-left min-w-0">
                      <span
                        className="num block text-[12px] font-bold money-nowrap sm:text-[13px]"
                        dir="rtl"
                        style={{
                          color: h.sign > 0 ? "var(--positive)" : h.sign < 0 ? "var(--negative)" : "var(--text)",
                        }}
                      >
                        {h.sign > 0 ? "+" : h.sign < 0 ? "−" : ""}
                        {displayToman ? formatMoney(displayToman, "IRT") : formatMoney(h.amount)}
                      </span>
                      {rate && (
                        <p className="muted num mt-0.5 block text-[9px] money-nowrap sm:text-[10px]">≈ {formatMoney(displayUsd)}</p>
                      )}
                    </div>
                  </li>
                );
              })}
              {!tx.length && <li className="muted py-8 text-center text-xs">هنوز تراکنشی ثبت نشده است.</li>}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}
