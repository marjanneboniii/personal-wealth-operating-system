"use client";

import { useActionState, useState } from "react";
import {
  createEventAction,
  createGoalAction,
  createPlannedAction,
  type ActionResult,
} from "@/app/actions";

type Opt = { id: string; code: string; name: string };

function Feedback({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <p className="text-[11px]" style={{ color: state.ok ? "var(--accent)" : "var(--danger)" }}>
      {state.message}
    </p>
  );
}

export function GoalForm({ accounts }: { accounts: Opt[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createGoalAction, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">عنوان هدف</label>
          <input name="name" required className="field" placeholder="مثلاً خرید خانه" />
        </div>
        <div>
          <label className="label">مبلغ هدف (USD)</label>
          <input name="targetBase" required inputMode="decimal" className="field num" dir="ltr" />
        </div>
        <div>
          <label className="label">تاریخ هدف</label>
          <input name="targetDate" type="date" className="field num" dir="ltr" />
        </div>
        <div>
          <label className="label">حساب پس‌انداز</label>
          <select name="fundAccountId" className="field" defaultValue="">
            <option value="">بدون حساب اختصاصی</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Feedback state={state} />
      <button className="btn btn-primary w-full sm:w-auto" disabled={pending}>
        {pending ? "…" : "ایجاد هدف"}
      </button>
    </form>
  );
}

export function EventForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createEventAction, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">نام رویداد</label>
          <input name="name" required className="field" placeholder="سفر، مراسم، هدیه…" />
        </div>
        <div>
          <label className="label">بودجه (USD)</label>
          <input name="budgetBase" required inputMode="decimal" className="field num" dir="ltr" />
        </div>
        <div>
          <label className="label">تاریخ</label>
          <input name="eventDate" type="date" required className="field num" dir="ltr" />
        </div>
        <div>
          <label className="label">دسته</label>
          <select name="category" className="field" defaultValue="trip">
            <option value="trip">سفر</option>
            <option value="ceremony">مراسم</option>
            <option value="gift">هدیه</option>
            <option value="purchase">خرید بزرگ</option>
            <option value="other">سایر</option>
          </select>
        </div>
      </div>
      <Feedback state={state} />
      <button className="btn btn-primary w-full sm:w-auto" disabled={pending}>
        {pending ? "…" : "ثبت رویداد"}
      </button>
    </form>
  );
}

export function PlannedForm({ accounts }: { accounts: Opt[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createPlannedAction, null);
  const [direction, setDirection] = useState("outflow");
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">عنوان برنامه</label>
          <input name="title" required className="field" placeholder="مثلاً شارژ صندوق اضطراری" />
        </div>
        <div>
          <label className="label">مبلغ (USD)</label>
          <input name="amountBase" required inputMode="decimal" className="field num" dir="ltr" />
        </div>
        <div>
          <label className="label">تاریخ برنامه</label>
          <input name="plannedDate" type="date" required className="field num" dir="ltr" />
        </div>
        <div>
          <label className="label">جهت</label>
          <select name="direction" className="field" value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="outflow">خروج وجه</option>
            <option value="inflow">ورود وجه</option>
          </select>
        </div>
        <div>
          <label className="label">{direction === "outflow" ? "از حساب" : "حساب مقصد نبود؟"}</label>
          <select name="fromAccountId" className="field" defaultValue="">
            <option value="">—</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">به حساب</label>
          <select name="toAccountId" className="field" defaultValue="">
            <option value="">—</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">تکرار</label>
          <select name="recurrence" className="field" defaultValue="none">
            <option value="none">یک‌بار</option>
            <option value="monthly">ماهانه</option>
            <option value="yearly">سالانه</option>
          </select>
        </div>
      </div>
      <p className="muted text-[11px]">
        این برنامه تا زمانی که دکمه «اجرا» زده نشود، هیچ اثری روی دفترکل و ثروت فعلی ندارد.
      </p>
      <Feedback state={state} />
      <button className="btn btn-primary w-full sm:w-auto" disabled={pending}>
        {pending ? "…" : "افزودن به برنامه‌ها"}
      </button>
    </form>
  );
}
