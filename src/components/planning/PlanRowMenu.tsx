"use client";

/**
 * «⋯» on a goal, fund, event or debt row — one sheet with everything the user
 * can do to it: set money aside (goals), edit, change state, delete.
 */
import { useActionState, useState, useTransition } from "react";
import type { ActionResult } from "@/app/actions";
import {
  addContributionAction,
  cancelDebtAction,
  deleteDebtAction,
  deleteEventAction,
  deleteFundAction,
  deleteGoalAction,
  setEventStatusAction,
  setGoalStatusAction,
  updateDebtAction,
  updateEventAction,
  updateFundAction,
  updateGoalAction,
} from "@/app/actions/planning";
import AmountInput from "@/components/ui/AmountInput";
import DualDateInput from "@/components/ui/DualDateInput";
import { FormStatus } from "@/components/ui/FormStatus";
import Icon from "@/components/ui/Icon";
import Sheet from "@/components/ui/Sheet";

type Kind = "goal" | "fund" | "event" | "debt";
type Item = {
  id: string;
  name: string;
  /** Toman: goal/fund target, event amount. */
  amount?: string;
  date?: string | null;
  status?: string;
  creditor?: string;
  /** Debt: some installment already paid — cancel only. */
  hasPayments?: boolean;
};

const EDIT = { goal: updateGoalAction, fund: updateFundAction, event: updateEventAction, debt: updateDebtAction } as const;

function EditForm({ kind, item, today }: { kind: Kind; item: Item; today: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(EDIT[kind], null);
  const [amount, setAmount] = useState(item.amount ?? "");
  const [date, setDate] = useState(item.date ?? (kind === "event" ? today : ""));
  return (
    <form action={action} className="plan-menu-form">
      <input type="hidden" name="id" value={item.id} />
      <input name="name" className="field" defaultValue={item.name} aria-label="نام" maxLength={kind === "debt" ? 120 : 80} required />
      {kind === "debt" ? (
        <input name="creditor" className="field" defaultValue={item.creditor} aria-label="طرف حساب" placeholder="طرف حساب" maxLength={120} required />
      ) : (
        <AmountInput name="target" value={amount} onValueChange={setAmount} className="field num" unit="toman" aria-label="مبلغ" placeholder="مبلغ" />
      )}
      {(kind === "goal" || kind === "event") && (
        <DualDateInput name="date" value={date} onChange={setDate} label={kind === "event" ? "تاریخ" : "تا تاریخ"} required={kind === "event"} showGregorian={false} />
      )}
      <FormStatus state={state} />
      <button type="submit" className="btn btn-soft w-full" disabled={pending}>
        ذخیره
      </button>
    </form>
  );
}

function SetAsideForm({ goalId, today }: { goalId: string; today: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addContributionAction, null);
  const [mode, setMode] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) setAmount("");
  }
  return (
    <form action={action} className="plan-menu-form">
      <input type="hidden" name="goalId" value={goalId} />
      <input type="hidden" name="mode" value={mode} />
      <div className="expense-seg" role="group" aria-label="نوع">
        {(
          [
            ["in", "کنار گذاشتم"],
            ["out", "برداشتم"],
          ] as const
        ).map(([k, t]) => (
          <button key={k} type="button" data-on={mode === k || undefined} aria-pressed={mode === k} onClick={() => setMode(k)}>
            {t}
          </button>
        ))}
      </div>
      <AmountInput name="amount" value={amount} onValueChange={setAmount} className="field num" unit="toman" placeholder="مبلغ" aria-label="مبلغ" />
      <DualDateInput name="date" value={date} onChange={setDate} label="تاریخ" showGregorian={false} />
      <FormStatus state={state} />
      <button type="submit" className="btn btn-primary w-full" disabled={pending || !(Number(amount) > 0)}>
        ثبت
      </button>
    </form>
  );
}

export default function PlanRowMenu({ kind, item, today }: { kind: Kind; item: Item; today: string }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();

  const act = (fn: () => Promise<ActionResult>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    start(async () => {
      const r = await fn();
      setMsg(r);
      // The action revalidates the page; the sheet just closes.
      if (r.ok) setOpen(false);
    });
  };

  const states: [string, string, () => Promise<ActionResult>][] =
    kind === "goal"
      ? item.status === "active"
        ? [
            ["reached", "رسیدم", () => setGoalStatusAction(item.id, "reached")],
            ["archived", "بایگانی", () => setGoalStatusAction(item.id, "archived")],
          ]
        : [["active", "فعال شود", () => setGoalStatusAction(item.id, "active")]]
      : kind === "event"
        ? item.status === "planned"
          ? [
              ["done", "برگزار شد", () => setEventStatusAction(item.id, "done")],
              ["cancelled", "لغو شد", () => setEventStatusAction(item.id, "cancelled")],
            ]
          : [["planned", "برنامه‌ریزی‌شده", () => setEventStatusAction(item.id, "planned")]]
        : kind === "debt" && item.status === "active"
          ? [["cancelled", "لغو بدهی", () => cancelDebtAction(item.id)]]
          : [];

  const del =
    kind === "goal"
      ? () => deleteGoalAction(item.id)
      : kind === "fund"
        ? () => deleteFundAction(item.id)
        : kind === "event"
          ? () => deleteEventAction(item.id)
          : item.hasPayments
            ? null
            : () => deleteDebtAction(item.id);

  return (
    <>
      <button type="button" className="plan-menu-btn" aria-label={`گزینه‌های ${item.name}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="more" size={18} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={item.name}>
        {open && (
          <div className="plan-menu">
            {kind === "goal" && item.status === "active" && <SetAsideForm goalId={item.id} today={today} />}
            <details className="plan-menu-edit">
              <summary>
                <Icon name="note" size={15} />
                ویرایش
              </summary>
              <EditForm kind={kind} item={item} today={today} />
            </details>
            {(states.length > 0 || del) && (
              <div className="plan-menu-actions">
                {states.map(([key, label, fn]) => (
                  <button
                    key={key}
                    type="button"
                    className="btn btn-soft"
                    disabled={busy}
                    onClick={() => act(fn, key === "cancelled" && kind === "debt" ? "قسط‌های پرداخت‌نشده از برنامه خارج می‌شوند. ادامه؟" : undefined)}
                  >
                    {label}
                  </button>
                ))}
                {del && (
                  <button type="button" className="btn btn-soft plan-menu-del" disabled={busy} onClick={() => act(del, `«${item.name}» حذف شود؟`)}>
                    <Icon name="trash" size={15} />
                    حذف
                  </button>
                )}
              </div>
            )}
            {msg && !msg.ok && (
              <p className="text-[length:var(--fs-xs)]" role="alert" style={{ color: "var(--negative)" }}>
                {msg.message}
              </p>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}
