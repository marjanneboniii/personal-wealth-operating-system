"use client";

/**
 * برنامه بازپرداخت — یکجا · ماهانه · سفارشی.
 *
 * ONE schedule editor for «ثبت بدهی یا طلب» and the setup wizard's «بدهی‌ها و
 * اقساط», so a loan entered on day one gets exactly the choices it would get
 * later: a lump sum, a fixed cadence (monthly or every few months), or its own
 * list of due dates. The dates and per-instalment amounts come from the SAME
 * pure generators the server writes with (`features/planning/obligations`).
 */
import { D } from "@/domain/decimal";
import { faCount, formatMoney } from "@/lib/format";
import {
  MAX_INSTALLMENTS,
  RECURRING_INTERVALS,
  generateDueDates,
  resolveScheduleAmounts,
} from "@/features/planning/obligations";
import DualDateInput from "@/components/ui/DualDateInput";
import JalaliDatePicker from "@/components/ui/JalaliDatePicker";
import AmountInput from "@/components/ui/AmountInput";
import Icon from "@/components/ui/Icon";

/** How the due dates are produced. `none` carries no schedule at all. */
export type ScheduleMode = "none" | "recurring" | "custom";

export type ScheduleValue = {
  mode: ScheduleMode;
  count: string;
  intervalMonths: string;
  firstDueDate: string;
  /** One independent Jalali-picked date per installment. No interval implied. */
  customDates: string[];
  /** Toman per installment; empty splits the amount exactly. */
  installmentIrt: string;
};

export const EMPTY_SCHEDULE: ScheduleValue = {
  mode: "none",
  count: "",
  intervalMonths: "1",
  firstDueDate: "",
  customDates: [""],
  installmentIrt: "",
};

export const INTERVAL_LABELS: Record<number, string> = {
  1: "ماهانه",
  2: "هر ۲ ماه",
  3: "هر ۳ ماه",
  4: "هر ۴ ماه",
  5: "هر ۵ ماه",
  6: "هر ۶ ماه",
};

const TILES: Array<[ScheduleMode, string, string]> = [
  ["none", "یکجا", "بدون قسط"],
  ["recurring", "ماهانه", "یا هر چند ماه"],
  ["custom", "سفارشی", "تاریخ‌های دلخواه"],
];

/** The dates, amounts and readiness a schedule describes. */
export function computeSchedule(value: ScheduleValue, principalIrt: string, startDate: string) {
  const count = Math.max(0, Math.min(MAX_INSTALLMENTS, Number(value.count) || 0));
  const customDates = value.customDates.filter((d) => d.length > 0);
  let dueDates: string[] = [];
  if (value.mode === "custom" && customDates.length > 0) {
    dueDates = generateDueDates({ kind: "custom", dueDates: customDates });
  } else if (value.mode === "recurring" && count > 0 && value.firstDueDate) {
    dueDates = generateDueDates({
      kind: "recurring",
      count,
      intervalMonths: Number(value.intervalMonths) || 1,
      firstDueDate: value.firstDueDate,
    });
  }

  let amounts: string[] = [];
  if (dueDates.length > 0 && principalIrt && D(principalIrt).gt(0)) {
    try {
      amounts = resolveScheduleAmounts({
        principalToman: D(principalIrt).toFixed(0),
        count: dueDates.length,
        installmentToman: value.installmentIrt,
      });
    } catch {
      amounts = [];
    }
  }
  const total = amounts.reduce((sum, a) => sum.add(D(a)), D("0"));

  const firstDueBeforeStart = value.mode === "recurring" && !!value.firstDueDate && !!startDate && value.firstDueDate < startDate;
  const customDueBeforeStart = value.mode === "custom" && !!startDate && customDates.some((due) => due < startDate);
  const ready =
    value.mode === "none" ||
    (value.mode === "recurring" && count > 0 && !!value.firstDueDate && !firstDueBeforeStart) ||
    (value.mode === "custom" && customDates.length > 0 && !customDueBeforeStart);

  return { count, customDates, dueDates, amounts, total, ready, firstDueBeforeStart, customDueBeforeStart };
}

/** What the server reads — a custom schedule sends ONLY its dates, a recurring one only its cadence. */
export function scheduleSubmission(value: ScheduleValue, principalIrt = "", startDate = "") {
  const { count, customDates } = computeSchedule(value, principalIrt, startDate);
  return {
    installmentCount: value.mode === "recurring" ? count : 0,
    intervalMonths: value.mode === "recurring" ? Number(value.intervalMonths) || 1 : 1,
    firstDueDate: value.mode === "recurring" ? value.firstDueDate : "",
    customDueDates: value.mode === "custom" ? customDates : [],
    installmentIrt: value.mode === "none" ? "" : value.installmentIrt,
  };
}

function Check() {
  return (
    <span className="expense-check" aria-hidden="true">
      <Icon name="check" size={11} strokeWidth={3} />
    </span>
  );
}

export default function DebtScheduleFields({
  value,
  onChange,
  principalIrt,
  startDate,
  idPrefix,
  countLabel = "تعداد اقساط",
  firstDueLabel = "اولین سررسید",
}: {
  value: ScheduleValue;
  onChange: (next: ScheduleValue) => void;
  principalIrt: string;
  startDate: string;
  /** Distinguishes several editors on one page (the setup wizard lists many debts). */
  idPrefix: string;
  countLabel?: string;
  firstDueLabel?: string;
}) {
  const patch = (updates: Partial<ScheduleValue>) => onChange({ ...value, ...updates });
  const s = computeSchedule(value, principalIrt, startDate);
  const setCustomDate = (index: number, iso: string) =>
    patch({ customDates: value.customDates.map((d, i) => (i === index ? iso : d)) });

  return (
    <div className="space-y-3">
      <div className="expense-squares" role="radiogroup" aria-label="برنامه بازپرداخت">
        {TILES.map(([mode, label, meta]) => {
          const on = value.mode === mode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={on}
              className="expense-square"
              data-on={on || undefined}
              onClick={() => patch({ mode })}
            >
              {on && <Check />}
              <span className="expense-square-label">{label}</span>
              <span className="expense-square-meta">{meta}</span>
            </button>
          );
        })}
      </div>

      {value.mode === "recurring" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor={`${idPrefix}-count`}>
                {countLabel}
              </label>
              <AmountInput
                id={`${idPrefix}-count`}
                value={value.count}
                onChange={(event) => patch({ count: event.target.value.replace(/[^0-9]/g, "") })}
                className="field num"
                inputMode="numeric"
                placeholder="۱۲"
                showWords={false}
                unit="none"
                grouping={false}
              />
            </div>
            <div>
              <DualDateInput
                name={`${idPrefix}-first-due`}
                value={value.firstDueDate}
                onChange={(iso) => patch({ firstDueDate: iso })}
                label={firstDueLabel}
                required
                showGregorian={false}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <span className="label">فاصله اقساط</span>
            <div className="expense-squares" role="radiogroup" aria-label="فاصله اقساط">
              {RECURRING_INTERVALS.map((months) => {
                const on = value.intervalMonths === String(months);
                return (
                  <button
                    key={months}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className="expense-square"
                    data-on={on || undefined}
                    onClick={() => patch({ intervalMonths: String(months) })}
                  >
                    {on && <Check />}
                    <span className="expense-square-label">{INTERVAL_LABELS[months]}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {s.firstDueBeforeStart && (
            <p className="expense-note expense-note-warn" role="alert">
              {firstDueLabel} باید در تاریخ شروع یا بعد از آن باشد.
            </p>
          )}
        </>
      )}

      {value.mode === "custom" && (
        <>
          <ul className="debt-dates">
            {value.customDates.map((iso, index) => (
              <li key={index} className="debt-date-row">
                <span className="debt-date-seq">قسط {faCount(index + 1)}</span>
                <div className="min-w-0 flex-1">
                  <JalaliDatePicker
                    value={iso || undefined}
                    onChange={(next) => setCustomDate(index, next)}
                    showGregorian={false}
                    ariaLabel={`سررسید قسط ${index + 1}`}
                  />
                </div>
                {value.customDates.length > 1 && (
                  <button
                    type="button"
                    onClick={() => patch({ customDates: value.customDates.filter((_, i) => i !== index) })}
                    className="icon-btn !min-h-9 !min-w-9"
                    aria-label={`حذف قسط ${index + 1}`}
                  >
                    <Icon name="x" size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => patch({ customDates: [...value.customDates, ""] })}
            disabled={value.customDates.length >= MAX_INSTALLMENTS}
            className="expense-square expense-square-add debt-date-add disabled:opacity-40"
          >
            <span className="expense-square-label">+ افزودن قسط</span>
          </button>
          {s.customDueBeforeStart && (
            <p className="expense-note expense-note-warn" role="alert">
              سررسید اقساط باید در تاریخ شروع یا بعد از آن باشد.
            </p>
          )}
        </>
      )}

      {value.mode !== "none" && (
        <div>
          <label className="label" htmlFor={`${idPrefix}-installment`}>
            مبلغ هر قسط به تومان (اختیاری)
          </label>
          <AmountInput
            id={`${idPrefix}-installment`}
            value={value.installmentIrt}
            onChange={(event) => patch({ installmentIrt: event.target.value.replace(/[^0-9]/g, "") })}
            className="field num"
            inputMode="numeric"
            dir="ltr"
            unit="toman"
            placeholder={
              s.dueDates.length
                ? `محاسبه خودکار: ${formatMoney(D(principalIrt || "0").div(String(s.dueDates.length)).toFixed(0), "IRT")}`
                : "ابتدا زمان‌بندی را کامل کنید"
            }
            disabled={s.dueDates.length === 0}
          />
          {s.dueDates.length > 0 && s.amounts.length > 0 && (
            <p className="expense-sub mt-1">
              {faCount(s.dueDates.length)} قسط · مجموع{" "}
              <span className="num" dir="rtl">
                {formatMoney(s.total.toFixed(0), "IRT")}
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
