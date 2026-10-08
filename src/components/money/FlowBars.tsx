"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";

type Month = { label: string; inflow: number; outflow: number };

/**
 * Twelve months of money in and out, one pair of rounded bars per month.
 *
 * The old chart filled each month with saturated green and red and squeezed
 * twelve columns into a phone, where «اردیبهشت» ran into «فروردین». Here every
 * column keeps a readable width and the strip scrolls sideways on a narrow
 * screen, opening on the latest months. Income is the solid bar, spending the
 * softer one; a tap (not only a hover — a phone has none) selects a month and
 * the line above reads it out. Values arrive already in `currency`.
 */
export default function FlowBars({ months, currency }: { months: Month[]; currency: string }) {
  // The latest month with any movement is read out first; the bars are only
  // dimmed once the user picks one, so the chart opens at full colour.
  const lastActive = months.findLastIndex((m) => m.inflow > 0 || m.outflow > 0);
  const [active, setActive] = useState(lastActive >= 0 ? lastActive : months.length - 1);
  const [picked, setPicked] = useState(false);
  const pick = (i: number) => {
    setActive(i);
    setPicked(true);
  };

  if (!months.length) return null;
  const max = Math.max(...months.map((m) => Math.max(m.inflow, m.outflow)), 1);
  const cur = months[Math.min(active, months.length - 1)];
  const net = cur.inflow - cur.outflow;

  return (
    <div className="mny-bars">
      <div className="mny-bars-read" aria-live="polite">
        <b>{cur.label}</b>
        <span className="mny-bars-key" data-kind="in">
          درآمد <span className="num" dir="rtl">{formatMoney(cur.inflow, currency)}</span>
        </span>
        <span className="mny-bars-key" data-kind="out">
          هزینه <span className="num" dir="rtl">{formatMoney(cur.outflow, currency)}</span>
        </span>
        <span className="mny-bars-net" data-sign={net > 0 ? 1 : net < 0 ? -1 : 0}>
          خالص <span className="num" dir="rtl">{formatMoney(net, currency)}</span>
        </span>
      </div>
      {/* An RTL strip opens scrolled to its start, so listing the months newest
          first puts the latest month in view on a phone with no script — and
          on screen it still reads oldest → newest from left to right. */}
      <div className="mny-bars-scroll" dir="rtl">
        <div className="mny-bars-plot" role="group" aria-label="درآمد و هزینهٔ ماهانه" data-picked={picked || undefined}>
          {months
            .map((m, i) => ({ m, i }))
            .reverse()
            .map(({ m, i }) => (
              <button
                key={`${m.label}-${i}`}
                type="button"
                className="mny-bars-col"
                aria-pressed={i === active}
                aria-label={`${m.label}: درآمد ${formatMoney(m.inflow, currency)}، هزینه ${formatMoney(m.outflow, currency)}`}
                onClick={() => pick(i)}
                onMouseEnter={() => pick(i)}
                onFocus={() => pick(i)}
              >
                <span className="mny-bars-pair" dir="ltr">
                  <i data-kind="in" style={{ height: `${(m.inflow / max) * 100}%` }} />
                  <i data-kind="out" style={{ height: `${(m.outflow / max) * 100}%` }} />
                </span>
                <span className="mny-bars-label">{m.label}</span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
