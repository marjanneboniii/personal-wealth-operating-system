import type { CSSProperties, ReactNode } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, springs, stagger, timing, useEnter } from "../design/motion";
import { parseEmphasis } from "../design/persian";
import { color, font, type, weight } from "../design/tokens";

export function Eyebrow({ children, delay = 0, tint = color.mint }: { children: ReactNode; delay?: number; tint?: string }) {
  const { style, p } = useEnter(delay, 18);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, ...style }}>
      <span style={{ width: 56 * p, height: 4, borderRadius: 4, background: tint, boxShadow: `0 0 18px ${tint}` }} />
      <span style={{ fontSize: type.label, fontWeight: weight.semibold, color: tint }}>{children}</span>
    </div>
  );
}

/**
 * Word-by-word headline. Each word rises out of a mask; *starred* words take
 * the accent. Words flow right-to-left because the stage is dir="rtl".
 */
export function Headline({ text, delay = 0, size = type.h1, accent = color.mint, style }: { text: string; delay?: number; size?: number; accent?: string; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = parseEmphasis(text);
  return (
    <h1 style={{ margin: 0, display: "flex", flexWrap: "wrap", columnGap: size * 0.26, rowGap: 0, fontSize: size, lineHeight: 1.55, fontWeight: weight.bold, color: color.text, ...style }}>
      {words.map((word, i) => {
        const p = spring({ frame: frame - delay - stagger(i), fps, config: springs.settle, durationInFrames: timing.enter });
        return (
          // Whole words only (letter boxes break joins); 0.5em slack keeps dots and گ inside the mask.
          <span key={i} style={{ display: "inline-block", whiteSpace: "nowrap", overflow: "hidden", padding: "0.5em 0.06em", margin: "-0.5em -0.06em" }}>
            <span style={{ display: "inline-block", transform: `translateY(${(1 - p) * 105}%)`, opacity: interpolate(p, [0, 0.3], [0, 1], clamp), color: word.accent ? accent : undefined, textShadow: word.accent ? `0 0 42px ${accent}55` : undefined }}>
              {word.text}
            </span>
          </span>
        );
      })}
    </h1>
  );
}

export function Body({ children, delay = 0, size = type.body, tint = color.text2, style }: { children: ReactNode; delay?: number; size?: number; tint?: string; style?: CSSProperties }) {
  const { style: enter } = useEnter(delay, 20);
  return <p style={{ margin: 0, fontSize: size, lineHeight: 1.6, color: tint, fontWeight: weight.medium, ...enter, ...style }}>{children}</p>;
}

export const numeric: CSSProperties = { ...font.numeric, whiteSpace: "nowrap" };
