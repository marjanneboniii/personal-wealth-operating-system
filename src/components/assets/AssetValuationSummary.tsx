import { D, Decimal } from "@/domain/decimal";
import { formatMoney, formatSignedMoney, trendTone, toneColor } from "@/lib/format";
import Icon from "@/components/ui/Icon";
import type { AssetValuation } from "@/features/portfolio/types";

/**
 * کادر «ارزش‌گذاری دارایی‌ها» — the valuation box of the summary status card.
 *
 * Every one of the four asset views («همه دارایی‌ها», «دارایی‌های مالی»,
 * «دارایی‌های واقعی», «سبد دارایی») renders this same box, so a figure is
 * stated in ONE currency per line and never as a primary amount with a hidden
 * «≈» equivalent:
 *
 *   ارزش روز سبد      → ارزش روز تومانی · ارزش روز دلاری
 *   بهای تمام‌شده      → بهای تمام‌شده تومانی · بهای تمام‌شده دلاری
 *   سود/زیان تحقق‌نیافته → تومانی · دلاری
 *
 * READ MODEL ONLY. Nothing is re-priced here: each figure is summed from the
 * very same `AssetValuation` rows the holdings table shows, so the box can
 * never disagree with the table below it — the Toman triple is Toman-canonical
 * (`value = cost + P&L` holds by construction, see the presentation-layer
 * consistency pass in `getPortfolioValuation`), and the USD triple is the
 * frozen ledger/market USD figure, never a Toman amount re-scaled at today's
 * rate.
 */

export type AssetValuationTotals = {
  valueToman: string;
  valueUsd: string;
  costToman: string;
  costUsd: string;
  pnlToman: string;
  pnlUsd: string;
};

/** Σ of the read model's per-asset figures — the totals of one asset view. */
export function valuationTotalsOf(rows: AssetValuation[]): AssetValuationTotals {
  const valueToman = rows.reduce((s, r) => s.add(D(r.currentValueToman)), Decimal.zero());
  const valueUsd = rows.reduce((s, r) => s.add(D(r.currentValue)), Decimal.zero());
  const costToman = rows.reduce((s, r) => s.add(D(r.costBasisToman ?? r.currentValueToman)), Decimal.zero());
  const costUsd = rows.reduce((s, r) => s.add(D(r.costBasis)), Decimal.zero());
  const pnlToman = rows.reduce((s, r) => s.add(D(r.unrealizedPnlToman)), Decimal.zero());
  const pnlUsd = rows.reduce((s, r) => s.add(D(r.unrealizedPnl)), Decimal.zero());
  return {
    valueToman: valueToman.toFixed(0),
    valueUsd: valueUsd.toString(),
    costToman: costToman.toFixed(0),
    costUsd: costUsd.toString(),
    pnlToman: pnlToman.toFixed(0),
    pnlUsd: pnlUsd.toString(),
  };
}

function Measure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2 border-b py-1.5 last:border-b-0" style={{ borderColor: "var(--border)" }}>
      <span className="muted min-w-0 shrink-0 text-[10px] leading-5 sm:text-[10.5px]">{label}</span>
      <span
        className="num min-w-0 text-[11.5px] font-bold leading-5 money-nowrap sm:text-[12.5px]"
        dir="rtl"
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

export default function AssetValuationSummary({
  totals,
  title = "ارزش‌گذاری دارایی‌ها",
  hint,
  showTitle = true,
  className = "",
  extra,
}: {
  totals: AssetValuationTotals;
  /** Title of the box. «سبد دارایی» already titles the section around it. */
  title?: string;
  hint?: string;
  showTitle?: boolean;
  className?: string;
  /**
   * One more figure rendered in the SAME style as the three core ones, so a
   * view can complete its summary card (e.g. «سود/زیان تحقق‌یافته» on
   * «سبد دارایی») without a second, differently formatted metric floating
   * beside it. `toman` is optional: a figure whose Toman is not canonical is
   * stated in the one currency that IS authoritative for it.
   */
  extra?: { name: string; toman?: string | null; usd: string; signed?: boolean };
}) {
  const pnlTone = trendTone(totals.pnlToman);
  const groups: {
    name: string;
    lines: { label: string; value: string; tone?: string }[];
  }[] = [
    {
      name: "ارزش روز سبد",
      lines: [
        { label: "ارزش روز تومانی", value: formatMoney(totals.valueToman, "IRT") },
        { label: "ارزش روز دلاری", value: formatMoney(totals.valueUsd, "USD") },
      ],
    },
    {
      name: "بهای تمام‌شده",
      lines: [
        { label: "بهای تمام‌شده تومانی", value: formatMoney(totals.costToman, "IRT") },
        { label: "بهای تمام‌شده دلاری", value: formatMoney(totals.costUsd, "USD") },
      ],
    },
    {
      name: "سود / زیان تحقق‌نیافته",
      lines: [
        {
          label: "سود/زیان تحقق‌نیافته تومانی",
          value: formatSignedMoney(totals.pnlToman, "IRT"),
          tone: toneColor(pnlTone),
        },
        {
          label: "سود/زیان تحقق‌نیافته دلاری",
          value: formatSignedMoney(totals.pnlUsd, "USD"),
          tone: toneColor(pnlTone),
        },
      ],
    },
  ];

  if (extra) {
    const extraTone = trendTone(extra.signed ? (extra.toman ?? extra.usd) : 0);
    const fmt = (value: string, currency: "IRT" | "USD") =>
      extra.signed ? formatSignedMoney(value, currency) : formatMoney(value, currency);
    groups.push({
      name: extra.name,
      lines: [
        ...(extra.toman != null
          ? [{ label: `${extra.name} تومانی`, value: fmt(extra.toman, "IRT"), tone: toneColor(extraTone) }]
          : []),
        { label: `${extra.name} دلاری`, value: fmt(extra.usd, "USD"), tone: toneColor(extraTone) },
      ],
    });
  }

  return (
    <div className={`card p-3.5 sm:p-4 ${className}`}>
      {showTitle && (
        <header className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold tracking-tight sm:text-[13px]">
              <span style={{ color: "var(--brand)" }}>
                <Icon name="coins" size={14} />
              </span>
              {title}
            </h3>
            {hint && <p className="muted mt-0.5 text-[10.5px] leading-5">{hint}</p>}
          </div>
        </header>
      )}
      <div className={`grid gap-x-6 gap-y-3 ${groups.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"}`}>
        {groups.map((g) => (
          <div key={g.name} className="min-w-0">
            <p className="muted mb-1 text-[10px] font-medium sm:text-[10.5px]">{g.name}</p>
            <div>
              {g.lines.map((l) => (
                <Measure key={l.label} label={l.label} value={l.value} tone={l.tone} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
