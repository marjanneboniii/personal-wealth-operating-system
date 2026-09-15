import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import SettleObligationSheet from "@/components/forms/SettleObligationSheet";
import ModuleTabs, { DEBT_TABS } from "@/components/ui/ModuleTabs";
import {
  INSTALLMENT_PARTIAL,
  isReceivable,
} from "@/features/planning/obligations";
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
    <div className="muted num text-[length:var(--fs-xs)] money-nowrap" dir="rtl">
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
      <dd className="num text-[length:var(--fs-xs)] font-semibold" dir="rtl">
        {value}
      </dd>
    </div>
  );
}

/**
 * بدهی → اقساط
 *
 * ONE LIST for the web and the installed PWA — no table to scroll sideways on
 * a phone, and no second copy of every row. Each installment is a row:
 *
 *   ● seq   title · creditor                     amount (+ remainder, $ line)
 *   ─────────────────────────────────────────────────────────────────────────
 *   سررسید <date> · <countdown>          [باز کردن در فرم] [پرداخت قسط]
 *
 * Rows are grouped: «معوق», «پیش‌رو», and the settled ones folded away under
 * «پرداخت‌شده‌ها». Backend is the source of truth for the money rules: the
 * schedule arrives with the frozen Toman amount and the correct USD figure per
 * state (pending → current rate, paid → payment snapshot). This page only formats.
 */
export default async function InstallmentsPage() {
  const authUser = await ensureAuth();
  await seedIfEmpty();
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
  const upcomingList = pending.filter((r) => r.dueDate >= today);
  const next30 = pending.filter((r) => r.dueDate >= today && daysUntil(r.dueDate) <= 30);

  // Outstanding totals only — a settled installment's Toman is history, not a
  // balance. `dueToman` (resolved in the backend) is what is STILL owed.
  const remainingTotalToman = sumToman(pending.map((r) => r.dueToman));
  const next30Toman = sumToman(next30.map((r) => r.dueToman));
  const remainingDisp = formatTomanPrimary(remainingTotalToman, rate);
  const next30Disp = formatTomanPrimary(next30Toman, rate);

  const insightLabel =
    insight?.direction === "decrease"
      ? "کاهش معادل دلاری اقساط پرداخت‌نشده"
      : insight?.direction === "increase"
        ? "افزایش معادل دلاری اقساط پرداخت‌نشده"
        : "معادل دلاری اقساط بدون تغییر";
  // A DEBT is the mirror image of an asset: FEWER dollars of obligation is good
  // news, so the colour follows that reading, and the words say it out loud.
  const insightWord =
    insight?.direction === "decrease" ? "کمتر از زمان ثبت" : insight?.direction === "increase" ? "بیشتر از زمان ثبت" : "بدون تغییر";
  const insightColor =
    insight?.direction === "decrease"
      ? "var(--positive)"
      : insight?.direction === "increase"
        ? "var(--negative)"
        : undefined;

  const renderRow = (r: (typeof rows)[number]) => {
    const late = !r.fx.isPaid && r.dueDate < today;
    const soon = !late && !r.fx.isPaid && daysUntil(r.dueDate) <= 14;
    const d = daysUntil(r.dueDate);
    // Toman is always the frozen obligation.
    const primary = r.fx.displayToman != null ? formatMoney(r.fx.displayToman, "IRT") : "—";
    const receivable = isReceivable(r.direction);
    const partial = r.status === INSTALLMENT_PARTIAL;
    // A paid installment shows WHEN IT WAS PAID (its due date is a note); a
    // pending one shows the countdown. The countdown phrase is an RTL isolate.
    const paidAt = r.fx.isPaid ? r.fx.paidAt : null;
    const paidOnTime = paidAt != null && paidAt === r.dueDate;
    const formHref = `/new?type=debt_repayment&installmentId=${r.id}&entryDate=${r.dueDate}&title=${encodeURIComponent(`قسط ${r.seq} — ${r.title}`)}`;

    return (
      <li
        key={r.id}
        className={`inst-row${r.fx.isPaid ? " is-paid" : ""}`}
        data-tone={late ? "late" : soon ? "soon" : undefined}
      >
        <div className="inst-head">
          <span className="inst-seq num" aria-label={`قسط ${faCount(r.seq)}`}>
            {r.fx.isPaid ? <Icon name="check" size={14} /> : faCount(r.seq)}
          </span>
          <div className="inst-main">
            <span className="inst-title" title={r.title}>
              {r.title}
            </span>
            <span className="inst-meta" title={r.creditor}>
              {r.creditor}
              {partial && (
                <>
                  {" · "}
                  <span style={{ color: "var(--warning)" }}>بخشی پرداخت شده</span>
                </>
              )}
            </span>
          </div>
          <div className="inst-side">
            <span className="num inst-amount money-nowrap" dir="rtl">
              {primary}
            </span>
            {/* A part-settled row states what is LEFT: the contractual figure
                above is no longer what the user owes. */}
            {partial && (
              <span className="num text-[length:var(--fs-xs)] money-nowrap" dir="rtl" style={{ color: "var(--warning)" }}>
                باقی‌مانده: {formatMoney(r.dueToman, "IRT")}
              </span>
            )}
            <InstallmentUsdLine fx={r.fx} />
          </div>
        </div>

        <div className="inst-foot">
          {paidAt ? (
            <span className="inst-when">
              <span>
                {receivable ? "دریافت" : "پرداخت"} <span className="num font-medium">{formatJalaliIso(paidAt)}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span className="num">{paidOnTime ? "در سررسید پرداخت شد" : `سررسید ${formatJalaliIso(r.dueDate)}`}</span>
            </span>
          ) : (
            <span className="inst-when">
              <span>
                سررسید <span className="num font-medium">{formatJalaliIso(r.dueDate)}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span
                className="font-medium whitespace-nowrap"
                style={late ? { color: "var(--negative)" } : soon ? { color: "var(--warning)" } : undefined}
              >
                {formatDaysUntil(d)}
              </span>
            </span>
          )}

          {!r.fx.isPaid && (
            <div className="inst-actions">
              <Link href={formHref} className="btn btn-ghost !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]">
                باز کردن در فرم
              </Link>
              <SettleObligationSheet
                installmentId={r.id}
                dueToman={r.dueToman}
                paidSoFarToman={r.paidSoFarToman}
                cashAccountId={cashAccount[0]?.id}
                direction={r.direction}
                label={`قسط ${r.seq} — ${r.title}`}
                className="inst-settle"
                buttonClassName="w-full"
              />
            </div>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-7">
      <div>
        <PageHeader
          title="اقساط"
          action={
            <Link href="/debts#new" className="btn btn-primary">
              <Icon name="plus" size={16} />
              افزودن بدهی قسطی
            </Link>
          }
        />
        <ModuleTabs tabs={DEBT_TABS} active="/debts/installments" label="بخش‌های تعهدات" />
      </div>

      <section className="metric-strip">
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
            <h2 className="text-[length:var(--fs-xs)] font-semibold">{insightLabel}</h2>
            <div className="text-[length:var(--fs-sm)] font-bold money-nowrap" dir="rtl" style={insightColor ? { color: insightColor } : undefined}>
              {insight.direction === "unchanged" ? (
                insightWord
              ) : (
                <>
                  {formatMoney(insight.amountUsd, "USD")}{" "}
                  <span className="text-[length:var(--fs-xs)] font-semibold">{insightWord}</span>{" "}
                  <span className="text-[length:var(--fs-xs)] font-semibold">{formatPctIsolated(insight.percent, 1)}</span>
                </>
              )}
            </div>
          </div>

          {/* The claim's arithmetic — the frozen Toman balance, each side's
              rate and the dollar figure each produces — one tap away. */}
          <details className="mt-2">
            <summary className="muted cursor-pointer text-[length:var(--fs-xs)]">جزئیات محاسبه</summary>
            <dl className="mt-2 space-y-1 border-t pt-2 sm:grid sm:grid-cols-2 sm:gap-x-6 sm:space-y-0" style={{ borderColor: "var(--border)" }}>
              <InsightRow label="مانده اقساط پرداخت‌نشده" value={formatMoney(insight.amountToman, "IRT")} />
              <InsightRow
                label={insight.avgOriginalFxRate ? `با نرخ زمان ثبت · ${formatMoney(insight.avgOriginalFxRate, "IRT")}` : "با نرخ زمان ثبت"}
                value={formatMoney(insight.originalUsd, "USD")}
              />
              <InsightRow
                label={insight.currentFxRate ? `با نرخ روز · ${formatMoney(insight.currentFxRate, "IRT")}` : "با نرخ روز"}
                value={formatMoney(insight.currentUsd, "USD")}
              />
              <InsightRow label="معادلِ قسط‌های داخل این محاسبه" value={`${faCount(insight.count)} قسط`} />
            </dl>
            {insight.missingOriginalCount > 0 && (
              <p className="muted mt-2 text-[length:var(--fs-xs)] leading-5">
                {faCount(insight.missingOriginalCount)} قسط نرخ زمان ثبت ندارد و محاسبه نشده است.
              </p>
            )}
          </details>
        </section>
      )}

      <Section title="زمان‌بندی اقساط">
        {rows.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="installments"
              title="هیچ قسطی برنامه‌ریزی نشده است"
              body="با تعریف بدهی و برنامه بازپرداخت، زمان‌بندی اقساط اینجا نمایش داده می‌شود."
              action={
                <Link href="/debts#new" className="btn btn-primary">
                  افزودن بدهی قسطی
                </Link>
              }
            />
          </div>
        ) : (
          <div className="space-y-4">
            {overdueList.length > 0 && (
              <div className="space-y-2">
                <h3 className="inst-group-title" style={{ color: "var(--negative)" }}>
                  معوق <span className="num">{faCount(overdueList.length)}</span>
                </h3>
                <ul className="inst-list">{overdueList.map(renderRow)}</ul>
              </div>
            )}

            {upcomingList.length > 0 && (
              <div className="space-y-2">
                <h3 className="inst-group-title">
                  پیش‌رو <span className="num">{faCount(upcomingList.length)}</span>
                </h3>
                <ul className="inst-list">{upcomingList.map(renderRow)}</ul>
              </div>
            )}

            {paid.length > 0 && (
              <details className="inst-paid" open={pending.length === 0}>
                <summary className="inst-group-title">
                  پرداخت‌شده‌ها <span className="num">{faCount(paid.length)}</span>
                </summary>
                <ul className="inst-list">{paid.map(renderRow)}</ul>
              </details>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
