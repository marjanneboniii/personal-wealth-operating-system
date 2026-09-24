"use client";

import { useActionState, useState, useTransition } from "react";
import { addDueDateAction, cancelDueDateAction, completeDueDateAction } from "@/app/actions/vehicles";
import type { ActionResult } from "@/app/actions";
import DualDateInput from "@/components/ui/DualDateInput";
import { FormStatus } from "@/components/ui/FormStatus";
import Icon from "@/components/ui/Icon";

const SMALL = "btn !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]";

export type DueView = { id: string; title: string; whenLabel: string; overdue: boolean; repeatLabel: string | null };

const KINDS = [
  ["inspection", "معاینه فنی", 12],
  ["toll", "عوارض سالانه", 12],
  ["service", "سرویس دوره‌ای", 6],
  ["other", "سایر", 0],
] as const;

/** A car's due dates: done / remove, and a short form to add one. Nothing posts. */
export default function VehicleDueDates({ vehicleId, items, today }: { vehicleId: string; items: DueView[]; today: string }) {
  const [adding, setAdding] = useState(false);
  const [state, action, saving] = useActionState<ActionResult | null, FormData>(addDueDateAction, null);
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>("inspection");
  const [dueDate, setDueDate] = useState(today);
  const [repeat, setRepeat] = useState<number>(12);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) setAdding(false);
  }

  const run = (fn: () => Promise<ActionResult>) => start(async () => setResult(await fn()));

  return (
    <div className="grid gap-2">
      {items.length > 0 && (
        <ul className="grid gap-1.5">
          {items.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 text-[length:var(--fs-xs)]">
              <Icon name="calendar" size={13} />
              <span className="min-w-0 flex-1">
                <b>{d.title}</b> · <span style={d.overdue ? { color: "var(--negative)" } : undefined}>{d.whenLabel}</span>
                {d.repeatLabel ? <span className="muted"> · {d.repeatLabel}</span> : null}
              </span>
              <button type="button" className={`${SMALL} btn-soft`} disabled={pending} onClick={() => run(() => completeDueDateAction(d.id))}>
                انجام شد
              </button>
              <button
                type="button"
                className={`${SMALL} btn-ghost`}
                disabled={pending}
                aria-label={`حذف ${d.title}`}
                onClick={() => window.confirm("این سررسید حذف شود؟") && run(() => cancelDueDateAction(d.id))}
              >
                <Icon name="x" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <FormStatus state={result} />
      {!adding ? (
        <button type="button" className={`${SMALL} btn-ghost justify-self-start`} onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} />
          افزودن سررسید
        </button>
      ) : (
        <form action={action} className="reconcile-form">
          <input type="hidden" name="vehicleId" value={vehicleId} />
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="repeatMonths" value={repeat ? String(repeat) : ""} />
          <div className="expense-seg" role="group" aria-label="نوع سررسید">
            {KINDS.map(([key, text, months]) => (
              <button
                key={key}
                type="button"
                data-on={kind === key || undefined}
                aria-pressed={kind === key}
                onClick={() => {
                  setKind(key);
                  setRepeat(months);
                }}
              >
                {text}
              </button>
            ))}
          </div>
          {kind === "other" && (
            <div>
              <label className="label" htmlFor={`due-title-${vehicleId}`}>
                عنوان
              </label>
              <input id={`due-title-${vehicleId}`} name="title" className="field" maxLength={80} required />
            </div>
          )}
          <DualDateInput name="dueDate" value={dueDate} onChange={setDueDate} label="تاریخ سررسید" required showGregorian={false} />
          <div>
            <label className="label" htmlFor={`due-repeat-${vehicleId}`}>
              تکرار
            </label>
            <select id={`due-repeat-${vehicleId}`} className="field" value={repeat} onChange={(e) => setRepeat(Number(e.target.value))}>
              <option value={0}>بدون تکرار</option>
              <option value={6}>هر ۶ ماه</option>
              <option value={12}>هر سال</option>
              <option value={24}>هر ۲ سال</option>
            </select>
          </div>
          <FormStatus state={state} />
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary flex-1 disabled:opacity-40" disabled={saving || !dueDate}>
              {saving ? "در حال ثبت…" : "ثبت سررسید"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>
              انصراف
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
