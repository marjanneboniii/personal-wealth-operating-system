import { interpolate, useCurrentFrame } from "remotion";
import { clamp, ease, stagger, timing } from "../design/motion";
import { faPercent } from "../design/persian";
import { color, radius, toneColor, type Tone, type as typeScale, weight } from "../design/tokens";

/** Horizontal meter. Fills from the right (RTL) with a glowing head. */
export function Meter({ value, delay = 0, tone = "mint", height = 28 }: { value: number; delay?: number; tone?: Tone; height?: number }) {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [delay, delay + timing.count], [0, value], { ...clamp, easing: ease.enter });
  const tint = toneColor(tone);
  return (
    <div style={{ position: "relative", height, borderRadius: radius.pill, background: "rgba(230,236,242,.08)", overflow: "hidden" }}>
      <div style={{ position: "absolute", insetBlock: 0, right: 0, width: `${p * 100}%`, borderRadius: radius.pill, background: `linear-gradient(270deg, ${tint}99, ${tint})`, boxShadow: `0 0 28px ${tint}88` }} />
      <div style={{ position: "absolute", insetBlock: 0, right: `calc(${p * 100}% - ${height}px)`, width: height, borderRadius: "50%", background: "#fff", opacity: p > 0.02 ? 0.85 : 0, filter: "blur(6px)" }} />
    </div>
  );
}

export type Segment = { label: string; share: number; tone: Tone };

/** Donut that draws its segments one after another, starting at 12 o'clock and running counter-clockwise (RTL). */
export function Donut({ segments, delay = 0, size = 420, thickness = 46 }: { segments: Segment[]; delay?: number; size?: number; thickness?: number }) {
  const frame = useCurrentFrame();
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const gap = 0.012;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: "visible", transform: "scaleX(-1) rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(230,236,242,.06)" strokeWidth={thickness} fill="none" />
      {segments.map((s, i) => {
        const start = offset;
        offset += s.share;
        const drawn = interpolate(frame, [delay + i * 8, delay + i * 8 + 26], [0, 1], { ...clamp, easing: ease.enter });
        const length = Math.max(0, s.share - gap) * drawn;
        const tint = toneColor(s.tone);
        return (
          <circle key={s.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tint} strokeWidth={thickness} strokeLinecap="butt"
            strokeDasharray={`${length * c} ${c}`} strokeDashoffset={-start * c} style={{ filter: `drop-shadow(0 0 14px ${tint}66)` }} />
        );
      })}
    </svg>
  );
}

/** Whole percentages that always add up to 100 (largest remainder). */
function wholePercents(shares: number[]) {
  const raw = shares.map((s) => s * 100);
  const out = raw.map(Math.floor);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  const missing = 100 - out.reduce((a, b) => a + b, 0);
  for (let k = 0; k < missing; k++) out[order[k % order.length][1]]++;
  return out;
}

export function Legend({ segments, delay = 0 }: { segments: Segment[]; delay?: number }) {
  const frame = useCurrentFrame();
  const percents = wholePercents(segments.map((s) => s.share));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {segments.map((s, i) => {
        const p = interpolate(frame, [delay + stagger(i), delay + stagger(i) + timing.enter], [0, 1], { ...clamp, easing: ease.enter });
        return (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 22, opacity: p, transform: `translateX(${(1 - p) * 30}px)` }}>
            <span style={{ width: 22, height: 22, borderRadius: 6, background: toneColor(s.tone), boxShadow: `0 0 16px ${toneColor(s.tone)}88` }} />
            <span style={{ fontSize: typeScale.body, color: color.text, fontWeight: weight.medium, minWidth: 160 }}>{s.label}</span>
            <span style={{ fontSize: typeScale.body, color: color.text2, fontWeight: weight.semibold }}>{faPercent(percents[i])}</span>
          </div>
        );
      })}
    </div>
  );
}
