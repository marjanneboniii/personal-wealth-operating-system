"use client";

import { useActionState, useState } from "react";
import { createBudgetAction, type ActionResult } from "@/app/actions";
import SubmitButton from "@/components/ui/SubmitButton";
import DualDateInput from "@/components/ui/DualDateInput";
import AmountInput from "@/components/ui/AmountInput";
import { SmartAmountPreview, useLatestRate } from "@/components/ui/SmartPreview";

export default function BudgetForm({
  accounts,
  initialRate,
  initialRateDate,
  initialRateSource,
}: {
  accounts: { id: string; code: string; name: string }[];
  initialRate?: string | null;
  initialRateDate?: string;
  initialRateSource?: string;
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(createBudgetAction, null);
  const [irtAmount, setIrtAmount] = useState("");
  const { rate, date, source } = useLatestRate(initialRate ?? null);
  const effectiveRate = initialRate ?? rate;
  const effectiveDate = initialRateDate ?? date;
  const effectiveSource = initialRateSource ?? source;

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="b-name">نام بودجه</label>
        <input id="b-name" name="name" className="field" placeholder="مثلاً: خوراک ماهانه" required />
      </div>
      <div>
        <label className="label" htmlFor="b-account">دسته هزینه</label>
        <select id="b-account" name="accountId" className="field" required>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} — {a.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="b-amount">سقف بودجه به تومان — مرجع</label>
        <AmountInput
          id="b-amount"
          name="amountBase"
          className="field num"
          dir="ltr"
          inputMode="numeric"
          placeholder="مثلاً 50000000"
          unit="toman"
          value={irtAmount}
          onChange={(e) => setIrtAmount(e.target.value.replace(/[^0-9]/g, ""))}
          required
        />
        <div className="mt-2">
          <SmartAmountPreview irtAmount={irtAmount} rate={effectiveRate} rateDate={effectiveDate} rateSource={effectiveSource} />
        </div>
        <p className="muted mt-1 text-[10px] leading-5">
          مبلغ تومان ثابت می‌ماند؛ معادل دلاری فقط نمایشی است و با تغییر نرخ روز به‌روز می‌شود.
        </p>
      </div>
      <DualDateInput name="periodStart" label="شروع دوره" required />
      <DualDateInput name="periodEnd" label="پایان دوره" required />
      <div className="flex items-center gap-3 sm:col-span-2">
        <SubmitButton className="btn btn-primary" pendingText="در حال ایجاد…">
          ایجاد بودجه
        </SubmitButton>
        {state && (
          <p className="text-[12px]" style={{ color: state.ok ? "var(--positive)" : "var(--negative)" }} role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
