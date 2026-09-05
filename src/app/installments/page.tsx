import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
import RowAction from "@/components/RowAction";
import {
  formatDualDate,
  todayIso,
  faCount,
  formatMoney,
  formatPct,
  formatTomanPrimary,
  sumToman,
} from "@/lib/format";
import { listInstallmentSchedule } from "@/features/planning/service";

export const dynamic = "force-dynamic";

function daysUntil(iso: string) {
  return Math.ceil((new Date(iso + "T00:00:00Z").getTime() - Date.now()) / 86_400_000);
}

export default async function InstallmentsPage() {
  const authUser = await ensureAuth();
  await seedIfEmpty();
  // Backend is the source of truth for the money rules: the schedule already
  // arrives with the frozen Toman amount and the correct USD figure per state
  // (pending → current rate, paid → payment snapshot). This page only formats.
  const schedule = await listInstallmentSchedule(authUser?.id);
  const rows = schedule.rows;
  const rate = schedule.rate;
  const insight = schedule.pendingUsdInsight;

  const cashAccount = await db
    .select({ id: accounts.id })
    .from(accounts)
    .leftJoin(assets, eq(assets.id, accounts.assetId))
    .where(
      and(
        sql`${accounts.type} = 'asset' and ${accounts.assetId} is not null and ${accounts.deletedAt} is null`,
        authUser ? sql`(${accounts.userId} = ${authUser.id} or ${accounts.userId} is null)` : sql`1=1`,
      ),
    )
    .orderBy(asc(accounts.code))
    .limit(1);

  const today = todayIso();
  const pending = rows.filter((r) => !r.fx.isPaid);
  const paid = rows.filter((r) => r.fx.isPaid);
  const overdueList = pending.filter((r) => r.dueDate < today);
  const next30 = pending.filter((r) => r.dueDate >= today && daysUntil(r.dueDate) <= 30);

  // Pending totals only — a paid installment's Toman is history, not a balance.
  const remainingTotalToman = sumToman(pending.map((r) => r.fx.amountToman));
  const next30Toman = sumToman(next30.map((r) => r.fx.amountToman));
  const remainingDisp = formatTomanPrimary(remainingTotalToman, rate);
  const next30Disp = formatTomanPrimary(next30Toman, rate);

  const insightLabel =
    insight?.direction === "decrease"
      ? "کاهش معادل دلاری"
      : insight?.direction === "increase"
        ? "افزایش معادل دلاری"
        : "معادل دلاری بدون تغییر";

  return (
    <div className="space-y-8">
      <PageHeader title="اقساط" subtitle="مبلغ تومان هر قسط ثابت است؛ معادل دلاری قسط پرداخت‌نشده با نرخ روز محاسبه می‌شود و برای قسط پرداخت‌شده روی نرخ لحظه پرداخت منجمد می‌ماند." />

      <section className="rise grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-4" style={{ borderColor: "var(--border)" }}>
        <Metric label="معوق" value={faCount(overdueList.length)} tone={overdueList.length ? "down" : "neutral"} />
        <Metric
          label="در ۳۰ روز آینده"
          value={faCount(next30.length)}
          hint={next30.length ? next30Disp.primary : undefined}
        />
        <Metric
          label="مانده اقساط"
          value={remainingDisp.primary}
          hint={remainingDisp.usdHint ? `معادل فعلی: ${remainingDisp.usdHint}` : undefined}
        />
        <Metric label="پرداخت‌شده" value={faCount(paid.length)} tone={paid.length > 0 ? "up" : "neutral"} hint={`از ${faCount(rows.length)} قسط`} />
      </section>

      {insight && (
        <div className="card flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
          <div>
            <div className="muted text-[10px] sm:text-[11px] font-medium">{insightLabel}</div>
            <div className="muted mt-0.5 text-[9.5px]">از زمان ثبت قسط · فقط اقساط پرداخت‌نشده</div>
          </div>
          {insight.direction === "unchanged" ? (
            <div className="text-[13px] font-bold" dir="rtl">
              بدون تغییر
            </div>
          ) : (
            <div
              className="text-[13px] font-bold money-nowrap"
              dir="rtl"
              style={{ color: insight.direction === "decrease" ? "var(--negative)" : "var(--positive)" }}
            >
              {formatMoney(insight.amountUsd, "USD")}
              <span className="num mr-2 text-[11px]">{formatPct(insight.percent, 0)}</span>
            </div>
          )}
        </div>
      )}

      <Section title="زمان‌بندی اقساط">
        {rows.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="installments"
              title="هیچ قسطی برنامه‌ریزی نشده است"
              body="با تعریف بدهی و برنامه بازپرداخت، زمان‌بندی اقساط اینجا نمایش داده می‌شود."
              action={
                <Link href="/debts" className="btn btn-primary">
                  رفتن به بدهی‌ها
                </Link>
              }
            />
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>وضعیت</th>
                  <th>بدهی</th>
                  <th className="hidden sm:table-cell">قسط</th>
                  <th>سررسید</th>
                  <th className="td-num">مبلغ</th>
                  <th className="text-left">اقدام</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const late = !r.fx.isPaid && r.dueDate < today;
                  const soon = !late && !r.fx.isPaid && daysUntil(r.dueDate) <= 14;
                  const d = daysUntil(r.dueDate);
                  // Toman is always the frozen obligation. The USD line comes
                  // from the backend view: payment snapshot for a paid row,
                  // current-rate equivalent for a pending one.
                  const primary = r.fx.displayToman != null ? formatMoney(r.fx.displayToman, "IRT") : "—";
                  const usdLine = r.fx.displayUsd != null ? formatMoney(r.fx.displayUsd, "USD") : null;
                  return (
                    <tr key={r.id} className={r.fx.isPaid ? "opacity-50" : ""}>
                      <td>
                        {r.fx.isPaid ? (
                          <span className="badge badge-pos">پرداخت‌شده</span>
                        ) : late ? (
                          <span className="badge badge-neg">معوق</span>
                        ) : soon ? (
                          <span className="badge badge-warn">نزدیک</span>
                        ) : (
                          <span className="badge badge-neutral">در انتظار</span>
                        )}
                      </td>
                      <td style={{ minWidth: "9rem" }}>
                        <span className="block text-[12.5px] font-medium">{r.title}</span>
                        <span className="muted block text-[10px]">{r.creditor}</span>
                      </td>
                      <td className="num hidden sm:table-cell" dir="ltr">
                        #{r.seq}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span className="num block text-[12px]">{formatDualDate(r.dueDate)}</span>
                        <span className="muted num text-[9.5px]">
                          {r.fx.isPaid && r.fx.paidAt
                            ? `پرداخت در ${formatDualDate(r.fx.paidAt)}`
                            : d < 0
                              ? `${faCount(Math.abs(d))} روز گذشته`
                              : d === 0
                                ? "امروز"
                                : `${faCount(d)} روز دیگر`}
                        </span>
                      </td>
                      <td className="td-num font-bold" dir="rtl">
                        <div>{primary}</div>
                        {usdLine && (
                          <div className="muted num text-[9.5px]">
                            {r.fx.isPaid ? "معادل هنگام پرداخت: " : "معادل فعلی: "}
                            {usdLine}
                          </div>
                        )}
                      </td>
                      <td className="text-left">
                        {!r.fx.isPaid && (
                          <span className="row-actions flex justify-end gap-1">
                            <Link
                              href={`/new?type=debt_repayment&installmentId=${r.id}&entryDate=${r.dueDate}&title=${encodeURIComponent(`قسط ${r.seq} — ${r.title}`)}`}
                              className="btn btn-ghost !min-h-8 !px-2.5 !py-1 text-[11px]"
                            >
                              باز کردن در فرم
                            </Link>
                            <RowAction kind="pay-installment" id={r.id} cashAccountId={cashAccount[0]?.id} label="پرداخت سریع" primary />
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
