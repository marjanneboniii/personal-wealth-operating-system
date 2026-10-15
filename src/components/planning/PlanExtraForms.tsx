"use client";

import { useActionState, useState, useTransition } from "react";
import Icon from "@/components/ui/Icon";
import type { ActionResult } from "@/app/actions";
import { createFundAction, createUndatedAction, deleteUndatedAction } from "@/app/actions/planning";
import AccountPicker, { type PickerAccount } from "@/components/ui/AccountPicker";
import AmountInput from "@/components/ui/AmountInput";
import DualDateInput from "@/components/ui/DualDateInput";
import { FormStatus } from "@/components/ui/FormStatus";

function useResetOnOk(state: ActionResult | null, reset: () => void, onDone?: () => void) {
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) {
      reset();
      onDone?.();
    }
  }
}

const FUND_KINDS = [
  ["emergency", "اضطراری"],
  ["reserve", "ذخیره"],
  ["family_support", "خانواده"],
] as const;

/** صندوق اختصاصی — a target and, optionally, the account that holds it. */
export function FundCardForm({ accounts, balances, onDone }: { accounts: PickerAccount[]; balances?: Record<string, string>; onDone?: () => void }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createFundAction, null);
  const [kind, setKind] = useState<(typeof FUND_KINDS)[number][0]>("emergency");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [accountId, setAccountId] = useState("");
  useResetOnOk(state, () => (setName(""), setTarget("")), onDone);
  return (
    <form action={action} className="expense-form space-y-3 p-3 sm:p-4">
      <input type="hidden" name="kind" value={kind} />
      <div className="expense-seg" role="group" aria-label="نوع صندوق">
        {FUND_KINDS.map(([k, t]) => (
          <button key={k} type="button" data-on={kind === k || undefined} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {t}
          </button>
        ))}
      </div>
      <input name="name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="نام" aria-label="نام" maxLength={80} required />
      <AmountInput name="target" value={target} onValueChange={setTarget} className="field num" unit="toman" placeholder="مبلغ هدف" aria-label="مبلغ هدف" />
      <AccountPicker label="حساب (اختیاری)" name="accountId" value={accountId} options={accounts} balances={balances} onChange={setAccountId} noneLabel="بدون حساب" />
      <FormStatus state={state} />
      <button type="submit" className="btn btn-primary w-full" disabled={pending || name.trim().length < 2 || !(Number(target) > 0)}>
        ساخت صندوق
      </button>
    </form>
  );
}

const UNITS = [
  ["EMAMI", "سکه تمام"],
  ["BAHAR", "بهار آزادی"],
  ["NIM", "نیم سکه"],
  ["ROB", "ربع سکه"],
  ["toman", "تومان"],
] as const;

/** بدهی یا طلب بدون سررسید — coins or Toman, owed on demand. */
export function UndatedForm({ onDone }: { onDone?: () => void }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createUndatedAction, null);
  const [direction, setDirection] = useState<"payable" | "receivable">("payable");
  const [unit, setUnit] = useState<(typeof UNITS)[number][0]>("EMAMI");
  const [title, setTitle] = useState("");
  const [qty, setQty] = useState("");
  const [startDate, setStartDate] = useState("");
  const [inflation, setInflation] = useState("");
  useResetOnOk(state, () => (setTitle(""), setQty(""), setInflation("")), onDone);
  const toman = unit === "toman";
  return (
    <form action={action} className="expense-form space-y-3 p-3 sm:p-4">
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="unit" value={unit} />
      <div className="expense-seg" role="group" aria-label="جهت">
        {(
          [
            ["payable", "بدهی من"],
            ["receivable", "طلب من"],
          ] as const
        ).map(([k, t]) => (
          <button key={k} type="button" data-on={direction === k || undefined} aria-pressed={direction === k} onClick={() => setDirection(k)}>
            {t}
          </button>
        ))}
      </div>
      <input name="title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان" aria-label="عنوان" maxLength={80} required />
      <div className="undated-units" role="radiogroup" aria-label="واحد">
        {UNITS.map(([k, t]) => (
          <button key={k} type="button" role="radio" aria-checked={unit === k} className="policy-opt" data-on={unit === k || undefined} onClick={() => setUnit(k)}>
            {t}
          </button>
        ))}
      </div>
      {toman ? (
        <>
          <AmountInput name="quantity" value={qty} onValueChange={setQty} className="field num" unit="toman" placeholder="مبلغ" aria-label="مبلغ" />
          <details className="plan-menu-edit">
            <summary>به‌روز با تورم (اختیاری)</summary>
            <div className="plan-menu-form">
              <DualDateInput name="startDate" value={startDate} onChange={setStartDate} label="از تاریخ" showGregorian={false} />
              <input
                name="inflationPct"
                className="field num"
                inputMode="decimal"
                value={inflation}
                onChange={(e) => setInflation(e.target.value)}
                placeholder="تورم سالانه ٪"
                aria-label="تورم سالانه به درصد"
                maxLength={6}
              />
              <p className="muted text-[length:var(--fs-xs)]">تخمینی است؛ مبنای قانونی، شاخص رسمی روز پرداخت است.</p>
            </div>
          </details>
        </>
      ) : (
        <input
          name="quantity"
          className="field num"
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="تعداد"
          aria-label="تعداد سکه"
          maxLength={8}
        />
      )}
      <FormStatus state={state} />
      <button
        type="submit"
        className="btn btn-primary w-full"
        disabled={pending || title.trim().length < 2 || !qty.trim() || (toman && !!inflation.trim() && !startDate)}
      >
        ثبت
      </button>
    </form>
  );
}

export function UndatedDeleteButton({ id, title }: { id: string; title: string }) {
  const [busy, start] = useTransition();
  return (
    <button
      type="button"
      className="plan-menu-btn"
      aria-label={`حذف ${title}`}
      disabled={busy}
      onClick={() => {
        if (!window.confirm(`«${title}» حذف شود؟`)) return;
        start(async () => {
          const r = await deleteUndatedAction(id);
          if (!r.ok) window.alert(r.message);
        });
      }}
    >
      <Icon name="trash" size={16} />
    </button>
  );
}
