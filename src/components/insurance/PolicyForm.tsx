"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createPolicyAction } from "@/app/actions/insurance";
import type { ActionResult } from "@/app/actions";
import AmountInput from "@/components/ui/AmountInput";
import DualDateInput from "@/components/ui/DualDateInput";
import { FormStatus } from "@/components/ui/FormStatus";
import Icon from "@/components/ui/Icon";
import { faCount, formatJalaliIso, formatMoney } from "@/lib/format";

export type PolicyOption = { id: string; label: string };
/** A debt from «بدهی‌ها» the policy can be paid through — see listLinkableDebts. */
export type DebtOption = {
  id: string;
  title: string;
  creditor: string;
  startDate: string;
  totalToman: string;
  paidToman: string;
  remainingToman: string;
  paidCount: number;
  totalCount: number;
  nextDueDate: string | null;
  nextDueToman: string | null;
  suggested: boolean;
};
type Kind = "third_party" | "car_body" | "fire" | "life" | "health" | "travel" | "liability" | "other";
type Mode = "cash" | "installments" | "debt";

const KINDS: { key: Kind; label: string; insured: "vehicle" | "property" | "none" }[] = [
  { key: "third_party", label: "شخص ثالث", insured: "vehicle" },
  { key: "car_body", label: "بدنه", insured: "vehicle" },
  { key: "fire", label: "آتش‌سوزی", insured: "property" },
  { key: "health", label: "درمان", insured: "none" },
  { key: "life", label: "عمر", insured: "none" },
  { key: "travel", label: "مسافرتی", insured: "none" },
  { key: "liability", label: "مسئولیت", insured: "property" },
  { key: "other", label: "سایر", insured: "none" },
];
/** The full name, for the policy's default title. */
const KIND_TITLE: Record<Kind, string> = {
  third_party: "شخص ثالث",
  car_body: "بدنه",
  fire: "آتش‌سوزی",
  health: "درمان تکمیلی",
  life: "عمر",
  travel: "مسافرتی",
  liability: "مسئولیت",
  other: "بیمه",
};

const FREQUENCIES = [
  ["once", "یک‌جا"],
  ["monthly", "ماهانه"],
  ["quarterly", "سه‌ماهه"],
  ["annual", "سالانه"],
] as const;

const DOWN_CHOICES = ["0", "20", "30", "50"] as const;
const COUNT_CHOICES = [2, 3, 4, 6, 12] as const;

/** One year after `iso` — the usual term of a policy, editable. */
function plusOneYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}
function plusMonths(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
const toman = (v: string | number) => formatMoney(String(v), "IRT");

export default function PolicyForm({
  accounts,
  debts,
  vehicles,
  properties,
  today,
  initial,
}: {
  /** Toman bank accounts only — the one place a premium or down payment leaves from. */
  accounts: PolicyOption[];
  debts: DebtOption[];
  vehicles: PolicyOption[];
  properties: PolicyOption[];
  today: string;
  initial?: { kind?: string; vehicleId?: string; propertyId?: string };
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createPolicyAction, null);
  const [kind, setKind] = useState<Kind>((KINDS.find((k) => k.key === initial?.kind)?.key ?? "third_party") as Kind);
  const [mode, setMode] = useState<Mode>("cash");
  const [title, setTitle] = useState("");
  const [premium, setPremium] = useState("");
  const [frequency, setFrequency] = useState<(typeof FREQUENCIES)[number][0]>("once");
  const [coverage, setCoverage] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(plusOneYear(today));
  const [payAccountId, setPayAccountId] = useState(accounts.length === 1 ? accounts[0].id : "");
  const [vehicleId, setVehicleId] = useState(initial?.vehicleId ?? "");
  const [propertyId, setPropertyId] = useState(initial?.propertyId ?? "");
  const [withSavings, setWithSavings] = useState(false);
  const [downPct, setDownPct] = useState("0");
  const [count, setCount] = useState(2);
  const [firstDue, setFirstDue] = useState(plusMonths(today, 1));
  const [debtId, setDebtId] = useState("");

  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) {
      setTitle("");
      setPremium("");
      setCoverage("");
      setDebtId("");
    }
  }

  const meta = KINDS.find((k) => k.key === kind)!;
  const insuredOptions = meta.insured === "vehicle" ? vehicles : meta.insured === "property" ? properties : [];
  const insuredLabel = insuredOptions.find((o) => o.id === (meta.insured === "vehicle" ? vehicleId : propertyId))?.label;
  const debt = debts.find((d) => d.id === debtId) ?? null;
  const effectiveTitle = title.trim() || (insuredLabel ? `${KIND_TITLE[kind]} ${insuredLabel}` : "") || (debt ? debt.title : "");
  const effectivePremium = mode === "debt" ? (debt?.totalToman ?? "") : premium;

  const total = Number(premium) || 0;
  const down = mode === "installments" ? Math.round((total * (Number(downPct) || 0)) / 100) : 0;
  const financed = Math.max(0, total - down);
  const perInstallment = count > 0 ? Math.ceil(financed / count) : 0;
  const needsAccount = mode === "cash" || (mode === "installments" && down > 0);
  const pctOk = Number(downPct) >= 0 && Number(downPct) < 100;

  const ready =
    !!effectiveTitle &&
    !!startDate &&
    (!endDate || endDate > startDate) &&
    (!needsAccount || !!payAccountId) &&
    (mode === "debt" ? !!debt : Number(premium) > 0) &&
    (mode !== "installments" || (pctOk && count >= 1 && !!firstDue && firstDue >= startDate));

  const pickDebt = (d: DebtOption) => {
    setDebtId(d.id);
    setStartDate(d.startDate);
    setEndDate(plusOneYear(d.startDate));
  };

  return (
    <form action={action} className="policy-form">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="title" value={effectiveTitle} />
      <input type="hidden" name="paymentMode" value={mode} />
      <input type="hidden" name="premiumToman" value={effectivePremium} />
      <input type="hidden" name="premiumFrequency" value={mode === "cash" ? frequency : "once"} />
      <input type="hidden" name="payAccountId" value={needsAccount ? payAccountId : ""} />
      <input type="hidden" name="debtId" value={mode === "debt" ? debtId : ""} />
      <input type="hidden" name="downPaymentPercent" value={mode === "installments" ? downPct : ""} />
      <input type="hidden" name="installmentCount" value={mode === "installments" ? String(count) : ""} />
      <input type="hidden" name="insuredVehicleId" value={meta.insured === "vehicle" ? vehicleId : ""} />
      <input type="hidden" name="insuredPropertyId" value={meta.insured === "property" ? propertyId : ""} />
      <input type="hidden" name="withSavings" value={kind === "life" && mode === "cash" && withSavings ? "yes" : ""} />

      {/* ── ۱. چه بیمه‌ای ── */}
      <fieldset className="policy-step">
        <legend className="policy-step-title">چه بیمه‌ای؟</legend>
        <div className="place-chips policy-kinds" role="radiogroup" aria-label="نوع بیمه">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              role="radio"
              aria-checked={kind === k.key}
              className={`place-chip justify-center${kind === k.key ? " is-on" : ""}`}
              onClick={() => setKind(k.key)}
            >
              <span className="place-chip-name text-center">{k.label}</span>
            </button>
          ))}
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
                {meta.insured === "vehicle" ? "خودرویی ثبت نشده است" : "ملکی ثبت نشده است"}؛ بیمه‌نامه بدون اتصال هم ثبت می‌شود.
              </p>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <DualDateInput name="startDate" value={startDate} onChange={setStartDate} label="شروع" required showGregorian={false} />
          <DualDateInput name="endDate" value={endDate} onChange={setEndDate} label="پایان" showGregorian={false} />
        </div>
      </fieldset>

      {/* ── ۲. پرداخت ── */}
      <fieldset className="policy-step">
        <legend className="policy-step-title">چطور پرداخت شده؟</legend>
        <div className="expense-seg policy-mode" role="radiogroup" aria-label="نحوه‌ی پرداخت">
          {(
            [
              ["cash", "نقدی"],
              ["installments", "اقساطی"],
              ["debt", "از بدهی‌هایم"],
            ] as const
          ).map(([key, text]) => (
            <button key={key} type="button" role="radio" aria-checked={mode === key} data-on={mode === key || undefined} onClick={() => setMode(key)}>
              {text}
            </button>
          ))}
        </div>

        {mode === "debt" ? (
          debts.length === 0 ? (
            <div className="policy-note">
              <Icon name="info" size={15} />
              <span>
                بدهی فعالی در «بدهی‌ها» نیست. اگر قسطی است، «اقساطی» را انتخاب کنید تا بدهی‌اش همین‌جا ساخته شود.{" "}
                <Link href="/debts" className="font-semibold" style={{ color: "var(--action)" }}>
                  بدهی‌ها
                </Link>
              </span>
            </div>
          ) : (
            <>
              <p className="muted text-[length:var(--fs-xs)] leading-5">
                بدهیِ همین بیمه را که قبلاً در «بدهی‌ها» ثبت کرده‌اید انتخاب کنید. اقساط از همان بدهی پیگیری می‌شود و مبلغی دوباره از حساب کم نمی‌شود.
              </p>
              <ul className="debt-picks" role="radiogroup" aria-label="بدهی‌ها">
                {debts.map((d) => {
                  const on = d.id === debtId;
                  const pct = Number(d.totalToman) > 0 ? Math.min(100, Math.round((Number(d.paidToman) * 100) / Number(d.totalToman))) : 0;
                  return (
                    <li key={d.id}>
                      <button type="button" role="radio" aria-checked={on} className={`debt-pick${on ? " is-on" : ""}`} onClick={() => pickDebt(d)}>
                        <span className="debt-pick-head">
                          <span className="min-w-0 flex-1">
                            <b className="block truncate text-[length:var(--fs-sm)]">{d.title}</b>
                            <span className="muted block truncate text-[length:var(--fs-xs)]">{d.creditor}</span>
                          </span>
                          {d.suggested && !on && <span className="badge badge-neutral shrink-0">پیشنهاد</span>}
                          <span className="place-chip-check" aria-hidden="true">
                            {on && <Icon name="check" size={12} />}
                          </span>
                        </span>
                        <span className="debt-pick-bar" aria-hidden="true">
                          <span style={{ width: `${pct}%` }} />
                        </span>
                        <span className="debt-pick-meta">
                          <span>
                            {d.totalCount > 0 ? `${faCount(d.paidCount)} از ${faCount(d.totalCount)} قسط پرداخت شده` : `${toman(d.paidToman)} پرداخت شده`}
                          </span>
                          <span className="num money-nowrap">مانده {toman(d.remainingToman)}</span>
                        </span>
                        {on && (
                          <span className="debt-pick-detail">
                            <span>
                              <span className="muted">کل بدهی</span>
                              <b className="num money-nowrap">{toman(d.totalToman)}</b>
                            </span>
                            <span>
                              <span className="muted">پرداخت‌شده</span>
                              <b className="num money-nowrap">{toman(d.paidToman)}</b>
                            </span>
                            <span>
                              <span className="muted">قسط بعدی</span>
                              <b className="num money-nowrap">
                                {d.nextDueDate ? `${formatJalaliIso(d.nextDueDate)}${d.nextDueToman ? ` · ${toman(d.nextDueToman)}` : ""}` : "—"}
                              </b>
                            </span>
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )
        ) : (
          <>
            <div>
              <label className="label" htmlFor="policy-premium">
                {mode === "installments" ? "مبلغ کل بیمه‌نامه (تومان)" : "حق بیمه (تومان)"}
              </label>
              <AmountInput id="policy-premium" value={premium} onValueChange={setPremium} placeholder="۰" className="field num" unit="toman" />
            </div>

            {mode === "cash" && (
              <div className="expense-seg policy-freq" role="radiogroup" aria-label="دوره‌ی پرداخت">
                {FREQUENCIES.map(([key, text]) => (
                  <button key={key} type="button" role="radio" aria-checked={frequency === key} data-on={frequency === key || undefined} onClick={() => setFrequency(key)}>
                    {text}
                  </button>
                ))}
              </div>
            )}

            {mode === "installments" && (
              <>
                <div>
                  <span className="label">پیش‌پرداخت</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {DOWN_CHOICES.map((p) => (
                      <button key={p} type="button" className={`chip${downPct === p ? " chip-on" : ""}`} aria-pressed={downPct === p} onClick={() => setDownPct(p)}>
                        {p === "0" ? "بدون پیش‌پرداخت" : `${Number(p).toLocaleString("fa-IR")}٪`}
                      </button>
                    ))}
                    <label className="policy-pct">
                      <input
                        className="field num"
                        inputMode="decimal"
                        aria-label="درصد پیش‌پرداخت دلخواه"
                        placeholder="دلخواه"
                        value={(DOWN_CHOICES as readonly string[]).includes(downPct) ? "" : downPct}
                        onChange={(e) => setDownPct(e.target.value.replace(/[^\d.۰-۹]/g, "").replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))) || "0")}
                      />
                      <span>٪</span>
                    </label>
                  </div>
                </div>
                <div>
                  <span className="label">تعداد قسط</span>
                  <div className="flex flex-wrap gap-1.5">
                    {COUNT_CHOICES.map((n) => (
                      <button key={n} type="button" className={`chip${count === n ? " chip-on" : ""}`} aria-pressed={count === n} onClick={() => setCount(n)}>
                        {faCount(n)} قسط
                      </button>
                    ))}
                  </div>
                </div>
                <DualDateInput name="firstDueDate" value={firstDue} onChange={setFirstDue} label="سررسید اولین قسط (ماهانه)" required showGregorian={false} />
                {total > 0 && pctOk && (
                  <div className="policy-summary" aria-live="polite">
                    {down > 0 && (
                      <span>
                        <span className="muted">پیش‌پرداخت</span>
                        <b className="num money-nowrap">{toman(down)}</b>
                      </span>
                    )}
                    <span>
                      <span className="muted">{faCount(count)} قسط ماهانه</span>
                      <b className="num money-nowrap">≈ {toman(perInstallment)}</b>
                    </span>
                    <span>
                      <span className="muted">از</span>
                      <b>{formatJalaliIso(firstDue)}</b>
                    </span>
                  </div>
                )}
              </>
            )}

            {needsAccount &&
              (accounts.length ? (
                <div>
                  <label className="label" htmlFor="policy-pay">
                    {mode === "installments" ? "پیش‌پرداخت از کدام حساب بانکی؟" : "از کدام حساب بانکی؟"}
                  </label>
                  <select id="policy-pay" className="field" value={payAccountId} onChange={(e) => setPayAccountId(e.target.value)} required>
                    <option value="">انتخاب حساب بانکی تومانی</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="policy-note">
                  <Icon name="info" size={15} />
                  <span>
                    حساب بانکی تومانی ثبت نشده است.{" "}
                    <Link href="/accounts" className="font-semibold" style={{ color: "var(--action)" }}>
                      افزودن حساب بانکی
                    </Link>
                  </span>
                </div>
              ))}
            {mode === "installments" && <p className="muted text-[length:var(--fs-xs)] leading-5">اقساط به «بدهی‌ها» اضافه و به‌موقع یادآوری می‌شود.</p>}
            {mode === "cash" && startDate < today && frequency === "once" && (
              <p className="muted text-[length:var(--fs-xs)] leading-5">شروع گذشته است؛ حق بیمه پرداخت‌شده فرض می‌شود و چیزی از حساب کم نمی‌شود.</p>
            )}
          </>
        )}
      </fieldset>

      {/* ── ۳. جزئیات (اختیاری) ── */}
      <details className="policy-more">
        <summary>
          <span>نام، شرکت بیمه و جزئیات دیگر</span>
          <Icon name="chevronDown" size={15} />
        </summary>
        <div className="space-y-3 pt-3">
          <div>
            <label className="label" htmlFor="policy-title">
              نام
            </label>
            <input id="policy-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={effectiveTitle || `مثلاً ${KIND_TITLE[kind]}`} maxLength={120} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="policy-insurer">
                شرکت بیمه
              </label>
              <input id="policy-insurer" name="insurer" className="field" maxLength={80} placeholder={debt?.creditor ?? "مثلاً بیمه ایران"} />
            </div>
            <div>
              <label className="label" htmlFor="policy-number">
                شماره بیمه‌نامه
              </label>
              <input id="policy-number" name="policyNumber" className="field num" dir="ltr" maxLength={60} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="policy-coverage">
              سقف تعهد / سرمایه‌ی بیمه‌شده
            </label>
            <AmountInput id="policy-coverage" name="coverageToman" value={coverage} onValueChange={setCoverage} placeholder="۰" className="field num" unit="toman" />
          </div>
          {kind === "life" && mode === "cash" && (
            <label className="flex min-h-11 cursor-pointer items-start gap-2 text-[length:var(--fs-sm)]">
              <input type="checkbox" className="mt-1" checked={withSavings} onChange={(e) => setWithSavings(e.target.checked)} />
              <span>
                اندوخته (ارزش بازخرید) دارد
                <span className="muted block text-[length:var(--fs-xs)]">حق بیمه به‌جای هزینه، انتقال به حساب اندوخته ثبت می‌شود و در ارزش خالص می‌ماند.</span>
              </span>
            </label>
          )}
          <div>
            <label className="label" htmlFor="policy-note">
              یادداشت
            </label>
            <input id="policy-note" name="note" className="field" maxLength={500} />
          </div>
        </div>
      </details>

      <FormStatus state={state} />
      <button type="submit" className="btn btn-primary w-full disabled:opacity-40" disabled={pending || !ready}>
        {pending ? "در حال ثبت…" : "ثبت بیمه‌نامه"}
      </button>
    </form>
  );
}
