import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import {
  countUnreviewed,
  getCashflow,
  getSnapshotSeries,
  getTransactions,
} from "@/features/ledger/queries";
import { projectCashflow, upcomingInstallments } from "@/features/planning/service";
import { getSetupState } from "@/features/setup/service";
import { Alert, Delta, EmptyState, Section, SectionLink } from "@/components/ui/Card";
import { AreaChart, BarsChart } from "@/components/charts/Charts";
import Icon from "@/components/ui/Icon";
import { humanizeEntry } from "@/lib/tx";
import { D } from "@/domain/decimal";
import { formatMoney, formatPct, formatShortDate, toJalali, faCount } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
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

  const [setupState, nw, snaps, tx, insts, flow, projection, unreviewed, fx] = await Promise.all([
    getSetupState(userId),
    getCurrentNetWorth(userId),
    // Net-worth history is per user: the delta badge and the chart must never
    // read another account's snapshots.
    getSnapshotSeries(40, userId),
    getTransactions({ limit: 6 }),
    upcomingInstallments(3),
    getCashflow(6),
    projectCashflow(6),
    countUnreviewed(),
    getLatestUsdIrtRate(),
  ]);

  const staleCount = nw.valuation.priceStatus.stale + nw.valuation.priceStatus.unavailable;
  const rate = fx.rate;
  const toIrt = (usd: string | number) => (rate ? D(usd).mul(rate).toFixed(0) : null);

  const series = [...snaps]
    .reverse()
    .map((s) => ({ date: s.asOf, value: Number(s.netWorth) }))
    .concat([{ date: new Date().toISOString().slice(0, 10), value: Number(nw.netWorth) }]);

  const lastSnap = snaps[0];
  const deltaAbs = lastSnap ? D(nw.netWorth).sub(lastSnap.netWorth).toString() : "0";
  const deltaPct = lastSnap && !D(lastSnap.netWorth).isZero()
    ? D(deltaAbs).div(lastSnap.netWorth).abs().mul(100).toFixed(2)
    : null;

  const monthFlow = flow.at(-1);
  const netMonth = monthFlow ? Number(monthFlow.inflow) - Number(monthFlow.outflow) : 0;
  const nextDeficit = projection.points.find((p) => p.deficit);

  // Attention items — only what genuinely needs a human decision
  const attention: { icon: "alert" | "clock" | "refresh" | "check"; tone: "warn" | "neg" | "info" | "pos"; text: string; detail: string; href: string; action: string }[] = [];
  if (unreviewed > 0)
    attention.push({
      icon: "check",
      tone: "warn",
      text: `${unreviewed} تراکنش بررسی‌نشده`,
      detail: "قبل از اعتماد به گزارش‌ها، این رکوردها را تأیید کنید.",
      href: "/transactions?review=unreviewed",
      action: "بررسی",
    });
  const soonInst = insts.find((i) => daysUntil(i.dueDate) <= 14);
  if (soonInst) {
    const d = daysUntil(soonInst.dueDate);
    attention.push({
      icon: "clock",
      tone: d < 0 ? "neg" : "info",
      text: d < 0 ? `قسط ${faCount(soonInst.seq)} «${soonInst.debtTitle}» سررسید گذشته است` : `قسط ${faCount(soonInst.seq)} «${soonInst.debtTitle}» ${d === 0 ? "امروز" : `${faCount(d)} روز دیگر`} سر می‌رسد`,
      detail: `${formatMoney(soonInst.amountBase)} — ${soonInst.creditor}`,
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
      text: `${staleCount} دارایی قیمت تازه ندارد`,
      detail: "ارزش‌گذاری این دارایی‌ها ممکن است قدیمی باشد.",
      href: "/portfolio",
      action: "تحلیل",
    });

  const hasAnything = !D(nw.totalAssets).isZero();

  return (
    <div className="space-y-8">
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

      {/* ═══ HERO — وضعیت مالی من چگونه است؟ ═══ */}
      <section className="pt-1">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
          <div className="min-w-0">
            <p className="muted text-[12px] font-medium">ارزش خالص دارایی</p>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <span className="display-num text-[40px] font-bold leading-none tracking-tight sm:text-[52px]" dir="rtl">
                {formatMoney(nw.netWorth)}
              </span>
              {lastSnap && (
                <Delta
                  value={deltaAbs}
                  pct={deltaPct}
                  suffix={lastSnap ? `از ${formatShortDate(lastSnap.asOf)}` : undefined}
                  className="text-[15px]"
                />
              )}
            </div>
            {nw.netWorthToman && (
              <p className="muted mt-2 text-[12.5px]">
                ≈ <span className="num">{formatMoney(nw.netWorthToman, "IRT")}</span>
                <span className="mx-1.5 opacity-50">·</span>
                نرخ مرجع <span className="num" dir="rtl">{formatMoney(rate, "IRT")}</span> ≈ ۱ دلار
              </p>
            )}
          </div>

          {/* Quick capture — fastest workflow in the product */}
          <div>
            <p className="muted mb-2 text-[11px] font-medium">ثبت سریع</p>
            <div className="flex gap-1.5">
              {QUICK.map((q) => (
                <Link
                  key={q.href}
                  href={q.href}
                  className="card interactive-card flex min-h-12 w-[62px] flex-col items-center gap-1.5 py-2.5 text-[10.5px] font-medium"
                  style={{ color: "var(--text-2)" }}
                >
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-full"
                    style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
                  >
                    <Icon name={q.icon} size={14} />
                  </span>
                  {q.label}
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Structure strip — dividers, not cards */}
        <div className="mt-6 grid grid-cols-3 divide-x divide-x-reverse border-t pt-4" style={{ borderColor: "var(--border)" }}>
            {[
              { label: "کل دارایی‌ها", value: nw.totalAssets, toman: nw.totalAssetsToman, tone: "var(--color-module-wealth)" },
              { label: "کل بدهی‌ها", value: D(nw.totalLiabilities).neg().toString(), toman: D(nw.totalLiabilitiesToman).neg().toString(), tone: "var(--color-module-commitments)" },
              { label: "نقدشونده", value: nw.liquid, toman: nw.liquidToman, tone: "var(--color-module-expenses)" },
            ].map((m) => (
            <div key={m.label} className="px-4 first:pr-0 last:pl-0" style={{ borderColor: "var(--border)" }}>
              <p className="muted text-[11px]">{m.label}</p>
              <p className="num mt-1 text-[15px] font-bold sm:text-lg" dir="rtl" style={{ color: m.tone }}>
                {formatMoney(m.value)}
              </p>
              <p className="muted num mt-0.5 hidden text-[10.5px] sm:block">
                ≈ {formatMoney(D(m.toman).abs().toString(), "IRT")}
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
          {/* ═══ ROND ═══ */}
          <Section title="ثروت شما چگونه تغییر کرده است؟" action={<SectionLink href="/net-worth" label="تحلیل ارزش خالص" />}>
            <div className="card p-4 sm:p-5">
              <AreaChart data={series} />
            </div>
          </Section>

          <div className="grid gap-8 lg:grid-cols-2">
            {/* ═══ COMPOSITION ═══ */}
            <Section title="ثروت شما کجا قرار دارد؟" action={<SectionLink href="/portfolio" label="سبد دارایی" />}>
              {nw.byClass.length === 0 ? (
                <p className="muted py-6 text-xs">دارایی‌ای ثبت نشده است.</p>
              ) : (
                <div>
                  <div className="comp-bar" role="img" aria-label="ترکیب ثروت">
                    {nw.byClass.map((c) => (
                      <span key={c.className} style={{ width: `${Number(c.share)}%`, background: c.color }} />
                    ))}
                  </div>
                  <ul className="mt-3 divide-y" style={{ borderColor: "var(--border)" }}>
                    {nw.byClass.slice(0, 5).map((c) => (
                      <li key={c.className} className="flex items-center justify-between gap-3 py-2.5">
                        <span className="flex min-w-0 items-center gap-2.5 text-[13px]">
                          <i className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ background: c.color }} />
                          <span className="truncate">{c.className}</span>
                        </span>
                        <span className="flex shrink-0 items-baseline gap-2">
                          <span className="num muted text-[11px]" dir="rtl">
                            {formatPct(Number(c.share), 1)}
                          </span>
                          <span className="num text-[13px] font-semibold" dir="rtl">
                            {formatMoney(c.value)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>

            {/* ═══ CASH FLOW ═══ */}
            <Section title="پول این ماه چه کرد؟" action={<SectionLink href="/cash-flow" label="جریان نقدی" />}>
              <div className="mb-4 grid grid-cols-3 gap-2">
                <div>
                  <p className="muted text-[10.5px]">درآمد</p>
                  <p className="num mt-0.5 text-[15px] font-bold" dir="rtl" style={{ color: "var(--positive)" }}>
                    {formatMoney(monthFlow?.inflow ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="muted text-[10.5px]">هزینه</p>
                  <p className="num mt-0.5 text-[15px] font-bold" dir="rtl" style={{ color: "var(--negative)" }}>
                    {formatMoney(monthFlow?.outflow ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="muted text-[10.5px]">خالص</p>
                  <p className="num mt-0.5 text-[15px] font-bold" dir="rtl" style={{ color: netMonth >= 0 ? "var(--positive)" : "var(--negative)" }}>
                    {netMonth >= 0 ? "+" : "−"}
                    {formatMoney(Math.abs(netMonth))}
                  </p>
                </div>
              </div>
              <BarsChart
                height={110}
                data={flow.map((f) => ({
                  label: (() => {
                    const j = toJalali(f.month);
                    return ["", "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"][j.m];
                  })(),
                  positive: Number(f.inflow),
                  negative: Number(f.outflow),
                }))}
              />
            </Section>
          </div>

          <Section title="ثروت شما چگونه تغییر کرده است؟" action={<SectionLink href="/net-worth" label="تحلیل ارزش خالص" />}>
            <p className="sr-only">
              {deltaPct
                ? `ارزش خالص نسبت به آخرین اسنپ‌شات ${deltaPct} درصد ${Number(deltaAbs) >= 0 ? "افزایش" : "کاهش"} یافته است.`
                : "تاریخچه کافی برای توصیف روند ارزش خالص وجود ندارد."}
            </p>
            <div className="card p-4 sm:p-5">
              <AreaChart data={series} />
            </div>
          </Section>

          {/* ═══ ACTIVITY ═══ */}
          <Section title="فعالیت اخیر" action={<SectionLink href="/transactions" label="همه تراکنش‌ها" />}>
            <ul className="divide-y border-t border-b" style={{ borderColor: "var(--border)" }} role="list">
              {tx.map((e) => {
                const h = humanizeEntry(e);
                return (
                  <li key={e.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{e.description}</p>
                      <p className="muted mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px]">
                        <span>{formatShortDate(e.entryDate)}</span>
                        <span className="opacity-40">·</span>
                        <span>{h.typeLabel}</span>
                        {h.from && h.to && (
                          <>
                            <span className="opacity-40">·</span>
                            <span className="truncate">
                              {h.from} ← {h.to}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="shrink-0 text-left">
                      <span
                        className="num text-[13.5px] font-bold"
                        dir="rtl"
                        style={{
                          color: h.sign > 0 ? "var(--positive)" : h.sign < 0 ? "var(--negative)" : "var(--text)",
                        }}
                      >
                        {h.sign > 0 ? "+" : h.sign < 0 ? "−" : ""}
                        {formatMoney(h.amount)}
                      </span>
                      {rate && (
                        <p className="muted num text-[10px]">≈ {formatMoney(toIrt(h.amount)!, "IRT")}</p>
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
