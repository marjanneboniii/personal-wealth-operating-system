"use client";

import Link from "next/link";
import { useActionState, useRef, useState, useTransition } from "react";
import { cancelPolicyAction, deletePolicyAction, renewPolicyAction } from "@/app/actions/insurance";
import type { ActionResult } from "@/app/actions";
import AccountPicker, { type PickerAccount } from "@/components/ui/AccountPicker";
import AmountInput from "@/components/ui/AmountInput";
import DualDateInput from "@/components/ui/DualDateInput";
import { FormStatus } from "@/components/ui/FormStatus";
import Icon from "@/components/ui/Icon";

const SMALL = "btn !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]";

function plusOneYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * One primary action (pay the premium, see the installments, or renew) and a
 * quiet «⋯» for the rest — a row never becomes a wall of buttons.
 */
export default function PolicyRowActions({
  id,
  active,
  payHref,
  debtHref,
  endDate,
  premiumToman,
  coverageToman,
  today,
  renewSoon,
  bankAccounts,
  balances,
  needsAccount,
}: {
  id: string;
  active: boolean;
  payHref: string | null;
  /** Paid through a debt: its installments, instead of a premium to pay. */
  debtHref: string | null;
  endDate: string | null;
  premiumToman: string;
  coverageToman: string | null;
  today: string;
  /** Near or past the end of the term: renewal is the main action. */
  renewSoon: boolean;
  /** Toman bank accounts, for a renewal of a term that had none (it was paid through a debt). */
  bankAccounts: PickerAccount[];
  balances?: Record<string, string>;
  needsAccount: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [state, action, saving] = useActionState<ActionResult | null, FormData>(renewPolicyAction, null);
  const from = endDate ?? today;
  const [newEnd, setNewEnd] = useState(plusOneYear(from));
  const [premium, setPremium] = useState(premiumToman);
  const [coverage, setCoverage] = useState(coverageToman ?? "");
  const [payAccountId, setPayAccountId] = useState(bankAccounts.length === 1 ? bankAccounts[0].id : "");
  const menuRef = useRef<HTMLDetailsElement>(null);

  const run = (fn: () => Promise<ActionResult>, confirmText: string) => {
    if (menuRef.current) menuRef.current.open = false;
    if (!window.confirm(confirmText)) return;
    start(async () => {
      const res = await fn();
      setError(res.ok ? null : res.message);
    });
  };

  return (
    <div className="policy-row-actions flex w-full flex-wrap items-center justify-end gap-2">
      {active && payHref && !renewSoon && (
        <Link href={payHref} className={`${SMALL} btn-primary`}>
          پرداخت حق بیمه
        </Link>
      )}
      {active && debtHref && !renewSoon && (
        <Link href={debtHref} className={`${SMALL} btn-soft`}>
          اقساط
        </Link>
      )}
      {active && (
        <button type="button" className={`${SMALL} ${renewSoon ? "btn-primary" : "btn-ghost"}`} aria-expanded={renewing} onClick={() => setRenewing((r) => !r)}>
          تمدید
        </button>
      )}
      <details ref={menuRef} className="policy-menu">
        <summary className={`${SMALL} btn-ghost !px-2`} aria-label="گزینه‌های بیشتر">
          <Icon name="more" size={16} />
        </summary>
        <div className="policy-menu-list">
          {active && payHref && renewSoon && (
            <Link href={payHref} className="policy-menu-link">
              پرداخت حق بیمه
            </Link>
          )}
          {active && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => cancelPolicyAction(id), "بیمه‌نامه لغو شود؟ یادآور حق بیمه‌ی بعدی حذف می‌شود؛ حق بیمه‌های پرداخت‌شده سر جایشان می‌مانند.")}
            >
              لغو بیمه‌نامه
            </button>
          )}
          <button
            type="button"
            style={{ color: "var(--negative)" }}
            disabled={pending}
            onClick={() => run(() => deletePolicyAction(id), "این بیمه‌نامه حذف شود؟ حق بیمه‌های ثبت‌شده، بدهی و حساب اندوخته سر جایشان می‌مانند.")}
          >
            حذف
          </button>
        </div>
      </details>
      {error && (
        <p className="w-full text-end text-[length:var(--fs-xs)]" role="alert" style={{ color: "var(--negative)" }}>
          {error}
        </p>
      )}
      {renewing && (
        <form action={action} className="reconcile-form w-full">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="startDate" value={from} />
          <DualDateInput name="endDate" value={newEnd} onChange={setNewEnd} label="پایان دوره‌ی جدید" required showGregorian={false} />
          <div>
            <label className="label" htmlFor={`renew-premium-${id}`}>
              حق بیمه‌ی دوره‌ی جدید (تومان)
            </label>
            <AmountInput id={`renew-premium-${id}`} name="premiumToman" value={premium} onValueChange={setPremium} className="field num" unit="toman" />
          </div>
          {needsAccount && (
            <AccountPicker
              label="از کدام حساب بانکی؟"
              sheetTitle="حساب بانکی تومانی"
              placeholder="انتخاب حساب بانکی"
              name="payAccountId"
              value={payAccountId}
              options={bankAccounts}
              balances={balances}
              onChange={setPayAccountId}
            />
          )}
          <div>
            <label className="label" htmlFor={`renew-coverage-${id}`}>
              سرمایه‌ی بیمه‌شده (اختیاری)
            </label>
            <AmountInput id={`renew-coverage-${id}`} name="coverageToman" value={coverage} onValueChange={setCoverage} className="field num" unit="toman" />
          </div>
          <FormStatus state={state} />
          <button type="submit" className="btn btn-primary w-full disabled:opacity-40" disabled={saving || !premium || newEnd <= from || (needsAccount && !payAccountId)}>
            {saving ? "در حال ثبت…" : "ثبت تمدید"}
          </button>
        </form>
      )}
    </div>
  );
}
