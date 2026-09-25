"use client";

import { useActionState, useState } from "react";
import { createChequeAction } from "@/app/actions/cheques";
import type { ActionResult } from "@/app/actions";
import AccountPicker, { type PickerAccount } from "@/components/ui/AccountPicker";
import AmountInput from "@/components/ui/AmountInput";
import DualDateInput from "@/components/ui/DualDateInput";

export type ChequeAccountOption = PickerAccount;
export type ChequeInstallmentOption = { id: string; label: string; amountToman: string | null; dueDate: string };

/**
 * «ثبت چک» — a cheque is a plan until it clears. Nothing here writes the
 * ledger; «ثبت پاس شدن» on the list does, through the transaction form.
 */
export default function ChequeForm({
  accounts,
  balances,
  installments,
  today,
}: {
  accounts: ChequeAccountOption[];
  /** Posted balance per account id, in the account's own unit. */
  balances?: Record<string, string>;
  installments: ChequeInstallmentOption[];
  today: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createChequeAction, null);
  const [direction, setDirection] = useState<"issued" | "received">("issued");
  const [counterparty, setCounterparty] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(today);
  const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0].id : "");
  const [installmentId, setInstallmentId] = useState("");

  // A saved cheque clears the form for the next one (a cheque book is usually
  // entered leaf by leaf); the direction and account stay.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) {
      setCounterparty("");
      setAmount("");
      setInstallmentId("");
    }
  }

  const issued = direction === "issued";
  const ready = counterparty.trim().length > 0 && Number(amount) > 0 && !!dueDate && (!issued || !!accountId);

  const pickInstallment = (id: string) => {
    setInstallmentId(id);
    const inst = installments.find((i) => i.id === id);
    if (inst) {
      if (inst.amountToman) setAmount(inst.amountToman);
      setDueDate(inst.dueDate);
    }
  };

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="direction" value={direction} />

      <div className="expense-seg" role="group" aria-label="نوع چک">
        {(
          [
            ["issued", "چک صادره (من نوشته‌ام)"],
            ["received", "چک دریافتی (به من داده‌اند)"],
          ] as const
        ).map(([key, text]) => (
          <button key={key} type="button" data-on={direction === key || undefined} aria-pressed={direction === key} onClick={() => setDirection(key)}>
            {text}
          </button>
        ))}
      </div>

      <div>
        <label className="label" htmlFor="cheque-counterparty">
          {issued ? "در وجه" : "از طرف"}
        </label>
        <input
          id="cheque-counterparty"
          name="counterparty"
          className="field"
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          placeholder={issued ? "مثلاً صاحب‌خانه" : "مثلاً خریدار خودرو"}
          maxLength={120}
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="cheque-amount">
          مبلغ (تومان)
        </label>
        <AmountInput id="cheque-amount" name="amountToman" value={amount} onValueChange={setAmount} placeholder="۰" className="field num" unit="toman" />
      </div>

      <DualDateInput name="dueDate" value={dueDate} onChange={setDueDate} label="تاریخ سررسید" required showGregorian={false} />

      <AccountPicker
        label={issued ? "از حساب" : "واریز به حساب (اختیاری)"}
        name="accountId"
        value={accountId}
        options={accounts}
        balances={balances}
        onChange={setAccountId}
        noneLabel={issued ? undefined : "هنوز مشخص نیست"}
      />

      {issued && installments.length > 0 && (
        <div>
          <label className="label" htmlFor="cheque-installment">
            بابت قسط (اختیاری)
          </label>
          <select id="cheque-installment" name="installmentId" className="field" value={installmentId} onChange={(e) => pickInstallment(e.target.value)}>
            <option value="">بابت قسط ثبت‌شده‌ای نیست</option>
            {installments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
          <p className="muted mt-1 text-[length:var(--fs-xs)] leading-5">
            اگر این چک برای قسطی است که در اقساط ثبت کرده‌اید، انتخابش کنید تا در پیش‌بینی نقدینگی دو بار شمرده نشود.
          </p>
        </div>
      )}

      <details className="rounded-[var(--r-md)] border p-3" style={{ borderColor: "var(--border)" }}>
        <summary className="cursor-pointer text-[length:var(--fs-sm)] font-semibold">جزئیات چک (اختیاری)</summary>
        <div className="mt-3 space-y-3">
          <div>
            <label className="label" htmlFor="cheque-sayad">
              شناسه صیادی (۱۶ رقم)
            </label>
            <input id="cheque-sayad" name="sayadId" className="field num" inputMode="numeric" dir="ltr" maxLength={24} autoComplete="off" />
          </div>
          <div>
            <label className="label" htmlFor="cheque-serial">
              شماره سریال
            </label>
            <input id="cheque-serial" name="serial" className="field num" dir="ltr" maxLength={40} autoComplete="off" />
          </div>
          {!issued && (
            <div>
              <label className="label" htmlFor="cheque-bank">
                بانک صادرکننده
              </label>
              <input id="cheque-bank" name="bankName" className="field" maxLength={60} placeholder="مثلاً بانک ملت" />
            </div>
          )}
          <div>
            <label className="label" htmlFor="cheque-note">
              یادداشت
            </label>
            <input id="cheque-note" name="note" className="field" maxLength={500} />
          </div>
        </div>
      </details>

      {state && (
        <p className="text-[length:var(--fs-xs)]" role={state.ok ? "status" : "alert"} style={{ color: state.ok ? "var(--positive)" : "var(--negative)" }}>
          {state.message}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full disabled:opacity-40" disabled={pending || !ready}>
        {pending ? "در حال ثبت…" : "ثبت چک"}
      </button>
      <p className="muted text-center text-[length:var(--fs-xs)]">
        چک تا وقتی پاس نشده فقط در برنامه و پیش‌بینی اثر دارد و از موجودی حساب‌ها چیزی کم یا زیاد نمی‌کند.
      </p>
    </form>
  );
}
