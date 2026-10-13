import { formatPct } from "@/lib/format";

/**
 * How one whole divides — a single bar in proportional blocks with a named
 * legend under it («تومانی ۵۳٪ · ارزی ۴۷٪»). Shares are percentages the
 * caller computed; the bar only draws them.
 */
export default function SplitBar({
  parts,
  label,
}: {
  parts: { key: string; label: string; share: number; color: string; value?: string }[];
  label: string;
}) {
  const shown = parts.filter((p) => p.share > 0);
  if (shown.length === 0) return null;
  return (
    <div className="mny-split">
      <div className="mny-split-bar" role="img" aria-label={label}>
        {shown.map((p) => (
          <i key={p.key} style={{ flexGrow: Math.max(p.share, 1.5), background: p.color }} />
        ))}
      </div>
      <ul className="mny-split-legend">
        {shown.map((p) => (
          <li key={p.key}>
            <span className="mny-split-swatch" style={{ background: p.color }} aria-hidden="true" />
            <span>{p.label}</span>
            <b className="num">{p.value ?? formatPct(Math.round(p.share), 0)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
