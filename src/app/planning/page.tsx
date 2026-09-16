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
import { Alert, EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
import { BarsChart } from "@/components/charts/Charts";
import { AddPlanButton } from "@/components/planning/AddPlanningSheet";
import RowAction from "@/components/RowAction";
import Icon from "@/components/ui/Icon";
import {
  formatDaysUntil,
  formatShortDate,
  getDualDate,
  toJalali,
  faCount,
  outflowTone,
  formatTomanPrimary,
  sumToman,
  todayIso,
} from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export const metadata = { title: "پیش‌بینی مالی" };

const FA_MONTHS = ["", "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

function daysUntil(iso: string) {
  return Math.ceil((new Date(iso + "T00:00:00Z").getTime() - Date.now()) / 86_400_000);
}

/**
 * پیش‌بینی مالی — «چه چیزی در راه است؟» as one queue plus the 12-month view.
 *
 * Presentation only: the projection, the queue sources and every planning
 * action are untouched; the capture forms moved from stacked `<details>`
 * panels into the header's «+ برنامه جدید» sheet.
 */
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
  // Planned amounts are contractual Toman.
  const totalPlannedOutToman = sumToman(
    pending.filter((p) => p.direction === "outflow").map((p) => p.amountToman ?? p.amountBase),
  );
  const liqDisp = formatTomanPrimary(projection.startingLiquidityToman ?? projection.startingLiquidity, fx.rate);
  const outDisp = formatTomanPrimary(totalPlannedOutToman, fx.rate);
  const endCum = projection.points.at(-1)?.cumulative ?? "0";
  const endDisp = formatTomanPrimary(endCum, fx.rate);
  const debtsOutstandingToman = sumToman(debts.map((d) => d.outstandingToman));
  const debtsDisp = formatTomanPrimary(debtsOutstandingToman, fx.rate);

  // Next actions — the single merged "what's next" queue
  const queue: {
    date: string;
    title: string;
    kind: "installment" | "plan" | "event";
    amountToman: string;
    id: string;
    extra?: string;
  }[] = [
    ...insts.slice(0, 4).map((i) => ({
      date: i.dueDate,
      title: `قسط ${i.seq} «${i.debtTitle}»`,
      kind: "installment" as const,
      amountToman: i.amountToman != null ? String(i.amountToman) : "0",
      id: i.id,
      extra: i.creditor,
    })),
    ...pending.slice(0, 4).map((p) => ({
      date: p.plannedDate,
      title: p.title,
      kind: "plan" as const,
      amountToman: p.amountToman ?? String(p.amountBase),
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
        amountToman: e.budgetToman ?? String(e.budgetBase),
        id: e.id,
        extra: "رویداد پیش‌رو",
      })),
  ]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6);

  const kindIcon = { installment: "installments" as const, plan: "goals" as const, event: "calendar" as const };

  const addProps = {
    accounts: accountRows,
    today: todayIso(),
    rate: fx.rate,
    rateDate: fx.effectiveDate,
    rateSource: fx.source,
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="پیش‌بینی مالی"
        subtitle="چه چیزی در راه است و نقدینگی کجا کم می‌آورد. مبالغ برنامه‌ریزی به تومان ثابت‌اند."
        action={<AddPlanButton {...addProps} />}
      />

      {deficit && (
        <Alert tone="neg" icon="alert" title={`کسری نقدینگی در ${formatShortDate(deficit.month)}`}>
          اگر همه برنامه‌ها و اقساط اجرا شوند، نقدینگی شما در این ماه منفی می‌شود. این برنامه‌ها را بازنگری یا نقدینگی را افزایش دهید.
        </Alert>
      )}

      <section className="metric-strip">
        <Metric label="نقدینگی فعلی" value={liqDisp.primary} hint={liqDisp.usdHint ? `معادل ${liqDisp.usdHint}` : undefined} />
        <Metric
          label="خروجی برنامه‌ریزی‌شده"
          value={outDisp.primary}
          tone={outflowTone(totalPlannedOutToman)}
          hint={`${faCount(pending.length)} برنامه در انتظار`}
        />
        <Metric
          label="نقدینگی پایان ۱۲ ماه"
          value={endDisp.primary}
          tone={deficit ? "down" : "neutral"}
          hint={endDisp.usdHint ? `معادل ${endDisp.usdHint}` : undefined}
        />
        <Metric label="هشدار کسری" value={deficit ? formatShortDate(deficit.month) : "ندارد"} tone={deficit ? "down" : "neutral"} />
      </section>

      <Section title="قدم‌های بعدی شما" hint="مرتب‌شده بر اساس نزدیک‌ترین سررسید">
        {queue.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="check-circle"
              title="همه‌چیز مرتب است"
              body="هیچ قسط، برنامه یا رویداد نزدیکی وجود ندارد. برنامه جدید بسازید تا آینده شکل بگیرد."
              action={<AddPlanButton {...addProps} label="ساخت اولین برنامه" variant="soft" />}
            />
          </div>
        ) : (
          <ul className="card plan-list">
            {queue.map((q) => {
              const d = daysUntil(q.date);
              const dual = getDualDate(q.date);
              const disp = formatTomanPrimary(q.amountToman, fx.rate);
              return (
                <li key={q.kind + q.id} className="plan-queue-row">
                  <span className="plan-icon" aria-hidden="true">
                    <Icon name={kindIcon[q.kind]} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[length:var(--fs-sm)]">{q.title}</b>
                    <span className="expense-sub block truncate">
                      {q.extra} · <span className="num">{dual.jalali}</span> ·{" "}
                      <span className="num" style={{ color: d < 0 ? "var(--negative)" : undefined }}>
                        {formatDaysUntil(d)}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-left">
                    <span className="num plan-amount block money-nowrap" dir="rtl">
                      {disp.primary}
                    </span>
                    {disp.usdHint && (
                      <span className="muted num block text-[length:var(--fs-xs)]" dir="rtl">
                        معادل {disp.usdHint}
                      </span>
                    )}
                  </span>
                  {q.kind === "installment" && (
                    <Link
                      href={`/new?type=expense&installmentId=${q.id}&entryDate=${q.date}&title=${encodeURIComponent(q.title)}`}
                      className="btn btn-soft !min-h-9 shrink-0 !px-3.5 !py-1.5 text-[length:var(--fs-xs)]"
                    >
                      پرداخت
                    </Link>
                  )}
                  {q.kind === "plan" && <RowAction kind="execute-plan" id={q.id} label="اجرا" />}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="جریان نقدی ۱۲ ماه آینده" hint="برنامه‌ها + اقساط + تعهدات + رویدادها — مبالغ به تومان">
        <div className="card p-3 sm:p-4">
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

      <Section title="ابزارهای برنامه‌ریزی">
        <div className="plan-tools">
          {[
            { href: "/budgets", label: "بودجه‌ها", q: "آیا در چارچوب هستم؟", icon: "budgets" as const },
            { href: "/goals", label: "اهداف و صندوق‌ها", q: "چقدر نزدیکم؟", icon: "goals" as const },
            { href: "/debts", label: "بدهی‌ها", q: `مانده ${debtsDisp.primary}`, icon: "debts" as const },
            { href: "/installments", label: "اقساط", q: "چه زمانی سر می‌رسد؟", icon: "installments" as const },
          ].map((l) => (
            <Link key={l.href} href={l.href} className="plan-tool">
              <span className="plan-icon" aria-hidden="true">
                <Icon name={l.icon} size={16} />
              </span>
              <b className="text-[length:var(--fs-sm)]">{l.label}</b>
              <span className="expense-sub truncate">{l.q}</span>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}
