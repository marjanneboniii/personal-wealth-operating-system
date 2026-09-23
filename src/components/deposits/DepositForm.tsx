"use client";

import { useActionState, useState } from "react";
import { createDepositAction } from "@/app/actions/deposits";
import type { ActionResult } from "@/app/actions";
import AmountInput from "@/components/ui/AmountInput";
import DualDateInput from "@/components/ui/DualDateInput";
import { formatMoney } from "@/lib/format";
import { normalizeNumericInput } from "@/lib/numericInput";

export type DepositAccountOption = { id: string; name: string; toman: boolean };

/** «ثبت سپرده» — nothing here posts; the interest becomes a monthly reminder. */
export default function DepositForm({ accounts, today }: { accounts: DepositAccountOption[]; today: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createDepositAction, null);
  const [kind, setKind] = useState<"bank" | "fund">("bank");
  const [title, setTitle] = useState("");
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [maturityDate, setMaturityDate] = useState("");
  const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0].id : "");
  const [payoutId, setPayoutId] = useState("");

  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) {
      setTitle("");
      setPrincipal("");
      setRate("");
      setMaturityDate("");
    }
  }

  const rateNum = Number(normalizeNumericInput(rate, { decimal: true }));
  const principalNum = Number(principal);
  const monthly = principalNum > 0 && rateNum > 0 && rateNum <= 100 ? Math.round((principalNum * rateNum) / 1200) : 0;
  const payoutOptions = accounts.filter((a) => a.toman);
  const effectivePayout = payoutId || (accounts.find((a) => a.id === accountId)?.toman ? accountId : "");
  const ready = title.trim().length > 0 && monthly > 0 && !!startDate && !!accountId && !!effectivePayout && (!maturityDate || maturityDate > startDate);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="payoutAccountId" value={effectivePayout} />

      <div className="expense-seg" role="group" aria-label="نوع">
        {(
          [
            ["bank", "سپرده‌ی بانکی"],
            ["fund", "صندوق با سود ماهانه"],
          ] as const
        ).map(([key, text]) => (
          <button key={key} type="button" data-on={kind === key || undefined} aria-pressed={kind === key} onClick={() => setKind(key)}>
            {text}
          </button>
        ))}
      </div>

      <div>
        <label className="label" htmlFor="deposit-title">
          نام
        </label>
        <input
          id="deposit-title"
          name="title"
          className="field"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === "bank" ? "مثلاً سپرده‌ی یک‌ساله" : "مثلاً صندوق درآمد ثابت"}
          maxLength={120}
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="deposit-institution">
          {kind === "bank" ? "بانک (اختیاری)" : "نام صندوق یا کارگزاری (اختیاری)"}
        </label>
        <input id="deposit-institution" name="institution" className="field" maxLength={80} />
      </div>

      <div>
        <label className="label" htmlFor="deposit-principal">
          مبلغ اصل (تومان)
        </label>
        <AmountInput id="deposit-principal" name="principalToman" value={principal} onValueChange={setPrincipal} placeholder="۰" className="field num" unit="toman" />
      </div>
      <div>
        <label className="label" htmlFor="deposit-rate">
          نرخ سود سالانه (٪)
        </label>
        <input
          id="deposit-rate"
          name="annualRate"
          className="field num"
          inputMode="decimal"
          dir="ltr"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          placeholder="23"
          required
        />
        {monthly > 0 && (
          <p className="muted mt-1 text-[length:var(--fs-xs)]">
            سود ماهانه حدود <b className="num">{formatMoney(String(monthly), "IRT")}</b> (اصل × نرخ ÷ ۱۲)
          </p>
        )}
      </div>

      <DualDateInput name="startDate" value={startDate} onChange={setStartDate} label="تاریخ شروع (روز واریز سود هر ماه)" required showGregorian={false} />
      <DualDateInput name="maturityDate" value={maturityDate} onChange={setMaturityDate} label="تاریخ سررسید (اختیاری)" showGregorian={false} />

      <div>
        <label className="label" htmlFor="deposit-account">
          اصل پول در کدام حساب است؟
        </label>
        <select id="deposit-account" name="accountId" className="field" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
          <option value="">انتخاب حساب</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="deposit-payout">
          سود به کدام حساب واریز می‌شود؟
        </label>
        <select id="deposit-payout" className="field" value={effectivePayout} onChange={(e) => setPayoutId(e.target.value)} required>
          <option value="">انتخاب حساب تومانی</option>
          {payoutOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="deposit-note">
          یادداشت (اختیاری)
        </label>
        <input id="deposit-note" name="note" className="field" maxLength={500} />
      </div>

      {state && (
        <p className="text-[length:var(--fs-xs)]" role={state.ok ? "status" : "alert"} style={{ color: state.ok ? "var(--positive)" : "var(--negative)" }}>
          {state.message}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full disabled:opacity-40" disabled={pending || !ready}>
        {pending ? "در حال ثبت…" : "ثبت سپرده"}
      </button>
      <p className="muted text-center text-[length:var(--fs-xs)]">
        اصل پول را قبلاً در حساب ثبت کرده‌اید؛ اینجا فقط سود ماهانه زمان‌بندی می‌شود و هر ماه با یک ضربه ثبت می‌کنید.
      </p>
    </form>
  );
}
