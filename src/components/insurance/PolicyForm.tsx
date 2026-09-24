"use client";

import { useActionState, useState } from "react";
import { createPolicyAction } from "@/app/actions/insurance";
import type { ActionResult } from "@/app/actions";
import AmountInput from "@/components/ui/AmountInput";
import DualDateInput from "@/components/ui/DualDateInput";
import { FormStatus } from "@/components/ui/FormStatus";
import { formatMoney } from "@/lib/format";

export type PolicyOption = { id: string; label: string };
type Kind = "third_party" | "car_body" | "fire" | "life" | "health" | "travel" | "liability" | "other";

const KINDS: { key: Kind; label: string; insured: "vehicle" | "property" | "none" }[] = [
  { key: "third_party", label: "شخص ثالث خودرو", insured: "vehicle" },
  { key: "car_body", label: "بدنه خودرو", insured: "vehicle" },
  { key: "fire", label: "آتش‌سوزی و زلزله", insured: "property" },
  { key: "life", label: "عمر", insured: "none" },
  { key: "health", label: "درمان تکمیلی", insured: "none" },
  { key: "travel", label: "مسافرتی", insured: "none" },
  { key: "liability", label: "مسئولیت", insured: "property" },
  { key: "other", label: "سایر", insured: "none" },
];

const FREQUENCIES = [
  ["annual", "سالانه"],
  ["monthly", "ماهانه"],
  ["quarterly", "سه‌ماهه"],
  ["once", "یک‌جا"],
] as const;

/** One year after `iso` — the usual term of a policy, editable. */
function plusOneYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export default function PolicyForm({
  accounts,
  vehicles,
  properties,
  today,
  initial,
}: {
  accounts: PolicyOption[];
  vehicles: PolicyOption[];
  properties: PolicyOption[];
  today: string;
  initial?: { kind?: string; vehicleId?: string; propertyId?: string };
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createPolicyAction, null);
  const initialKind = (KINDS.find((k) => k.key === initial?.kind)?.key ?? "third_party") as Kind;
  const [kind, setKind] = useState<Kind>(initialKind);
  const [title, setTitle] = useState("");
  const [premium, setPremium] = useState("");
  const [frequency, setFrequency] = useState<(typeof FREQUENCIES)[number][0]>("annual");
  const [coverage, setCoverage] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(plusOneYear(today));
  const [payAccountId, setPayAccountId] = useState(accounts.length === 1 ? accounts[0].id : "");
  const [vehicleId, setVehicleId] = useState(initial?.vehicleId ?? "");
  const [propertyId, setPropertyId] = useState(initial?.propertyId ?? "");
  const [withSavings, setWithSavings] = useState(false);

  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) {
      setTitle("");
      setPremium("");
      setCoverage("");
    }
  }

  const meta = KINDS.find((k) => k.key === kind)!;
  const insuredOptions = meta.insured === "vehicle" ? vehicles : meta.insured === "property" ? properties : [];
  const insuredLabel = insuredOptions.find((o) => o.id === (meta.insured === "vehicle" ? vehicleId : propertyId))?.label;
  const perYear = frequency === "monthly" ? 12 : frequency === "quarterly" ? 4 : 1;
  const yearly = Number(premium) > 0 ? Number(premium) * perYear : 0;
  const effectiveTitle = title.trim() || (insuredLabel ? `${meta.label} ${insuredLabel}` : "");
  const ready = !!effectiveTitle && Number(premium) > 0 && !!startDate && !!payAccountId && (!endDate || endDate > startDate);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="title" value={effectiveTitle} />
      <input type="hidden" name="premiumFrequency" value={frequency} />
      <input type="hidden" name="insuredVehicleId" value={meta.insured === "vehicle" ? vehicleId : ""} />
      <input type="hidden" name="insuredPropertyId" value={meta.insured === "property" ? propertyId : ""} />
      <input type="hidden" name="withSavings" value={kind === "life" && withSavings ? "yes" : ""} />

      <div>
        <label className="label" htmlFor="policy-kind">
          نوع بیمه
        </label>
        <select id="policy-kind" name="kind" className="field" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
      </div>

      {meta.insured !== "none" && (
        <div>
          <label className="label" htmlFor="policy-insured">
            {meta.insured === "vehicle" ? "کدام خودرو؟" : "کدام ملک؟"}
          </label>
          {insuredOptions.length ? (
            <select
              id="policy-insured"
              className="field"
              value={meta.insured === "vehicle" ? vehicleId : propertyId}
              onChange={(e) => (meta.insured === "vehicle" ? setVehicleId(e.target.value) : setPropertyId(e.target.value))}
            >
              <option value="">— بدون اتصال —</option>
              {insuredOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="muted text-[length:var(--fs-xs)]">
              {meta.insured === "vehicle" ? "خودرویی در «دارایی‌های واقعی» ثبت نشده است." : "ملکی در «دارایی‌های واقعی» ثبت نشده است."} بیمه‌نامه بدون اتصال هم ثبت می‌شود.
            </p>
          )}
        </div>
      )}

      <div>
        <label className="label" htmlFor="policy-title">
          نام
        </label>
        <input
          id="policy-title"
          className="field"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={effectiveTitle || `مثلاً ${meta.label}`}
          maxLength={120}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="policy-insurer">
            شرکت بیمه (اختیاری)
          </label>
          <input id="policy-insurer" name="insurer" className="field" maxLength={80} placeholder="مثلاً بیمه ایران" />
        </div>
        <div>
          <label className="label" htmlFor="policy-number">
            شماره بیمه‌نامه (اختیاری)
          </label>
          <input id="policy-number" name="policyNumber" className="field num" dir="ltr" maxLength={60} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <DualDateInput name="startDate" value={startDate} onChange={setStartDate} label="شروع" required showGregorian={false} />
        <DualDateInput name="endDate" value={endDate} onChange={setEndDate} label="پایان" showGregorian={false} />
      </div>

      <div>
        <label className="label" htmlFor="policy-premium">
          حق بیمه (تومان)
        </label>
        <AmountInput id="policy-premium" name="premiumToman" value={premium} onValueChange={setPremium} placeholder="۰" className="field num" unit="toman" />
        <div className="expense-seg mt-2" role="group" aria-label="دوره‌ی پرداخت">
          {FREQUENCIES.map(([key, text]) => (
            <button key={key} type="button" data-on={frequency === key || undefined} aria-pressed={frequency === key} onClick={() => setFrequency(key)}>
              {text}
            </button>
          ))}
        </div>
        {yearly > 0 && frequency !== "annual" && frequency !== "once" && (
          <p className="muted mt-1 text-[length:var(--fs-xs)]">
            سالانه حدود <b className="num">{formatMoney(String(yearly), "IRT")}</b>
          </p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="policy-pay">
          حق بیمه از کدام حساب پرداخت می‌شود؟
        </label>
        <select id="policy-pay" name="payAccountId" className="field" value={payAccountId} onChange={(e) => setPayAccountId(e.target.value)} required>
          <option value="">انتخاب حساب تومانی</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="policy-coverage">
          سقف تعهد / سرمایه‌ی بیمه‌شده (اختیاری)
        </label>
        <AmountInput id="policy-coverage" name="coverageToman" value={coverage} onValueChange={setCoverage} placeholder="۰" className="field num" unit="toman" />
        {meta.insured === "property" && <p className="muted mt-1 text-[length:var(--fs-xs)]">با ارزش روز ملک مقایسه می‌شود تا کم‌بیمه‌بودن معلوم شود.</p>}
      </div>

      {kind === "life" && (
        <label className="flex min-h-11 cursor-pointer items-start gap-2 text-[length:var(--fs-sm)]">
          <input type="checkbox" className="mt-1" checked={withSavings} onChange={(e) => setWithSavings(e.target.checked)} />
          <span>
            این بیمه‌نامه اندوخته (ارزش بازخرید) دارد
            <span className="muted block text-[length:var(--fs-xs)]">
              یک حساب «اندوخته» ساخته می‌شود و حق بیمه به‌جای هزینه، انتقال به آن ثبت می‌شود؛ این پول در ارزش خالص شما می‌ماند.
            </span>
          </span>
        </label>
      )}

      <div>
        <label className="label" htmlFor="policy-note">
          یادداشت (اختیاری)
        </label>
        <input id="policy-note" name="note" className="field" maxLength={500} />
      </div>

      <FormStatus state={state} />
      <button type="submit" className="btn btn-primary w-full disabled:opacity-40" disabled={pending || !ready}>
        {pending ? "در حال ثبت…" : "ثبت بیمه‌نامه"}
      </button>
      <p className="muted text-center text-[length:var(--fs-xs)]">ثبت بیمه‌نامه سندی نمی‌سازد؛ هر حق بیمه در سررسیدش یادآوری و با یک ضربه ثبت می‌شود.</p>
    </form>
  );
}
