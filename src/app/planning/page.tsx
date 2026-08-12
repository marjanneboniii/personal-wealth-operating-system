import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import {
  listDebts,
  listEvents,
  listPlanned,
  projectCashflow,
  upcomingInstallments,
} from "@/features/planning/service";
import { Alert, EmptyState, Metric, PageHeader, Section, SectionLink } from "@/components/ui/Card";
import { BarsChart } from "@/components/charts/Charts";
import { EventForm, GoalForm, PlannedForm } from "@/components/forms/QuickForms";
import RowAction from "@/components/RowAction";
import Icon from "@/components/ui/Icon";
import { formatMoney, formatShortDate, getDualDate, toJalali } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

const FA_MONTHS = ["", "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

function daysUntil(iso: string) {
  return Math.ceil((new Date(iso + "T00:00:00Z").getTime() - Date.now()) / 86_400_000);
}

export default async function PlanningPage() {
  await ensureAuth();
  await seedIfEmpty();
  const [planned, insts, debts, events, projection, accountRows, fx] = await Promise.all([
    listPlanned(),
    upcomingInstallments(6),
    listDebts(),
    listEvents(),
    projectCashflow(12),
    db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .leftJoin(assets, eq(assets.id, accounts.assetId))
      .where(sql`${accounts.deletedAt} is null and ${accounts.assetId} is not null`)
      .orderBy(asc(accounts.code)),
    getLatestUsdIrtRate(),
  ]);

  const pending = planned.filter((p) => p.status === "pending");
  const deficit = projection.points.find((p) => p.deficit);
  const totalPlannedOut = pending.filter((p) => p.direction === "outflow").reduce((s, p) => s + Number(p.amountBase), 0);

  // Next actions — the single merged "what's next" queue
  const queue: {
    date: string;
    title: string;
    kind: "installment" | "plan" | "event";
    amount: string;
    id: string;
    extra?: string;
  }[] = [
    ...insts.slice(0, 4).map((i) => ({
      date: i.dueDate,
      title: `قسط ${i.seq} «${i.debtTitle}»`,
      kind: "installment" as const,
      amount: i.amountBase,
      id: i.id,
      extra: i.creditor,
    })),
    ...pending.slice(0, 4).map((p) => ({
      date: p.plannedDate,
      title: p.title,
      kind: "plan" as const,
      amount: p.amountBase,
      id: p.id,
      extra: p.direction === "inflow" ? "ورودی برنامه‌ریزی‌شده" : "خروجی برنامه‌ریزی‌شده",
    })),
    ...events
      .filter((e) => e.status === "planned")
      .slice(0, 3)
      .map((e) => ({
        date: e.eventDate,
        title: e.name,
        kind: "event" as const,
        amount: e.budgetBase,
        id: e.id,
        extra: "رویداد پیش‌رو",
      })),
  ]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6);

  const kindIcon = { installment: "installments" as const, plan: "goals" as const, event: "calendar" as const };

  return (
    <div className="space-y-8">
      <PageHeader title="پیش‌بینی مالی" />

      {deficit && (
        <Alert tone="neg" icon="alert" title={`کسری نقدینگی در ${formatShortDate(deficit.month)}`}>
          اگر همه برنامه‌ها و اقساط اجرا شوند، نقدینگی شما در این ماه منفی می‌شود. این برنامه‌ها را بازنگری یا نقدینگی را افزایش دهید.
        </Alert>
      )}

      <section className="rise grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-4" style={{ borderColor: "var(--border)" }}>
        <Metric label="نقدینگی فعلی" value={formatMoney(projection.startingLiquidity)} />
        <Metric label="خروجی برنامه‌ریزی‌شده" value={formatMoney(totalPlannedOut)} tone="down" hint={`${pending.length} برنامه در انتظار`} />
        <Metric
          label="نقدینگی پایان ۱۲ ماه"
          value={formatMoney(projection.points.at(-1)?.cumulative ?? "0")}
          tone={deficit ? "down" : "up"}
        />
        <Metric label="هشدار کسری" value={deficit ? formatShortDate(deficit.month) : "ندارد"} tone={deficit ? "down" : "up"} />
      </section>

      {/* The queue */}
      <Section title="قدم‌های بعدی شما" hint="مرتب‌شده بر اساس نزدیک‌ترین سررسید">
        {queue.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="check-circle"
              title="همه‌چیز مرتب است"
              body="هیچ قسط، برنامه یا رویداد نزدیکی وجود ندارد. برنامه جدید بسازید تا آینده شکل بگیرد."
            />
          </div>
        ) : (
          <ul className="divide-y border-t border-b" style={{ borderColor: "var(--border)" }}>
            {queue.map((q) => {
              const d = daysUntil(q.date);
              const dual = getDualDate(q.date);
              return (
                <li key={q.kind + q.id} className="flex items-center gap-3 py-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
                  >
                    <Icon name={kindIcon[q.kind]} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{q.title}</p>
                    <p className="muted mt-0.5 text-[11px]">
                      {q.extra} · {dual.jalali} ·{" "}
                      <span style={{ color: d < 0 ? "var(--negative)" : undefined }} className="num">
                        {d < 0 ? `${Math.abs(d)} روز گذشته` : d === 0 ? "امروز" : `${d} روز دیگر`}
                      </span>
                    </p>
                  </div>
                  <span className="num shrink-0 text-[13.5px] font-bold" dir="ltr">
                    {formatMoney(q.amount)}
                  </span>
                  {q.kind === "installment" && (
                    <Link
                      href={`/new?type=expense&installmentId=${q.id}&entryDate=${q.date}&title=${encodeURIComponent(q.title)}`}
                      className="btn btn-primary !min-h-9 shrink-0 !px-3.5 !py-1.5 text-[12px]"
                    >
                      پرداخت
                    </Link>
                  )}
                  {q.kind === "plan" && <RowAction kind="execute-plan" id={q.id} label="اجرا" primary />}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Forecast */}
      <Section title="جریان نقدی ۱۲ ماه آینده" hint="برنامه‌ها + اقساط + تعهدات + رویدادها — پیش‌بینی، نه واقعیت">
        <div className="card p-4 sm:p-5">
          <BarsChart
            height={150}
            data={projection.points.map((p) => ({
              label: FA_MONTHS[toJalali(p.month).m],
              positive: Number(p.inflow),
              negative: Number(p.outflow),
            }))}
          />
        </div>
      </Section>

      {/* Doorways to the planning family */}
      <Section title="ابزارهای برنامه‌ریزی">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {[
            { href: "/budgets", label: "بودجه‌ها", q: "آیا در چارچوب هستم؟", icon: "budgets" as const },
            { href: "/goals", label: "اهداف و صندوق‌ها", q: "چقدر نزدیکم؟", icon: "goals" as const },
            { href: "/debts", label: "بدهی‌ها", q: `مانده: ${formatMoney(debts.reduce((s, d) => s + Number(d.outstandingBase), 0))}`, icon: "debts" as const },
            { href: "/installments", label: "اقساط", q: "چه زمانی سر می‌رسد؟", icon: "installments" as const },
          ].map((l) => (
            <Link key={l.href} href={l.href} className="card group p-4 transition-transform hover:-translate-y-0.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
                <Icon name={l.icon} size={17} />
              </span>
              <p className="mt-2.5 text-[13px] font-semibold">{l.label}</p>
              <p className="muted mt-0.5 truncate text-[10.5px]">{l.q}</p>
            </Link>
          ))}
        </div>
      </Section>

      {/* Capture — collapsed until needed */}
      <Section title="افزودن برنامه جدید" hint="تا قبل از «اجرا» هیچ سندی در دفترکل ایجاد نمی‌شود">
        <div className="space-y-2.5">
          {[
            { id: "planned", label: "تراکنش برنامه‌ریزی‌شده", body: <PlannedForm accounts={accountRows} initialRate={fx.rate} initialRateDate={fx.effectiveDate} initialRateSource={fx.source} /> },
            { id: "goal", label: "هدف مالی", body: <GoalForm accounts={accountRows} initialRate={fx.rate} initialRateDate={fx.effectiveDate} initialRateSource={fx.source} /> },
            { id: "event", label: "رویداد آینده", body: <EventForm initialRate={fx.rate} initialRateDate={fx.effectiveDate} initialRateSource={fx.source} /> },
          ].map((f) => (
            <details key={f.id} className="card group overflow-hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 marker:hidden [&::-webkit-details-marker]:hidden">
                <span className="text-[13.5px] font-semibold">{f.label}</span>
                <span className="muted transition-transform group-open:rotate-180">
                  <Icon name="chevronDown" size={15} />
                </span>
              </summary>
              <div className="border-t p-4" style={{ borderColor: "var(--border)" }}>
                {f.body}
              </div>
            </details>
          ))}
        </div>
        <div className="mt-4">
          <SectionLink href="/goals" label="مدیریت اهداف، صندوق‌ها و تعهدات" />
        </div>
      </Section>
    </div>
  );
}
