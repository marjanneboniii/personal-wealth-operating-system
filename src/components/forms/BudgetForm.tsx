"use client";

import { useActionState } from "react";
import { createBudgetAction, type ActionResult } from "@/app/actions";
import SubmitButton from "@/components/ui/SubmitButton";
import DualDateInput from "@/components/ui/DualDateInput";

export default function BudgetForm({ accounts }: { accounts: { id: string; code: string; name: string }[] }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(createBudgetAction, null);

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
        <label className="label" htmlFor="b-amount">سقف (ارز پایه — دلار)</label>
        <input id="b-amount" name="amountBase" className="field num" dir="ltr" inputMode="decimal" placeholder="500" required />
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
