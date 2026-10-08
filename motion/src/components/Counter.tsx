import type { CSSProperties } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { clamp, ease, timing } from "../design/motion";
import { faNumber } from "../design/persian";
import { color, font, weight } from "../design/tokens";

/**
 * Animated amount. Counts from `from` to `to` with an expo ease, in Persian
 * digits, with the unit set smaller beside it. A short glow marks the moment
 * the value lands.
 */
export function Counter({
  to,
  from = 0,
  delay = 0,
  duration = timing.count,
  decimals = 0,
  unit,
  size = 120,
  tint = color.text,
  glow,
  style,
}: {
  to: number;
  from?: number;
  delay?: number;
  duration?: number;
  decimals?: number;
  unit?: string;
  size?: number;
  tint?: string;
  glow?: string;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [delay, delay + duration], [0, 1], { ...clamp, easing: ease.enter });
  const value = from + (to - from) * t;
  const land = interpolate(frame, [delay + duration * 0.7, delay + duration, delay + duration + 18], [0, 1, 0], clamp);
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: size * 0.16, color: tint, ...style }}>
      <span style={{ ...font.numeric, fontSize: size, fontWeight: weight.bold, lineHeight: 1.1, whiteSpace: "nowrap", textShadow: glow ? `0 0 ${24 + land * 40}px ${glow}${land > 0.01 ? "88" : "33"}` : undefined }}>
        {faNumber(value, decimals)}
      </span>
      {unit && <span style={{ fontSize: Math.max(32, size * 0.32), fontWeight: weight.medium, color: color.text2 }}>{unit}</span>}
    </span>
  );
}
