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

/** How the due dates are produced. `once` carries no schedule at all. */
type ScheduleMode = "none" | "recurring" | "custom";

const INTERVAL_LABELS: Record<number, string> = {
  1: "ماهانه",
  2: "هر ۲ ماه",
  3: "هر ۳ ماه",
  4: "هر ۴ ماه",
  5: "هر ۵ ماه",
  6: "هر ۶ ماه",
};

/**
 * ثبت تعهد مالی — «بدهی من» یا «طلب من».
 *
 * ONE FORM, TWO DIRECTIONS. A debt and a receivable are the same contract read
 * from two ends, so they share one form; the direction switch at the top is not
 * a caption but the field that decides the sign of the cash leg when the
 * obligation is later settled.
 *
 * The submit button stays hidden behind a preview so an obligation can never be
 * created by an accidental click — and the preview now shows the ACTUAL
 * generated due dates, because a custom schedule is impossible to verify from a
 * count and a first date.
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
  // Every user-facing noun follows the direction. The vocabulary is not
  // decoration: a form that says «بستانکار» while recording money owed TO the
  // user is simply wrong, and the user has no other signal to catch it.
  const noun = receivable ? "طلب" : "بدهی";
  const partyLabel = receivable ? "بدهکار (چه کسی به شما بدهکار است؟)" : "بستانکار (به چه کسی بدهکارید؟)";

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
  // Joined once so the memo below can depend on a plain value: the array
  // identity changes on every keystroke, and the lint rule (rightly) refuses a
  // computed expression in a dependency list.
  const customDatesKey = customDates.filter((d) => d.length > 0).join(",");
  const filledCustomDates = useMemo(
    () => (customDatesKey ? customDatesKey.split(",") : []),
    [customDatesKey],
  );

  /**
   * The due dates this schedule actually produces — computed with the SAME
   * pure generator the server writes with, so the preview is the contract and
   * not a second approximation of it.
   */
  const dueDates = useMemo(() => {
    if (scheduleMode === "custom") {
      return filledCustomDates.length > 0
        ? generateDueDates({ kind: "custom", dueDates: filledCustomDates })
        : [];
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

  /**
   * Per-installment amounts — the SAME exact split the server performs, so the
   * preview shows the real figures including the one-Toman remainder rows. A
   * preview that rounds differently from the write is worse than no preview.
   */
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

  const scheduleReady =
    scheduleMode === "none" ||
    (scheduleMode === "recurring" && count > 0 && Boolean(firstDueDate)) ||
    (scheduleMode === "custom" && filledCustomDates.length > 0);

  const canPreview = Boolean(
    title.trim() && creditor.trim() && principalIrt && D(principalIrt).gt(0) && startDate && scheduleReady,
  );

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
      {/* A custom schedule submits ONLY its dates; a recurring one submits only
          its count/interval/first date. The server picks the shape from what
          arrives, so the two can never be silently blended. */}
      <input
        type="hidden"
        name="installmentCount"
        value={scheduleMode === "recurring" ? String(count) : "0"}
      />
      <input type="hidden" name="intervalMonths" value={scheduleMode === "recurring" ? intervalMonths : "1"} />
      <input
        type="hidden"
        name="customDueDates"
        value={scheduleMode === "custom" ? filledCustomDates.join(",") : ""}
      />
      <input type="hidden" name="installmentIrt" value={installmentIrt} />
      <input type="hidden" name="firstDueDate" value={scheduleMode === "recurring" ? firstDueDate : ""} />

      {!showPreview ? (
        <>
          {/* ── DIRECTION ────────────────────────────────────────────────
              First question on the form, because every label under it
              depends on the answer. */}
          <div>
            <label className="label">این مورد چیست؟</label>
            <div className="seg" role="group" aria-label="جهت تعهد">
              <button
                type="button"
                onClick={() => setDirection("payable")}
                className={direction === "payable" ? "seg-on" : ""}
                aria-pressed={direction === "payable"}
              >
                بدهی من
              </button>
              <button
                type="button"
                onClick={() => setDirection("receivable")}
                className={direction === "receivable" ? "seg-on" : ""}
                aria-pressed={direction === "receivable"}
              >
                طلب من
              </button>
            </div>
            <p className="muted mt-1 text-[length:var(--fs-xs)]">
              {receivable
                ? "پولی که شخص یا شرکتی به شما بدهکار است. هنگام وصول، به موجودی شما اضافه می‌شود."
                : "پولی که شما به شخص، بانک یا مؤسسه بدهکارید. هنگام پرداخت، از موجودی شما کم می‌شود."}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">عنوان {noun}</label>
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
            <div>
              <label className="label">اصل مبلغ به تومان</label>
              <AmountInput
                value={principalIrt}
                onChange={(event) => setPrincipalIrt(event.target.value.replace(/[^0-9]/g, ""))}
                className="field num !text-lg !font-bold"
                inputMode="numeric"
                dir="ltr"
                unit="toman"
                placeholder="مثلاً 500000000"
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
            <div>
              <label className="label">نرخ سود سالانه (درصد)</label>
              <input
                value={interestRate}
                onChange={(event) => setInterestRate(event.target.value.replace(/[^0-9.]/g, ""))}
                className="field num"
                inputMode="decimal"
                dir="ltr"
                placeholder="18"
              />
              <p className="muted mt-1 text-[length:var(--fs-xs)]">
                در این مرحله به‌عنوان اطلاعات {noun} ذخیره می‌شود؛ محاسبه خودکار سود انجام نمی‌گیرد.
              </p>
            </div>
            <div className="sm:col-span-2">
              <DualDateInput
                name="startDatePreview"
                value={startDate}
                onChange={setStartDate}
                label={`تاریخ شروع ${noun}`}
                required
                showGregorian={false}
              />
            </div>
          </div>

          {/* ── SCHEDULE ────────────────────────────────────────────────── */}
          <div className="rounded-[var(--r-lg)] border p-4" style={{ borderColor: "var(--border)" }}>
            <div className="mb-3">
              <h3 className="text-[length:var(--fs-sm)] font-bold">برنامه بازپرداخت</h3>
              <p className="muted mt-1 text-[length:var(--fs-xs)]">
                {receivable
                  ? "اگر قرار است طلب شما قسطی وصول شود، زمان‌بندی آن را اینجا تعریف کنید."
                  : "اگر قسطی تعریف نکنید، بدهی بدون زمان‌بندی ثبت می‌شود و هر زمان قابل پرداخت است."}
              </p>
            </div>

            <div className="seg mb-3 flex-wrap" role="group" aria-label="نوع زمان‌بندی">
              <button
                type="button"
                onClick={() => setScheduleMode("none")}
                className={scheduleMode === "none" ? "seg-on" : ""}
                aria-pressed={scheduleMode === "none"}
              >
                یکجا (بدون قسط)
              </button>
              <button
                type="button"
                onClick={() => setScheduleMode("recurring")}
                className={scheduleMode === "recurring" ? "seg-on" : ""}
                aria-pressed={scheduleMode === "recurring"}
              >
                فاصله ثابت
              </button>
              <button
                type="button"
                onClick={() => setScheduleMode("custom")}
                className={scheduleMode === "custom" ? "seg-on" : ""}
                aria-pressed={scheduleMode === "custom"}
              >
                زمان‌بندی سفارشی
              </button>
            </div>

            {scheduleMode === "recurring" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">تعداد اقساط</label>
                  <input
                    value={installmentCount}
                    onChange={(event) => setInstallmentCount(event.target.value.replace(/[^0-9]/g, ""))}
                    className="field num"
                    inputMode="numeric"
                    dir="ltr"
                    placeholder="12"
                  />
                </div>
                <div>
                  <label className="label">فاصله اقساط</label>
                  <select
                    value={intervalMonths}
                    onChange={(event) => setIntervalMonths(event.target.value)}
                    className="field"
                  >
                    {RECURRING_INTERVALS.map((months) => (
                      <option key={months} value={String(months)}>
                        {INTERVAL_LABELS[months]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <DualDateInput
                    name="firstDueDatePreview"
                    value={firstDueDate}
                    onChange={setFirstDueDate}
                    label="اولین سررسید"
                    required
                    showGregorian={false}
                  />
                  {firstDueDate && startDate && firstDueDate < startDate && (
                    <p className="neg mt-1 text-[length:var(--fs-xs)]">
                      اولین سررسید باید در تاریخ شروع یا بعد از آن باشد.
                    </p>
                  )}
                </div>
              </div>
            )}

            {scheduleMode === "custom" && (
              <div className="space-y-3">
                <p className="muted text-[length:var(--fs-xs)] leading-5">
                  تاریخ هر قسط را جداگانه انتخاب کنید. فاصله اقساط لازم نیست ثابت باشد — مثلاً قسط بعدی می‌تواند
                  سه ماه بعد و قسط پس از آن شش ماه بعد باشد.
                </p>
                <ul className="space-y-2.5">
                  {customDates.map((iso, index) => (
                    <li key={index} className="flex flex-wrap items-end gap-2">
                      <span className="mb-2 shrink-0 text-[length:var(--fs-xs)] font-semibold leading-6">
                        قسط <span className="num" dir="ltr">#{index + 1}</span>
                      </span>
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
                          className="btn btn-ghost !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]"
                          aria-label={`حذف قسط ${index + 1}`}
                        >
                          حذف
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => setCustomDates((cur) => [...cur, ""])}
                  disabled={customDates.length >= MAX_INSTALLMENTS}
                  className="btn btn-ghost !min-h-9 !px-3.5 !py-1.5 text-[length:var(--fs-xs)] disabled:opacity-40"
                >
                  افزودن قسط
                </button>
              </div>
            )}

            {scheduleMode !== "none" && (
              <div className="mt-3">
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
                      ? `محاسبه خودکار: ${formatMoney(
                          D(principalIrt || "0").div(String(dueDates.length)).toFixed(0),
                          "IRT",
                        )}`
                      : "ابتدا زمان‌بندی را کامل کنید"
                  }
                  disabled={dueDates.length === 0}
                />
                {dueDates.length > 0 && (
                  <p className="muted mt-1 text-[length:var(--fs-xs)]">
                    در صورت خالی بودن، اصل مبلغ دقیقاً تقسیم می‌شود و باقی‌مانده تقسیم به اولین اقساط اضافه
                    می‌شود؛ مجموع اقساط همیشه برابر اصل مبلغ می‌ماند.
                  </p>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={!canPreview}
            onClick={() => setShowPreview(true)}
            className="btn btn-primary w-full disabled:opacity-40"
          >
            {canPreview ? "پیش‌نمایش قبل از ثبت نهایی" : "برای پیش‌نمایش، عنوان، طرف مقابل، مبلغ و تاریخ را کامل کنید"}
          </button>
        </>
      ) : (
        <PreviewCard title={`پیش‌نمایش ثبت ${noun} — هنوز ذخیره نشده است`}>
          <div className="space-y-2 text-[length:var(--fs-xs)] leading-6">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <span className="muted">نوع:</span>{" "}
                <strong>{receivable ? "طلب من (دریافتنی)" : "بدهی من (پرداختنی)"}</strong>
              </div>
              <div><span className="muted">عنوان:</span> <strong>{title}</strong></div>
              <div>
                <span className="muted">{receivable ? "بدهکار" : "بستانکار"}:</span> <strong>{creditor}</strong>
              </div>
              <div>
                <span className="muted">اصل مبلغ:</span>{" "}
                <strong className="num" dir="rtl">{formatMoney(principalIrt, "IRT")}</strong>
              </div>
              <div>
                <span className="muted">معادل تقریبی پایه:</span>{" "}
                <strong className="num" dir="rtl">{principalUsd ? formatMoney(principalUsd, "USD") : "—"}</strong>
              </div>
              <div>
                <span className="muted">نرخ سود:</span>{" "}
                <strong className="num" dir="rtl">{formatPct(interestRate || "0", 2)}</strong>
              </div>
              <div>
                <span className="muted">شروع:</span>{" "}
                <strong className="num" dir="rtl">{formatJalaliIso(startDate)}</strong>
              </div>
            </div>

            {dueDates.length > 0 && (
              <div className="soft rounded-[var(--r-md)] p-3">
                <div className="font-semibold">
                  برنامه اقساط ·{" "}
                  {scheduleMode === "custom"
                    ? "زمان‌بندی سفارشی"
                    : INTERVAL_LABELS[Number(intervalMonths) || 1]}
                </div>
                <div className="muted mt-1">
                  {faCount(dueDates.length)} قسط · مجموع{" "}
                  <span className="num" dir="rtl">{formatMoney(scheduleTotal.toFixed(0), "IRT")}</span>
                </div>
                {/* EVERY date is listed, not a sample: a custom schedule cannot
                    be verified from the first four rows, and the whole reason
                    the user chose custom is that the dates are irregular. */}
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
                {amounts.length > 0 && principalIrt && !installmentIrt && (
                  <p className="muted mt-2 text-[length:var(--fs-xs)]">
                    مجموع اقساط دقیقاً برابر اصل مبلغ است.
                  </p>
                )}
              </div>
            )}

            <div
              className="rounded-[var(--r-md)] border p-3 text-[length:var(--fs-xs)] leading-5"
              style={{ borderColor: "var(--warning)", background: "var(--warning-soft)" }}
            >
              {receivable
                ? "ثبت مالی هنگام وصول هر قسط انجام می‌شود؛ تا آن زمان دفترکل تغییری نمی‌کند."
                : "ثبت مالی هنگام پرداخت هر قسط انجام می‌شود؛ تا آن زمان دفترکل تغییری نمی‌کند."}
            </div>
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
