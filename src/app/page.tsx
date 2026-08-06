import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { snapshots } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { getCashflow, getLedger, getNetWorth, getRealizedPnl } from "@/features/ledger/queries";
import { listFunds, listGoals, projectCashflow, upcomingInstallments } from "@/features/planning/service";
import { getSetupState } from "@/features/setup/service";
import { Card, Money, Progress, Stat } from "@/components/ui/Card";
import { AreaChart, BarsChart, Donut } from "@/components/charts/Charts";
import { formatMoney, formatQty, getDualDate } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
import { D } from "@/domain/decimal";
import { ENTRY_TYPE_LABELS, type EntryType } from "@/domain/accounting";

export const dynamic = "force-dynamic";

const QUICK = [
  { href: "/new?type=expense", label: "هزینه", icon: "−" },
  { href: "/new?type=income", label: "درآمد", icon: "+" },
  { href: "/new?type=transfer", label: "انتقال", icon: "⇄" },
  { href: "/new?type=buy", label: "خرید دارایی", icon: "↑" },
  { href: "/new?type=sell", label: "فروش دارایی", icon: "↓" },
];

export default async function DashboardPage() {
  await seedIfEmpty();

  const [setupState, nw, snaps, ledger, insts, goals, funds, pnl, flow, projection, fxSnap] = await Promise.all([
    getSetupState(),
    getNetWorth(),
    db.select().from(snapshots).orderBy(desc(snapshots.asOf)).limit(24),
    getLedger(6),
    upcomingInstallments(4),
    listGoals(),
    listFunds(),
    getRealizedPnl(),
    getCashflow(6),
    projectCashflow(6),
    getLatestUsdIrtRate(),
  ]);

  const rate = fxSnap.rate;
  const toIrt = (usd: string) => (rate ? D(usd).mul(rate).toFixed(0) : "—");

  const series = [...snaps]
    .reverse()
    .map((s) => ({ date: s.asOf, value: Number(s.netWorth) }))
    .concat([{ date: new Date().toISOString().slice(0, 10), value: Number(nw.netWorth) }]);

  const nextDeficit = projection.points.find((p) => p.deficit);

  return (
    <div className="space-y-4">
      {!setupState.completed && (
        <div className="card soft flex flex-wrap items-center justify-between gap-3 p-4 border" style={{ borderColor: "var(--accent)" }}>
          <div>
            <div className="text-xs font-bold" style={{ color: "var(--accent)" }}>
              راه‌اندازی اولیه انجام نشده است
            </div>
            <div className="muted text-[11px] mt-0.5">
              ارز پایه محاسباتی، حساب‌های اصلی و موجودی اولیه خود را پیکربندی کنید.
            </div>
          </div>
          <Link href="/setup" className="btn btn-primary !py-1.5 !px-4 text-xs">
            شروع راه‌اندازی اولیه ←
          </Link>
        </div>
      )}

      <div className="soft rounded-2xl p-3 text-[11px] flex flex-wrap items-center justify-between gap-2">
        <span>نرخ دلار مرجع (Single Source): <strong dir="ltr" className="num">{formatMoney(rate, "IRT")}</strong> ≈ $1</span>
        <span className="muted">تاریخ نرخ: <span dir="ltr" className="num">{fxSnap.effectiveDate}</span> · منبع: {fxSnap.source} · تمام پیش‌نمایش‌های مبلغ با این نرخ محاسبه می‌شوند (فقط نمایشی)</span>
      </div>

      {/* Hero — dual */}
      <section className="card rise overflow-hidden p-5">
        <div className="muted text-[11px]">ارزش خالص دارایی‌ها (Net Worth) — نمایش دوگانه</div>
        <div className="num mt-1 text-3xl font-bold tracking-tight sm:text-4xl" dir="ltr">
          {formatMoney(nw.netWorth)} <span className="text-[16px] muted">≈</span> <span dir="rtl" className="text-[18px]" style={{ color:"var(--accent)" }}>{formatMoney(toIrt(nw.netWorth), "IRT")}</span>
        </div>
        <div className="muted mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          <span>
            دارایی: <span dir="ltr" className="num">{formatMoney(nw.totalAssets)}</span> <span dir="rtl" className="num text-[10px]" style={{ color:"var(--accent)" }}>≈ {formatMoney(toIrt(nw.totalAssets), "IRT")}</span>
          </span>
          <span>
            بدهی: <span style={{ color: "var(--danger)" }}><span dir="ltr" className="num">{formatMoney(nw.totalLiabilities)}</span> <span dir="rtl" className="num text-[10px]">≈ {formatMoney(toIrt(nw.totalLiabilities), "IRT")}</span></span>
          </span>
          <span>
            نقدشوندگی: <span dir="ltr" className="num">{formatMoney(nw.liquid)}</span> <span dir="rtl" className="num text-[10px]">≈ {formatMoney(toIrt(nw.liquid), "IRT")}</span>
          </span>
        </div>
        <div className="mt-4 grid grid-cols-5 gap-2">
          {QUICK.map((q) => (
            <Link key={q.href} href={q.href} className="soft flex flex-col items-center gap-1 rounded-2xl py-2.5 text-[10px]">
              <span className="text-base leading-none">{q.icon}</span>
              {q.label}
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="روند ثروت">
          <AreaChart data={series} />
        </Card>
        <Card title="تخصیص دارایی">
          <Donut
            data={nw.byClass.map((c) => ({ label: c.className, value: Number(c.value), color: c.color }))}
          />
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-3">
          <div className="muted text-[10px]">سود تحقق‌یافته — دوگانه</div>
          <div className="num font-bold" dir="ltr" style={{ color: Number(pnl.total) >= 0 ? "var(--accent)" : "var(--danger)" }}>{formatMoney(pnl.total)}</div>
          <div className="num text-[10px]" dir="rtl">{formatMoney(toIrt(pnl.total), "IRT")}</div>
        </div>
        <div className="card p-3">
          <div className="muted text-[10px]">نقدینگی ۶ ماه آینده</div>
          <div className="num font-bold" dir="ltr">{formatMoney(projection.points.at(-1)?.cumulative ?? "0")}</div>
          <div className="num text-[10px]" dir="rtl">{formatMoney(toIrt(projection.points.at(-1)?.cumulative ?? "0"), "IRT")}</div>
          <div className="muted text-[10px]">{nextDeficit ? "هشدار کسری نقدینگی" : "بدون کسری"}</div>
        </div>
        <Stat label="اهداف فعال" value={`${goals.filter((g) => g.status === "active").length}`} hint="در حال پیگیری" />
        <Stat label="اقساط پیش‌رو" value={formatMoney(insts.reduce((s, i) => s + Number(i.amountBase), 0))} hint={`${insts.length} قسط`} tone="down" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="جریان نقدی ۶ ماه اخیر — نمایش دوگانه">
          <BarsChart
            data={flow.map((f) => ({
              label: getDualDate(f.month).jalali,
              positive: Number(f.inflow),
              negative: Number(f.outflow),
            }))}
          />
          <div className="muted mt-2 flex gap-4 text-[10px]">
            <span><i className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--accent)" }} /> ورودی</span>
            <span><i className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--danger)" }} /> خروجی</span>
          </div>
        </Card>

        <Card title="اهداف مالی — دوگانه" action={<Link href="/planning" className="chip">همه</Link>}>
          <ul className="space-y-3">
            {goals.slice(0, 4).map((g) => (
              <li key={g.id}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span>{g.name}</span>
                  <span className="num muted" dir="ltr">
                    {formatMoney(g.savedBase, "IRT")} / {formatMoney(g.targetBase, "IRT")} <span style={{ color:"var(--accent)" }}>≈ {formatMoney(toIrt(g.savedBase), "IRT")} / {formatMoney(toIrt(g.targetBase), "IRT")}</span>
                  </span>
                </div>
                <Progress value={g.progress} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="سررسیدهای پیش‌رو — دوگانه" action={<Link href="/debts" className="chip">اقساط</Link>}>
          <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
            {insts.map((i) => {
              const dual = getDualDate(i.dueDate);
              return (
                <li key={i.id} className="flex items-center justify-between py-2.5 text-xs">
                  <div>
                    <div>{i.debtTitle} — قسط {i.seq}</div>
                    <div className="muted text-[10px] flex gap-2"><span>شمسی: {dual.jalali}</span><span>میلادی: <span dir="ltr" className="num">{dual.gregorian}</span></span> · {i.creditor}</div>
                  </div>
                  <div className="text-left">
                    <div className="num font-bold" dir="ltr">{formatMoney(i.amountBase)}</div>
                    <div className="num text-[10px]" dir="rtl">{formatMoney(toIrt(i.amountBase), "IRT")}</div>
                  </div>
                </li>
              );
            })}
            {!insts.length && <li className="muted py-6 text-center text-xs">قسط سررسیدنشده‌ای نیست</li>}
          </ul>
        </Card>

        <Card title="صندوق‌های اختصاصی — دوگانه">
          <ul className="space-y-3">
            {funds.map((f) => (
              <li key={f.id}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span>
                    {f.name}
                    <span className="chip mr-2">
                      {f.kind === "emergency" ? "اضطراری" : f.kind === "family_support" ? "خانواده" : "ذخیره"}
                    </span>
                  </span>
                  <span className="num muted" dir="ltr">
                    {formatMoney(f.savedBase)} / {formatMoney(f.targetBase)} <span style={{ color:"var(--accent)" }}>≈ {formatMoney(toIrt(f.savedBase), "IRT")} / {formatMoney(toIrt(f.targetBase), "IRT")}</span>
                  </span>
                </div>
                <Progress value={f.progress} color={f.kind === "emergency" ? "#38bdf8" : f.kind === "family_support" ? "#f472b6" : "#fbbf24"} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="آخرین اسناد دفترکل — دوگانه" action={<Link href="/ledger" className="chip">دفترکل</Link>}>
        <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
          {ledger.map((e) => {
            const amount = e.lines.reduce((s, l) => s + Math.max(0, Number(l.baseValue)), 0);
            const dual = getDualDate(e.entryDate);
            return (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-xs">{e.description}</div>
                  <div className="muted text-[10px] flex flex-wrap gap-2">
                    <span className="chip ml-2">{ENTRY_TYPE_LABELS[e.type as EntryType] ?? e.type}</span>
                    <span>شمسی: {dual.jalali}</span>
                    <span>میلادی: <span dir="ltr" className="num">{dual.gregorian}</span></span>
                    <span>· {e.lines.length} ردیف</span>
                  </div>
                </div>
                <div className="text-left">
                  <div className="num font-bold" dir="ltr">{formatMoney(amount)}</div>
                  <div className="num text-[10px]" dir="rtl">{formatMoney(toIrt(String(amount)), "IRT")}</div>
                  <div className="muted num text-[10px]" dir="ltr">
                    {e.lines[0] ? `${formatQty(e.lines[0].quantity, e.lines[0].decimals)} ${e.lines[0].symbol}` : ""}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
