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
  matched: { label: "یکی با بانک", icon: "check", c: "var(--positive)", bg: "var(--positive-soft)" },
  mismatch: { label: "اختلاف", icon: "alert", c: "var(--warning)", bg: "var(--warning-soft)" },
  unchecked: { label: "تطبیق نشده", icon: "scale", c: "var(--text-3)", bg: "var(--sunken)" },
} as const;

/**
 * One account, one line: name, balance in توازن, state — and a single «تطبیق».
 * The figures and the two fixes appear only when there is a difference.
 */
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
    if (!window.confirm("اختلاف با یک سند اصلاحی صاف شود؟ هزینه یا درآمد حساب نمی‌شود و بعداً قابل ابطال است.")) return;
    startAdjust(async () => setAdjustResult(await adjustToBankAction(row.checkpointId!)));
  };
  const mismatch = row.state === "mismatch";

  return (
    <li id={`acc-${row.accountId}`} className="reconcile-row">
      <div className="list-row">
        <span className="flow-icon" aria-hidden="true" style={{ color: s.c, background: s.bg }}>
          <Icon name={s.icon} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[length:var(--fs-sm)] font-semibold">{row.name}</p>
          <p className="muted truncate text-[length:var(--fs-xs)]">
            <span className="num money-nowrap" dir="rtl">
              {row.ledgerNowLabel}
            </span>
            <span style={{ color: row.state === "unchecked" ? undefined : s.c }}>
              {" · "}
              {s.label}
            </span>
            {row.bankMeta && row.state === "matched" ? ` · ${row.bankMeta}` : ""}
            {row.stale && row.state !== "unchecked" ? " · قدیمی" : ""}
          </p>
        </div>
        <button
          type="button"
          className={`${SMALL} ${row.state === "unchecked" ? "btn-soft" : "btn-ghost"} shrink-0`}
          aria-expanded={open}
          aria-label={`تطبیق ${row.name}`}
          onClick={() => setOpen((o) => !o)}
        >
          تطبیق
        </button>
      </div>

      {(mismatch || open || adjustResult) && (
        <div className="reconcile-body">
          {mismatch && (
            <div className="recon-diff">
              <dl className="reconcile-figures">
                <div>
                  <dt>بانک</dt>
                  <dd className="num money-nowrap" dir="rtl">
                    {row.bankLabel}
                  </dd>
                </div>
                {row.differenceLabel && (
                  <div>
                    <dt>اختلاف</dt>
                    <dd className="num money-nowrap" dir="rtl" style={{ color: "var(--warning)" }}>
                      {row.differenceLabel}
                    </dd>
                  </div>
                )}
              </dl>
              {row.hint && <p className="muted text-[length:var(--fs-xs)]">{row.hint}</p>}
              <div className="flex flex-wrap gap-2">
                {row.missingHref && (
                  <Link href={row.missingHref} className={`${SMALL} btn-primary`}>
                    ثبت تراکنش جاافتاده
                  </Link>
                )}
                {row.checkpointId && (
                  <button type="button" className={`${SMALL} btn-ghost`} disabled={adjusting} onClick={adjust}>
                    {adjusting ? "در حال ثبت…" : "اصلاح موجودی"}
                  </button>
                )}
              </div>
            </div>
          )}
          <FormStatus state={adjustResult} />

          {open && (
            <form action={action} className="reconcile-form">
              <input type="hidden" name="accountId" value={row.accountId} />
              <input type="hidden" name="negative" value={negative ? "yes" : ""} />
              <div>
                <label className="label" htmlFor={`bal-${row.accountId}`}>
                  موجودی در اپ بانک یا کیف پول
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
                {row.unit === "toman" && (
                  <label className="mt-1.5 flex items-center gap-2 text-[length:var(--fs-xs)] text-[color:var(--text-3)]">
                    <input type="checkbox" checked={negative} onChange={(e) => setNegative(e.target.checked)} />
                    منفی است
                  </label>
                )}
              </div>
              <DualDateInput name="asOf" value={asOf} onChange={setAsOf} label="تاریخ" required showGregorian={false} />
              <FormStatus state={state} />
              <button type="submit" className="btn btn-primary w-full disabled:opacity-40" disabled={pending || !balance}>
                {pending ? "در حال مقایسه…" : "مقایسه"}
              </button>
            </form>
          )}
        </div>
      )}
    </li>
  );
}
