"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { adjustToBankAction, recordBankBalanceAction } from "@/app/actions/reconcile";
import type { ActionResult } from "@/app/actions";
import AmountInput from "@/components/ui/AmountInput";
import DualDateInput from "@/components/ui/DualDateInput";
import { FormStatus } from "@/components/ui/FormStatus";
import Icon from "@/components/ui/Icon";

const SMALL = "btn !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]";

export type ReconcileRowView = {
  accountId: string;
  name: string;
  state: "matched" | "mismatch" | "unchecked";
  stale: boolean;
  /** Pre-formatted on the server — no formatter crosses into the client. */
  ledgerNowLabel: string;
  bankLabel: string | null;
  bankMeta: string | null;
  differenceLabel: string | null;
  /** One sentence on what the difference most likely is. */
  hint: string | null;
  checkpointId: string | null;
  /** «ثبت تراکنش جاافتاده» → /new, pre-filled; null for a non-Toman account. */
  missingHref: string | null;
  unit: "toman" | "usd" | "usdt";
  today: string;
};

const STATE = {
  matched: { label: "با بانک یکی است", icon: "check", c: "var(--positive)", bg: "var(--positive-soft)" },
  mismatch: { label: "اختلاف با بانک", icon: "alert", c: "var(--warning)", bg: "var(--warning-soft)" },
  unchecked: { label: "تطبیق نشده", icon: "scale", c: "var(--text-3)", bg: "var(--sunken)" },
} as const;

export default function ReconcileRow({ row }: { row: ReconcileRowView }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(recordBankBalanceAction, null);
  const [balance, setBalance] = useState("");
  const [negative, setNegative] = useState(false);
  const [asOf, setAsOf] = useState(row.today);
  const [adjusting, startAdjust] = useTransition();
  const [adjustResult, setAdjustResult] = useState<ActionResult | null>(null);

  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) {
      setBalance("");
      setOpen(false);
    }
  }

  const s = STATE[row.state];
  const adjust = () => {
    if (!row.checkpointId) return;
    if (!window.confirm("یک سند «اصلاحی» به اندازه‌ی اختلاف ثبت شود؟ این سند هزینه یا درآمد حساب نمی‌شود و اگر بعداً تراکنش واقعی را پیدا کردید، می‌توانید آن را ابطال کنید.")) return;
    startAdjust(async () => setAdjustResult(await adjustToBankAction(row.checkpointId!)));
  };

  return (
    <li id={`acc-${row.accountId}`} className="reconcile-row">
      <div className="list-row">
        <span className="flow-icon" aria-hidden="true" style={{ color: s.c, background: s.bg }}>
          <Icon name={s.icon} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="acct-title text-[length:var(--fs-sm)] font-semibold">{row.name}</p>
          <p className="muted text-[length:var(--fs-xs)]" style={row.state === "mismatch" ? { color: s.c } : undefined}>
            {s.label}
            {row.bankMeta ? ` · ${row.bankMeta}` : ""}
            {row.stale && row.state !== "unchecked" ? " · قدیمی" : ""}
          </p>
        </div>
        <div className="acct-amount shrink-0 text-left">
          <p className="num money-nowrap text-[length:var(--fs-sm)] font-semibold" dir="rtl">
            {row.ledgerNowLabel}
          </p>
          <p className="muted text-[length:var(--fs-xs)]">در توازن</p>
        </div>
      </div>

      <div className="reconcile-body">
        {row.bankLabel && (
          <dl className="reconcile-figures">
            <div>
              <dt>بانک</dt>
              <dd className="num money-nowrap" dir="rtl">{row.bankLabel}</dd>
            </div>
            {row.differenceLabel && (
              <div>
                <dt>اختلاف</dt>
                <dd className="num money-nowrap" dir="rtl" style={{ color: row.state === "mismatch" ? "var(--warning)" : undefined }}>
                  {row.differenceLabel}
                </dd>
              </div>
            )}
          </dl>
        )}
        {row.state === "mismatch" && row.hint && <p className="muted text-[length:var(--fs-xs)]">{row.hint}</p>}

        <div className="flex flex-wrap justify-end gap-2">
          {row.state === "mismatch" && row.missingHref && (
            <Link href={row.missingHref} className={`${SMALL} btn-primary`}>
              ثبت تراکنش جاافتاده
            </Link>
          )}
          {row.state === "mismatch" && row.checkpointId && (
            <button type="button" className={`${SMALL} btn-soft`} disabled={adjusting} onClick={adjust}>
              {adjusting ? "در حال ثبت…" : "اصلاح موجودی"}
            </button>
          )}
          <button type="button" className={`${SMALL} btn-ghost`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {row.state === "unchecked" ? "ثبت موجودی بانک" : "موجودی تازه"}
          </button>
        </div>
        <FormStatus state={adjustResult} />

        {open && (
          <form action={action} className="reconcile-form">
            <input type="hidden" name="accountId" value={row.accountId} />
            <input type="hidden" name="negative" value={negative ? "yes" : ""} />
            <div>
              <label className="label" htmlFor={`bal-${row.accountId}`}>
                موجودی‌ای که بانک نشان می‌دهد
              </label>
              <AmountInput
                id={`bal-${row.accountId}`}
                name="balance"
                value={balance}
                onValueChange={setBalance}
                placeholder="۰"
                className="field num"
                unit={row.unit}
                inputMode={row.unit === "toman" ? "numeric" : "decimal"}
              />
              <label className="mt-1.5 flex items-center gap-2 text-[length:var(--fs-xs)]">
                <input type="checkbox" checked={negative} onChange={(e) => setNegative(e.target.checked)} />
                موجودی منفی است (برداشت بیش از موجودی)
              </label>
            </div>
            <DualDateInput name="asOf" value={asOf} onChange={setAsOf} label="تاریخ" required showGregorian={false} />
            <FormStatus state={state} />
            <button type="submit" className="btn btn-primary w-full disabled:opacity-40" disabled={pending || !balance}>
              {pending ? "در حال ثبت…" : "مقایسه با توازن"}
            </button>
          </form>
        )}
      </div>
    </li>
  );
}
