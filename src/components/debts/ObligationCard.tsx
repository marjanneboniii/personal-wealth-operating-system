import Link from "next/link";
import { OBLIGATION_STATE_LABELS, isReceivable, type ObligationState } from "@/features/planning/obligations";
import { Progress } from "@/components/ui/Card";
import { faCount, formatDaysUntil, formatJalaliIso, formatMoney, formatPct, formatTomanPrimary } from "@/lib/format";

export function daysUntil(iso: string) {
  return Math.ceil((new Date(iso + "T00:00:00Z").getTime() - Date.now()) / 86_400_000);
}

export type ObligationCardData = {
  id: string;
  title: string;
  creditor: string;
  startDate: string;
  interestRate?: string | number | null;
  direction?: string | null;
  /** Derived state from the planning service; older read models only carry `status`. */
  state?: string | null;
  status?: string | null;
  principalToman?: string | number | null;
  outstandingToman?: string | number | null;
  paidCount: number;
  totalCount: number;
  nextDue?: { dueDate: string; amountToman?: string | number | null } | null;
};

/** «فعال» is the normal case and gets no badge — only states worth noticing do. */
const STATE_BADGE: Partial<Record<ObligationState, string>> = {
  "due-soon": "badge badge-warn",
  overdue: "badge badge-neg",
  "partially-paid": "badge badge-warn",
  settled: "badge badge-pos",
  cancelled: "badge badge-neutral",
};

function resolveState(d: ObligationCardData, today: string): ObligationState {
  if (d.state && d.state in OBLIGATION_STATE_LABELS) return d.state as ObligationState;
  if (d.status === "settled") return "settled";
  if (d.nextDue && d.nextDue.dueDate < today) return "overdue";
  return "active";
}

/**
 * One obligation — a debt, a receivable or a loan.
 *
 * Reads top to bottom: what and with whom → what is left → how far through the
 * schedule → what is next, with the one action that fits. Toman is the
 * contractual figure; USD never appears on the card.
 *
 *   قسطی      → «اقساط» (pay there) + «پرداخت آزاد»
 *   بدون قسط  → «پرداخت» / «ثبت دریافت» straight into the transaction form
 */
export default function ObligationCard({ d, today, rate }: { d: ObligationCardData; today: string; rate: string | null }) {
  const receivable = isReceivable(d.direction);
  const state = resolveState(d, today);
  const settled = state === "settled";
  const late = state === "overdue";
  const badge = STATE_BADGE[state];
  const outstanding = formatTomanPrimary(settled ? "0" : (d.outstandingToman ?? "0"), rate);
  const progress = d.totalCount ? (d.paidCount / d.totalCount) * 100 : 0;
  const dDays = d.nextDue ? daysUntil(d.nextDue.dueDate) : null;
  const interest = Number(d.interestRate ?? 0);
  const scheduled = d.totalCount > 0;

  const settleHref = `/new?type=debt_repayment&debtId=${d.id}&title=${encodeURIComponent(
    `${receivable ? "دریافت" : "بازپرداخت"} — ${d.title}`,
  )}`;

  return (
    <li className={`card obligation-card${settled ? " is-settled" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-[length:var(--fs-sm)] font-semibold leading-6">{d.title}</h3>
            {badge && <span className={badge}>{OBLIGATION_STATE_LABELS[state]}</span>}
          </div>
          <p className="muted mt-0.5 text-[length:var(--fs-xs)] leading-5">
            {d.creditor}
            <span aria-hidden="true"> · </span>
            شروع <span className="num">{formatJalaliIso(d.startDate)}</span>
            {interest > 0 && (
              <>
                <span aria-hidden="true"> · </span>
                سود <span className="num">{formatPct(interest, 1)}</span>
              </>
            )}
          </p>
        </div>
        <div className="shrink-0 text-left">
          <p
            className="num text-[length:var(--fs-md)] font-bold leading-6 money-nowrap"
            dir="rtl"
            style={settled ? { color: "var(--positive)" } : undefined}
          >
            {outstanding.primary}
          </p>
          {d.principalToman != null && !settled && (
            <p className="muted num text-[length:var(--fs-xs)] leading-5 money-nowrap" dir="rtl">
              اصل {formatMoney(d.principalToman, "IRT")}
            </p>
          )}
        </div>
      </div>

      {scheduled && (
        <div className="mt-3 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <Progress
              value={progress}
              color={settled ? "var(--positive)" : "var(--action)"}
              aria-label="پیشرفت اقساط"
            />
          </div>
          <span className="muted num shrink-0 text-[length:var(--fs-xs)]">
            {faCount(d.paidCount)} از {faCount(d.totalCount)}
          </span>
        </div>
      )}

      {!settled && (
        <div className="obligation-card-foot">
          <p
            className="min-w-0 text-[length:var(--fs-xs)] leading-5"
            style={{ color: late ? "var(--negative)" : "var(--text-2)" }}
          >
            {d.nextDue ? (
              <>
                {receivable ? "دریافت بعدی" : "قسط بعدی"}{" "}
                <b className="num font-semibold" dir="rtl">
                  {d.nextDue.amountToman != null ? formatMoney(d.nextDue.amountToman, "IRT") : "—"}
                </b>
                <span aria-hidden="true"> · </span>
                <span className="num">{dDays != null ? formatDaysUntil(dDays) : "—"}</span>
              </>
            ) : (
              "بدون زمان‌بندی"
            )}
          </p>
          <div className="flex shrink-0 gap-1.5">
            {scheduled && (
              <Link href="/debts/installments" className="btn btn-soft !min-h-9 !px-3.5 !py-1.5 text-[length:var(--fs-xs)]">
                اقساط
              </Link>
            )}
            <Link
              href={settleHref}
              className={`btn ${scheduled ? "btn-ghost" : "btn-soft"} !min-h-9 !px-3.5 !py-1.5 text-[length:var(--fs-xs)]`}
            >
              {scheduled ? (receivable ? "دریافت آزاد" : "پرداخت آزاد") : receivable ? "ثبت دریافت" : "پرداخت"}
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}
