import { interpolate, useCurrentFrame } from "remotion";
import { color, font, weight } from "../design/tokens";
import { clamp, ease } from "../design/motion";

/**
 * The Tavazon scale glyph (same geometry as src/components/layout/BrandMark).
 * `draw` animates it: the column rises, the beam extends, the pans settle level.
 */
export function BrandGlyph({ size = 64, tint = color.text, draw }: { size?: number; tint?: string; draw?: { start: number } }) {
  const frame = useCurrentFrame();
  const t = (from: number, len: number) =>
    draw ? interpolate(frame, [draw.start + from, draw.start + from + len], [0, 1], { ...clamp, easing: ease.enter }) : 1;
  const column = t(0, 14);
  const beam = t(8, 16);
  const pans = t(18, 14);
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" style={{ overflow: "visible" }}>
      <path d="M32 46 V12" stroke={tint} strokeWidth="4" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - column} />
      <path d="M22 46 h20" stroke={tint} strokeWidth="4" strokeLinecap="round" opacity={column} />
      <g transform={`translate(32 18) scale(${beam} 1) translate(-32 -18)`}>
        <path d="M14 18 H50" stroke={tint} strokeWidth="4" strokeLinecap="round" />
      </g>
      <g opacity={pans} transform={`translate(0 ${(1 - pans) * -8})`}>
        <path d="M6 24 a10 10 0 0 0 20 0 z" fill={tint} />
        <path d="M38 24 a10 10 0 0 0 20 0 z" fill={tint} />
      </g>
    </svg>
  );
}

export function BrandLockup({ size = 56, tint = color.text, subtitle }: { size?: number; tint?: string; subtitle?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.34, color: tint }}>
      <BrandGlyph size={size} tint={tint} />
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
        <span style={{ fontFamily: font.sans, fontWeight: weight.bold, fontSize: size * 0.72 }}>توازن</span>
        {subtitle && <span style={{ fontSize: size * 0.36, color: color.text2, fontWeight: weight.medium }}>{subtitle}</span>}
      </div>
    </div>
  );
}
