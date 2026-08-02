import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import {
  listEvents,
  listFunds,
  listGoals,
  listObligations,
  listPlanned,
  projectCashflow,
} from "@/features/planning/service";
import { Card, Money, PageHeader, Progress, Stat } from "@/components/ui/Card";
import { BarsChart } from "@/components/charts/Charts";
import { EventForm, GoalForm, PlannedForm } from "@/components/forms/QuickForms";
import RowAction from "@/components/RowAction";
import { formatMoney, formatShortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const CATEGORY: Record<string, string> = {
  trip: "سفر",
  ceremony: "مراسم",
  gift: "هدیه",
  purchase: "خرید بزرگ",
  other: "سایر",
};

export default async function PlanningPage() {
  await seedIfEmpty();
  const [goals, events, planned, obligations, funds, projection, accountRows] = await Promise.all([
    listGoals(),
    listEvents(),
    listPlanned(),
    listObligations(),
    listFunds(),
    projectCashflow(12),
    db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .leftJoin(assets, eq(assets.id, accounts.assetId))
      .where(sql`${accounts.deletedAt} is null and ${accounts.assetId} is not null`)
      .orderBy(asc(accounts.code)),
  ]);

  const pending = planned.filter((p) => p.status === "pending");
  const deficit = projection.points.find((p) => p.deficit);
  const totalPlannedOut = pending
    .filter((p) => p.direction === "outflow")
    .reduce((s, p) => s + Number(p.amountBase), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="برنامه‌ریزی مالی"
        subtitle="آینده کاملاً از دفترکل جدا است؛ فقط با «اجرا» به ثروت واقعی تبدیل می‌شود."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="نقدینگی فعلی" value={formatMoney(projection.startingLiquidity)} />
        <Stat label="خروج برنامه‌ریزی‌شده" value={formatMoney(totalPlannedOut)} tone="down" />
        <Stat label="نقدینگی پایان دوره" value={formatMoney(projection.points.at(-1)?.cumulative ?? "0")} tone={deficit ? "down" : "up"} />
        <Stat label="هشدار کسری" value={deficit ? formatShortDate(deficit.month) : "ندارد"} tone={deficit ? "down" : "up"} />
      </div>

      <Card title="پیش‌بینی جریان نقدی ۱۲ ماه آینده">
        <BarsChart
          data={projection.points.map((p) => ({
            label: formatShortDate(p.month),
            positive: Number(p.inflow),
            negative: Number(p.outflow),
          }))}
        />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-right text-[11px]">
            <thead className="muted">
              <tr>
                <th className="py-1 font-normal">ماه</th>
                <th className="py-1 font-normal">ورودی</th>
                <th className="py-1 font-normal">خروجی</th>
                <th className="py-1 font-normal">خالص</th>
                <th className="py-1 font-normal">نقدینگی تجمعی</th>
              </tr>
            </thead>
            <tbody>
              {projection.points.map((p) => (
                <tr key={p.month} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="py-1.5">{formatShortDate(p.month)}</td>
                  <td className="num py-1.5" dir="ltr">{formatMoney(p.inflow)}</td>
                  <td className="num py-1.5" dir="ltr">{formatMoney(p.outflow)}</td>
                  <td className="num py-1.5" dir="ltr"><Money value={p.net} tone /></td>
                  <td className="num py-1.5" dir="ltr" style={{ color: p.deficit ? "var(--danger)" : undefined }}>
                    {formatMoney(p.cumulative)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="تراکنش‌های برنامه‌ریزی‌شده">
        <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
          {planned.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs">
              <div>
                <div>
                  {p.title}
                  <span className="chip mr-2">{p.direction === "inflow" ? "ورودی" : "خروجی"}</span>
                  {p.recurrence !== "none" && (
                    <span className="chip mr-1">{p.recurrence === "monthly" ? "ماهانه" : "سالانه"}</span>
                  )}
                </div>
                <div className="muted mt-1 text-[10px]">
                  {formatShortDate(p.plannedDate)} ·{" "}
                  {p.status === "executed" ? "اجرا شده — در دفترکل" : p.status === "cancelled" ? "لغو شده" : "در انتظار اجرا"}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Money value={p.amountBase} />
                {p.status === "pending" && <RowAction kind="execute-plan" id={p.id} label="اجرا" primary />}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="اهداف مالی">
          <ul className="space-y-4">
            {goals.map((g) => (
              <li key={g.id}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span>
                    {g.name}
                    {g.targetDate && <span className="muted mr-2 text-[10px]">تا {formatShortDate(g.targetDate)}</span>}
                  </span>
                  <span className="num muted" dir="ltr">
                    {formatMoney(g.savedBase)} / {formatMoney(g.targetBase)}
                  </span>
                </div>
                <Progress value={g.progress} />
                <div className="muted mt-1 text-[10px]">باقی‌مانده: {formatMoney(g.remainingBase)}</div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="صندوق‌های اختصاصی">
          <ul className="space-y-4">
            {funds.map((f) => (
              <li key={f.id}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span>{f.name}</span>
                  <span className="num muted" dir="ltr">
                    {formatMoney(f.savedBase)} / {formatMoney(f.targetBase)}
                  </span>
                </div>
                <Progress value={f.progress} color="#38bdf8" />
                {f.note && <div className="muted mt-1 text-[10px]">{f.note}</div>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="رویدادها و خریدهای آینده">
          <ul className="divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2.5">
                <div>
                  <div>{e.name} <span className="chip mr-2">{CATEGORY[e.category] ?? e.category}</span></div>
                  <div className="muted text-[10px]">{formatShortDate(e.eventDate)}</div>
                </div>
                <Money value={e.budgetBase} />
              </li>
            ))}
          </ul>
        </Card>

        <Card title="تعهدات مالی">
          <ul className="divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {obligations.map((o) => (
              <li key={o.id} className="flex items-center justify-between py-2.5">
                <div>
                  <div>{o.title} <span className="chip mr-2">{o.recurrence === "monthly" ? "ماهانه" : o.recurrence === "yearly" ? "سالانه" : "یک‌بار"}</span></div>
                  <div className="muted text-[10px]">سررسید {formatShortDate(o.dueDate)}</div>
                </div>
                <Money value={o.amountBase} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="افزودن برنامه جدید">
        <div className="space-y-6">
          <PlannedForm accounts={accountRows} />
          <hr style={{ borderColor: "var(--line)" }} />
          <GoalForm accounts={accountRows} />
          <hr style={{ borderColor: "var(--line)" }} />
          <EventForm />
        </div>
      </Card>
    </div>
  );
}
