"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createDebtAction, type ActionResult } from "@/app/actions";
import { D } from "@/domain/decimal";
import { addMonthsIso, formatDualDate, formatJalaliIso, formatMoney } from "@/lib/format";
import DualDateInput from "@/components/ui/DualDateInput";
import AmountInput from "@/components/ui/AmountInput";
import { PreviewCard, SmartAmountPreview } from "@/components/ui/SmartPreview";

type Props = {
  today: string;
  initialRate: string | null;
  initialRateDate?: string;
  initialRateSource?: string;
};

/**
 * Planning-layer debt definition. The submit button is intentionally hidden
 * behind a preview so a debt can never be created by an accidental click.
 */
export default function DebtForm({ today, initialRate, initialRateDate, initialRateSource }: Props) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(createDebtAction, null);
  const [title, setTitle] = useState("");
  const [creditor, setCreditor] = useState("");
  const [principalIrt, setPrincipalIrt] = useState("");
  const [interestRate, setInterestRate] = useState("0");
  const [startDate, setStartDate] = useState(today);
  const [installmentCount, setInstallmentCount] = useState("0");
  const [installmentIrt, setInstallmentIrt] = useState("");
  const [firstDueDate, setFirstDueDate] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (!state?.ok) return;
    const timer = window.setTimeout(() => {
      setShowPreview(false);
      setTitle("");
      setCreditor("");
      setPrincipalIrt("");
      setInterestRate("0");
      setInstallmentCount("0");
      setInstallmentIrt("");
      setFirstDueDate("");
      router.refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [state?.ok, router]);

  const count = Math.max(0, Math.min(360, Number(installmentCount) || 0));
  const effectiveInstallmentIrt = useMemo(() => {
    if (!count || !principalIrt || !D(principalIrt).gt(0)) return "";
    if (installmentIrt && D(installmentIrt).gt(0)) return installmentIrt;
    return D(principalIrt).div(String(count)).toFixed(0);
  }, [count, principalIrt, installmentIrt]);

  const principalUsd = principalIrt && initialRate && D(initialRate).gt(0) ? D(principalIrt).div(initialRate).toFixed(2) : "";
  const canPreview = Boolean(
    title.trim() &&
      creditor.trim() &&
      principalIrt &&
      D(principalIrt).gt(0) &&
      startDate &&
      (count === 0 || (firstDueDate && effectiveInstallmentIrt && D(effectiveInstallmentIrt).gt(0))),
  );

  return (
    <form action={formAction} className="space-y-4" dir="rtl">
      {/* Server values are submitted only after the final confirmation. */}
      <input type="hidden" name="title" value={title} />
      <input type="hidden" name="creditor" value={creditor} />
      <input type="hidden" name="principalIrt" value={principalIrt} />
      <input type="hidden" name="interestRate" value={interestRate} />
      <input type="hidden" name="startDate" value={startDate} />
      <input type="hidden" name="installmentCount" value={String(count)} />
      <input type="hidden" name="installmentIrt" value={effectiveInstallmentIrt} />
      <input type="hidden" name="firstDueDate" value={firstDueDate} />

      {!showPreview ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">عنوان بدهی</label>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="field"
                placeholder="مثلاً وام مسکن"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="label">بستانکار / طلبکار</label>
              <input
                value={creditor}
                onChange={(event) => setCreditor(event.target.value)}
                className="field"
                placeholder="مثلاً بانک یا شخص"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="label">اصل بدهی به تومان</label>
              <AmountInput
                value={principalIrt}
                onChange={(event) => setPrincipalIrt(event.target.value.replace(/[^0-9]/g, ""))}
                className="field num !text-lg !font-bold"
                inputMode="numeric"
                dir="ltr"
                unit="toman"
                placeholder="مثلاً 800000000"
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
              <p className="muted mt-1 text-[10.5px]">در این مرحله به‌عنوان اطلاعات بدهی ذخیره می‌شود؛ محاسبه خودکار سود انجام نمی‌گیرد.</p>
            </div>
            <div className="sm:col-span-2">
              <DualDateInput name="startDatePreview" value={startDate} onChange={setStartDate} label="تاریخ شروع بدهی" required />
            </div>
          </div>

          <div className="rounded-[var(--r-lg)] border p-4" style={{ borderColor: "var(--border)" }}>
            <div className="mb-3">
              <h3 className="text-[13px] font-bold">برنامه بازپرداخت (اختیاری)</h3>
              <p className="muted mt-1 text-[10.5px]">اگر قسطی تعریف نکنید، بدهی بدون زمان‌بندی ثبت می‌شود و بعداً قابل پیگیری است.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">تعداد اقساط</label>
                <input
                  value={installmentCount}
                  onChange={(event) => setInstallmentCount(event.target.value.replace(/[^0-9]/g, ""))}
                  className="field num"
                  inputMode="numeric"
                  dir="ltr"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="label">مبلغ هر قسط به تومان (اختیاری)</label>
                <AmountInput
                  value={installmentIrt}
                  onChange={(event) => setInstallmentIrt(event.target.value.replace(/[^0-9]/g, ""))}
                  className="field num"
                  inputMode="numeric"
                  dir="ltr"
                  unit="toman"
                  placeholder={count ? `محاسبه خودکار: ${formatMoney(D(principalIrt || "0").div(String(count)).toFixed(0), "IRT")}` : "وقتی تعداد اقساط بیشتر از صفر باشد"}
                  disabled={!count}
                />
                {count > 0 && <p className="muted mt-1 text-[10px]">در صورت خالی بودن، اصل بدهی به‌طور مساوی تقسیم می‌شود.</p>}
              </div>
              {count > 0 && (
                <div className="sm:col-span-2">
                  <DualDateInput name="firstDueDatePreview" value={firstDueDate} onChange={setFirstDueDate} label="اولین سررسید" required />
                  {firstDueDate && startDate && firstDueDate < startDate && <p className="neg mt-1 text-[10.5px]">اولین سررسید باید در تاریخ شروع یا بعد از آن باشد.</p>}
                </div>
              )}
            </div>
          </div>

          <button type="button" disabled={!canPreview} onClick={() => setShowPreview(true)} className="btn btn-primary w-full disabled:opacity-40">
            {canPreview ? "پیش‌نمایش قبل از ثبت نهایی" : "برای پیش‌نمایش، عنوان، بستانکار، مبلغ و تاریخ را کامل کنید"}
          </button>
        </>
      ) : (
        <PreviewCard title="پیش‌نمایش تعریف بدهی — هنوز ذخیره نشده است">
          <div className="space-y-2 text-[12px] leading-6">
            <div className="grid gap-2 sm:grid-cols-2">
              <div><span className="muted">عنوان:</span> <strong>{title}</strong></div>
              <div><span className="muted">بستانکار:</span> <strong>{creditor}</strong></div>
              <div><span className="muted">اصل بدهی:</span> <strong className="num" dir="ltr">{formatMoney(principalIrt, "IRT")}</strong></div>
              <div><span className="muted">معادل تقریبی پایه:</span> <strong className="num" dir="ltr">{principalUsd ? formatMoney(principalUsd, "USD") : "—"}</strong></div>
              <div><span className="muted">نرخ سود:</span> <strong className="num" dir="ltr">{interestRate || "0"}٪</strong></div>
              <div><span className="muted">شروع:</span> <strong>{formatJalaliIso(startDate)} <span className="muted num" dir="ltr">({startDate})</span></strong></div>
            </div>

            {count > 0 && firstDueDate && (
              <div className="soft rounded-[var(--r-md)] p-3">
                <div className="font-semibold">برنامه اقساط</div>
                <div className="muted mt-1">{count} قسط × <span className="num" dir="ltr">{formatMoney(effectiveInstallmentIrt, "IRT")}</span> · شروع از {formatDualDate(firstDueDate)}</div>
                <ul className="mt-2 grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-2">
                  {Array.from({ length: Math.min(count, 4) }, (_, index) => {
                    const due = addMonthsIso(firstDueDate, index);
                    return <li key={due} className="flex justify-between gap-2"><span>قسط {index + 1}</span><span className="num" dir="ltr">{formatJalaliIso(due)} · {due}</span></li>;
                  })}
                  {count > 4 && <li className="muted sm:col-span-2">… و {count - 4} قسط دیگر تا {formatDualDate(addMonthsIso(firstDueDate, count - 1))}</li>}
                </ul>
              </div>
            )}

            <div className="rounded-[var(--r-md)] border p-3 text-[11px] leading-5" style={{ borderColor: "var(--warning)", background: "var(--warning-soft)" }}>
              این فرم فقط بدهی و برنامه اقساط را در لایه برنامه‌ریزی ثبت می‌کند. در این مرحله هیچ Journal Entry، Posting، مانده حساب یا دفترکل ایجاد/ویرایش نمی‌شود.
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowPreview(false)} className="btn btn-ghost flex-1">بازگشت به ویرایش</button>
            <button type="submit" disabled={pending} className="btn btn-primary flex-1">{pending ? "در حال ثبت…" : "تأیید نهایی و ثبت بدهی"}</button>
          </div>
        </PreviewCard>
      )}

      {state && (
        <p
          role="status"
          className="rounded-[var(--r-md)] px-3 py-2 text-[12px] font-medium"
          style={{ background: state.ok ? "var(--positive-soft)" : "var(--negative-soft)", color: state.ok ? "var(--positive)" : "var(--negative)" }}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
