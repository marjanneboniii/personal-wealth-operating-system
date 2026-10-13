import type { ReactNode } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, ease, springs } from "../design/motion";
import { color, radius, toneColor, type Tone, type as typeScale, weight } from "../design/tokens";
import { Icon, type IconName } from "./Icon";

/** Status pill. Pops in on the UI spring. */
export function Chip({ children, icon, tone = "mint", delay = 0 }: { children: ReactNode; icon?: IconName; tone?: Tone; delay?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: springs.ui });
  const tint = toneColor(tone);
  return (
    <div style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 16, padding: "14px 30px", borderRadius: radius.pill, background: `${tint}1a`, border: `1.5px solid ${tint}66`, color: tint, fontSize: typeScale.label, fontWeight: weight.semibold, whiteSpace: "nowrap", opacity: interpolate(p, [0, 0.4], [0, 1], clamp), transform: `scale(${0.93 + p * 0.07})` }}>
      {icon && <Icon name={icon} size={40} stroke={2} />}
      {children}
    </div>
  );
}

/** Success mark: ring draws, check strokes in, one pulse ring expands. */
export function CheckBurst({ delay = 0, size = 132, tone = "positive" }: { delay?: number; size?: number; tone?: Tone }) {
  const frame = useCurrentFrame();
  const tint = toneColor(tone);
  const ring = interpolate(frame, [delay, delay + 16], [0, 1], { ...clamp, easing: ease.enter });
  const tick = interpolate(frame, [delay + 8, delay + 22], [0, 1], { ...clamp, easing: ease.enter });
  const pulse = interpolate(frame, [delay + 12, delay + 40], [0, 1], { ...clamp, easing: ease.enter });
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `3px solid ${tint}`, transform: `scale(${1 + pulse * 0.7})`, opacity: (1 - pulse) * 0.7 }} />
      <svg width={size} height={size} viewBox="0 0 48 48" style={{ filter: `drop-shadow(0 0 18px ${tint}88)` }}>
        <circle cx="24" cy="24" r="21" fill={`${tint}22`} stroke={tint} strokeWidth="2.5" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - ring} transform="rotate(-90 24 24)" />
        <path d="m14.5 24.5 6.5 6.5 13-14" fill="none" stroke={tint} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - tick} />
      </svg>
    </div>
  );
}

/**
 * Primary action that gets pressed at `pressAt`: a touch point travels in on
 * an arc, the button dips on the snap spring and a ripple spreads from the
 * touch. The arrow points to the start side (left in RTL) for "continue".
 */
export function PressButton({ label, delay = 0, pressAt }: { label: string; delay?: number; pressAt: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - delay, fps, config: springs.settle, durationInFrames: 20 });
  const press = spring({ frame: frame - pressAt, fps, config: springs.snap });
  const release = spring({ frame: frame - pressAt - 5, fps, config: springs.snap });
  const dip = press - release;
  const ripple = interpolate(frame, [pressAt, pressAt + 22], [0, 1], { ...clamp, easing: ease.enter });
  const done = frame >= pressAt + 4;
  // Touch point: travels on an arc toward the button, lands at pressAt.
  const travel = interpolate(frame, [pressAt - 22, pressAt], [0, 1], { ...clamp, easing: ease.inOut });
  const touchX = interpolate(travel, [0, 1], [-260, 0]);
  const touchY = interpolate(travel, [0, 1], [220, 0]) - Math.sin(travel * Math.PI) * 80;
  const touchOpacity = interpolate(frame, [pressAt - 22, pressAt - 14, pressAt + 10, pressAt + 18], [0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "relative", opacity: enter, transform: `translateY(${(1 - enter) * 30}px)` }}>
      <div style={{ position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "30px 44px", borderRadius: radius.md, background: done ? color.mint : color.text, color: color.ink900, fontSize: typeScale.title * 0.85, fontWeight: weight.bold, transform: `scale(${1 - dip * 0.04})`, boxShadow: done ? `0 0 60px ${color.mint}66` : "0 20px 40px rgba(0,0,0,.35)" }}>
        <div style={{ position: "absolute", left: "50%", top: "50%", width: 1200, height: 1200, marginLeft: -600, marginTop: -600, borderRadius: "50%", background: "rgba(255,255,255,.5)", transform: `scale(${ripple})`, opacity: (1 - ripple) * (frame >= pressAt ? 1 : 0) }} />
        <span style={{ position: "relative" }}>{label}</span>
        <span style={{ position: "relative", display: "flex" }}>
          <Icon name={done ? "check" : "arrow-start"} size={56} stroke={2.2} />
        </span>
      </div>
      <div style={{ position: "absolute", left: "34%", top: "50%", width: 88, height: 88, margin: -44, borderRadius: "50%", border: `4px solid ${color.text}`, background: "rgba(230,236,242,.18)", boxShadow: "0 10px 30px rgba(0,0,0,.4)", opacity: touchOpacity, transform: `translate(${touchX}px, ${touchY}px) scale(${1 - dip * 0.2})` }} />
    </div>
  );
}
