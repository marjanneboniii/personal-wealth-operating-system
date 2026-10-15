"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createChequeAction } from "@/app/actions/cheques";
import type { ActionResult } from "@/app/actions";
import AccountPicker, { type PickerAccount } from "@/components/ui/AccountPicker";
import AmountInput from "@/components/ui/AmountInput";
import DualDateInput from "@/components/ui/DualDateInput";
import { FormStatus } from "@/components/ui/FormStatus";
import Icon, { type IconName } from "@/components/ui/Icon";
import { faCount, formatDaysUntil, formatJalaliIso, formatMoney } from "@/lib/format";

export type ChequeAccountOption = PickerAccount;
export type ChequeInstallmentOption = {
  id: string;
  label: string;
  debtTitle: string;
  seq: number;
  amountToman: string | null;
  dueDate: string;
};

export type ChequeEventOption = { id: string; name: string; date: string };

type Direction = "issued" | "received";
type Purpose = "installment" | "event" | "rent" | "purchase" | "loan" | "guarantee" | "other";
type Tone = "info" | "warning" | "negative" | "positive" | "action";

const DIRECTIONS: { key: Direction; label: string; hint: string; icon: IconName; tone: Tone }[] = [
  { key: "issued", label: "چک صادره", hint: "من نوشته‌ام", icon: "arrow-up", tone: "negative" },
  { key: "received", label: "چک دریافتی", hint: "به من داده‌اند", icon: "arrow-down", tone: "positive" },
];

/** «بابت» — what the cheque is for. «قسط» links it to a scheduled installment. */
const PURPOSES: { key: Purpose; label: string; icon: IconName; tone: Tone }[] = [
  { key: "installment", label: "قسط", icon: "installments", tone: "action" },
  { key: "event", label: "رویداد", icon: "calendar", tone: "warning" },
  { key: "rent", label: "اجاره", icon: "home", tone: "info" },
  { key: "purchase", label: "خرید", icon: "bag", tone: "warning" },
  { key: "loan", label: "قرض", icon: "coins", tone: "positive" },
  { key: "guarantee", label: "ضمانت", icon: "shield", tone: "negative" },
  { key: "other", label: "سایر", icon: "more", tone: "action" },
];

const toneStyle = (tone: Tone) => ({ background: `var(--${tone}-soft)`, color: `var(--${tone})` });
const toman = (v: string) => formatMoney(v, "IRT");
const NEAR_DUE_DAYS = 7;

function StepTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <legend className="policy-step-title">
      <span className="policy-step-num num" aria-hidden="true">
        {faCount(n)}
      </span>
      {children}
    </legend>
  );
}

/**
 * «ثبت چک» — a cheque is a plan until it clears. Nothing here writes the
 * ledger; «ثبت پاس شدن» on the list does, through the transaction form.
 * Same steps and tiles as «ثبت بیمه‌نامه».
 */
export default function ChequeForm({
  accounts,
  balances,
  installments,
  events = [],
  today,
}: {
  accounts: ChequeAccountOption[];
  /** Posted balance per account id, in the account's own unit. */
  balances?: Record<string, string>;
  installments: ChequeInstallmentOption[];
  /** Planned events a written cheque can pay toward. */
  events?: ChequeEventOption[];
  today: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createChequeAction, null);
  const [direction, setDirection] = useState<Direction>("issued");
  const [counterparty, setCounterparty] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(today);
  const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0].id : "");
  const [purpose, setPurpose] = useState<Purpose | "">("");
  const [installmentId, setInstallmentId] = useState("");
  const [eventId, setEventId] = useState("");
  const [note, setNote] = useState("");

  // A saved cheque clears the form for the next one (a cheque book is usually
  // entered leaf by leaf); the direction, account and «بابت» stay.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) {
      setCounterparty("");
      setAmount("");
      setInstallmentId("");
      setNote("");
    }
  }

  const issued = direction === "issued";
  const linksInstallment = issued && purpose === "installment";
  const linksEvent = issued && purpose === "event";
  const eventName = events.find((e) => e.id === eventId)?.name;
  const ready = counterparty.trim().length > 0 && Number(amount) > 0 && !!dueDate && (!issued || !!accountId);

  const purposeLabel = PURPOSES.find((p) => p.key === purpose)?.label;
  // No column of its own: «بابت» leads the note, where the list already shows it.
  const fullNote = [purpose && purpose !== "other" ? `بابت ${linksEvent && eventName ? eventName : purposeLabel}` : "", note.trim()].filter(Boolean).join(" — ");

  const days = dueDate ? Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : NaN;
  const status: { tone: "pos" | "warn" | "neg"; icon: IconName; text: string } =
    !Number.isFinite(days) || days > NEAR_DUE_DAYS
      ? { tone: "pos", icon: "check-circle", text: "در جریان — تا سررسید وقت هست" }
      : days >= 0
        ? { tone: "warn", icon: "clock", text: "نزدیک سررسید — موجودی حساب را بررسی کنید" }
        : { tone: "neg", icon: "alert", text: "سررسید گذشته — اگر پاس یا برگشت خورده، پس از ثبت وضعیتش را تغییر دهید" };

  const pickInstallment = (inst: ChequeInstallmentOption) => {
    if (installmentId === inst.id) {
      setInstallmentId("");
      return;
    }
    setInstallmentId(inst.id);
    if (inst.amountToman) setAmount(inst.amountToman);
    setDueDate(inst.dueDate);
  };

  const pickPurpose = (key: Purpose) => {
    setPurpose(purpose === key ? "" : key);
    if (key !== "installment" || purpose === key) setInstallmentId("");
    if (key !== "event" || purpose === key) setEventId("");
  };

  return (
    <form action={action} className="policy-form">
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="installmentId" value={linksInstallment ? installmentId : ""} />
      <input type="hidden" name="eventId" value={linksEvent ? eventId : ""} />
      <input type="hidden" name="note" value={fullNote} />

      {/* ── ۱. نوع چک ── */}
      <fieldset className="policy-step">
        <StepTitle n={1}>چه چکی؟</StepTitle>
        <div className="policy-modes cheque-dir" role="radiogroup" aria-label="نوع چک">
          {DIRECTIONS.map((d) => {
            const on = direction === d.key;
            return (
              <button key={d.key} type="button" role="radio" aria-checked={on} className="policy-mode-card cheque-tile" data-on={on || undefined} onClick={() => setDirection(d.key)}>
                <span className="cheque-dir-icon" style={toneStyle(d.tone)} aria-hidden="true">
                  <Icon name={d.icon} size={17} />
                </span>
                <span className="policy-mode-label">{d.label}</span>
                <span className="policy-mode-hint">{d.hint}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* ── ۲. مبلغ و سررسید ── */}
      <fieldset className="policy-step">
        <StepTitle n={2}>مبلغ و سررسید</StepTitle>
        <div className="cheque-two">
          <div>
            <label className="label" htmlFor="cheque-amount">
              مبلغ (تومان)
            </label>
            <AmountInput id="cheque-amount" name="amountToman" value={amount} onValueChange={setAmount} placeholder="۰" className="field num" unit="toman" />
          </div>
          <DualDateInput name="dueDate" value={dueDate} onChange={setDueDate} label="تاریخ سررسید" required showGregorian={false} />
        </div>
        {dueDate && (
          <div className="cheque-status" data-tone={status.tone} role="status">
            <Icon name={status.icon} size={16} />
            <span>
              <b>{formatDaysUntil(days)}</b> · {status.text}
            </span>
          </div>
        )}
      </fieldset>

      {/* ── ۳. طرف حساب و بابت ── */}
      <fieldset className="policy-step">
        <StepTitle n={3}>طرف حساب و بابت</StepTitle>
        <div>
          <label className="label" htmlFor="cheque-counterparty">
            {issued ? "در وجه" : "از طرف"}
          </label>
          <input
            id="cheque-counterparty"
            name="counterparty"
            className="field"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            placeholder={issued ? "مثلاً صاحب‌خانه" : "مثلاً خریدار خودرو"}
            maxLength={120}
            required
          />
        </div>
        <div>
          <span className="label">بابت (اختیاری)</span>
          <div className="policy-kinds cheque-purposes" role="radiogroup" aria-label="بابت">
            {PURPOSES.map((p) => {
              const on = purpose === p.key;
              return (
                <button key={p.key} type="button" role="radio" aria-checked={on} className="policy-kind cheque-tile" data-on={on || undefined} onClick={() => pickPurpose(p.key)}>
                  <span className="policy-kind-icon" style={toneStyle(p.tone)} aria-hidden="true">
                    <Icon name={p.icon} size={17} />
                  </span>
                  <span className="policy-kind-name">{p.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {linksInstallment &&
          (installments.length > 0 ? (
            <div>
              <span className="label">کدام قسط؟</span>
              <div className="cheque-insts" role="radiogroup" aria-label="قسط">
                {installments.map((i) => {
                  const on = installmentId === i.id;
                  return (
                    <button key={i.id} type="button" role="radio" aria-checked={on} className="cheque-inst cheque-tile" data-on={on || undefined} onClick={() => pickInstallment(i)} title={i.label}>
                      <span className="cheque-inst-seq num" aria-hidden="true">
                        {faCount(i.seq)}
                      </span>
                      <span className="min-w-0">
                        <span className="cheque-inst-name block">{i.debtTitle}</span>
                        <span className="cheque-inst-date">
                          قسط {faCount(i.seq)} · سررسید {formatJalaliIso(i.dueDate)}
                        </span>
                      </span>
                      {i.amountToman && <span className="cheque-inst-amount num">{toman(i.amountToman)}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="policy-note">
              <Icon name="info" size={15} />
              <span>
                قسط پرداخت‌نشده‌ای ندارید.{" "}
                <Link href="/debts" className="underline">
                  ثبت بدهی
                </Link>
              </span>
            </div>
          ))}
        {linksEvent &&
          (events.length > 0 ? (
            <div className="cheque-insts" role="radiogroup" aria-label="رویداد">
              {events.map((e) => {
                const on = eventId === e.id;
                return (
                  <button key={e.id} type="button" role="radio" aria-checked={on} className="cheque-inst cheque-tile" data-on={on || undefined} onClick={() => setEventId(on ? "" : e.id)}>
                    <span className="cheque-inst-seq" aria-hidden="true">
                      <Icon name="calendar" size={16} />
                    </span>
                    <span className="min-w-0">
                      <span className="cheque-inst-name block">{e.name}</span>
                      <span className="cheque-inst-date">{formatJalaliIso(e.date)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="policy-note">
              <Icon name="info" size={15} />
              <span>
                رویدادی ندارید.{" "}
                <Link href="/goals" className="underline">
                  ساخت رویداد
                </Link>
              </span>
            </div>
          ))}
      </fieldset>

      {/* ── ۴. حساب ── */}
      <fieldset className="policy-step">
        <StepTitle n={4}>{issued ? "از کدام حساب؟" : "واریز به کدام حساب؟"}</StepTitle>
        <AccountPicker
          label={issued ? "حساب بانکی" : "حساب بانکی (اختیاری)"}
          name="accountId"
          value={accountId}
          options={accounts}
          balances={balances}
          onChange={setAccountId}
          noneLabel={issued ? undefined : "هنوز مشخص نیست"}
        />
      </fieldset>

      {/* ── ۵. جزئیات (اختیاری) ── */}
      <details className="policy-more">
        <summary>
          <span className="policy-step-title">
            <span className="policy-step-num num" aria-hidden="true">
              {faCount(5)}
            </span>
            شناسه صیادی و توضیحات
            <span className="muted text-[length:var(--fs-xs)] font-normal">اختیاری</span>
          </span>
          <Icon name="chevronDown" size={15} />
        </summary>
        <div className="space-y-3 pt-3">
          <div className="cheque-two">
            <div>
              <label className="label" htmlFor="cheque-sayad">
                شناسه صیادی (۱۶ رقم)
              </label>
              <input id="cheque-sayad" name="sayadId" className="field num" inputMode="numeric" dir="ltr" maxLength={24} autoComplete="off" />
            </div>
            <div>
              <label className="label" htmlFor="cheque-serial">
                شماره سریال
              </label>
              <input id="cheque-serial" name="serial" className="field num" dir="ltr" maxLength={40} autoComplete="off" />
            </div>
          </div>
          {!issued && (
            <div>
              <label className="label" htmlFor="cheque-bank">
                بانک صادرکننده
              </label>
              <input id="cheque-bank" name="bankName" className="field" maxLength={60} placeholder="مثلاً بانک ملت" />
            </div>
          )}
          <div>
            <label className="label" htmlFor="cheque-note">
              توضیحات
            </label>
            <input id="cheque-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={440} />
          </div>
        </div>
      </details>

      <FormStatus state={state} />
      <button type="submit" className="btn btn-primary w-full disabled:opacity-40" disabled={pending || !ready}>
        {pending ? "در حال ثبت…" : "ثبت چک"}
      </button>
      <p className="muted text-center text-[length:var(--fs-xs)]">
        چک تا وقتی پاس نشده فقط در برنامه و پیش‌بینی اثر دارد و از موجودی حساب‌ها چیزی کم یا زیاد نمی‌کند.
      </p>
    </form>
  );
}
