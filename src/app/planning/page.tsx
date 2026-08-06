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
import { formatMoney, formatShortDate, getDualDate, formatJalaliIso } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
import { D } from "@/domain/decimal";

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
  const [goals, events, planned, obligations, funds, projection, accountRows, fxSnap] = await Promise.all([
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
    getLatestUsdIrtRate(),
  ]);

  const pending = planned.filter((p) => p.status === "pending");
  const deficit = projection.points.find((p) => p.deficit);
  const totalPlannedOut = pending
    .filter((p) => p.direction === "outflow")
    .reduce((s, p) => s + Number(p.amountBase), 0);

  const rate = fxSnap.rate;
  const toUsd = (irt: string) => (rate ? D(irt).div(rate).toFixed(2) : "—");

  return (
    <div className="space-y-4">
      <PageHeader
        title="برنامه‌ریزی مالی"
        subtitle="آینده کاملاً از دفترکل جدا است؛ فقط با «اجرا» به ثروت واقعی تبدیل می‌شود. معادل دلاری با آخرین نرخ به‌صورت لحظه‌ای محاسبه می‌شود."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="نقدینگی فعلی" value={formatMoney(projection.startingLiquidity)} />
        <Stat label="خروج برنامه‌ریزی‌شده" value={formatMoney(totalPlannedOut)} tone="down" />
        <Stat label="نقدینگی پایان دوره" value={formatMoney(projection.points.at(-1)?.cumulative ?? "0")} tone={deficit ? "down" : "up"} />
        <Stat label="هشدار کسری" value={deficit ? formatShortDate(deficit.month) : "ندارد"} tone={deficit ? "down" : "up"} />
      </div>

      {/* Rate banner — shared source of truth */}
      <div className="soft rounded-2xl p-3 text-[11px] flex flex-wrap items-center justify-between gap-2">
        <span>نرخ دلار مرجع برای تمام پیش‌نمایش‌ها: <strong dir="ltr" className="num">{formatMoney(rate, "IRT")}</strong> ≈ $1</span>
        <span className="muted">تاریخ نرخ: <span dir="ltr" className="num">{fxSnap.effectiveDate}</span> · منبع: {fxSnap.source} · با تغییر نرخ، معادل دلاری تمام آیتم‌های برنامه‌ریزی به‌صورت خودکار به‌روزرسانی می‌شود (فقط نمایشی)</span>
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
                  <td className="py-1.5">{formatShortDate(p.month)} <span className="muted text-[10px]" dir="ltr">{p.month}</span></td>
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
          {planned.map((p) => {
            const usd = toUsd(p.amountBase);
            const dual = getDualDate(p.plannedDate);
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs">
                <div>
                  <div>
                    {p.title}
                    <span className="chip mr-2">{p.direction === "inflow" ? "ورودی" : "خروجی"}</span>
                    {p.recurrence !== "none" && (
                      <span className="chip mr-1">{p.recurrence === "monthly" ? "ماهانه" : "سالانه"}</span>
                    )}
                  </div>
                  <div className="muted mt-1 text-[10px] flex flex-wrap gap-2">
                    <span>شمسی: <span dir="rtl">{dual.jalali}</span></span>
                    <span>میلادی: <span dir="ltr" className="num">{dual.gregorian}</span></span>
                    <span>·</span>
                    <span>{p.status === "executed" ? "اجرا شده — در دفترکل" : p.status === "cancelled" ? "لغو شده" : "در انتظار اجرا"}</span>
                  </div>
                  <div className="muted text-[10px]">مبلغ به تومان: <span dir="rtl" className="num">{formatMoney(p.amountBase, "IRT")}</span> ≈ <span dir="ltr" className="num" style={{ color:"var(--accent)" }}>{usd !== "—" ? formatMoney(usd, "USD") : "—"}</span> <span className="chip">نرخ لحظه‌ای</span></div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="num" dir="rtl">{formatMoney(p.amountBase, "IRT")}</span>
                  <span className="muted text-[10px]">≈</span>
                  <span className="num" dir="ltr" style={{ color:"var(--accent)" }}>{usd !== "—" ? formatMoney(usd, "USD") : "—"}</span>
                  {p.status === "pending" && (
                    <div className="flex gap-1">
                      <RowAction kind="execute-plan" id={p.id} label="اجرا" primary />
                      <a href={`/new?title=${encodeURIComponent(p.title)}&irtAmount=${p.amountBase}&entryDate=${p.plannedDate}`} className="btn btn-ghost !py-1 !px-2 text-[11px]">بارگذاری در فرم تراکنش</a>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="اهداف مالی">
          <ul className="space-y-4">
            {goals.map((g) => {
              const usdTarget = toUsd(g.targetBase);
              const usdSaved = toUsd(g.savedBase);
              const dual = g.targetDate ? getDualDate(g.targetDate) : null;
              return (
                <li key={g.id}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span>
                      {g.name}
                      {dual && <span className="muted mr-2 text-[10px]">تا {dual.jalali} / <span dir="ltr" className="num">{dual.gregorian}</span></span>}
                    </span>
                    <span className="num muted" dir="ltr">
                      {formatMoney(g.savedBase, "IRT")} / {formatMoney(g.targetBase, "IRT")}
                      <span className="mr-1" style={{ color:"var(--accent)" }}>≈ {usdSaved !== "—" ? formatMoney(usdSaved, "USD") : "—"} / {usdTarget !== "—" ? formatMoney(usdTarget, "USD") : "—"}</span>
                    </span>
                  </div>
                  <Progress value={g.progress} />
                  <div className="muted mt-1 text-[10px] flex justify-between">
                    <span>باقی‌مانده: {formatMoney(g.remainingBase, "IRT")} ≈ {toUsd(g.remainingBase) !== "—" ? formatMoney(toUsd(g.remainingBase), "USD") : "—"}</span>
                    <span>اولویت: {g.priority === 1 ? "بالا" : g.priority === 2 ? "متوسط" : "پایین"} · وضعیت: {g.status}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="صندوق‌های اختصاصی">
          <ul className="space-y-4">
            {funds.map((f) => {
              const usdSaved = toUsd(f.savedBase);
              const usdTarget = toUsd(f.targetBase);
              return (
                <li key={f.id}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span>{f.name}</span>
                    <span className="num muted" dir="ltr">
                      {formatMoney(f.savedBase, "IRT")} / {formatMoney(f.targetBase, "IRT")}
                      <span className="mr-1" style={{ color:"var(--accent)" }}>≈ {formatMoney(usdSaved, "USD")} / {formatMoney(usdTarget, "USD")}</span>
                    </span>
                  </div>
                  <Progress value={f.progress} color="#38bdf8" />
                  {f.note && <div className="muted mt-1 text-[10px]">{f.note}</div>}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="رویدادها و خریدهای آینده">
          <ul className="divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {events.map((e) => {
              const usd = toUsd(e.budgetBase);
              const dual = getDualDate(e.eventDate);
              return (
                <li key={e.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <div>{e.name} <span className="chip mr-2">{CATEGORY[e.category] ?? e.category}</span></div>
                    <div className="muted text-[10px] flex gap-2"><span>شمسی: {dual.jalali}</span><span>میلادی: <span dir="ltr" className="num">{dual.gregorian}</span></span></div>
                  </div>
                  <div className="text-left">
                    <div className="num font-bold" dir="rtl">{formatMoney(e.budgetBase, "IRT")}</div>
                    <div className="num text-[10px]" dir="ltr" style={{ color:"var(--accent)" }}>{usd !== "—" ? formatMoney(usd, "USD") : "—"}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="تعهدات مالی">
          <ul className="divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {obligations.map((o) => {
              const usd = toUsd(o.amountBase);
              const dual = getDualDate(o.dueDate);
              return (
                <li key={o.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <div>{o.title} <span className="chip mr-2">{o.recurrence === "monthly" ? "ماهانه" : o.recurrence === "yearly" ? "سالانه" : "یک‌بار"}</span></div>
                    <div className="muted text-[10px] flex gap-2"><span>سررسید شمسی: {dual.jalali}</span><span>میلادی: <span dir="ltr" className="num">{dual.gregorian}</span></span></div>
                  </div>
                  <div className="text-left">
                    <div className="num font-bold" dir="rtl">{formatMoney(o.amountBase, "IRT")}</div>
                    <div className="num text-[10px]" dir="ltr" style={{ color:"var(--accent)" }}>{usd !== "—" ? formatMoney(usd, "USD") : "—"}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Card title="افزودن برنامه جدید — لایه برنامه‌ریزی (Planning Layer)">
        <p className="muted text-[11px] mb-4">هر آیتم مبلغ به تومان (IRT) به‌عنوان مرجع دارد؛ معادل دلاری با آخرین نرخ به‌صورت لحظه‌ای و فقط نمایشی محاسبه می‌شود. تا قبل از «تأیید نهایی» و «اجرا»، هیچ Journal Entry ایجاد نمی‌شود.</p>
        <div className="space-y-6">
          <PlannedForm accounts={accountRows} initialRate={rate} initialRateDate={fxSnap.effectiveDate} initialRateSource={fxSnap.source} />
          <hr style={{ borderColor: "var(--line)" }} />
          <GoalForm accounts={accountRows} initialRate={rate} initialRateDate={fxSnap.effectiveDate} initialRateSource={fxSnap.source} />
          <hr style={{ borderColor: "var(--line)" }} />
          <EventForm initialRate={rate} initialRateDate={fxSnap.effectiveDate} initialRateSource={fxSnap.source} />
        </div>
      </Card>
    </div>
  );
}
