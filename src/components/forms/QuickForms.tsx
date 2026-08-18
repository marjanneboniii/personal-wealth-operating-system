"use client";

import { useActionState, useState } from "react";
import {
  createEventAction,
  createGoalAction,
  createPlannedAction,
  type ActionResult,
} from "@/app/actions";
import { SmartAmountPreview, PreviewCard, useLatestRate } from "@/components/ui/SmartPreview";
import DualDateInput from "@/components/ui/DualDateInput";
import AmountInput from "@/components/ui/AmountInput";
import { formatMoney, getDualDate } from "@/lib/format";
import { D } from "@/domain/decimal";

type Opt = { id: string; code: string; name: string };

function Feedback({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <p className="text-[11px]" style={{ color: state.ok ? "var(--brand)" : "var(--negative)" }}>
      {state.message}
    </p>
  );
}

type PreviewProps = {
  title: string;
  description?: string;
  irtAmount: string;
  rate: string | null;
  rateDate?: string;
  rateSource?: string;
  isoDate: string;
  status?: string;
  priority?: string;
  extra?: React.ReactNode;
};

function PlanningPreview({ title, description, irtAmount, rate, rateDate, rateSource, isoDate, status, priority, extra }: PreviewProps) {
  const usd = irtAmount && rate ? D(irtAmount).div(rate).toFixed(2) : "";
  const dual = isoDate ? getDualDate(isoDate) : null;
  return (
    <PreviewCard title="پیش‌نمایش قبل از ذخیره — فقط نمایشی">
      <div className="space-y-2 text-xs leading-6">
        <div><span className="muted">عنوان:</span> <strong>{title || "—"}</strong></div>
        {description && <div><span className="muted">توضیحات:</span> {description}</div>}
        <div className="soft rounded-xl p-2">
          <div className="muted text-[10px]">مبلغ به تومان و معادل دلاری (نرخ لحظه‌ای)</div>
          <div className="num font-bold" dir="rtl">{irtAmount ? formatMoney(irtAmount, "IRT") : "—"}</div>
          <div className="num" dir="rtl" style={{ color: "var(--brand)" }}>{usd ? formatMoney(usd, "USD") : "—"} <span className="muted text-[10px]"> نرخ: {rate ? formatMoney(rate, "IRT") + " ≈ ۱ دلار" : "ثبت نشده"}</span></div>
          {rateDate && <div className="muted text-[10px]">تاریخ نرخ: <span dir="auto" className="num">{rateDate}</span> · منبع: {rateSource ?? "—"}</div>}
        </div>
        <div className="flex flex-wrap gap-3">
          <span>تاریخ شمسی: <strong dir="rtl">{dual?.jalali ?? "—"}</strong></span>
          <span>میلادی: <strong dir="auto" className="num">{dual?.gregorian ?? "—"}</strong></span>
        </div>
        {status && <div><span className="muted">وضعیت:</span> <strong>{status}</strong></div>}
        {priority && <div><span className="muted">اولویت:</span> <strong>{priority}</strong></div>}
        {extra}
        <div className="muted text-[10px]">تا قبل از «تأیید نهایی» هیچ Journal Entry یا Ledger Entry ایجاد نمی‌شود. معادل دلاری با آخرین نرخ به‌صورت لحظه‌ای محاسبه و با تغییر نرخ به‌روزرسانی می‌شود.</div>
      </div>
    </PreviewCard>
  );
}

export function GoalForm({ accounts, initialRate, initialRateDate, initialRateSource }: { accounts: Opt[]; initialRate?: string | null; initialRateDate?: string; initialRateSource?: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createGoalAction, null);
  const [name, setName] = useState("");
  const [irtAmount, setIrtAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [priority, setPriority] = useState("2");
  const [showPreview, setShowPreview] = useState(false);
  const { rate, date, source } = useLatestRate(initialRate ?? null);
  const effectiveRate = initialRate ?? rate;
  const effectiveDate = initialRateDate ?? date;
  const effectiveSource = initialRateSource ?? source;

  const canPreview = name && irtAmount && D(irtAmount).gt(0);

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">عنوان هدف</label>
          <input name="name" required className="field" placeholder="مثلاً خرید خانه" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">مبلغ هدف به تومان — مرجع</label>
          <AmountInput
            value={irtAmount}
            onChange={(e) => setIrtAmount(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="مثلاً 1200000000"
            className="field num"
            dir="ltr"
            unit="toman"
          />
          <input type="hidden" name="targetBase" value={irtAmount} />
          <div className="mt-2"><SmartAmountPreview irtAmount={irtAmount} rate={effectiveRate} rateDate={effectiveDate} rateSource={effectiveSource} /></div>
        </div>
        <div className="sm:col-span-2">
          <DualDateInput name="targetDate" value={targetDate} onChange={setTargetDate} label="تاریخ هدف" />
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
        <div>
          <label className="label">اولویت</label>
          <select name="priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="field">
            <option value="1">۱ — بالا</option>
            <option value="2">۲ — متوسط</option>
            <option value="3">۳ — پایین</option>
          </select>
        </div>
      </div>

      {showPreview ? (
        <>
          <PlanningPreview title={name} irtAmount={irtAmount} rate={effectiveRate} rateDate={effectiveDate} rateSource={effectiveSource} isoDate={targetDate} status="فعال" priority={priority === "1" ? "بالا" : priority === "2" ? "متوسط" : "پایین"} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowPreview(false)} className="btn btn-ghost flex-1">بازگشت به ویرایش</button>
            <button className="btn btn-primary flex-1" disabled={pending}>{pending ? "…" : "تأیید نهایی"}</button>
          </div>
        </>
      ) : (
        <button type="button" disabled={!canPreview} onClick={() => setShowPreview(true)} className="btn btn-primary w-full sm:w-auto disabled:opacity-40">
          پیش‌نمایش قبل از ذخیره
        </button>
      )}
      <Feedback state={state} />
    </form>
  );
}

export function EventForm({ initialRate, initialRateDate, initialRateSource }: { initialRate?: string | null; initialRateDate?: string; initialRateSource?: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createEventAction, null);
  const [name, setName] = useState("");
  const [irtAmount, setIrtAmount] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [category, setCategory] = useState("trip");
  const [showPreview, setShowPreview] = useState(false);
  const { rate, date, source } = useLatestRate(initialRate ?? null);
  const effectiveRate = initialRate ?? rate;
  const effectiveDate = initialRateDate ?? date;
  const effectiveSource = initialRateSource ?? source;

  const canPreview = name && irtAmount && D(irtAmount).gt(0) && eventDate;

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">نام رویداد</label>
          <input name="name" required className="field" placeholder="سفر، مراسم، هدیه…" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">بودجه به تومان</label>
          <AmountInput value={irtAmount} onChange={(e) => setIrtAmount(e.target.value.replace(/[^0-9]/g, ""))} placeholder="مثلاً 30000000" className="field num" dir="ltr" unit="toman" />
          <input type="hidden" name="budgetBase" value={irtAmount} />
          <div className="mt-2"><SmartAmountPreview irtAmount={irtAmount} rate={effectiveRate} rateDate={effectiveDate} rateSource={effectiveSource} /></div>
        </div>
        <div className="sm:col-span-2">
          <DualDateInput name="eventDate" value={eventDate} onChange={setEventDate} label="تاریخ" required />
        </div>
        <div>
          <label className="label">دسته</label>
          <select name="category" value={category} onChange={(e) => setCategory(e.target.value)} className="field">
            <option value="trip">سفر</option>
            <option value="ceremony">مراسم</option>
            <option value="gift">هدیه</option>
            <option value="purchase">خرید بزرگ</option>
            <option value="other">سایر</option>
          </select>
        </div>
      </div>

      {showPreview ? (
        <>
          <PlanningPreview title={name} irtAmount={irtAmount} rate={effectiveRate} rateDate={effectiveDate} rateSource={effectiveSource} isoDate={eventDate} status="planned" extra={<div><span className="muted">دسته:</span> {category}</div>} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowPreview(false)} className="btn btn-ghost flex-1">بازگشت</button>
            <button className="btn btn-primary flex-1" disabled={pending}>{pending ? "…" : "تأیید نهایی"}</button>
          </div>
        </>
      ) : (
        <button type="button" disabled={!canPreview} onClick={() => setShowPreview(true)} className="btn btn-primary w-full sm:w-auto disabled:opacity-40">پیش‌نمایش قبل از ذخیره</button>
      )}
      <Feedback state={state} />
    </form>
  );
}

export function PlannedForm({ accounts, initialRate, initialRateDate, initialRateSource }: { accounts: Opt[]; initialRate?: string | null; initialRateDate?: string; initialRateSource?: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createPlannedAction, null);
  const [direction, setDirection] = useState("outflow");
  const [title, setTitle] = useState("");
  const [irtAmount, setIrtAmount] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const { rate, date, source } = useLatestRate(initialRate ?? null);
  const effectiveRate = initialRate ?? rate;
  const effectiveDate = initialRateDate ?? date;
  const effectiveSource = initialRateSource ?? source;

  const canPreview = title && irtAmount && D(irtAmount).gt(0) && plannedDate;

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">عنوان برنامه</label>
          <input name="title" required className="field" placeholder="مثلاً شارژ صندوق اضطراری" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label">مبلغ به تومان</label>
          <AmountInput value={irtAmount} onChange={(e) => setIrtAmount(e.target.value.replace(/[^0-9]/g, ""))} placeholder="مثلاً 4000000" className="field num" dir="ltr" unit="toman" />
          <input type="hidden" name="amountBase" value={irtAmount} />
          <div className="mt-2"><SmartAmountPreview irtAmount={irtAmount} rate={effectiveRate} rateDate={effectiveDate} rateSource={effectiveSource} /></div>
        </div>
        <div className="sm:col-span-2">
          <DualDateInput name="plannedDate" value={plannedDate} onChange={setPlannedDate} label="تاریخ برنامه" required />
        </div>
        <div>
          <label className="label">جهت</label>
          <select name="direction" value={direction} onChange={(e) => setDirection(e.target.value)} className="field">
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
      {showPreview ? (
        <>
          <PlanningPreview title={title} irtAmount={irtAmount} rate={effectiveRate} rateDate={effectiveDate} rateSource={effectiveSource} isoDate={plannedDate} status="pending" priority={direction === "outflow" ? "خروج وجه" : "ورود وجه"} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowPreview(false)} className="btn btn-ghost flex-1">بازگشت</button>
            <button className="btn btn-primary flex-1" disabled={pending}>{pending ? "…" : "تأیید نهایی"}</button>
          </div>
        </>
      ) : (
        <button type="button" disabled={!canPreview} onClick={() => setShowPreview(true)} className="btn btn-primary w-full sm:w-auto disabled:opacity-40">پیش‌نمایش قبل از ذخیره</button>
      )}
      <Feedback state={state} />
    </form>
  );
}
