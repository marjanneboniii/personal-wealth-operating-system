"use client";

/**
 * The building blocks every «ثبت تراکنش» card shares — one visual language
 * for expense, income, transfer, buy, sell and debt repayment:
 *
 *   TxCard        a card with a tinted icon badge and a title
 *   AmountHero    the one place a number is typed: large, centred, in the
 *                 type's colour, with one-tap presets under it
 *   AccountTiles  money accounts as logo tiles (bank, exchange, coin) with
 *                 their balance — a tap selects; long lists fall back to the
 *                 grouped sheet of AccountPicker
 *   DateChips     امروز · دیروز · پریروز · تقویم (Jalali picker, never typed)
 *   FeeToggle     «کارمزد داشت» — the fee field only when it is needed
 *   TagChips      the user's own hashtags, toggled with a tap
 *
 * Nothing here is typed except an amount. PRESENTATION ONLY: values are owned
 * by TransactionForm.
 */
import { useMemo, useState, type ReactNode } from "react";
import { displayAccountName } from "@/lib/assetDisplay";
import { currencyLabel, faCount, getDualDate } from "@/lib/format";
import AccountPicker, { AccountMark, balanceText, subtitleOf, type PickerAccount } from "@/components/ui/AccountPicker";
import AmountInput from "@/components/ui/AmountInput";
import Icon, { type IconName } from "@/components/ui/Icon";
import JalaliDatePicker from "@/components/ui/JalaliDatePicker";

/** Each type has its own colour; every card of the form picks it up. */
export const TX_KINDS = [
  { key: "expense", label: "هزینه", hint: "خرج روزانه", icon: "card" },
  { key: "income", label: "درآمد", hint: "حقوق، سود، اجاره", icon: "download" },
  { key: "transfer", label: "انتقال", hint: "بین حساب‌های خودم", icon: "swap" },
  { key: "buy", label: "خرید دارایی", hint: "طلا، سکه، ارز، سهام", icon: "trend-up" },
  { key: "sell", label: "فروش دارایی", hint: "تبدیل به پول", icon: "trend-down" },
  { key: "debt_repayment", label: "پرداخت بدهی", hint: "قسط و وام", icon: "debts" },
] as const satisfies ReadonlyArray<{ key: string; label: string; hint: string; icon: IconName }>;

/** Expense groups: an icon and a colour per standard group code. */
export const EXPENSE_GROUP_LOOK: Record<string, { icon: IconName; color: string }> = {
  HSG: { icon: "home", color: "#3e63dd" },
  TRN: { icon: "car", color: "#0090ff" },
  FOD: { icon: "food", color: "#f76b15" },
  HLT: { icon: "heart", color: "#e5484d" },
  HYG: { icon: "sparkle", color: "#d6409f" },
  CLT: { icon: "shirt", color: "#8e4ec6" },
  ENT: { icon: "ticket", color: "#e93d82" },
  COM: { icon: "phone", color: "#00a2c7" },
  PUR: { icon: "bag", color: "#ab4aba" },
  FAM: { icon: "users", color: "#12a594" },
  INS: { icon: "shield", color: "#6e56cf" },
  EDU: { icon: "book", color: "#3e9b4f" },
  WRK: { icon: "briefcase", color: "#5b5bd6" },
  TAX: { icon: "receipt", color: "#978365" },
  SOC: { icon: "gift", color: "#ca244d" },
  MSC: { icon: "more", color: "#8b8d98" },
};

/** Income groups, the same way. */
export const INCOME_GROUP_LOOK: Record<string, { icon: IconName; color: string }> = {
  "INC-SAL": { icon: "wallet", color: "#12a594" },
  "INC-BIZ": { icon: "briefcase", color: "#3e63dd" },
  "INC-INV": { icon: "trend-up", color: "#8e4ec6" },
  "INC-PEN": { icon: "calendar", color: "#f76b15" },
  "INC-SUP": { icon: "heart", color: "#d6409f" },
  "INC-OTH": { icon: "gift", color: "#e5484d" },
};

export const FALLBACK_LOOK = { icon: "layers" as IconName, color: "#8b8d98" };

export function TxCard({
  icon,
  title,
  aside,
  children,
  id,
}: {
  icon: IconName;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="txr-card" aria-labelledby={id}>
      <header className="txr-card-head">
        <span className="txr-badge" aria-hidden="true">
          <Icon name={icon} size={16} />
        </span>
        <h2 id={id}>{title}</h2>
        {aside && <span className="txr-card-aside">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

/** A tinted tile: icon (or a logo) over a label, a check when chosen. */
export function Tile({
  on,
  onClick,
  label,
  meta,
  icon,
  mark,
  color,
  role = "radio",
}: {
  on?: boolean;
  onClick: () => void;
  label: string;
  meta?: ReactNode;
  icon?: IconName;
  mark?: ReactNode;
  color?: string;
  role?: "radio" | "button";
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === "radio" ? !!on : undefined}
      className="txr-tile"
      data-on={on || undefined}
      style={color ? ({ "--tile": color } as React.CSSProperties) : undefined}
      onClick={onClick}
    >
      {on && (
        <span className="txr-tick" aria-hidden="true">
          <Icon name="check" size={10} strokeWidth={3} />
        </span>
      )}
      {mark ?? (icon && (
        <span className="txr-tile-icon" aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
      ))}
      <span className="txr-tile-label">{label}</span>
      {meta && <span className="txr-tile-meta">{meta}</span>}
    </button>
  );
}

/** Preset amounts: a tap SETS the amount (it does not add to it). */
export type Preset = { label: ReactNode; value: string; key?: string };

export function Presets({ items, current, onPick, label }: { items: Preset[]; current: string; onPick: (v: string) => void; label: string }) {
  if (items.length === 0) return null;
  return (
    <div className="txr-presets" role="group" aria-label={label}>
      {items.map((p) => {
        const on = !!current && current === p.value;
        return (
          <button key={p.key ?? p.value} type="button" className="txr-preset" data-on={on || undefined} aria-pressed={on} onClick={() => onPick(p.value)}>
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

/** The amount as the hero of the card: large, centred, in the type's colour. */
export function AmountHero({ label, unit, children, foot }: { label: string; unit?: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="txr-hero">
      <span className="txr-hero-label">
        {label}
        {unit && <span className="txr-hero-unit">{unit}</span>}
      </span>
      <div className="txr-hero-field">{children}</div>
      {foot}
    </div>
  );
}

/** Up to this many accounts are shown as tiles; more open the grouped sheet. */
const TILE_LIMIT = 9;

export function AccountTiles({
  options: raw,
  value,
  onChange,
  balances,
  sheetTitle,
  placeholder,
}: {
  options: PickerAccount[];
  value: string;
  onChange: (id: string) => void;
  balances?: Record<string, string>;
  sheetTitle: string;
  placeholder: string;
}) {
  const options = useMemo(
    () => raw.map((a) => ({ ...a, name: displayAccountName(a.name), walletName: a.walletName ? displayAccountName(a.walletName) : a.walletName })),
    [raw],
  );
  if (options.length > TILE_LIMIT) {
    return <AccountPicker value={value} options={raw} balances={balances} onChange={onChange} placeholder={placeholder} sheetTitle={sheetTitle} />;
  }
  return (
    <div className="txr-accts" role="radiogroup" aria-label={sheetTitle}>
      {options.map((a) => {
        const on = a.id === value;
        const bal = balances ? balanceText(a, balances[a.id]) : null;
        const sub = subtitleOf(a);
        return (
          <button key={a.id} type="button" role="radio" aria-checked={on} className="txr-acct" data-on={on || undefined} onClick={() => onChange(a.id)}>
            <AccountMark account={a} size={34} />
            <span className="txr-acct-text">
              <span className="txr-acct-name">{a.name}</span>
              <span className="txr-acct-sub">{bal ?? (sub || " ")}</span>
            </span>
            <span className="txr-radio" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * امروز · دیروز · پریروز · تقویم. The caller posts `entryDate` itself (a
 * hidden input), so the value reaches the server whichever chip is chosen.
 */
export function DateChips({ value, onChange, today, label }: { value: string; onChange: (iso: string) => void; today: string; label: string }) {
  const [picking, setPicking] = useState(false);
  const days: Array<[string, string]> = [
    ["امروز", today],
    ["دیروز", shiftIso(today, -1)],
    ["پریروز", shiftIso(today, -2)],
  ];
  const quick = days.some(([, iso]) => iso === value);
  return (
    <div className="txr-date">
      <div className="txr-seg" role="group" aria-label={label}>
        {days.map(([text, iso]) => {
          const on = value === iso && !picking;
          return (
            <button
              key={text}
              type="button"
              data-on={on || undefined}
              aria-pressed={on}
              onClick={() => {
                onChange(iso);
                setPicking(false);
              }}
            >
              {text}
            </button>
          );
        })}
        <button type="button" data-on={(!quick && !!value) || picking || undefined} aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
          <Icon name="calendar" size={14} />
          {!quick && value ? getDualDate(value).jalali : "تقویم"}
        </button>
      </div>
      {picking && <JalaliDatePicker value={value} onChange={onChange} ariaLabel={label} />}
    </div>
  );
}

/** «کارمزد داشت» — the fee field appears only when it is needed. */
export function FeeToggle({
  fee,
  setFee,
  feeInToman,
  feeSymbol,
  foot,
}: {
  fee: string;
  setFee: (v: string) => void;
  feeInToman: boolean;
  feeSymbol: string;
  foot?: ReactNode;
}) {
  const [open, setOpen] = useState(!!fee);
  return (
    <div className="txr-fee">
      <button
        type="button"
        className="txr-switch"
        role="switch"
        aria-checked={open}
        onClick={() => {
          if (open) setFee("");
          setOpen(!open);
        }}
      >
        <span className="txr-switch-track" aria-hidden="true" />
        کارمزد داشت
        <span className="txr-card-aside">{feeInToman ? "تومان" : currencyLabel(feeSymbol)}</span>
      </button>
      {open && (
        <AmountInput
          inputMode={feeInToman ? "numeric" : "decimal"}
          value={fee}
          onValueChange={setFee}
          className="field num"
          unit={feeInToman ? "toman" : feeSymbol}
          placeholder="۰"
          aria-label="کارمزد"
        />
      )}
      {foot}
    </div>
  );
}

/** The user's own hashtags, toggled with a tap — never typed here. */
export function TagChips({ suggestions, value, onChange }: { suggestions: string[]; value: string; onChange: (v: string) => void }) {
  const tokens = value.split(/\s+/).filter(Boolean);
  const extra = tokens.map((t) => t.replace(/^#/, "")).filter((t) => !suggestions.includes(t));
  const all = [...extra, ...suggestions].slice(0, 16);
  if (all.length === 0) return null;
  return (
    <div className="txr-tags" role="group" aria-label="برچسب">
      {all.map((t) => {
        const token = `#${t}`;
        const on = tokens.includes(token);
        return (
          <button
            key={t}
            type="button"
            className="txr-tag"
            aria-pressed={on}
            data-on={on || undefined}
            onClick={() => onChange(on ? tokens.filter((x) => x !== token).join(" ") : [...tokens, token].join(" "))}
          >
            #{t}
          </button>
        );
      })}
    </div>
  );
}

/** «۱۵ام» — a day of the month for the recurring-income chips. */
export function DayGrid({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  return (
    <div className="txr-days" role="radiogroup" aria-label="روز واریز در ماه">
      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
        <button key={d} type="button" role="radio" aria-checked={d === value} data-on={d === value || undefined} className="num" onClick={() => onChange(d)}>
          {faCount(d)}
        </button>
      ))}
    </div>
  );
}
