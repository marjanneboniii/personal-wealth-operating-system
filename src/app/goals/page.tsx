import { asc, eq, sql } from "drizzle-orm";
import { ensureAuth } from "@/lib/authGuard";
import { db } from "@/db";
import { accounts, assets } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { listEvents, listFunds, listGoals, listObligations } from "@/features/planning/service";
import { EmptyState, Metric, PageHeader, Progress, Section } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import { EventForm, GoalForm } from "@/components/forms/QuickForms";
import { formatDualDate, formatMoney } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

const FUND_KIND: Record<string, string> = {
  emergency: "اضطراری",
  reserve: "ذخیره",
  family_support: "خانواده",
};

const EVENT_CATEGORY: Record<string, string> = {
  trip: "سفر",
  ceremony: "مراسم",
  gift: "هدیه",
  purchase: "خرید بزرگ",
  other: "سایر",
};

export default async function GoalsPage() {
  await ensureAuth();
  await seedIfEmpty();
  const [goals, funds, events, obligations, accountRows, fx] = await Promise.all([
    listGoals(),
    listFunds(),
    listEvents(),
    listObligations(),
    db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .leftJoin(assets, eq(assets.id, accounts.assetId))
      .where(sql`${accounts.deletedAt} is null and ${accounts.assetId} is not null`)
      .orderBy(asc(accounts.code)),
    getLatestUsdIrtRate(),
  ]);

  const activeGoals = goals.filter((g) => g.status === "active");
  const totalTarget = activeGoals.reduce((s, g) => s + Number(g.targetBase), 0);
  const totalSaved = activeGoals.reduce((s, g) => s + Number(g.savedBase), 0);
  const overall = totalTarget ? Math.min(100, (totalSaved / totalTarget) * 100) : 0;

  return (
    <div className="space-y-8">
      <PageHeader title="اهداف و صندوق‌ها" />

      {activeGoals.length > 0 && (
        <section className="rise border-b pb-6" style={{ borderColor: "var(--border)" }}>
          <div className="mb-2 flex items-baseline justify-between">
            <p className="muted text-[12px] font-medium">پیشرفت مجموع اهداف فعال</p>
            <p className="num text-[13px] font-bold" dir="ltr">
              {formatMoney(totalSaved)} <span className="muted font-normal">از</span> {formatMoney(totalTarget)}
            </p>
          </div>
          <Progress value={overall} />
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="اهداف فعال" value={String(activeGoals.length)} />
            <Metric label="رسیده" value={String(goals.filter((g) => g.status === "reached").length)} tone="up" />
            <Metric label="صندوق‌های اختصاصی" value={String(funds.length)} />
            <Metric label="رویدادهای پیش‌رو" value={String(events.filter((e) => e.status === "planned").length)} />
          </div>
        </section>
      )}

      {/* Goals */}
      <Section title="اهداف مالی">
        {goals.length === 0 ? (
          <div className="card">
            <EmptyState icon="goals" title="هنوز هدفی تعریف نشده است" />
          </div>
        ) : (
          <ul className="space-y-2.5">
            {goals.map((g) => {
              const done = g.status === "reached";
              return (
                <li key={g.id} className="card p-4">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <p className="flex items-center gap-2 text-[14px] font-semibold">
                      {done && (
                        <span style={{ color: "var(--positive)" }}>
                          <Icon name="check-circle" size={16} />
                        </span>
                      )}
                      {g.name}
                      <span className="badge badge-neutral">
                        اولویت {g.priority === 1 ? "بالا" : g.priority === 2 ? "متوسط" : "پایین"}
                      </span>
                      {g.targetDate && <span className="muted num text-[10.5px]">تا {formatDualDate(g.targetDate)}</span>}
                    </p>
                    <span className="num text-[13px]" dir="ltr">
                      <b className="text-[15px]">{formatMoney(g.savedBase)}</b> <span className="muted">از {formatMoney(g.targetBase)}</span>
                    </span>
                  </div>
                  <Progress value={g.progress} color={done ? "var(--positive)" : "var(--brand)"} />
                  <div className="muted mt-2 flex justify-between text-[11px]">
                    <span className="num" dir="ltr">
                      {g.progress.toFixed(0)}٪
                    </span>
                    <span>
                      {done ? "تبریک — به این هدف رسیدید" : `${formatMoney(g.remainingBase)} مانده`}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        {/* Funds */}
        <Section title="صندوق‌های اختصاصی" hint="پول‌های کنارگذاشته‌شده برای منظور مشخص">
          {funds.length === 0 ? (
            <p className="muted py-4 text-xs">صندوقی تعریف نشده است.</p>
          ) : (
            <ul className="space-y-4">
              {funds.map((f) => (
                <li key={f.id}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="font-medium">
                      {f.name}
                      <span className="badge badge-neutral mr-2">{FUND_KIND[f.kind] ?? f.kind}</span>
                    </span>
                    <span className="num" dir="ltr">
                      <b>{formatMoney(f.savedBase)}</b> <span className="muted text-[11px]">از {formatMoney(f.targetBase)}</span>
                    </span>
                  </div>
                  <Progress value={f.progress} color="var(--info)" />
                  {f.note && <p className="muted mt-1.5 text-[10.5px]">{f.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Events & obligations */}
        <Section title="رویدادها و تعهدات" hint="هزینه‌های از پیش‌دانسته آینده">
          {events.length === 0 && obligations.length === 0 ? (
            <p className="muted py-4 text-xs">رویداد یا تعهدی ثبت نشده است.</p>
          ) : (
            <ul className="divide-y border-t border-b" style={{ borderColor: "var(--border)" }}>
              {[
                ...events.map((e) => ({
                  id: e.id,
                  title: e.name,
                  date: e.eventDate,
                  amount: e.budgetBase,
                  badge: EVENT_CATEGORY[e.category] ?? "رویداد",
                  recurrence: null as string | null,
                })),
                ...obligations.map((o) => ({
                  id: o.id,
                  title: o.title,
                  date: o.dueDate,
                  amount: o.amountBase,
                  badge: "تعهد",
                  recurrence: o.recurrence,
                })),
              ]
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-[13px] font-medium">
                        {x.title}
                        <span className="badge badge-neutral">{x.badge}</span>
                        {x.recurrence && x.recurrence !== "none" && (
                          <span className="badge badge-info">{x.recurrence === "monthly" ? "ماهانه" : "سالانه"}</span>
                        )}
                      </p>
                      <p className="muted num mt-0.5 text-[10.5px]">{formatDualDate(x.date)}</p>
                    </div>
                    <span className="num shrink-0 text-[13px] font-bold" dir="ltr">
                      {formatMoney(x.amount)}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Capture forms */}
      <Section title="افزودن">
        <div className="grid gap-2.5 lg:grid-cols-2">
          <details className="card group overflow-hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 marker:hidden [&::-webkit-details-marker]:hidden">
              <span className="text-[13.5px] font-semibold">هدف جدید</span>
              <span className="muted transition-transform group-open:rotate-180">
                <Icon name="chevronDown" size={15} />
              </span>
            </summary>
            <div className="border-t p-4" style={{ borderColor: "var(--border)" }}>
              <GoalForm accounts={accountRows} initialRate={fx.rate} initialRateDate={fx.effectiveDate} initialRateSource={fx.source} />
            </div>
          </details>
          <details className="card group overflow-hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 marker:hidden [&::-webkit-details-marker]:hidden">
              <span className="text-[13.5px] font-semibold">رویداد جدید</span>
              <span className="muted transition-transform group-open:rotate-180">
                <Icon name="chevronDown" size={15} />
              </span>
            </summary>
            <div className="border-t p-4" style={{ borderColor: "var(--border)" }}>
              <EventForm initialRate={fx.rate} initialRateDate={fx.effectiveDate} initialRateSource={fx.source} />
            </div>
          </details>
        </div>
      </Section>
    </div>
  );
}
