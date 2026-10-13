import type { ReactNode } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";

export type StatDelta = { text: string; tone: "up" | "down" | "flat" };

/**
 * One headline figure, PaceUI «Stat» style: a small icon chip and label on
 * top, the figure, then an optional change pill, a bar and a footer line.
 *
 * Every money page uses this one block for its figures, so «موجودی کل»,
 * «درآمد این ماه» and «اصل سپرده‌ها» read the same way everywhere.
 *
 * `tone="ink"` puts the card on the ink stage (the dark token set shared with
 * the dashboard's net-worth figure) — one per page, for its lead number.
 * Values arrive already formatted: this component never formats money.
 */
export default function StatCard({
  label,
  value,
  icon,
  period,
  delta,
  hint,
  tone = "plain",
  bar,
  footer,
  className = "",
}: {
  label: string;
  value: ReactNode;
  icon?: IconName;
  /** «مهر ۱۴۰۵», «۱۲ ماه اخیر» — the span the figure covers. */
  period?: string;
  delta?: StatDelta | null;
  hint?: ReactNode;
  tone?: "plain" | "ink" | "positive" | "negative";
  /** A Progress / SplitBar under the figure. */
  bar?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mny-stat${tone === "ink" ? " ink-stage" : ""} ${className}`} data-tone={tone}>
      <div className="mny-stat-head">
        {icon && (
          <span className="mny-stat-icon" aria-hidden="true">
            <Icon name={icon} size={15} />
          </span>
        )}
        <div className="min-w-0">
          <p className="mny-stat-label">{label}</p>
          {period && <p className="mny-stat-period">{period}</p>}
        </div>
      </div>
      <div className="mny-stat-value" dir="rtl">
        {value}
      </div>
      {(delta || hint) && (
        <div className="mny-stat-meta">
          {delta && (
            <span className="mny-delta" data-tone={delta.tone}>
              {delta.text}
            </span>
          )}
          {hint && <span className="mny-stat-hint">{hint}</span>}
        </div>
      )}
      {bar}
      {footer && <div className="mny-stat-foot">{footer}</div>}
    </div>
  );
}
