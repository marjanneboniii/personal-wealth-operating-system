"use client";

/**
 * AccountPicker — «انتخاب حساب» as the app draws accounts everywhere else:
 * a field-shaped button that shows the chosen account (its bank / coin mark,
 * the place it is held in and its balance) and opens a sheet with every
 * option grouped by what it is:
 *
 *   حساب‌های بانکی        Toman accounts at a bank
 *   تتر و استیبل‌کوین      USDT, USDC… wherever they are held
 *   صندوق و نقد            cash boxes, funds, policy savings
 *   صرافی و کارگزاری       Toman held at an exchange or broker
 *   ارزی                   USD, EUR, AED…
 *
 * A search box appears once the list is long. PRESENTATION ONLY: the chosen
 * id goes to `onChange` (and to a hidden input when `name` is set); which
 * accounts are allowed is decided by the caller.
 */
import { useId, useMemo, useState, type ReactNode } from "react";
import { D } from "@/domain/decimal";
import { LIQUID_SYMBOLS } from "@/features/accounts/classification";
import { walletLogoFor } from "@/features/setup/holdingWallets";
import AssetLogo from "@/components/ui/AssetLogo";
import Icon, { type IconName } from "@/components/ui/Icon";
import Sheet from "@/components/ui/Sheet";
import { currencyLabel, faCount, formatNumber, formatQty } from "@/lib/format";

export type PickerAccount = {
  id: string;
  name: string;
  symbol?: string | null;
  decimals?: number;
  logoUrl?: string | null;
  coingeckoId?: string | null;
  className?: string | null;
  /** `wallets.name` — the bank, exchange or wallet the account is held in. */
  walletName?: string | null;
  /** `wallets.kind` — bank | cash | exchange | broker | hot | cold | fund | insurance. */
  walletKind?: string | null;
};

type GroupKey = "bank" | "stable" | "cash" | "venue" | "fx" | "other";

const GROUPS: { key: GroupKey; title: string; icon: IconName }[] = [
  { key: "bank", title: "حساب‌های بانکی", icon: "card" },
  { key: "stable", title: "تتر و استیبل‌کوین", icon: "coins" },
  { key: "cash", title: "صندوق و نقد", icon: "wallet" },
  { key: "venue", title: "صرافی و کارگزاری", icon: "swap" },
  { key: "fx", title: "ارزی", icon: "globe" },
  { key: "other", title: "سایر حساب‌ها", icon: "layers" },
];

const STABLES = new Set(["USDT", "USDC", "USDG", "USDE", "USDS", "PYUSD", "BUSD", "DAI", "USDD", "FDUSD"]);
const TOMAN = new Set(["IRT", "IRR", ""]);

const unitOf = (a: PickerAccount) => (a.symbol ?? "").trim().toUpperCase();
const kindOf = (a: PickerAccount) => (a.walletKind ?? "").trim().toLowerCase();

function groupOf(a: PickerAccount): GroupKey {
  const unit = unitOf(a);
  const kind = kindOf(a);
  if (STABLES.has(unit)) return "stable";
  if (TOMAN.has(unit)) {
    if (kind === "bank") return "bank";
    if (kind === "cash" || kind === "fund" || kind === "insurance") return "cash";
    if (kind === "exchange" || kind === "broker") return "venue";
    return kind ? "other" : "bank";
  }
  if (kind === "cash" || kind === "fund") return "cash";
  return LIQUID_SYMBOLS.has(unit) ? "fx" : "other";
}

/** The place, then the unit — whatever the name does not already say. */
function subtitleOf(a: PickerAccount): string {
  const unit = unitOf(a);
  const unitText = unit && !TOMAN.has(unit) ? currencyLabel(unit) : "تومان";
  const parts: string[] = [];
  if (a.walletName && !a.name.includes(a.walletName)) parts.push(a.walletName);
  if (!a.name.includes(unitText) && !(unit && a.name.toUpperCase().includes(unit))) parts.push(unitText);
  return parts.join(" · ");
}

/** A balance in the account's own unit. */
function balanceText(a: PickerAccount, raw: string | undefined): ReactNode {
  if (raw === undefined) return null;
  const unit = unitOf(a);
  if (TOMAN.has(unit)) {
    const toman = unit === "IRR" ? D(raw).div(10) : D(raw);
    return (
      <>
        <span className="num">{formatNumber(toman.toFixed(0), { decimals: 0 })}</span> تومان
      </>
    );
  }
  return (
    <>
      <span className="num">{formatQty(raw, Math.min(Math.max(a.decimals ?? 2, 0), 6))}</span> {currencyLabel(unit)}
    </>
  );
}

function AccountMark({ account: a, size = 36 }: { account: PickerAccount; size?: number }) {
  const group = groupOf(a);
  const place = a.walletName ?? a.name;
  if (group === "bank") return <AssetLogo assetType="bank" brandName={place} name={place} size={size} />;
  if (group === "venue") return <AssetLogo assetType="company" brandName={place} name={place} userLogoUrl={walletLogoFor(place) ?? undefined} size={size} />;
  if (group === "cash" && TOMAN.has(unitOf(a))) {
    return (
      <span className="acct-pick-glyph" style={{ width: size, height: size }} aria-hidden="true">
        <Icon name={kindOf(a) === "cash" ? "wallet" : "coins"} size={Math.round(size * 0.46)} />
      </span>
    );
  }
  const placeLogo = walletLogoFor(a.walletName);
  return (
    <span className="acct-pick-mark">
      <AssetLogo symbol={a.symbol} name={a.name} logoUrl={a.logoUrl ?? null} coingeckoId={a.coingeckoId ?? null} assetClassName={a.className} size={size} />
      {placeLogo && (
        <span className="acct-pick-badge">
          <AssetLogo userLogoUrl={placeLogo} name={a.walletName} size={Math.round(size * 0.48)} />
        </span>
      )}
    </span>
  );
}

export default function AccountPicker({
  label,
  value,
  options,
  onChange,
  balances,
  name,
  placeholder = "انتخاب حساب",
  sheetTitle,
  empty,
  disabled,
  noneLabel,
}: {
  label?: string;
  value: string;
  options: PickerAccount[];
  onChange: (id: string) => void;
  /** Posted quantity per account id, in the account's own unit. */
  balances?: Record<string, string>;
  /** Also submits the chosen id under this name. */
  name?: string;
  placeholder?: string;
  sheetTitle?: string;
  /** Shown instead of the button when there is nothing to choose. */
  empty?: ReactNode;
  disabled?: boolean;
  /** When set, «no account» is a valid choice with this label (e.g. «هنوز مشخص نیست»). */
  noneLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const labelId = useId();
  const selected = options.find((o) => o.id === value) ?? null;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? options.filter((o) => [o.name, o.walletName, o.symbol, o.symbol ? currencyLabel(o.symbol) : ""].some((t) => (t ?? "").toLowerCase().includes(q)))
      : options;
    return GROUPS.map((g) => ({ ...g, items: matches.filter((o) => groupOf(o) === g.key) })).filter((g) => g.items.length > 0);
  }, [options, query]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const pick = (id: string) => {
    onChange(id);
    close();
  };

  if (options.length === 0 && empty) {
    return (
      <div>
        {label && <span className="label">{label}</span>}
        {empty}
      </div>
    );
  }

  const shownGroups = new Set(options.map(groupOf)).size;
  const selectedSub = selected ? subtitleOf(selected) : "";
  const selectedBal = selected && balances ? balanceText(selected, balances[selected.id]) : null;

  return (
    <div>
      {label && (
        <span className="label" id={labelId}>
          {label}
        </span>
      )}
      {name && <input type="hidden" name={name} value={value} />}
      <button
        type="button"
        className="acct-pick-trigger"
        data-empty={selected ? undefined : true}
        aria-haspopup="dialog"
        aria-labelledby={label ? labelId : undefined}
        aria-label={label ? undefined : placeholder}
        disabled={disabled || options.length === 0}
        onClick={() => setOpen(true)}
      >
        {selected ? (
          <>
            <AccountMark account={selected} size={34} />
            <span className="acct-pick-text">
              <span className="acct-pick-name">{selected.name}</span>
              <span className="acct-pick-sub">
                {selectedSub}
                {selectedBal && (
                  <>
                    {selectedSub ? " · " : ""}
                    موجودی {selectedBal}
                  </>
                )}
              </span>
            </span>
            <span className="acct-pick-change">تغییر</span>
          </>
        ) : (
          <>
            <span className="acct-pick-glyph" style={{ width: 34, height: 34 }} aria-hidden="true">
              <Icon name="wallet" size={16} />
            </span>
            <span className="acct-pick-text">
              <span className="acct-pick-name">{options.length === 0 ? "حسابی موجود نیست" : (noneLabel ?? placeholder)}</span>
              {options.length > 0 && <span className="acct-pick-sub">{faCount(options.length)} حساب</span>}
            </span>
            <Icon name="chevronDown" size={16} />
          </>
        )}
      </button>

      <Sheet open={open} onClose={close} title={sheetTitle ?? label ?? placeholder}>
        <div className="acct-pick-sheet">
          {options.length > 6 && (
            <label className="acct-pick-search">
              <Icon name="search" size={15} />
              <input className="field" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جستجوی حساب، بانک یا ارز" aria-label="جستجوی حساب" />
            </label>
          )}
          {noneLabel && !query && (
            <button type="button" role="radio" aria-checked={!value} className="acct-pick-row" data-on={!value || undefined} onClick={() => pick("")}>
              <span className="acct-pick-glyph" style={{ width: 36, height: 36 }} aria-hidden="true">
                <Icon name="x" size={15} />
              </span>
              <span className="acct-pick-text">
                <span className="acct-pick-name">{noneLabel}</span>
              </span>
              <span className="place-chip-check" aria-hidden="true">
                {!value && <Icon name="check" size={12} />}
              </span>
            </button>
          )}
          {groups.length === 0 && <p className="muted py-6 text-center text-[length:var(--fs-sm)]">حسابی با این نام پیدا نشد.</p>}
          {groups.map((g) => (
            <section key={g.key} className="acct-pick-group" aria-label={g.title}>
              {shownGroups > 1 && (
                <h3 className="acct-pick-group-title">
                  <Icon name={g.icon} size={13} />
                  {g.title}
                  <span className="num">{faCount(g.items.length)}</span>
                </h3>
              )}
              <ul role="radiogroup" aria-label={g.title}>
                {g.items.map((a) => {
                  const on = a.id === value;
                  const sub = subtitleOf(a);
                  const bal = balances ? balanceText(a, balances[a.id]) : null;
                  return (
                    <li key={a.id}>
                      <button type="button" role="radio" aria-checked={on} className="acct-pick-row" data-on={on || undefined} onClick={() => pick(a.id)}>
                        <AccountMark account={a} />
                        <span className="acct-pick-text">
                          <span className="acct-pick-name">{a.name}</span>
                          {sub && <span className="acct-pick-sub">{sub}</span>}
                        </span>
                        {balances && (
                          <span className="acct-pick-bal money-nowrap" dir="rtl">
                            {bal ?? <span className="muted">بدون موجودی</span>}
                          </span>
                        )}
                        <span className="place-chip-check" aria-hidden="true">
                          {on && <Icon name="check" size={12} />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
