/**
 * A progress ring for «پوشش داده» — how complete and current the books are.
 * Pure SVG, no client code; the number is also in text for screen readers.
 */
export default function CoverageRing({ percent, size = 44 }: { percent: number; size?: number }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  const color = p >= 100 ? "var(--positive)" : p >= 60 ? "var(--action)" : "var(--warning)";
  return (
    <span className="coverage-ring" style={{ width: size, height: size }} role="img" aria-label={`پوشش داده ${p.toLocaleString("fa-IR")} درصد`}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sunken)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(c * p) / 100} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="coverage-ring-value num" aria-hidden="true">
        {p.toLocaleString("fa-IR")}
      </span>
    </span>
  );
}
