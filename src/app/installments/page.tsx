import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
import RowAction from "@/components/RowAction";
import {
  formatJalaliIso,
  todayIso,
  faCount,
  formatDaysUntil,
  formatDaysWindow,
  formatMoney,
  formatPctIsolated,
  formatTomanPrimary,
  sumToman,
} from "@/lib/format";
import { listInstallmentSchedule } from "@/features/planning/service";
import type { InstallmentFxView } from "@/features/planning/installmentFx";

export const dynamic = "force-dynamic";

function daysUntil(iso: string) {
  return Math.ceil((new Date(iso + "T00:00:00Z").getTime() - Date.now()) / 86_400_000);
}

/**
 * Per-installment dollar line. Toman is frozen, so the only thing that can
 * move on a PENDING row is its dollar equivalent — and the user reads that
 * per row («چقدر نسبت به زمان ثبت تغییر کرد؟»), not as one anonymous number in
 * a summary band. Paid rows have no such line: their dollar value is history.
 */
function InstallmentUsdLine({ fx }: { fx: InstallmentFxView }) {
  if (fx.displayUsd == null) return null;
  const label = fx.isPaid ? "معادل هنگام پرداخت: " : "معادل فعلی: ";
  const change = fx.usdChange;
  return (
    <div className="muted num mt-0.5 text-[length:var(--fs-xs)] money-nowrap" dir="rtl">
      {label}
      {formatMoney(fx.displayUsd, "USD")}
      {change && change.direction !== "unchanged" ? (
        <>
          {" · "}
          <span style={{ color: change.direction === "decrease" ? "var(--positive)" : "var(--negative)" }}>
            {formatPctIsolated(change.percent, 1)} {change.direction === "decrease" ? "کمتر" : "بیشتر"}
          </span>
          {fx.originalUsdEquivalent ? (
            <>
              {" از "}
              {formatMoney(fx.originalUsdEquivalent, "USD")}
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** One line of the FX breakdown: label on the right, figure on the left. */
function InsightRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-0.5">
      <dt className="muted min-w-0 text-[length:var(--fs-xs)] leading-4">{label}</dt>
      <dd className="num text-[11.5px] font-semibold" dir="rtl">
        {value}
      </dd>
    </div>
  );
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
      ? "کاهش معادل دلاری اقساط پرداخت‌نشده"
      : insight?.direction === "increase"
        ? "افزایش معادل دلاری اقساط پرداخت‌نشده"
        : "معادل دلاری اقساط بدون تغییر";
  // A DEBT is the mirror image of an asset: FEWER dollars of obligation is good
  // news, so the colour follows that reading, and the words «کمتر / بیشتر از
  // زمان ثبت» say it out loud. A bare dollar figure with no stated base and no
  // direction is exactly what made this band unreadable on the phone screenshot.
  const insightWord =
    insight?.direction === "decrease" ? "کمتر از زمان ثبت" : insight?.direction === "increase" ? "بیشتر از زمان ثبت" : "بدون تغییر";
  const insightColor =
    insight?.direction === "decrease"
      ? "var(--positive)"
      : insight?.direction === "increase"
        ? "var(--negative)"
        : undefined;

  return (
    <div className="space-y-8">
      <PageHeader title="اقساط" subtitle="مبلغ تومان هر قسط ثابت است؛ معادل دلاری با نرخ روز محاسبه می‌شود." />

      <section className="rise grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-4" style={{ borderColor: "var(--border)" }}>
        <Metric label="معوق" value={faCount(overdueList.length)} tone={overdueList.length ? "down" : "neutral"} />
        <Metric
          label={formatDaysWindow(30)}
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
        <section className="card px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-[12.5px] font-semibold">{insightLabel}</h2>
            <div className="text-[13px] font-bold money-nowrap" dir="rtl" style={insightColor ? { color: insightColor } : undefined}>
              {insight.direction === "unchanged" ? (
                insightWord
              ) : (
                <>
                  {formatMoney(insight.amountUsd, "USD")}{" "}
                  <span className="text-[11px] font-semibold">{insightWord}</span>{" "}
                  <span className="text-[11px] font-semibold">{formatPctIsolated(insight.percent, 1)}</span>
                </>
              )}
            </div>
          </div>

          {/* The claim, with its arithmetic spelled out: the frozen Toman
              balance, each side's rate, and the dollar figure that comes out of
              dividing one by the other. */}
          <dl className="mt-2 space-y-1 border-t pt-2 sm:grid sm:grid-cols-2 sm:gap-x-6 sm:space-y-0" style={{ borderColor: "var(--border)" }}>
            <InsightRow label="مانده اقساط پرداخت‌نشده" value={formatMoney(insight.amountToman, "IRT")} />
            <InsightRow
              label={
                insight.avgOriginalFxRate
                  ? `با نرخ زمان ثبت · ${formatMoney(insight.avgOriginalFxRate, "IRT")}`
                  : "با نرخ زمان ثبت"
              }
              value={formatMoney(insight.originalUsd, "USD")}
            />
            <InsightRow
              label={
                insight.currentFxRate
                  ? `با نرخ روز · ${formatMoney(insight.currentFxRate, "IRT")}`
                  : "با نرخ روز"
              }
              value={formatMoney(insight.currentUsd, "USD")}
            />
            <InsightRow label="معادلِ قسط‌های داخل این محاسبه" value={`${faCount(insight.count)} قسط`} />
          </dl>

          <p className="muted mt-2 text-[length:var(--fs-xs)] leading-4">
            مبلغ تومان هر قسط ثابت است، پس تنها چیزی که تغییر می‌کند معادل دلاری آن است: همین اختلاف، قسط‌به‌قسط داخل کارت هر قسط هم نوشته شده است.
            {insight.missingOriginalCount > 0
              ? ` ${faCount(insight.missingOriginalCount)} قسط نرخ زمان ثبت ندارد و در این مقایسه حساب نشده است.`
              : ""}
          </p>
        </section>
      )}

      <Section title="زمان‌بندی اقساط" hint="از نزدیک‌ترین سررسید به دورترین">
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
          <>
            {/* ── Mobile / PWA: stacked cards — the 6-column table is
                   unreadable cramped on a phone, so each installment gets a
                   roomy card with status, due date, amount and actions laid
                   out vertically instead of squeezed into one row. ── */}
            <ul className="space-y-2.5 sm:hidden">
              {rows.map((r) => {
                const late = !r.fx.isPaid && r.dueDate < today;
                const soon = !late && !r.fx.isPaid && daysUntil(r.dueDate) <= 14;
                const d = daysUntil(r.dueDate);
                // Toman is always the frozen obligation. The USD line comes
                // from the backend view: payment snapshot for a paid row,
                // current-rate equivalent for a pending one.
                const primary = r.fx.displayToman != null ? formatMoney(r.fx.displayToman, "IRT") : "—";
                const statusBadge = r.fx.isPaid ? (
                  <span className="badge badge-pos">پرداخت‌شده</span>
                ) : late ? (
                  <span className="badge badge-neg">معوق</span>
                ) : soon ? (
                  <span className="badge badge-warn">نزدیک</span>
                ) : (
                  <span className="badge badge-neutral">در انتظار</span>
                );
                /* The date row: a paid installment shows WHEN IT WAS PAID (its
                   due date is history, and printing the same Jalali date twice
                   read as a duplication bug); a pending one shows the countdown.
                   The countdown phrase is an RTL isolate, so a dir="ltr" parent
                   can no longer shuffle the number away from the word «روز». */
                const paidAt = r.fx.isPaid ? r.fx.paidAt : null;
                const paidOnTime = paidAt != null && paidAt === r.dueDate;
                const formHref = `/new?type=debt_repayment&installmentId=${r.id}&entryDate=${r.dueDate}&title=${encodeURIComponent(`قسط ${r.seq} — ${r.title}`)}`;
                return (
                  <li
                    key={r.id}
                    className={`card p-3.5 ${r.fx.isPaid ? "opacity-60" : ""}`}
                    style={late ? { borderInlineStart: "3px solid var(--negative)" } : soon ? { borderInlineStart: "3px solid var(--warning)" } : undefined}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="shrink-0 text-[12.5px] font-semibold leading-6">
                            قسط <span className="num" dir="ltr">#{r.seq}</span>
                          </span>
                          {statusBadge}
                        </div>
                        <div className="mt-1 truncate text-[12px] font-medium" title={r.title}>{r.title}</div>
                        <div className="muted truncate text-[length:var(--fs-xs)]" title={r.creditor}>{r.creditor}</div>
                      </div>
                      <div className="shrink-0 text-left">
                        <div className="num text-[13px] font-bold money-nowrap" dir="rtl">
                          {primary}
                        </div>
                        <InstallmentUsdLine fx={r.fx} />
                      </div>
                    </div>

                    <div
                      className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t pt-2 text-[11px] leading-5"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <span className="muted">
                        {paidAt ? "پرداخت" : "سررسید"}{" "}
                        <span className="num font-medium" dir="ltr">
                          {formatJalaliIso(paidAt ?? r.dueDate)}
                        </span>
                      </span>
                      {paidAt ? (
                        <span className="muted num text-[length:var(--fs-xs)]">
                          {paidOnTime ? "در سررسید پرداخت شد" : `سررسید ${formatJalaliIso(r.dueDate)}`}
                        </span>
                      ) : (
                        <span className="num font-medium" style={late ? { color: "var(--negative)" } : soon ? { color: "var(--warning)" } : undefined}>
                          {formatDaysUntil(d)}
                        </span>
                      )}
                    </div>

                    {!r.fx.isPaid && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Link
                          href={formHref}
                          className="btn btn-soft !min-h-10 !px-2 !py-2 text-[11.5px]"
                        >
                          باز کردن در فرم
                        </Link>
                        <RowAction
                          kind="pay-installment"
                          id={r.id}
                          cashAccountId={cashAccount[0]?.id}
                          label="پرداخت سریع"
                          primary
                          className="w-full [&>button]:w-full"
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {/* ── Tablet / desktop: the full table stays as-is ── */}
            <div className="card hidden overflow-x-auto sm:block">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">وضعیت</th>
                    <th scope="col">بدهی</th>
                    <th scope="col" className="hidden sm:table-cell">قسط</th>
                    <th scope="col">سررسید</th>
                    <th scope="col" className="td-num">مبلغ</th>
                    <th scope="col" className="text-left">اقدام</th>
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
                          <span className="muted block text-[length:var(--fs-xs)]">{r.creditor}</span>
                        </td>
                        <td className="num hidden sm:table-cell" dir="ltr">
                          #{r.seq}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <span className="num block text-[12px]">{formatJalaliIso(r.dueDate)}</span>
                          {r.fx.isPaid && r.fx.paidAt ? (
                            <span className="muted text-[length:var(--fs-xs)]">
                              پرداخت{" "}
                              <span className="num" dir="ltr">
                                {formatJalaliIso(r.fx.paidAt)}
                              </span>
                            </span>
                          ) : (
                            <span className="muted num text-[length:var(--fs-xs)]">{formatDaysUntil(d)}</span>
                          )}
                        </td>
                        <td className="td-num font-bold" dir="rtl">
                          <div>{primary}</div>
                          <InstallmentUsdLine fx={r.fx} />
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
          </>
        )}
      </Section>
    </div>
  );
}
