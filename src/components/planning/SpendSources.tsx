"use client";

/**
 * «از کدام پول‌ها خرج می‌کنید؟» — one switch per stablecoin / exchange-Toman
 * account. On = counted in the forecast's opening cash. Folded by default;
 * open when the forecast shows a shortfall, right under that alert.
 */
import { useState, useTransition } from "react";
import Icon from "@/components/ui/Icon";
import { AccountMark, balanceText } from "@/components/ui/AccountPicker";
import { setSpendFromAction } from "@/app/actions/planning";
import { displayAccountName } from "@/lib/assetDisplay";
import { faCount } from "@/lib/format";
import type { SpendSource } from "@/features/planning/spendSources";

export default function SpendSources({ sources, open }: { sources: SpendSource[]; open: boolean }) {
  const [on, setOn] = useState(() => Object.fromEntries(sources.map((s) => [s.id, s.on])));
  const [, start] = useTransition();
  if (sources.length === 0) return null;
  const count = sources.filter((s) => on[s.id]).length;

  const toggle = (id: string) => {
    const next = !on[id];
    setOn((m) => ({ ...m, [id]: next }));
    start(async () => {
      const r = await setSpendFromAction(id, next);
      if (!r.ok) setOn((m) => ({ ...m, [id]: !next }));
    });
  };

  return (
    <details className="card spend-src" open={open}>
      <summary>
        <span className="spend-src-title">از کدام پول‌ها خرج می‌کنید؟</span>
        <span className="muted num">
          {faCount(count)} از {faCount(sources.length)}
        </span>
        <Icon name="chevronDown" size={15} />
      </summary>
      <ul>
        {sources.map((s) => {
          const checked = !!on[s.id];
          const account = { id: s.id, name: displayAccountName(s.name), symbol: s.symbol, decimals: s.decimals, logoUrl: s.logoUrl, walletName: s.walletName };
          return (
            <li key={s.id}>
              <button type="button" role="switch" aria-checked={checked} className="spend-row" onClick={() => toggle(s.id)}>
                <AccountMark account={account} size={30} />
                <span className="spend-text">
                  <span className="spend-name">{account.name}</span>
                  <span className="spend-bal money-nowrap" dir="rtl">
                    {balanceText(account, s.quantity)}
                  </span>
                </span>
                <span className="spend-track" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
