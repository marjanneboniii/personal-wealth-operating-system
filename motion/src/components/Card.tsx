import type { CSSProperties, ReactNode } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, ease, springs } from "../design/motion";
import { color, glass, radius, shadow, type, weight } from "../design/tokens";

/**
 * Floating glass panel. Enters with a slight 3D tilt that settles flat, then a
 * single light sweep crosses it — the signature "premium tech" beat.
 */
export function GlassCard({ children, delay = 0, width, padding = 56, style, sweep = true }: { children: ReactNode; delay?: number; width?: number; padding?: number; style?: CSSProperties; sweep?: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: springs.settle, durationInFrames: 26 });
  const sweepX = interpolate(frame, [delay + 14, delay + 44], [-60, 160], { ...clamp, easing: ease.inOut });
  const float = Math.sin((frame - delay) / 38) * 6;
  return (
    <div style={{ perspective: 1800, width }}>
      <div
        style={{
          position: "relative",
          padding,
          borderRadius: radius.lg,
          background: glass.background,
          border: glass.border,
          boxShadow: shadow.card,
          backdropFilter: glass.blur,
          overflow: "hidden",
          opacity: interpolate(p, [0, 0.5], [0, 1], clamp),
          transform: `translateY(${(1 - p) * 70 + float}px) rotateX(${(1 - p) * 14}deg) rotateY(${(1 - p) * 10}deg) scale(${0.94 + p * 0.06})`,
          ...style,
        }}
      >
        {/* Top hairline highlight. */}
        <div style={{ position: "absolute", insetInline: 0, top: 0, height: 1.5, background: `linear-gradient(90deg, transparent, ${color.mint}88, transparent)` }} />
        {sweep && (
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: `linear-gradient(105deg, transparent ${sweepX - 18}%, rgba(255,255,255,.07) ${sweepX}%, transparent ${sweepX + 18}%)` }} />
        )}
        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 32 }}>{children}</div>
      </div>
    </div>
  );
}

/** Label / value line inside a card. */
export function Row({ label, children, delay = 0, highlight }: { label: string; children: ReactNode; delay?: number; highlight?: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: springs.settle, durationInFrames: 22 });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 40,
        padding: "22px 32px",
        borderRadius: radius.md,
        background: highlight ? `${highlight}14` : "rgba(230,236,242,.04)",
        border: `1.5px solid ${highlight ? `${highlight}55` : color.line}`,
        opacity: p,
        // RTL: rows enter from the start (right) side.
        transform: `translateX(${(1 - p) * 40}px)`,
      }}
    >
      <span style={{ fontSize: type.label, color: color.text2, fontWeight: weight.medium }}>{label}</span>
      {children}
    </div>
  );
}
