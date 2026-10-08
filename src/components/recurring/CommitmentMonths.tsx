"use client";

import { useState } from "react";
import { faCount, formatMoney } from "@/lib/format";

export type CommitmentMonth = {
  key: string;
  label: string;
  year: number;
  totalToman: string;
  overdueToman: string;
  /** Toman per kind — the bar is stacked by what the money is for. */
  parts?: { installment: string; premium: string; subscription: string };
  items: { key: string; title: string; toman: string; estimated: boolean }[];
};

const KINDS = [
  { key: "installment", label: "قسط" },
  { key: "premium", label: "حق بیمه" },
  { key: "subscription", label: "اشتراک و قبض" },
] as const;

const toman = (v: string) => formatMoney(v, "IRT");

/**
 * The months ahead, one bar each — how much is already spoken for, month by
 * month, stacked by what it is for (installments, premiums, subscriptions),
 * so a month that jumps says why. The selected month is solid, the others
 * recede. Tap (or focus) a month to read what is due in it.
 */
export default function CommitmentMonths({ months }: { months: CommitmentMonth[] }) {
  const [active, setActive] = useState(0);
  const max = Math.max(...months.map((m) => Number(m.totalToman)), 1);
  const cur = months[active];
  const shown = cur.items.slice(0, 4);
  const rest = cur.items.length - shown.length;
  const used = KINDS.filter((k) => months.some((m) => m.parts && Number(m.parts[k.key]) > 0));

  return (
    <div className="commit-chart">
      <div className="commit-bars" role="tablist" aria-label="ماه‌های پیش رو">
        {months.map((m, i) => {
          const h = (Number(m.totalToman) / max) * 100;
          return (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`${m.label}: ${toman(m.totalToman)}`}
              className={`commit-bar${i === active ? " is-on" : ""}`}
              onClick={() => setActive(i)}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
            >
              <span className="commit-bar-track">
                <span className="commit-bar-fill mny-stack" style={{ height: `${Math.max(h, Number(m.totalToman) > 0 ? 3 : 0)}%` }}>
                  {m.parts && Number(m.totalToman) > 0
                    ? KINDS.filter((k) => Number(m.parts![k.key]) > 0).map((k) => (
                        <i key={k.key} data-kind={k.key} style={{ flexGrow: Number(m.parts![k.key]) }} />
                      ))
                    : null}
                </span>
              </span>
              <span className="commit-bar-label">{m.label}</span>
            </button>
          );
        })}
      </div>

      {used.length > 1 && (
        <ul className="mny-stack-legend" aria-hidden="true">
          {used.map((k) => (
            <li key={k.key}>
              <i data-kind={k.key} />
              {k.label}
            </li>
          ))}
        </ul>
      )}

      <div className="commit-detail" role="tabpanel" aria-live="polite">
        <div className="flex items-baseline justify-between gap-3">
          <b className="text-[length:var(--fs-sm)]">
            {cur.label} {cur.year.toLocaleString("fa-IR", { useGrouping: false })}
          </b>
          <b className="num money-nowrap text-[length:var(--fs-sm)]" dir="rtl">
            {toman(cur.totalToman)}
          </b>
        </div>
        {shown.length === 0 ? (
          <p className="muted mt-1 text-[length:var(--fs-xs)]">پرداختی ثبت نشده.</p>
        ) : (
          <ul className="commit-items">
            {shown.map((it) => (
              <li key={it.key}>
                <span className="min-w-0 truncate">
                  {it.title}
                  {it.estimated && <span className="muted"> · تخمینی</span>}
                </span>
                <span className="num money-nowrap" dir="rtl">
                  {toman(it.toman)}
                </span>
              </li>
            ))}
            {rest > 0 && <li className="muted">و {faCount(rest)} مورد دیگر</li>}
          </ul>
        )}
        {Number(cur.overdueToman) > 0 && (
          <p className="mt-1.5 text-[length:var(--fs-xs)]" style={{ color: "var(--warning)" }}>
            شامل {toman(cur.overdueToman)} قسط عقب‌افتاده
          </p>
        )}
      </div>
    </div>
  );
}
