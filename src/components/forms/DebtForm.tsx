"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createDebtAction, type ActionResult } from "@/app/actions";
import { D } from "@/domain/decimal";
import { faCount, formatJalaliIso, formatMoney, formatPct } from "@/lib/format";
import {
  MAX_INSTALLMENTS,
  RECURRING_INTERVALS,
  generateDueDates,
  resolveScheduleAmounts,
  type ObligationDirection,
} from "@/features/planning/obligations";
import DualDateInput from "@/components/ui/DualDateInput";
import JalaliDatePicker from "@/components/ui/JalaliDatePicker";
import AmountInput from "@/components/ui/AmountInput";
import Icon from "@/components/ui/Icon";
import { PreviewCard, SmartAmountPreview } from "@/components/ui/SmartPreview";
import { FormStatus } from "@/components/ui/FormStatus";

type Props = {
  today: string;
  initialRate: string | null;
  initialRateDate?: string;
  initialRateSource?: string;
  /** Which side of the obligation this form opens on. */
  defaultDirection?: ObligationDirection;
};

/** How the due dates are produced. `none` carries no schedule at all. */
type ScheduleMode = "none" | "recurring" | "custom";

const INTERVAL_LABELS: Record<number, string> = {
  1: "ماهانه",
  2: "هر ۲ ماه",
  3: "هر ۳ ماه",
  4: "هر ۴ ماه",
  5: "هر ۵ ماه",
  6: "هر ۶ ماه",
};

const SCHEDULE_TILES: Array<[ScheduleMode, string, string]> = [
  ["none", "یکجا", "بدون قسط"],
  ["recurring", "فاصله ثابت", "ماهانه یا چندماهه"],
  ["custom", "سفارشی", "تاریخ‌های دلخواه"],
];

function Check() {
  return (
    <span className="expense-check" aria-hidden="true">
      <Icon name="check" size={11} strokeWidth={3} />
    </span>
  );
}

/**
 * ثبت تعهد مالی — «بدهی من» یا «طلب من», in the same plain cards as the
 * transaction form:
 *
 *   این مورد چیست؟   بدهی من · طلب من
 *   مشخصات           title, the other party, amount, interest, start date
 *   برنامه           یکجا · فاصله ثابت · سفارشی — as tiles, then its fields
 *
 * ONE FORM, TWO DIRECTIONS. A debt and a receivable are the same contract read
 * from two ends; the direction decides the sign of the cash leg when the
 * obligation is later settled, and every label follows it.
 *
 * The submit button stays behind a preview that lists the ACTUAL generated due
 * dates, so an obligation is never created by an accidental click.
 */
export default function DebtForm({
  today,
  initialRate,
  initialRateDate,
  initialRateSource,
  defaultDirection = "payable",
}: Props) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(createDebtAction, null);
  const [direction, setDirection] = useState<ObligationDirection>(defaultDirection);
  const [title, setTitle] = useState("");
  const [creditor, setCreditor] = useState("");
  const [principalIrt, setPrincipalIrt] = useState("");
  const [interestRate, setInterestRate] = useState("0");
  const [startDate, setStartDate] = useState(today);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("none");
  const [installmentCount, setInstallmentCount] = useState("0");
  const [intervalMonths, setIntervalMonths] = useState("1");
  const [installmentIrt, setInstallmentIrt] = useState("");
  const [firstDueDate, setFirstDueDate] = useState("");
  /** One independent Jalali-picked date per installment. No interval implied. */
  const [customDates, setCustomDates] = useState<string[]>([""]);
  const [showPreview, setShowPreview] = useState(false);

  const receivable = direction === "receivable";
  // Every user-facing noun follows the direction: a form that says «بستانکار»
  // while recording money owed TO the user is simply wrong.
  const noun = receivable ? "طلب" : "بدهی";
  const partyLabel = receivable ? "بدهکار" : "بستانکار";

  useEffect(() => {
    if (!state?.ok) return;
    const timer = window.setTimeout(() => {
      setShowPreview(false);
      setTitle("");
      setCreditor("");
      setPrincipalIrt("");
      setInterestRate("0");
      setScheduleMode("none");
      setInstallmentCount("0");
      setIntervalMonths("1");
      setInstallmentIrt("");
      setFirstDueDate("");
      setCustomDates([""]);
      router.refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [state?.ok, router]);

  const count = Math.max(0, Math.min(MAX_INSTALLMENTS, Number(installmentCount) || 0));
  // Joined once so the memo below depends on a plain value, not an array identity.
  const customDatesKey = customDates.filter((d) => d.length > 0).join(",");
  const filledCustomDates = useMemo(() => (customDatesKey ? customDatesKey.split(",") : []), [customDatesKey]);

  /** The due dates this schedule produces — the SAME pure generator the server writes with. */
  const dueDates = useMemo(() => {
    if (scheduleMode === "custom") {
      return filledCustomDates.length > 0 ? generateDueDates({ kind: "custom", dueDates: filledCustomDates }) : [];
    }
    if (scheduleMode === "recurring" && count > 0 && firstDueDate) {
      return generateDueDates({
        kind: "recurring",
        count,
        intervalMonths: Number(intervalMonths) || 1,
        firstDueDate,
      });
    }
    return [];
  }, [scheduleMode, filledCustomDates, count, intervalMonths, firstDueDate]);

  /** Per-installment amounts — the SAME exact split the server performs. */
  const amounts = useMemo(() => {
    if (dueDates.length === 0 || !principalIrt || !D(principalIrt).gt(0)) return [];
    try {
      return resolveScheduleAmounts({
        principalToman: D(principalIrt).toFixed(0),
        count: dueDates.length,
        installmentToman: installmentIrt,
      });
    } catch {
      return [];
    }
  }, [dueDates.length, principalIrt, installmentIrt]);

  const scheduleTotal = amounts.reduce((sum, a) => sum.add(D(a)), D("0"));
  const principalUsd =
    principalIrt && initialRate && D(initialRate).gt(0) ? D(principalIrt).div(initialRate).toFixed(2) : "";

  // A due date before the start date blocks the preview.
  const firstDueBeforeStart =
    scheduleMode === "recurring" && Boolean(firstDueDate) && Boolean(startDate) && firstDueDate < startDate;
  const customDueBeforeStart =
    scheduleMode === "custom" && Boolean(startDate) && filledCustomDates.some((due) => due < startDate);

  const scheduleReady =
    scheduleMode === "none" ||
    (scheduleMode === "recurring" && count > 0 && Boolean(firstDueDate) && !firstDueBeforeStart) ||
    (scheduleMode === "custom" && filledCustomDates.length > 0 && !customDueBeforeStart);

  const canPreview = Boolean(
    title.trim() && creditor.trim() && principalIrt && D(principalIrt).gt(0) && startDate && scheduleReady,
  );

  const missing: string[] = [];
  if (!title.trim()) missing.push("عنوان");
  if (!creditor.trim()) missing.push(partyLabel);
  if (!principalIrt || !D(principalIrt).gt(0)) missing.push("مبلغ");
  if (!scheduleReady) missing.push("برنامه اقساط");

  const setCustomDate = (index: number, iso: string) =>
    setCustomDates((cur) => cur.map((d, i) => (i === index ? iso : d)));

  return (
    <form action={formAction} className="space-y-4" dir="rtl">
      {/* Server values are submitted only after the final confirmation. */}
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="title" value={title} />
      <input type="hidden" name="creditor" value={creditor} />
      <input type="hidden" name="principalIrt" value={principalIrt} />
      <input type="hidden" name="interestRate" value={interestRate} />
      <input type="hidden" name="startDate" value={startDate} />
      {/* A custom schedule submits ONLY its dates; a recurring one only its
          count/interval/first date, so the two can never be blended. */}
      <input type="hidden" name="installmentCount" value={scheduleMode === "recurring" ? String(count) : "0"} />
      <input type="hidden" name="intervalMonths" value={scheduleMode === "recurring" ? intervalMonths : "1"} />
      <input type="hidden" name="customDueDates" value={scheduleMode === "custom" ? filledCustomDates.join(",") : ""} />
      <input type="hidden" name="installmentIrt" value={installmentIrt} />
      <input type="hidden" name="firstDueDate" value={scheduleMode === "recurring" ? firstDueDate : ""} />

      {!showPreview ? (
        <div className="expense-form">
          {/* ── Direction — first, because every label below depends on it ── */}
          <section className="card expense-card" aria-labelledby="debt-direction-title">
            <header className="expense-head">
              <h2 id="debt-direction-title">این مورد چیست؟</h2>
            </header>
            <div className="expense-squares debt-direction" role="radiogroup" aria-label="جهت تعهد">
              {(
                [
                  ["payable", "بدهی من", "به کسی بدهکارم"],
                  ["receivable", "طلب من", "کسی به من بدهکار است"],
                ] as const
              ).map(([value, label, meta]) => {
                const on = direction === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className="expense-square"
                    data-on={on || undefined}
                    onClick={() => setDirection(value)}
                  >
                    {on && <Check />}
                    <span className="expense-square-label">{label}</span>
                    <span className="expense-square-meta">{meta}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Details ── */}
          <section className="card expense-card" aria-labelledby="debt-details-title">
            <header className="expense-head">
              <h2 id="debt-details-title">مشخصات {noun}</h2>
            </header>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">عنوان</label>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="field"
                  placeholder={receivable ? "مثلاً طلب از شرکت X" : "مثلاً وام مسکن"}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="label">{partyLabel}</label>
                <input
                  value={creditor}
                  onChange={(event) => setCreditor(event.target.value)}
                  className="field"
                  placeholder="مثلاً بانک یا شخص"
                  autoComplete="off"
                />
              </div>
            </div>
            <div>
              <label className="label">مبلغ به تومان</label>
              <AmountInput
                value={principalIrt}
                onChange={(event) => setPrincipalIrt(event.target.value.replace(/[^0-9]/g, ""))}
                className="field num"
                inputMode="numeric"
                dir="ltr"
                unit="toman"
                placeholder="۰"
              />
              <div className="mt-2">
                <SmartAmountPreview
                  irtAmount={principalIrt}
                  rate={initialRate}
                  rateDate={initialRateDate}
                  rateSource={initialRateSource}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <DualDateInput
                  name="startDatePreview"
                  value={startDate}
                  onChange={setStartDate}
                  label={`تاریخ شروع ${noun}`}
                  required
                  showGregorian={false}
                />
              </div>
              <div>
                <label className="label">سود سالانه (٪، اختیاری)</label>
                <AmountInput
                  value={interestRate}
                  onChange={(event) => setInterestRate(event.target.value)}
                  className="field num"
                  inputMode="decimal"
                  placeholder="۰"
                  showWords={false}
                  unit="none"
                />
              </div>
            </div>
          </section>

          {/* ── Schedule ── */}
          <section className="card expense-card" aria-labelledby="debt-schedule-title">
            <header className="expense-head">
              <h2 id="debt-schedule-title">{receivable ? "برنامه وصول" : "برنامه بازپرداخت"}</h2>
            </header>
            <div className="expense-squares" role="radiogroup" aria-label="نوع زمان‌بندی">
              {SCHEDULE_TILES.map(([mode, label, meta]) => {
                const on = scheduleMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className="expense-square"
                    data-on={on || undefined}
                    onClick={() => setScheduleMode(mode)}
                  >
                    {on && <Check />}
                    <span className="expense-square-label">{label}</span>
                    <span className="expense-square-meta">{meta}</span>
                  </button>
                );
              })}
            </div>

            {scheduleMode === "recurring" && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">تعداد اقساط</label>
                    <AmountInput
                      value={installmentCount}
                      onChange={(event) => setInstallmentCount(event.target.value)}
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
                      name="firstDueDatePreview"
                      value={firstDueDate}
                      onChange={setFirstDueDate}
                      label="اولین سررسید"
                      required
                      showGregorian={false}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <span className="label">فاصله اقساط</span>
                  <div className="expense-squares" role="radiogroup" aria-label="فاصله اقساط">
                    {RECURRING_INTERVALS.map((months) => {
                      const on = intervalMonths === String(months);
                      return (
                        <button
                          key={months}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          className="expense-square"
                          data-on={on || undefined}
                          onClick={() => setIntervalMonths(String(months))}
                        >
                          {on && <Check />}
                          <span className="expense-square-label">{INTERVAL_LABELS[months]}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {firstDueBeforeStart && (
                  <p className="expense-note expense-note-warn" role="alert">
                    اولین سررسید باید در تاریخ شروع یا بعد از آن باشد.
                  </p>
                )}
              </>
            )}

            {scheduleMode === "custom" && (
              <>
                <ul className="debt-dates">
                  {customDates.map((iso, index) => (
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
                      {customDates.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setCustomDates((cur) => cur.filter((_, i) => i !== index))}
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
                  onClick={() => setCustomDates((cur) => [...cur, ""])}
                  disabled={customDates.length >= MAX_INSTALLMENTS}
                  className="expense-square expense-square-add debt-date-add disabled:opacity-40"
                >
                  <span className="expense-square-label">+ افزودن قسط</span>
                </button>
                {customDueBeforeStart && (
                  <p className="expense-note expense-note-warn" role="alert">
                    سررسید اقساط باید در تاریخ شروع یا بعد از آن باشد.
                  </p>
                )}
              </>
            )}

            {scheduleMode !== "none" && (
              <div>
                <label className="label">مبلغ هر قسط به تومان (اختیاری)</label>
                <AmountInput
                  value={installmentIrt}
                  onChange={(event) => setInstallmentIrt(event.target.value.replace(/[^0-9]/g, ""))}
                  className="field num"
                  inputMode="numeric"
                  dir="ltr"
                  unit="toman"
                  placeholder={
                    dueDates.length
                      ? `محاسبه خودکار: ${formatMoney(D(principalIrt || "0").div(String(dueDates.length)).toFixed(0), "IRT")}`
                      : "ابتدا زمان‌بندی را کامل کنید"
                  }
                  disabled={dueDates.length === 0}
                />
                {dueDates.length > 0 && amounts.length > 0 && (
                  <p className="expense-sub mt-1">
                    {faCount(dueDates.length)} قسط · مجموع{" "}
                    <span className="num" dir="rtl">
                      {formatMoney(scheduleTotal.toFixed(0), "IRT")}
                    </span>
                  </p>
                )}
              </div>
            )}
          </section>

          <div className="space-y-1.5">
            <button
              type="button"
              disabled={!canPreview}
              onClick={() => setShowPreview(true)}
              className="btn btn-primary w-full disabled:opacity-40"
            >
              پیش‌نمایش
            </button>
            {!canPreview && missing.length > 0 && (
              <p className="muted text-center text-[length:var(--fs-xs)]" role="status">
                باقی مانده: {missing.join("، ")}
              </p>
            )}
          </div>
        </div>
      ) : (
        <PreviewCard title={`پیش‌نمایش ${noun}`}>
          <div className="space-y-2 text-[length:var(--fs-xs)] leading-6">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <span className="muted">نوع:</span> <strong>{receivable ? "طلب من (دریافتنی)" : "بدهی من (پرداختنی)"}</strong>
              </div>
              <div>
                <span className="muted">عنوان:</span> <strong>{title}</strong>
              </div>
              <div>
                <span className="muted">{partyLabel}:</span> <strong>{creditor}</strong>
              </div>
              <div>
                <span className="muted">اصل مبلغ:</span>{" "}
                <strong className="num" dir="rtl">
                  {formatMoney(principalIrt, "IRT")}
                </strong>
              </div>
              <div>
                <span className="muted">معادل تقریبی پایه:</span>{" "}
                <strong className="num" dir="rtl">
                  {principalUsd ? formatMoney(principalUsd, "USD") : "—"}
                </strong>
              </div>
              <div>
                <span className="muted">نرخ سود:</span>{" "}
                <strong className="num" dir="rtl">
                  {formatPct(interestRate || "0", 2)}
                </strong>
              </div>
              <div>
                <span className="muted">شروع:</span>{" "}
                <strong className="num" dir="rtl">
                  {formatJalaliIso(startDate)}
                </strong>
              </div>
            </div>

            {dueDates.length > 0 && (
              <div className="soft rounded-[var(--r-md)] p-3">
                <div className="font-semibold">
                  برنامه اقساط · {scheduleMode === "custom" ? "زمان‌بندی سفارشی" : INTERVAL_LABELS[Number(intervalMonths) || 1]}
                </div>
                <div className="muted mt-1">
                  {faCount(dueDates.length)} قسط · مجموع{" "}
                  <span className="num" dir="rtl">
                    {formatMoney(scheduleTotal.toFixed(0), "IRT")}
                  </span>
                </div>
                {/* EVERY date is listed: an irregular schedule cannot be verified from a sample. */}
                <ul className="mt-2 grid gap-x-4 gap-y-1 text-[length:var(--fs-xs)] sm:grid-cols-2">
                  {dueDates.map((due, index) => (
                    <li key={`${due}-${index}`} className="flex justify-between gap-2">
                      <span>قسط {faCount(index + 1)}</span>
                      <span className="num" dir="rtl">
                        {formatJalaliIso(due)}
                        {amounts[index] ? ` · ${formatMoney(amounts[index], "IRT")}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="muted text-[length:var(--fs-xs)] leading-5">
              {receivable ? "تا وصول هر قسط، دفترکل تغییری نمی‌کند." : "تا پرداخت هر قسط، دفترکل تغییری نمی‌کند."}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowPreview(false)} className="btn btn-ghost flex-1">
              بازگشت به ویرایش
            </button>
            <button type="submit" disabled={pending} className="btn btn-primary flex-1">
              {pending ? "در حال ثبت…" : `تأیید نهایی و ثبت ${noun}`}
            </button>
          </div>
        </PreviewCard>
      )}

      <FormStatus state={state} />
    </form>
  );
}
