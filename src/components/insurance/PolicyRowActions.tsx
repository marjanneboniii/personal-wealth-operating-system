"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { cancelPolicyAction, deletePolicyAction, renewPolicyAction } from "@/app/actions/insurance";
import type { ActionResult } from "@/app/actions";
import AmountInput from "@/components/ui/AmountInput";
import DualDateInput from "@/components/ui/DualDateInput";
import { FormStatus } from "@/components/ui/FormStatus";

const SMALL = "btn !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]";

function plusOneYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export default function PolicyRowActions({
  id,
  active,
  payHref,
  endDate,
  premiumToman,
  coverageToman,
  today,
  renewSoon,
}: {
  id: string;
  active: boolean;
  payHref: string | null;
  endDate: string | null;
  premiumToman: string;
  coverageToman: string | null;
  today: string;
  /** Near or past the end of the term: renewal is the main action. */
  renewSoon: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [state, action, saving] = useActionState<ActionResult | null, FormData>(renewPolicyAction, null);
  const from = endDate ?? today;
  const [newEnd, setNewEnd] = useState(plusOneYear(from));
  const [premium, setPremium] = useState(premiumToman);
  const [coverage, setCoverage] = useState(coverageToman ?? "");

  const run = (fn: () => Promise<ActionResult>, confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    start(async () => {
      const res = await fn();
      setError(res.ok ? null : res.message);
    });
  };

  return (
    <div className="flex w-full flex-wrap justify-end gap-2">
      {active && payHref && (
        <Link href={payHref} className={`${SMALL} ${renewSoon ? "btn-soft" : "btn-primary"}`}>
          پرداخت حق بیمه
        </Link>
      )}
      {active && (
        <button type="button" className={`${SMALL} ${renewSoon ? "btn-primary" : "btn-ghost"}`} aria-expanded={renewing} onClick={() => setRenewing((r) => !r)}>
          تمدید
        </button>
      )}
      {active && (
        <button
          type="button"
          className={`${SMALL} btn-ghost`}
          disabled={pending}
          onClick={() => run(() => cancelPolicyAction(id), "بیمه‌نامه لغو شود؟ یادآور حق بیمه‌ی بعدی حذف می‌شود؛ حق بیمه‌های ثبت‌شده در دفترکل می‌مانند.")}
        >
          لغو
        </button>
      )}
      <button
        type="button"
        className={`${SMALL} btn-ghost`}
        style={{ color: "var(--negative)" }}
        disabled={pending}
        onClick={() => run(() => deletePolicyAction(id), "این بیمه‌نامه حذف شود؟ حق بیمه‌های ثبت‌شده و حساب اندوخته در دفترکل می‌مانند.")}
      >
        حذف
      </button>
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
          <div>
            <label className="label" htmlFor={`renew-coverage-${id}`}>
              سرمایه‌ی بیمه‌شده (اختیاری)
            </label>
            <AmountInput id={`renew-coverage-${id}`} name="coverageToman" value={coverage} onValueChange={setCoverage} className="field num" unit="toman" />
          </div>
          <FormStatus state={state} />
          <button type="submit" className="btn btn-primary w-full disabled:opacity-40" disabled={saving || !premium || newEnd <= from}>
            {saving ? "در حال ثبت…" : "ثبت تمدید"}
          </button>
        </form>
      )}
    </div>
  );
}
