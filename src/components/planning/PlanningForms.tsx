"use client";

/**
 * بودجه · هدف · رویداد · برنامه — the same plain cards as «ثبت هزینه».
 *
 * Each form is one column of cards: a choice is a square tile or a segment,
 * never a dropdown the user must open, and the amount always carries its
 * ready-made Toman presets plus the live dollar equivalent.
 *
 * PRESENTATION ONLY: every form posts exactly the fields its server action
 * already expects (`createBudgetAction`, `createGoalAction`,
 * `createEventAction`, `createPlannedAction`) — no action was changed, so the
 * Toman-is-the-contract rule and the ownership checks behind them still hold.
 */
import { useActionState, useEffect, useState, type ReactNode } from "react";
import {
  createBudgetAction,
  createEventAction,
  createGoalAction,
  createPlannedAction,
  type ActionResult,
} from "@/app/actions";
import AmountInput from "@/components/ui/AmountInput";
import DualDateInput from "@/components/ui/DualDateInput";
import Icon from "@/components/ui/Icon";
import { SmartAmountPreview } from "@/components/ui/SmartPreview";
import { addMonthsIso, formatJalaliIso, jalaliMonthLength, jalaliToIso, toJalali } from "@/lib/format";

export type AccountOpt = { id: string; code: string; name: string };

export type RateProps = {
  rate?: string | null;
  rateDate?: string;
  rateSource?: string;
};

/** Toman presets — a tap SETS the amount (it does not add to it). */
const BUDGET_PRESETS: Array<[string, number]> = [
  ["۵ میلیون", 5_000_000],
  ["۱۰ میلیون", 10_000_000],
  ["۲۰ میلیون", 20_000_000],
  ["۵۰ میلیون", 50_000_000],
  ["۱۰۰ میلیون", 100_000_000],
  ["۲۰۰ میلیون", 200_000_000],
];

const GOAL_PRESETS: Array<[string, number]> = [
  ["۱۰۰ میلیون", 100_000_000],
  ["۵۰۰ میلیون", 500_000_000],
  ["۱ میلیارد", 1_000_000_000],
  ["۲ میلیارد", 2_000_000_000],
  ["۵ میلیارد", 5_000_000_000],
  ["۱۰ میلیارد", 10_000_000_000],
];

const PLAN_PRESETS: Array<[string, number]> = [
  ["۱ میلیون", 1_000_000],
  ["۵ میلیون", 5_000_000],
  ["۱۰ میلیون", 10_000_000],
  ["۲۰ میلیون", 20_000_000],
  ["۵۰ میلیون", 50_000_000],
  ["۱۰۰ میلیون", 100_000_000],
];

/** Persian search: Arabic ي/ك, half-spaces and case never block a match. */
const norm = (s: string) =>
  s.replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[‌\s]+/g, " ").trim().toLowerCase();

function Check() {
  return (
    <span className="expense-check" aria-hidden="true">
      <Icon name="check" size={11} strokeWidth={3} />
    </span>
  );
}

function Feedback({ state }: { state: ActionResult | null }) {
  if (!state || state.ok) return null;
  return (
    <p className="expense-note" role="alert" style={{ color: "var(--negative)" }}>
      {state.message}
    </p>
  );
}

/** One card: a title, an optional aside, and its controls. */
function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card expense-card">
      <header className="expense-head">
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** The amount card every planning form shares. */
function AmountCard({
  title,
  name,
  value,
  onChange,
  presets,
  rate,
  rateDate,
  rateSource,
}: {
  title: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  presets: Array<[string, number]>;
} & RateProps) {
  return (
    <Card title={title} aside={<span className="expense-sub">تومان</span>}>
      <AmountInput
        name={name}
        value={value}
        onValueChange={onChange}
        placeholder="۰"
        className="field num"
        unit="toman"
        aria-label={title}
      />
      <div className="expense-presets" role="group" aria-label="مبلغ‌های آماده">
        {presets.map(([label, amount]) => {
          const on = value === String(amount);
          return (
            <button
              key={amount}
              type="button"
              className="expense-preset"
              data-on={on || undefined}
              aria-pressed={on}
              onClick={() => onChange(String(amount))}
            >
              {label}
            </button>
          );
        })}
      </div>
      {value && <SmartAmountPreview irtAmount={value} rate={rate ?? null} rateDate={rateDate} rateSource={rateSource} />}
      <p className="expense-sub">مبلغ تومان ثابت می‌ماند؛ معادل دلاری فقط نمایشی است.</p>
    </Card>
  );
}

/** A labelled row — the same one the expense form uses for date and note. */
function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="expense-row">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="expense-row-label">
          {label}
        </label>
      ) : (
        <span className="expense-row-label">{label}</span>
      )}
      {children}
    </div>
  );
}

/** Segmented choice — «امروز / دیروز» in the expense form, anything here. */
function Seg<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<[T, string]>;
  label: string;
}) {
  return (
    <div className="expense-seg" role="group" aria-label={label}>
      {options.map(([key, text]) => {
        const on = value === key;
        return (
          <button key={key} type="button" data-on={on || undefined} aria-pressed={on} onClick={() => onChange(key)}>
            {text}
          </button>
        );
      })}
    </div>
  );
}

function Submit({ pending, disabled, label, note }: { pending: boolean; disabled: boolean; label: string; note?: string }) {
  return (
    <div className="sheet-submit">
      <button type="submit" className="btn btn-primary w-full disabled:opacity-40" disabled={pending || disabled}>
        {pending ? "در حال ثبت…" : label}
      </button>
      {note && <p className="expense-sub mt-2 text-center">{note}</p>}
    </div>
  );
}

/** Close the sheet as soon as the server confirms the write. */
function useCloseOnSuccess(state: ActionResult | null, onDone: () => void) {
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
}

/* ────────────────────────── بودجه جدید ────────────────────────── */

/** Jalali period presets — the boundaries a household actually budgets on. */
function jalaliPeriod(today: string, mode: "month" | "quarter" | "year") {
  const { y, m } = toJalali(today);
  if (mode === "year") {
    return { start: jalaliToIso(y, 1, 1), end: jalaliToIso(y, 12, jalaliMonthLength(y, 12)) };
  }
  const start = jalaliToIso(y, m, 1);
  if (mode === "month") return { start, end: jalaliToIso(y, m, jalaliMonthLength(y, m)) };
  // Quarter: this month plus the next two, year-end included.
  const raw = m + 2;
  const endYear = raw > 12 ? y + 1 : y;
  const endMonth = raw > 12 ? raw - 12 : raw;
  return { start, end: jalaliToIso(endYear, endMonth, jalaliMonthLength(endYear, endMonth)) };
}

export function BudgetCardForm({
  accounts,
  tags = [],
  today,
  onDone,
  rate,
  rateDate,
  rateSource,
}: { accounts: AccountOpt[]; tags?: string[]; today: string; onDone: () => void } & RateProps) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createBudgetAction, null);
  useCloseOnSuccess(state, onDone);

  // A budget caps an expense category — or everything carrying one #tag (a trip, a renovation).
  const [scope, setScope] = useState<"account" | "tag">("account");
  const [tag, setTag] = useState("");
  const [accountId, setAccountId] = useState("");
  const [browsing, setBrowsing] = useState(true);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [touchedName, setTouchedName] = useState(false);
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<"month" | "quarter" | "year" | "custom">("month");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);

  const selected = accounts.find((a) => a.id === accountId) ?? null;
  const q = norm(query);
  const matches = q ? accounts.filter((a) => norm(a.name).includes(q)) : accounts;

  const pick = (a: AccountOpt) => {
    setAccountId(a.id);
    setBrowsing(false);
    setQuery("");
    // The category name is the budget's name until the user writes their own.
    if (!touchedName) setName(a.name);
  };

  const range = period === "custom" ? { start, end } : jalaliPeriod(today, period);
  const cleanTag = tag.trim().replace(/^#+/, "");
  const ready = (scope === "account" ? !!accountId : cleanTag.length > 0) && name.trim().length >= 2 && Number(amount) > 0 && range.start <= range.end;

  return (
    <form action={action} className="expense-form p-3 sm:p-4">
      <input type="hidden" name="accountId" value={scope === "account" ? accountId : ""} />
      <input type="hidden" name="tag" value={scope === "tag" ? cleanTag : ""} />
      <input type="hidden" name="name" value={name} />
      <Seg
        value={scope}
        onChange={setScope}
        label="بودجه روی"
        options={[
          ["account", "دسته هزینه"],
          ["tag", "برچسب"],
        ]}
      />
      {period !== "custom" && (
        <>
          <input type="hidden" name="periodStart" value={range.start} />
          <input type="hidden" name="periodEnd" value={range.end} />
        </>
      )}

      {scope === "tag" && (
        <Card title="بودجه برای کدام برچسب؟">
          <input
            className="field"
            dir="auto"
            value={tag}
            onChange={(e) => {
              setTag(e.target.value);
              if (!touchedName) setName(e.target.value.trim() ? `#${e.target.value.trim().replace(/^#+/, "")}` : "");
            }}
            placeholder="مثلاً سفر_مشهد"
            aria-label="برچسب"
            maxLength={60}
          />
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.slice(0, 12).map((t) => (
                <button
                  key={t}
                  type="button"
                  className="shortcut-chip"
                  aria-pressed={cleanTag === t}
                  onClick={() => {
                    setTag(t);
                    if (!touchedName) setName(`#${t}`);
                  }}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}
          <p className="expense-sub mt-2">هر هزینه‌ای که این برچسب را داشته باشد، از هر دسته‌ای، در این بودجه حساب می‌شود.</p>
        </Card>
      )}

      {scope === "account" && (
      <Card
        title="بودجه برای کدام دسته هزینه؟"
        aside={
          selected && !browsing ? (
            <button type="button" className="expense-link" onClick={() => setBrowsing(true)}>
              تغییر
            </button>
          ) : undefined
        }
      >
        {selected && !browsing ? (
          <div className="expense-squares">
            <button type="button" className="expense-square" data-on onClick={() => setBrowsing(true)}>
              <Check />
              <span className="expense-square-label">{selected.name}</span>
            </button>
          </div>
        ) : (
          <>
            {accounts.length > 8 && (
              <div className="expense-search">
                <Icon name="search" size={16} />
                <input
                  type="search"
                  className="field"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="جست‌وجوی دسته هزینه…"
                  aria-label="جست‌وجوی دسته هزینه"
                />
              </div>
            )}
            {matches.length === 0 ? (
              <p className="expense-empty">دسته‌ای پیدا نشد.</p>
            ) : (
              <div className="expense-squares" role="radiogroup" aria-label="دسته هزینه">
                {matches.map((a) => {
                  const on = a.id === accountId;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className="expense-square"
                      data-on={on || undefined}
                      onClick={() => pick(a)}
                    >
                      {on && <Check />}
                      <span className="expense-square-label">{a.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </Card>
      )}

      <AmountCard
        title="سقف بودجه"
        name="amountBase"
        value={amount}
        onChange={setAmount}
        presets={BUDGET_PRESETS}
        rate={rate}
        rateDate={rateDate}
        rateSource={rateSource}
      />

      <section className="card expense-card expense-details">
        <Row label="دوره">
          <Seg
            value={period}
            onChange={setPeriod}
            label="دوره بودجه"
            options={[
              ["month", "این ماه"],
              ["quarter", "سه ماه"],
              ["year", "امسال"],
              ["custom", "بازه دلخواه"],
            ]}
          />
          {period === "custom" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <DualDateInput name="periodStart" value={start} onChange={setStart} label="شروع دوره" required showGregorian={false} />
              <DualDateInput name="periodEnd" value={end} onChange={setEnd} label="پایان دوره" required showGregorian={false} />
            </div>
          ) : (
            <p className="expense-sub num">
              {formatJalaliIso(range.start)} ← {formatJalaliIso(range.end)}
            </p>
          )}
        </Row>
        <Row label="نام بودجه" htmlFor="budget-name">
          <input
            id="budget-name"
            className="field"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setTouchedName(true);
            }}
            placeholder="مثلاً خوراک ماهانه"
            maxLength={120}
          />
        </Row>
      </section>

      <Feedback state={state} />
      <Submit
        pending={pending}
        disabled={!ready}
        label="ایجاد بودجه"
        note={scope === "tag" ? "هزینه‌های این برچسب به تومانِ روز ثبت با این سقف سنجیده می‌شود." : "مصرف واقعی این دسته به‌طور خودکار با این سقف سنجیده می‌شود."}
      />
    </form>
  );
}

/* ────────────────────────── هدف مالی ────────────────────────── */

export function GoalCardForm({
  accounts,
  today,
  onDone,
  rate,
  rateDate,
  rateSource,
}: { accounts: AccountOpt[]; today: string; onDone: () => void } & RateProps) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createGoalAction, null);
  useCloseOnSuccess(state, onDone);

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [priority, setPriority] = useState("2");
  const [when, setWhen] = useState<"6m" | "12m" | "custom" | "none">("12m");
  const [targetDate, setTargetDate] = useState(addMonthsIso(today, 12));

  const presetDate = when === "6m" ? addMonthsIso(today, 6) : when === "12m" ? addMonthsIso(today, 12) : "";
  const ready = name.trim().length >= 2 && Number(amount) > 0;

  return (
    <form action={action} className="expense-form p-3 sm:p-4">
      {when !== "custom" && <input type="hidden" name="targetDate" value={presetDate} />}

      <Card title="هدف">
        <input
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          name="name"
          placeholder="مثلاً خرید خانه"
          maxLength={120}
          autoFocus
        />
        <div className="expense-row !p-0">
          <span className="expense-row-label">اولویت</span>
          <Seg
            value={priority}
            onChange={setPriority}
            label="اولویت هدف"
            options={[
              ["1", "بالا"],
              ["2", "متوسط"],
              ["3", "پایین"],
            ]}
          />
          <input type="hidden" name="priority" value={priority} />
        </div>
      </Card>

      <AmountCard
        title="مبلغ هدف"
        name="targetBase"
        value={amount}
        onChange={setAmount}
        presets={GOAL_PRESETS}
        rate={rate}
        rateDate={rateDate}
        rateSource={rateSource}
      />

      <section className="card expense-card expense-details">
        <Row label="تا چه زمانی">
          <Seg
            value={when}
            onChange={setWhen}
            label="تاریخ هدف"
            options={[
              ["6m", "۶ ماه دیگر"],
              ["12m", "یک سال دیگر"],
              ["custom", "تاریخ دیگر"],
              ["none", "بدون تاریخ"],
            ]}
          />
          {when === "custom" ? (
            <DualDateInput name="targetDate" value={targetDate} onChange={setTargetDate} label="تاریخ هدف" showGregorian={false} />
          ) : (
            presetDate && <p className="expense-sub num">{formatJalaliIso(presetDate)}</p>
          )}
        </Row>
        <Row label="حساب پس‌انداز" htmlFor="goal-account">
          <select id="goal-account" name="fundAccountId" className="field" defaultValue="">
            <option value="">بدون حساب اختصاصی</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Row>
      </section>

      <Feedback state={state} />
      <Submit pending={pending} disabled={!ready} label="ثبت هدف" note="پیشرفت هدف از موجودی حساب پس‌انداز آن خوانده می‌شود." />
    </form>
  );
}

/* ────────────────────────── رویداد آینده ────────────────────────── */

const EVENT_CATEGORIES: Array<[string, string]> = [
  ["trip", "سفر"],
  ["ceremony", "مراسم"],
  ["gift", "هدیه"],
  ["purchase", "خرید بزرگ"],
  ["other", "سایر"],
];

export function EventCardForm({
  today,
  onDone,
  rate,
  rateDate,
  rateSource,
}: { today: string; onDone: () => void } & RateProps) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createEventAction, null);
  useCloseOnSuccess(state, onDone);

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("trip");
  const [eventDate, setEventDate] = useState(addMonthsIso(today, 1));

  const ready = name.trim().length >= 2 && Number(amount) > 0 && !!eventDate;

  return (
    <form action={action} className="expense-form p-3 sm:p-4">
      <input type="hidden" name="category" value={category} />

      <Card title="رویداد">
        <input
          className="field"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="مثلاً سفر نوروز"
          maxLength={120}
          autoFocus
        />
        <div className="expense-squares" role="radiogroup" aria-label="دسته رویداد">
          {EVENT_CATEGORIES.map(([key, label]) => {
            const on = category === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={on}
                className="expense-square"
                data-on={on || undefined}
                onClick={() => setCategory(key)}
              >
                {on && <Check />}
                <span className="expense-square-label">{label}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <AmountCard
        title="بودجه رویداد"
        name="budgetBase"
        value={amount}
        onChange={setAmount}
        presets={PLAN_PRESETS}
        rate={rate}
        rateDate={rateDate}
        rateSource={rateSource}
      />

      <section className="card expense-card expense-details">
        <Row label="تاریخ">
          <DualDateInput name="eventDate" value={eventDate} onChange={setEventDate} label="تاریخ رویداد" required showGregorian={false} />
        </Row>
      </section>

      <Feedback state={state} />
      <Submit pending={pending} disabled={!ready} label="ثبت رویداد" note="رویداد فقط برنامه است و در موجودی حساب‌ها اثری ندارد." />
    </form>
  );
}

/* ────────────────────── تراکنش برنامه‌ریزی‌شده ────────────────────── */

export function PlannedCardForm({
  accounts,
  today,
  onDone,
  rate,
  rateDate,
  rateSource,
}: { accounts: AccountOpt[]; today: string; onDone: () => void } & RateProps) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createPlannedAction, null);
  useCloseOnSuccess(state, onDone);

  const [direction, setDirection] = useState<"outflow" | "inflow">("outflow");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [plannedDate, setPlannedDate] = useState(addMonthsIso(today, 1));
  const [recurrence, setRecurrence] = useState("none");

  const ready = title.trim().length >= 2 && Number(amount) > 0 && !!plannedDate;

  return (
    <form action={action} className="expense-form p-3 sm:p-4">
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="recurrence" value={recurrence} />

      <Card title="برنامه">
        <Seg
          value={direction}
          onChange={setDirection}
          label="جهت برنامه"
          options={[
            ["outflow", "خروج وجه"],
            ["inflow", "ورود وجه"],
          ]}
        />
        <input
          className="field"
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="مثلاً شارژ صندوق اضطراری"
          maxLength={120}
        />
      </Card>

      <AmountCard
        title="مبلغ"
        name="amountBase"
        value={amount}
        onChange={setAmount}
        presets={PLAN_PRESETS}
        rate={rate}
        rateDate={rateDate}
        rateSource={rateSource}
      />

      <section className="card expense-card expense-details">
        <Row label="تاریخ برنامه">
          <DualDateInput name="plannedDate" value={plannedDate} onChange={setPlannedDate} label="تاریخ برنامه" required showGregorian={false} />
        </Row>
        <Row label="تکرار">
          <Seg
            value={recurrence}
            onChange={setRecurrence}
            label="تکرار برنامه"
            options={[
              ["none", "یک‌بار"],
              ["monthly", "ماهانه"],
              ["yearly", "سالانه"],
            ]}
          />
        </Row>
        <Row label={direction === "outflow" ? "از حساب" : "حساب مبدأ"} htmlFor="plan-from">
          <select id="plan-from" name="fromAccountId" className="field" defaultValue="">
            <option value="">—</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="به حساب" htmlFor="plan-to">
          <select id="plan-to" name="toAccountId" className="field" defaultValue="">
            <option value="">—</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Row>
      </section>

      <Feedback state={state} />
      <Submit pending={pending} disabled={!ready} label="ثبت برنامه" note="تا زدن «اجرا» چیزی در حساب‌ها ثبت نمی‌شود." />
    </form>
  );
}
