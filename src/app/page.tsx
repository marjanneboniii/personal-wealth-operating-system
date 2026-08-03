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
import { formatMoney, formatQty, formatShortDate } from "@/lib/format";
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

  const [setupState, nw, snaps, ledger, insts, goals, funds, pnl, flow, projection] = await Promise.all([
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
  ]);

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

      {/* Hero */}
      <section className="card rise overflow-hidden p-5">
        <div className="muted text-[11px]">ارزش خالص دارایی‌ها (Net Worth)</div>
        <div className="num mt-1 text-3xl font-bold tracking-tight sm:text-4xl" dir="ltr">
          {formatMoney(nw.netWorth)}
        </div>
        <div className="muted mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          <span>
            دارایی: <Money value={nw.totalAssets} />
          </span>
          <span>
            بدهی: <span style={{ color: "var(--danger)" }}><Money value={nw.totalLiabilities} /></span>
          </span>
          <span>
            نقدشوندگی: <Money value={nw.liquid} />
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
        <Stat label="سود تحقق‌یافته" value={formatMoney(pnl.total)} tone={Number(pnl.total) >= 0 ? "up" : "down"} />
        <Stat label="نقدینگی ۶ ماه آینده" value={formatMoney(projection.points.at(-1)?.cumulative ?? "0")} tone={nextDeficit ? "down" : "up"} hint={nextDeficit ? "هشدار کسری نقدینگی" : "بدون کسری"} />
        <Stat label="اهداف فعال" value={`${goals.filter((g) => g.status === "active").length}`} hint="در حال پیگیری" />
        <Stat label="اقساط پیش‌رو" value={formatMoney(insts.reduce((s, i) => s + Number(i.amountBase), 0))} hint={`${insts.length} قسط`} tone="down" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="جریان نقدی ۶ ماه اخیر">
          <BarsChart
            data={flow.map((f) => ({
              label: formatShortDate(f.month),
              positive: Number(f.inflow),
              negative: Number(f.outflow),
            }))}
          />
          <div className="muted mt-2 flex gap-4 text-[10px]">
            <span><i className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--accent)" }} /> ورودی</span>
            <span><i className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--danger)" }} /> خروجی</span>
          </div>
        </Card>

        <Card title="اهداف مالی" action={<Link href="/planning" className="chip">همه</Link>}>
          <ul className="space-y-3">
            {goals.slice(0, 4).map((g) => (
              <li key={g.id}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span>{g.name}</span>
                  <span className="num muted" dir="ltr">
                    {formatMoney(g.savedBase)} / {formatMoney(g.targetBase)}
                  </span>
                </div>
                <Progress value={g.progress} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="سررسیدهای پیش‌رو" action={<Link href="/debts" className="chip">اقساط</Link>}>
          <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
            {insts.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2.5 text-xs">
                <div>
                  <div>{i.debtTitle} — قسط {i.seq}</div>
                  <div className="muted text-[10px]">{i.creditor} · {formatShortDate(i.dueDate)}</div>
                </div>
                <Money value={i.amountBase} />
              </li>
            ))}
            {!insts.length && <li className="muted py-6 text-center text-xs">قسط سررسیدنشده‌ای نیست</li>}
          </ul>
        </Card>

        <Card title="صندوق‌های اختصاصی">
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
                    {formatMoney(f.savedBase)} / {formatMoney(f.targetBase)}
                  </span>
                </div>
                <Progress value={f.progress} color={f.kind === "emergency" ? "#38bdf8" : f.kind === "family_support" ? "#f472b6" : "#fbbf24"} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="آخرین اسناد دفترکل" action={<Link href="/ledger" className="chip">دفترکل</Link>}>
        <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
          {ledger.map((e) => {
            const amount = e.lines.reduce((s, l) => s + Math.max(0, Number(l.baseValue)), 0);
            return (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-xs">{e.description}</div>
                  <div className="muted text-[10px]">
                    <span className="chip ml-2">{ENTRY_TYPE_LABELS[e.type as EntryType] ?? e.type}</span>
                    {formatShortDate(e.entryDate)} · {e.lines.length} ردیف
                  </div>
                </div>
                <div className="text-left">
                  <Money value={amount} />
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
