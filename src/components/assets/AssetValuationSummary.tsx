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

/**
 * One figure of a valuation group.
 *
 * LAYOUT (the fix): the label and the amount are STACKED, never squeezed onto
 * one baseline. The previous side-by-side row put a long Persian label
 * («سود/زیان تحقق‌نیافته تومانی») and a long Persian-digit amount
 * («+۷٬۰۵۸٬۴۱۵٬۱۸۹ تومان») on the same 10px line, so on a phone the two
 * collided and the whole box read as one unbroken run of text. Stacking gives
 * every amount its own line, its own breathing room, and a readable size.
 */
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
    <div className="valuation-measure">
      <span className="valuation-measure-label">{label}</span>
      <span
        className="num valuation-measure-value money-nowrap"
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
    <div className={`card valuation-summary p-4 sm:p-5 ${className}`}>
      {showTitle && (
        <header className="valuation-summary-header">
          <h3 className="valuation-summary-title">
            <span style={{ color: "var(--brand)" }}>
              <Icon name="coins" size={15} />
            </span>
            {title}
          </h3>
          {hint && <p className="valuation-summary-hint">{hint}</p>}
        </header>
      )}
      {/* One column on a phone, two on a tablet, one per group on a desktop —
          each group is a self-contained tile with its own border and padding,
          so groups can never visually run into each other. */}
      <div
        className={`valuation-grid ${
          groups.length >= 4 ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3"
        }`}
      >
        {groups.map((g) => (
          <section key={g.name} className="valuation-group">
            <h4 className="valuation-group-title">{g.name}</h4>
            <div className="valuation-group-lines">
              {g.lines.map((l) => (
                <Measure key={l.label} label={l.label} value={l.value} tone={l.tone} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
