"use client";

import { useActionState, useState, useTransition } from "react";
import Icon from "@/components/ui/Icon";
import type { ActionResult } from "@/app/actions";
import { createFundAction, createUndatedAction, deleteUndatedAction } from "@/app/actions/planning";
import { type PickerAccount } from "@/components/ui/AccountPicker";
import SavingsAccountChooser from "./SavingsAccountChooser";
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
  ["emergency", "اضطراری", "برای روز مبادا"],
  ["reserve", "ذخیره", "پس‌انداز آزاد"],
  ["family_support", "خانواده", "حمایت از عزیزان"],
] as const;

/** صندوق اختصاصی — what it is for, its target and, optionally, where it is kept. */
export function FundCardForm({ accounts, balances, onDone }: { accounts: PickerAccount[]; balances?: Record<string, string>; onDone?: () => void }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createFundAction, null);
  const [kind, setKind] = useState<(typeof FUND_KINDS)[number][0]>("emergency");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [accountId, setAccountId] = useState("");
  useResetOnOk(state, () => (setName(""), setTarget("")), onDone);
  return (
    <form action={action} className="expense-form space-y-3 p-3 sm:p-4" dir="rtl">
      <input type="hidden" name="kind" value={kind} />

      <section className="card expense-card" aria-labelledby="fund-kind-title">
        <header className="expense-head">
          <h2 id="fund-kind-title">صندوق برای چیست؟</h2>
        </header>
        <div className="expense-squares fund-kinds" role="radiogroup" aria-label="نوع صندوق">
          {FUND_KINDS.map(([k, t, meta]) => {
            const on = kind === k;
            return (
              <button key={k} type="button" role="radio" aria-checked={on} className="expense-square" data-on={on || undefined} onClick={() => setKind(k)}>
                {on && <Check />}
                <span className="expense-square-label">{t}</span>
                <span className="expense-square-meta">{meta}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card expense-card" aria-labelledby="fund-details-title">
        <header className="expense-head">
          <h2 id="fund-details-title">مشخصات</h2>
        </header>
        <div>
          <label className="label" htmlFor="fund-name">نام صندوق</label>
          <input id="fund-name" name="name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً صندوق اضطراری خانه" maxLength={80} autoComplete="off" required />
        </div>
        <div>
          <label className="label">مبلغ هدف به تومان</label>
          <AmountInput name="target" value={target} onValueChange={setTarget} className="field num" unit="toman" placeholder="۰" aria-label="مبلغ هدف" />
        </div>
      </section>

      <section className="card expense-card">
        <SavingsAccountChooser
          name="accountId"
          value={accountId}
          options={accounts}
          balances={balances}
          onChange={setAccountId}
          noneLabel="بدون حساب اختصاصی"
          hint="اختیاری — موجودی صندوق از همین حساب خوانده می‌شود."
        />
      </section>

      <FormStatus state={state} />
      <button type="submit" className="btn btn-primary w-full" disabled={pending || name.trim().length < 2 || !(Number(target) > 0)}>
        ساخت صندوق
      </button>
    </form>
  );
}

const COINS = [
  ["EMAMI", "سکه تمام", "امامی"],
  ["BAHAR", "بهار آزادی", "طرح قدیم"],
  ["NIM", "نیم سکه", "½ سکه"],
  ["ROB", "ربع سکه", "¼ سکه"],
] as const;

type Coin = (typeof COINS)[number][0];

function Check() {
  return (
    <span className="expense-check" aria-hidden="true">
      <Icon name="check" size={11} strokeWidth={3} />
    </span>
  );
}

/**
 * بدهی بدون سررسید — coins or Toman owed with no due date. One card: what it
 * is, then سکه (which coin, how many) or تومان (amount, optionally indexed to
 * inflation). Kept out of net worth: with no date it is never a cash flow.
 */
export function UndatedForm({ onDone }: { onDone?: () => void }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createUndatedAction, null);
  const [kind, setKind] = useState<"coin" | "toman">("coin");
  const [coin, setCoin] = useState<Coin>("EMAMI");
  const [title, setTitle] = useState("");
  const [qty, setQty] = useState("");
  const [startDate, setStartDate] = useState("");
  const [inflation, setInflation] = useState("");
  useResetOnOk(state, () => (setTitle(""), setQty(""), setInflation("")), onDone);
  const toman = kind === "toman";
  return (
    <form action={action} className="expense-form space-y-3 p-3 sm:p-4" dir="rtl">
      <input type="hidden" name="direction" value="payable" />
      <input type="hidden" name="unit" value={toman ? "toman" : coin} />

      <section className="card expense-card" aria-label="بدهی بدون سررسید">
        <div>
          <label className="label" htmlFor="undated-title">عنوان</label>
          <input
            id="undated-title"
            name="title"
            className="field"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثلاً قرض خانوادگی"
            maxLength={80}
            autoComplete="off"
            required
          />
        </div>

        <div className="expense-seg" role="radiogroup" aria-label="واحد">
          {(
            [
              ["coin", "سکه"],
              ["toman", "تومان"],
            ] as const
          ).map(([k, t]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} data-on={kind === k || undefined} onClick={() => (setKind(k), setQty(""))}>
              {t}
            </button>
          ))}
        </div>

        {toman ? (
          <>
            <div>
              <label className="label">مبلغ به تومان</label>
              <AmountInput name="quantity" value={qty} onValueChange={setQty} className="field num" unit="toman" placeholder="۰" aria-label="مبلغ" />
            </div>
            <details className="plan-menu-edit">
              <summary>
                <Icon name="trend-up" size={16} />
                به‌روز با تورم (اختیاری)
              </summary>
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
                <p className="expense-sub">تخمینی است؛ مبنای قانونی، شاخص رسمی روز پرداخت است.</p>
              </div>
            </details>
          </>
        ) : (
          <>
            <div className="expense-squares undated-coins" role="radiogroup" aria-label="نوع سکه">
              {COINS.map(([k, label, meta]) => {
                const on = coin === k;
                return (
                  <button key={k} type="button" role="radio" aria-checked={on} className="expense-square" data-on={on || undefined} onClick={() => setCoin(k)}>
                    {on && <Check />}
                    <span className="expense-square-label">{label}</span>
                    <span className="expense-square-meta">{meta}</span>
                  </button>
                );
              })}
            </div>
            <div>
              <label className="label" htmlFor="undated-qty">تعداد</label>
              <input
                id="undated-qty"
                name="quantity"
                className="field num"
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="۰"
                maxLength={8}
                autoComplete="off"
              />
            </div>
          </>
        )}
        <p className="expense-note">
          {toman ? "" : "ارزش سکه هر روز با قیمت بازار حساب می‌شود. "}در دارایی خالص حساب نمی‌شود.
        </p>
      </section>

      <FormStatus state={state} />
      <button
        type="submit"
        className="btn btn-primary w-full"
        disabled={pending || title.trim().length < 2 || !qty.trim() || (toman && !!inflation.trim() && !startDate)}
      >
        ثبت بدهی
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
