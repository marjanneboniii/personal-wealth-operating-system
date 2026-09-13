import { formatPct } from "@/lib/format";

export type AllocationSlice = {
  key: string;
  label: string;
  /** Share of the whole, 0–100. */
  percent: number;
  /** Already-formatted amount (Toman-canonical). */
  value: string;
  color: string;
};

const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0);

/** One stacked bar and its legend — the composition of an asset view at a glance. */
export default function AllocationBar({ slices, label }: { slices: AllocationSlice[]; label: string }) {
  return (
    <div className="card alloc">
      <div className="alloc-bar" role="img" aria-label={label}>
        {slices.map((s) => (
          <span key={s.key} style={{ width: `${clamp(s.percent)}%`, background: s.color }} />
        ))}
      </div>
      <ul className="alloc-legend">
        {slices.map((s) => (
          <li key={s.key} className="alloc-row">
            <span className="flex min-w-0 items-center gap-2">
              <i className="alloc-dot" style={{ background: s.color }} aria-hidden="true" />
              <span className="truncate text-[length:var(--fs-sm)]">{s.label}</span>
            </span>
            <span className="flex shrink-0 items-baseline gap-3">
              <span className="num money-nowrap text-[length:var(--fs-sm)] font-semibold" dir="rtl">
                {s.value}
              </span>
              <span className="muted num w-12 text-left text-[length:var(--fs-xs)]" dir="rtl">
                {formatPct(clamp(s.percent), 1)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
