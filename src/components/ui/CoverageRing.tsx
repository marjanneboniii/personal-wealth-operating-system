/**
 * A progress ring for «پوشش داده» — how complete and current the books are.
 * Pure SVG, no client code; the number is also in text for screen readers.
 *
 * The number is drawn INSIDE the SVG and the box is sized inline, so the ring
 * never depends on a stylesheet rule to keep its figure in the middle — a
 * missing or stale CSS chunk once pushed «۵۰» under the card.
 */
export default function CoverageRing({ percent, size = 44 }: { percent: number; size?: number }) {
  const stroke = Math.max(3, Math.round(size / 11));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const color = p >= 100 ? "var(--positive)" : p >= 60 ? "var(--action)" : "var(--warning)";
  const mid = size / 2;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={`پوشش داده ${p.toLocaleString("fa-IR")} درصد`}
      style={{ display: "block", flexShrink: 0 }}
    >
      <circle cx={mid} cy={mid} r={r} fill="none" stroke="var(--sunken)" strokeWidth={stroke} />
      <circle
        cx={mid}
        cy={mid}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${(c * p) / 100} ${c}`}
        transform={`rotate(-90 ${mid} ${mid})`}
      />
      <text
        x={mid}
        y={mid}
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--text)"
        style={{ fontSize: Math.round(size * 0.28), fontWeight: 700, fontFamily: "inherit" }}
      >
        {p.toLocaleString("fa-IR")}
      </text>
    </svg>
  );
}
