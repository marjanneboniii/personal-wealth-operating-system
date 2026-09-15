"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createDebtAction, type ActionResult } from "@/app/actions";
import { D } from "@/domain/decimal";
import { faCount, formatJalaliIso, formatMoney, formatPct } from "@/lib/format";
import type { ObligationDirection } from "@/features/planning/obligations";
import DualDateInput from "@/components/ui/DualDateInput";
import AmountInput from "@/components/ui/AmountInput";
import Icon from "@/components/ui/Icon";
import { PreviewCard, SmartAmountPreview } from "@/components/ui/SmartPreview";
import { FormStatus } from "@/components/ui/FormStatus";
import DebtScheduleFields, {
  EMPTY_SCHEDULE,
  INTERVAL_LABELS,
  computeSchedule,
  scheduleSubmission,
  type ScheduleValue,
} from "@/components/debts/DebtScheduleFields";

type Props = {
  today: string;
  initialRate: string | null;
  initialRateDate?: string;
  initialRateSource?: string;
  /** Which side of the obligation this form opens on. */
  defaultDirection?: ObligationDirection;
};

function Check() {
  return (
    <span className="expense-check" aria-hidden="true">
      <Icon name="check" size={11} strokeWidth={3} />
    </span>
  );
}

/**
 * ثبت بدهی یا طلب — «بدهی من» یا «طلب من», in the same plain cards as the
 * transaction form:
 *
 *   این مورد چیست؟   بدهی من · طلب من
 *   مشخصات           title, the other party, amount, interest, start date
 *   برنامه           یکجا · ماهانه · سفارشی (shared with the setup wizard)
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
  const [schedule, setSchedule] = useState<ScheduleValue>(EMPTY_SCHEDULE);
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
      setSchedule(EMPTY_SCHEDULE);
      router.refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [state?.ok, router]);

  /** The due dates and amounts — the SAME pure generators the server writes with. */
  const plan = computeSchedule(schedule, principalIrt, startDate);
  const submitted = scheduleSubmission(schedule, principalIrt, startDate);
  const principalUsd =
    principalIrt && initialRate && D(initialRate).gt(0) ? D(principalIrt).div(initialRate).toFixed(2) : "";

  const canPreview = Boolean(
    title.trim() && creditor.trim() && principalIrt && D(principalIrt).gt(0) && startDate && plan.ready,
  );

  const missing: string[] = [];
  if (!title.trim()) missing.push("عنوان");
  if (!creditor.trim()) missing.push(partyLabel);
  if (!principalIrt || !D(principalIrt).gt(0)) missing.push("مبلغ");
  if (!plan.ready) missing.push(receivable ? "برنامه وصول" : "برنامه بازپرداخت");

  return (
    <form action={formAction} className="space-y-4" dir="rtl">
      {/* Server values are submitted only after the final confirmation. A
          custom schedule submits ONLY its dates; a recurring one only its
          count/interval/first date, so the two can never be blended. */}
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="title" value={title} />
      <input type="hidden" name="creditor" value={creditor} />
      <input type="hidden" name="principalIrt" value={principalIrt} />
      <input type="hidden" name="interestRate" value={interestRate} />
      <input type="hidden" name="startDate" value={startDate} />
      <input type="hidden" name="installmentCount" value={String(submitted.installmentCount)} />
      <input type="hidden" name="intervalMonths" value={String(submitted.intervalMonths)} />
      <input type="hidden" name="customDueDates" value={submitted.customDueDates.join(",")} />
      <input type="hidden" name="installmentIrt" value={submitted.installmentIrt} />
      <input type="hidden" name="firstDueDate" value={submitted.firstDueDate} />

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
            <DebtScheduleFields value={schedule} onChange={setSchedule} principalIrt={principalIrt} startDate={startDate} idPrefix="debt" />
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

            {plan.dueDates.length > 0 && (
              <div className="soft rounded-[var(--r-md)] p-3">
                <div className="font-semibold">
                  برنامه اقساط · {schedule.mode === "custom" ? "زمان‌بندی سفارشی" : INTERVAL_LABELS[Number(schedule.intervalMonths) || 1]}
                </div>
                <div className="muted mt-1">
                  {faCount(plan.dueDates.length)} قسط · مجموع{" "}
                  <span className="num" dir="rtl">
                    {formatMoney(plan.total.toFixed(0), "IRT")}
                  </span>
                </div>
                {/* EVERY date is listed: an irregular schedule cannot be verified from a sample. */}
                <ul className="mt-2 grid gap-x-4 gap-y-1 text-[length:var(--fs-xs)] sm:grid-cols-2">
                  {plan.dueDates.map((due, index) => (
                    <li key={`${due}-${index}`} className="flex justify-between gap-2">
                      <span>قسط {faCount(index + 1)}</span>
                      <span className="num" dir="rtl">
                        {formatJalaliIso(due)}
                        {plan.amounts[index] ? ` · ${formatMoney(plan.amounts[index], "IRT")}` : ""}
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
