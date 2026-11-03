import Link from "next/link";
import { OBLIGATION_STATE_LABELS, isReceivable, type ObligationState } from "@/features/planning/obligations";
import { Progress } from "@/components/ui/Card";
import PlanRowMenu from "@/components/planning/PlanRowMenu";
import DateTile from "@/components/ui/DateTile";
import { faCount, formatDaysUntil, formatJalaliIso, formatMoney, formatPct, formatTomanPrimary, daysUntilIso } from "@/lib/format";

export function daysUntil(iso: string) {
  return daysUntilIso(iso);
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
    <li className={`obl-card${settled ? " is-settled" : ""}`}>
      <div className="obl-card-head">
        <div className="obl-card-id">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="obl-card-title">{d.title}</h3>
            {badge && <span className={badge}>{OBLIGATION_STATE_LABELS[state]}</span>}
          </div>
          {/* Each fact is one unbreakable chip: the line wraps between them,
              never inside «شروع ۱۴۰۵/۰۲/۱۳». */}
          <p className="obl-card-meta">
            <span>{d.creditor}</span>
            <span>
              شروع <bdi className="num">{formatJalaliIso(d.startDate)}</bdi>
            </span>
            {interest > 0 && (
              <span>
                سود <bdi className="num">{formatPct(interest, 1)}</bdi>
              </span>
            )}
          </p>
        </div>
        <div className="obl-card-figure">
          <p className="obl-card-amount num money-nowrap" dir="rtl" style={settled ? { color: "var(--positive)" } : undefined}>
            {outstanding.primary}
          </p>
          {d.principalToman != null && !settled && (
            <p className="obl-card-principal num money-nowrap" dir="rtl">
              از اصل {formatMoney(d.principalToman, "IRT")}
            </p>
          )}
        </div>
        <div className="obl-card-menu">
          <PlanRowMenu
            kind="debt"
            item={{ id: d.id, name: d.title, creditor: d.creditor, status: d.status ?? "active", hasPayments: d.paidCount > 0 }}
            today={today}
          />
        </div>
      </div>

      {scheduled && (
        <div className="obl-card-progress">
          <div className="min-w-0 flex-1">
            <Progress
              value={progress}
              color={settled ? "var(--positive)" : "var(--action)"}
              aria-label="پیشرفت اقساط"
              segments={d.totalCount}
            />
          </div>
          <span className="muted num shrink-0 text-[length:var(--fs-xs)]">
            {faCount(d.paidCount)} از {faCount(d.totalCount)}
          </span>
        </div>
      )}

      {!settled && (
        <div className="obligation-card-foot">
          <div className="obl-card-next" data-late={late || undefined}>
            {d.nextDue && <DateTile iso={d.nextDue.dueDate} size="sm" className="shrink-0" />}
            {d.nextDue ? (
              <div className="obl-card-next-body">
                <span className="obl-card-next-label">{receivable ? "دریافت بعدی" : "قسط بعدی"}</span>
                <b className="obl-card-next-amount num money-nowrap" dir="rtl">
                  {d.nextDue.amountToman != null ? formatMoney(d.nextDue.amountToman, "IRT") : "—"}
                </b>
                <span className="obl-card-next-when">{dDays != null ? formatDaysUntil(dDays) : "—"}</span>
              </div>
            ) : (
              <span className="obl-card-next-label">بدون زمان‌بندی</span>
            )}
          </div>
          <div className="obl-card-actions">
            {scheduled && (
              <Link href="/debts/installments" className="btn btn-soft">
                اقساط
              </Link>
            )}
            <Link href={settleHref} className={`btn ${scheduled ? "btn-ghost" : "btn-soft"}`}>
              {scheduled ? (receivable ? "دریافت آزاد" : "پرداخت آزاد") : receivable ? "ثبت دریافت" : "پرداخت"}
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}
