import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import { listDebts } from "@/features/planning/service";
import {
  OBLIGATION_STATE_LABELS,
  isReceivable,
  type ObligationState,
} from "@/features/planning/obligations";
import { EmptyState, Card, Metric, PageHeader, Progress, Section, SectionLink } from "@/components/ui/Card";
import DebtForm from "@/components/forms/DebtForm";
import Icon from "@/components/ui/Icon";
import {
  formatJalaliIso,
  formatMoney,
  formatPct,
  todayIso,
  faCount,
  formatDaysUntil,
  formatTomanPrimary,
  sumToman,
} from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

function daysUntil(iso: string) {
  return Math.ceil((new Date(iso + "T00:00:00Z").getTime() - Date.now()) / 86_400_000);
}

/** The badge class each derived state carries. Colour follows MEANING. */
const STATE_BADGE: Record<ObligationState, string> = {
  active: "badge badge-neutral",
  "due-soon": "badge badge-warn",
  overdue: "badge badge-neg",
  "partially-paid": "badge badge-warn",
  settled: "badge badge-pos",
  cancelled: "badge badge-neutral",
};

type Obligation = Awaited<ReturnType<typeof listDebts>>[number];

/**
 * One obligation card — «بدهی من» or «طلب من».
 *
 * The card answers, in this order, the questions the brief lists (§16): who,
 * which direction, how much in total, how much is left, what state it is in,
 * when the next date is, and how far through the schedule it is. The primary
 * action is the ONE thing the user came here to do, and it differs by
 * direction and by whether a schedule exists:
 *
 *   بدهی بدون قسط  → «پرداخت بدهی»
 *   بدهی قسطی      → «مشاهده اقساط»  (then «پرداخت قسط» there)
 *   طلب بدون قسط   → «ثبت دریافت»
 *   طلب قسطی       → «مشاهده اقساط»
 *
 * The non-installment payment link is what was missing entirely: a debt with no
 * schedule rendered a card with no way to pay it, because the only action was
 * bound to `nextDue`, which such a debt never has. The transaction form has
 * accepted `?debtId=` for direct debt settlement all along — this just points
 * at it.
 */
function ObligationCard({ d, today, rate }: { d: Obligation; today: string; rate: string | null }) {
  const receivable = isReceivable(d.direction);
  const state = (d.state ?? "active") as ObligationState;
  const settled = state === "settled";
  const progress = d.totalCount ? (d.paidCount / d.totalCount) * 100 : 0;
  const dDays = d.nextDue ? daysUntil(d.nextDue.dueDate) : null;
  const late = state === "overdue";

  const outToman = settled ? "0" : (d.outstandingToman ?? "0");
  const outDisp = formatTomanPrimary(outToman, rate);
  const nextInstToman = d.nextDue?.amountToman != null ? String(d.nextDue.amountToman) : null;

  // A receivable's outstanding balance is money COMING IN, so it is not painted
  // in the negative hue a debt gets. Same number, opposite meaning.
  const balanceColor = settled
    ? "var(--positive)"
    : receivable
      ? "var(--positive)"
      : "var(--negative)";

  const settleHref = `/new?type=debt_repayment&debtId=${d.id}&title=${encodeURIComponent(
    `${receivable ? "دریافت" : "بازپرداخت"} — ${d.title}`,
  )}`;

  return (
    <li className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[length:var(--fs-xs)] sm:text-[length:var(--fs-sm)] font-semibold tracking-tight money-nowrap">
            {settled && (
              <span style={{ color: "var(--positive)" }}>
                <Icon name="check-circle" size={17} />
              </span>
            )}
            {d.title}
            <span className={receivable ? "badge badge-pos" : "badge badge-neutral"}>
              {receivable ? "طلب من" : "بدهی من"}
            </span>
            <span className={STATE_BADGE[state]}>{OBLIGATION_STATE_LABELS[state]}</span>
          </p>
          <p className="muted mt-1 text-[length:var(--fs-xs)]">
            {receivable ? "بدهکار" : "بستانکار"}: {d.creditor} · شروع {formatJalaliIso(d.startDate)} · نرخ سود{" "}
            <span className="num" dir="rtl">{formatPct(d.interestRate, 2)}</span>
          </p>
          <p className="muted mt-0.5 text-[length:var(--fs-xs)]">
            اصل مبلغ:{" "}
            <span className="num" dir="rtl">
              {d.principalToman != null ? formatMoney(d.principalToman, "IRT") : "—"}
            </span>
          </p>
        </div>
        <div className="text-left">
          <p className="muted text-[length:var(--fs-xs)]">
            {receivable ? "مانده قابل دریافت" : "مانده قابل پرداخت"}
          </p>
          <p className="num text-xl font-bold" dir="rtl" style={{ color: balanceColor }}>
            {outDisp.primary}
          </p>
          <p className="muted num mt-0.5 text-[length:var(--fs-xs)]" dir="rtl">
            {outDisp.usdHint ? <>معادل: {outDisp.usdHint}</> : null}
          </p>
        </div>
      </div>

      {d.totalCount > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-[length:var(--fs-xs)]">
            <span className="muted">
              <span className="num" dir="rtl">
                {faCount(d.paidCount)} از {faCount(d.totalCount)}
              </span>{" "}
              قسط {receivable ? "دریافت" : "پرداخت"} شده
            </span>
            <span className="num" dir="rtl">{formatPct(progress, 0)}</span>
          </div>
          <Progress value={progress} color={settled ? "var(--positive)" : "var(--brand)"} />
        </div>
      )}

      <div
        className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3.5"
        style={{ borderColor: "var(--border)" }}
      >
        <p
          className="text-[length:var(--fs-xs)]"
          style={{ color: late ? "var(--negative)" : "var(--text-2)" }}
        >
          {d.nextDue ? (
            <>
              {receivable ? "دریافت بعدی" : "قسط بعدی"}:{" "}
              <b className="num">{nextInstToman != null ? formatMoney(nextInstToman, "IRT") : "—"}</b> ·{" "}
              {/* Shared helper: the number must sit BEFORE «روز»
                  («۱۷ روز دیگر»); hand-written variants of this phrase kept
                  getting shuffled by the bidi rules. */}
              <b
                className="num"
                style={dDays != null && dDays < 0 ? { color: "var(--negative)" } : undefined}
              >
                {dDays != null ? formatDaysUntil(dDays) : "—"}
              </b>
            </>
          ) : settled ? (
            receivable ? "همه اقساط دریافت شدند." : "همه اقساط پرداخت شدند."
          ) : (
            "بدون زمان‌بندی — هر زمان قابل تسویه است."
          )}
        </p>
        <div className="flex gap-1.5">
          {!settled &&
            (d.totalCount > 0 ? (
              <Link
                href="/debts/installments"
                className="btn btn-primary !min-h-9 !px-3.5 !py-1.5 text-[length:var(--fs-xs)]"
              >
                مشاهده اقساط
              </Link>
            ) : (
              /* THE MISSING ACTION. A debt with no schedule used to render a
                 card with no way to settle it at all. */
              <Link
                href={settleHref}
                className="btn btn-primary !min-h-9 !px-3.5 !py-1.5 text-[length:var(--fs-xs)]"
              >
                {receivable ? "ثبت دریافت" : "پرداخت بدهی"}
              </Link>
            ))}
          {d.totalCount > 0 && (
            <Link
              href={settleHref}
              className="btn btn-ghost !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]"
            >
              {receivable ? "دریافت آزاد" : "پرداخت آزاد"}
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

export default async function DebtsPage() {
  await ensureAuth();
  await seedIfEmpty();
  const [all, fx] = await Promise.all([listDebts(), getLatestUsdIrtRate()]);

  const today = todayIso();
  // DIRECTION SPLIT. The two sides are never summed together: netting a
  // receivable against a debt would report neither correctly.
  const debts = all.filter((d) => !isReceivable(d.direction));
  const receivables = all.filter((d) => isReceivable(d.direction));

  // Toman is authoritative — never rebuild from USD × live rate.
  const totalDebtToman = sumToman(debts.map((d) => d.outstandingToman));
  const totalReceivableToman = sumToman(receivables.map((d) => d.outstandingToman));
  const overdue = all.flatMap((d) =>
    d.installments.filter((i) => i.status !== "paid" && i.dueDate < today),
  );
  const nextPayment = debts
    .flatMap((d) => (d.nextDue ? [{ ...d.nextDue, title: d.title }] : []))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const nextToman = nextPayment?.amountToman != null ? String(nextPayment.amountToman) : null;
  const nextDisp = nextToman ? formatTomanPrimary(nextToman, fx.rate) : null;
  const debtDisp = formatTomanPrimary(totalDebtToman, fx.rate);
  const receivableDisp = formatTomanPrimary(totalReceivableToman, fx.rate);

  return (
    <div className="space-y-8">
      <PageHeader
        title="تعهدات مالی"
        subtitle="بدهی‌ها و مطالبات شما در یک جا. مبلغ تومان هر تعهد ثابت است؛ معادل دلاری فقط نمایشی است و با نرخ روز تغییر می‌کند."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="#manual-debt"
              className="btn btn-primary !min-h-9 !px-3.5 !py-1.5 text-[length:var(--fs-xs)]"
            >
              <Icon name="plus" size={15} />
              ثبت تعهد
            </Link>
            <SectionLink href="/debts/installments" label="برنامه اقساط" />
          </div>
        }
      />

      {/* بدهی‌های من · مطالبات من · اقساط · وام‌ها · تعهدات آینده */}
      <nav className="seg flex-wrap" aria-label="بخش‌های تعهدات">
        <span className="seg-on">بدهی‌ها و مطالبات</span>
        <Link href="/debts/loans">وام‌ها</Link>
        <Link href="/debts/installments">اقساط</Link>
        <Link href="/debts/obligations">تعهدات آینده</Link>
      </nav>

      <section
        className="grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-4"
        style={{ borderColor: "var(--border)" }}
      >
        <Metric
          label="کل بدهی‌های من"
          value={debtDisp.primary}
          tone={Number(totalDebtToman) > 0 ? "down" : "neutral"}
          hint={
            Number(totalDebtToman) === 0
              ? "بدهی‌ای ندارید"
              : debtDisp.usdHint
                ? `معادل: ${debtDisp.usdHint}`
                : `${faCount(debts.length)} بدهی`
          }
        />
        {/* «کل مطالبات» appears only when the user actually has one: an empty
            KPI is noise on a dashboard this deliberately minimal. */}
        {receivables.length > 0 ? (
          <Metric
            label="کل مطالبات من"
            value={receivableDisp.primary}
            tone="up"
            hint={
              receivableDisp.usdHint
                ? `معادل: ${receivableDisp.usdHint}`
                : `${faCount(receivables.length)} مورد`
            }
          />
        ) : (
          <Metric label="اقساط معوق" value={faCount(overdue.length)} tone={overdue.length ? "down" : "neutral"} />
        )}
        <Metric
          label="قسط بعدی"
          value={nextDisp?.primary ?? "—"}
          hint={
            nextPayment
              ? `${nextPayment.title} · ${formatJalaliIso(nextPayment.dueDate)}${nextDisp?.usdHint ? ` · معادل ${nextDisp.usdHint}` : ""}`
              : "قسطی در انتظار نیست"
          }
        />
        <Metric
          label="تسویه‌شده"
          value={faCount(all.filter((d) => d.state === "settled").length)}
          hint={all.length ? `از مجموع ${faCount(all.length)} تعهد` : undefined}
        />
      </section>

      <section id="manual-debt" className="scroll-mt-24">
        <Section
          title="ثبت تعهد جدید"
          hint="اول مشخص کنید بدهی است یا طلب؛ بعد پیش‌نمایش را ببینید. فقط بعد از تأیید نهایی ذخیره می‌شود."
        >
          <Card className="p-4 sm:p-5" title="بدهی یا طلب جدید">
            <DebtForm
              today={today}
              initialRate={fx.rate}
              initialRateDate={fx.effectiveDate}
              initialRateSource={fx.source}
            />
          </Card>
        </Section>
      </section>

      <Section title="بدهی‌های من" hint="پولی که شما به دیگران بدهکارید">
        {debts.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="debts"
              title="هیچ بدهی‌ای ثبت نشده است"
              body="وقتی وام یا بدهی ثبت شود، مانده‌اش اینجا دنبال می‌شود و در صورت قسطی بودن، برنامه بازپرداختش ساخته می‌شود."
            />
          </div>
        ) : (
          <ul className="space-y-2.5">
            {debts.map((d) => (
              <ObligationCard key={d.id} d={d} today={today} rate={fx.rate} />
            ))}
          </ul>
        )}
      </Section>

      {/* The receivables section renders only when the user has one — a debt-only
          user never sees an empty half of a screen they did not ask for. */}
      {receivables.length > 0 && (
        <Section title="مطالبات من" hint="پولی که دیگران به شما بدهکارند">
          <ul className="space-y-2.5">
            {receivables.map((d) => (
              <ObligationCard key={d.id} d={d} today={today} rate={fx.rate} />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
