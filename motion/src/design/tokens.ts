/**
 * Tavazon motion design system — the fixed visual identity of every video.
 *
 * Values mirror the product's dark ("ink") token set in src/app/globals.css so
 * films read as the same product as the landing hero. Change them here only
 * when the brand itself changes; a new video never edits this file.
 */

export const canvas = { width: 1920, height: 1080, fps: 30 } as const;

export const color = {
  // Ink surfaces, deepest first.
  ink950: "#050b14",
  ink900: "#0d1726",
  ink800: "#142235",
  ink700: "#1b2c42",
  // Text on ink.
  text: "#e6ecf2",
  text2: "#a4b2c0",
  text3: "#7d8b99",
  line: "rgba(230,236,242,.10)",
  lineStrong: "rgba(230,236,242,.20)",
  // Signal colours: mint is the brand accent, voltage is a rare highlight.
  mint: "#31f2bf",
  mintDeep: "#2bd3a8",
  voltage: "#e4ff33",
  // Meaning.
  positive: "#34d399",
  negative: "#f87171",
  warning: "#fbbf24",
  // Asset classes (from the product's --lc-* dark inks).
  gold: "#fbbf24",
  sky: "#60a5fa",
  violet: "#a78bfa",
  teal: "#2dd4bf",
} as const;

export type Tone = "mint" | "positive" | "negative" | "warning" | "gold" | "sky" | "violet" | "teal" | "text";
export const toneColor = (tone: Tone = "text") => (tone === "text" ? color.text : color[tone]);

export const font = {
  sans: "Vazirmatn, system-ui, sans-serif",
  // Persian digits come from Vazirmatn; tabular figures keep counters still.
  numeric: { fontFeatureSettings: '"tnum" 1, "ss01" 1', fontVariantNumeric: "tabular-nums" } as const,
} as const;

/** Type scale in source pixels (1920 wide). Smallest readable label is `label`. */
export const type = {
  display: 176,
  hero: 128,
  h1: 96,
  h2: 72,
  title: 60,
  body: 48,
  label: 40,
  caption: 32,
} as const;

export const weight = { regular: 400, medium: 500, semibold: 600, bold: 700 } as const;

export const space = { xs: 8, sm: 16, md: 24, lg: 40, xl: 64, xxl: 96, safeX: 132, safeY: 112 } as const;
export const radius = { sm: 14, md: 24, lg: 36, pill: 999 } as const;

export const shadow = {
  card: "0 40px 80px rgba(2,6,12,.55), 0 12px 24px rgba(2,6,12,.35), inset 0 1px 0 rgba(255,255,255,.06)",
  glow: (hex: string, strength = 0.45) => `0 0 48px ${hex}${Math.round(strength * 255).toString(16).padStart(2, "0")}`,
} as const;

export const glass = {
  background: "linear-gradient(160deg, rgba(27,44,66,.86) 0%, rgba(20,34,53,.78) 100%)",
  border: `1.5px solid ${color.line}`,
  blur: "blur(24px)",
} as const;
