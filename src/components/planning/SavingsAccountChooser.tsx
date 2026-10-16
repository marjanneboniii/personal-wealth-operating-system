"use client";

/**
 * «کجا پس‌انداز می‌کنید؟» — the savings account of a goal or a fund, chosen
 * in place from cards instead of a sheet: a bank account or a stablecoin held
 * in a wallet (the list comes from `listSavingsAccounts`). Few accounts fit on
 * one screen; past six, the rest fold behind «نمایش همه».
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import Icon from "@/components/ui/Icon";
import { AccountMark, balanceText, type PickerAccount } from "@/components/ui/AccountPicker";
import { displayAccountName } from "@/lib/assetDisplay";
import { isStablecoinSymbol } from "@/lib/stablecoins";
import { faCount } from "@/lib/format";

const FOLD_AT = 6;

export default function SavingsAccountChooser({
  label = "کجا پس‌انداز می‌کنید؟",
  hint,
  name,
  value,
  onChange,
  options: raw,
  balances,
  noneLabel,
}: {
  label?: string;
  hint?: string;
  name?: string;
  value: string;
  onChange: (id: string) => void;
  options: PickerAccount[];
  balances?: Record<string, string>;
  /** When set, «no account» is a valid choice with this caption. */
  noneLabel?: string;
}) {
  const [all, setAll] = useState(false);
  const options = useMemo(
    () => raw.map((a) => ({ ...a, name: displayAccountName(a.name), walletName: a.walletName ? displayAccountName(a.walletName) : a.walletName })),
    [raw],
  );
  const groups = useMemo(() => {
    const bank = options.filter((a) => !isStablecoinSymbol(a.symbol));
    const stable = options.filter((a) => isStablecoinSymbol(a.symbol));
    return [
      { key: "bank", title: "حساب‌های بانکی", icon: "card" as const, items: bank },
      { key: "stable", title: "تتر و استیبل‌کوین", icon: "coins" as const, items: stable },
    ].filter((g) => g.items.length > 0);
  }, [options]);

  // Fold past six, but never hide the chosen account.
  let budget = all ? Infinity : FOLD_AT;
  const shown = groups.map((g) => {
    const items = g.items.filter((a) => {
      if (a.id === value) return true;
      if (budget <= 0) return false;
      budget -= 1;
      return true;
    });
    return { ...g, items };
  });
  const hidden = options.length - shown.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="sav-pick" role="radiogroup" aria-label={label}>
      {name && <input type="hidden" name={name} value={value} />}
      <div className="sav-pick-head">
        <span className="label">{label}</span>
        {hint && <span className="expense-sub">{hint}</span>}
      </div>

      {options.length === 0 ? (
        <div className="sav-pick-empty">
          <Icon name="wallet" size={18} />
          <span>هنوز حساب بانکی یا کیف پول استیبل‌کوینی ثبت نکرده‌اید.</span>
          <Link href="/accounts#new-account" className="btn btn-soft">
            افزودن حساب
          </Link>
        </div>
      ) : (
        <>
          {noneLabel && (
            <button type="button" role="radio" aria-checked={!value} className="sav-none" data-on={!value || undefined} onClick={() => onChange("")}>
              <span className="sav-none-dot" aria-hidden="true" />
              {noneLabel}
            </button>
          )}
          {shown.map((g) => (
            <section key={g.key} className="sav-pick-group" aria-label={g.title}>
              {groups.length > 1 && (
                <h3 className="sav-pick-title">
                  <Icon name={g.icon} size={13} />
                  {g.title}
                </h3>
              )}
              <div className="sav-pick-grid">
                {g.items.map((a) => {
                  const on = a.id === value;
                  const bal = balanceText(a, balances?.[a.id] ?? a.balance ?? undefined);
                  return (
                    <button key={a.id} type="button" role="radio" aria-checked={on} className="sav-card" data-on={on || undefined} onClick={() => onChange(on && noneLabel ? "" : a.id)}>
                      {on && (
                        <span className="expense-check" aria-hidden="true">
                          <Icon name="check" size={11} strokeWidth={3} />
                        </span>
                      )}
                      <AccountMark account={a} size={32} />
                      <span className="sav-card-name">{a.name}</span>
                      {a.walletName && a.walletName !== a.name && <span className="sav-card-sub">{a.walletName}</span>}
                      <span className="sav-card-bal money-nowrap" dir="rtl">
                        {bal ?? <span className="muted">بدون موجودی</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          {(hidden > 0 || all) && options.length > FOLD_AT && (
            <button type="button" className="expense-link sav-more" onClick={() => setAll((v) => !v)}>
              {all ? "نمایش کمتر" : `نمایش همه (${faCount(options.length)})`}
              <Icon name="chevronDown" size={14} />
            </button>
          )}
        </>
      )}
    </div>
  );
}
