import type { CSSProperties } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";
import { D, Decimal } from "@/domain/decimal";
import { formatMoney, formatSignedMoney, trendTone, toneColor } from "@/lib/format";
import type { AssetValuation } from "@/features/portfolio/types";

/**
 * کادر «ارزش‌گذاری دارایی‌ها» — the one summary every asset view opens with.
 *
 * Each group states its figure once in Toman (primary) and once in USD
 * (secondary). No figure is shown as a primary amount with a hidden «≈» twin.
 *
 * READ MODEL ONLY. Nothing is re-priced here: each figure is summed from the
 * very same `AssetValuation` rows the holdings table shows, so the box can
 * never disagree with the table below it — the Toman triple is Toman-canonical
 * (`value = cost + P&L` holds by construction), and the USD triple is the
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

/**
 * One figure. Its per-currency label («ارزش روز تومانی») stays in the markup for
 * screen readers; on screen the group title names the figure and the amount
 * names its own currency («… تومان» / «… دلار»), so the label is not printed a
 * second time.
 */
function Measure({
  label,
  value,
  tone,
  primary,
}: {
  label: string;
  value: string;
  tone?: string;
  primary: boolean;
}) {
  return (
    <div className={primary ? "valuation-measure is-primary" : "valuation-measure"}>
      <span className="sr-only">{label}</span>
      <span className="num valuation-measure-value money-nowrap" dir="rtl" style={{ ...(tone ? { color: tone } : {}), "--valuation-chars": Math.max(1, value.replace(/[\u2066-\u2069]/g, "").length) } as CSSProperties}>
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
  title?: string;
  hint?: string;
  showTitle?: boolean;
  className?: string;
  /**
   * One more figure rendered in the SAME style as the three core ones (e.g.
   * «سود/زیان تحقق‌یافته»). `toman` is optional: a figure whose Toman is not
   * canonical is stated in the one currency that IS authoritative for it.
   */
  extra?: { name: string; toman?: string | null; usd: string; signed?: boolean };
}) {
  // Each currency is coloured by its OWN sign: a Toman gain beside a USD loss
  // is green then red, never both green.
  const toneOf = (value: string | number) => toneColor(trendTone(value));
  const groups: {
    name: string;
    icon: IconName;
    lines: { label: string; value: string; tone?: string }[];
  }[] = [
    {
      name: "ارزش روز سبد",
      icon: "portfolio",
      lines: [
        { label: "ارزش روز تومانی", value: formatMoney(totals.valueToman, "IRT") },
        { label: "ارزش روز دلاری", value: formatMoney(totals.valueUsd, "USD") },
      ],
    },
    {
      name: "بهای تمام‌شده",
      icon: "coins",
      lines: [
        { label: "بهای تمام‌شده تومانی", value: formatMoney(totals.costToman, "IRT") },
        { label: "بهای تمام‌شده دلاری", value: formatMoney(totals.costUsd, "USD") },
      ],
    },
    {
      name: "سود / زیان تحقق‌نیافته",
      icon: D(totals.pnlToman).isNegative() ? "trend-down" : "trend-up",
      lines: [
        { label: "سود/زیان تحقق‌نیافته تومانی", value: formatSignedMoney(totals.pnlToman, "IRT"), tone: toneOf(totals.pnlToman) },
        { label: "سود/زیان تحقق‌نیافته دلاری", value: formatSignedMoney(totals.pnlUsd, "USD"), tone: toneOf(totals.pnlUsd) },
      ],
    },
  ];

  if (extra) {
    const fmt = (value: string, currency: "IRT" | "USD") =>
      extra.signed ? formatSignedMoney(value, currency) : formatMoney(value, currency);
    const lineTone = (value: string) => (extra.signed ? toneOf(value) : toneOf(0));
    groups.push({
      name: extra.name,
      icon: "check-circle",
      lines: [
        ...(extra.toman != null ? [{ label: `${extra.name} تومانی`, value: fmt(extra.toman, "IRT"), tone: lineTone(extra.toman) }] : []),
        { label: `${extra.name} دلاری`, value: fmt(extra.usd, "USD"), tone: lineTone(extra.usd) },
      ],
    });
  }

  // The page's lead figure on the ink stage, the rest as stat cards beside it
  // (one shared StatCard look across the money, asset and obligation pages).
  return (
    <section className={`mny-valuation ${className}`} aria-label={title}>
      {showTitle && hint && <p className="mny-valuation-hint">{hint}</p>}
      <div className="mny-stats" style={{ ["--mny-cols" as string]: groups.length + 1 } as CSSProperties}>
        {groups.map((g, i) => (
          <div
            key={g.name}
            className={i === 0 ? "mny-stat ink-stage mny-stat-lead" : "mny-stat"}
            data-tone={i === 0 ? "ink" : "plain"}
          >
            <div className="mny-stat-head">
              <span className="mny-stat-icon" aria-hidden="true">
                <Icon name={g.icon} size={15} />
              </span>
              <div className="min-w-0">
                <h3 className="mny-stat-label">{g.name}</h3>
                {i === 0 && showTitle && <p className="mny-stat-period">{title}</p>}
              </div>
            </div>
            <div className="mny-valuation-lines">
              {g.lines.map((l, j) => (
                <Measure key={l.label} label={l.label} value={l.value} tone={l.tone} primary={j === 0} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
