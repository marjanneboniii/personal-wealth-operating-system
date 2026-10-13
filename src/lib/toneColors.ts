/**
 * Text on a coloured fill — one rule for every hue the app paints with
 * (transaction types, expense categories, budget templates):
 *
 *   --x        the vivid hue, untouched: icons, tiles, borders, rings, bars
 *   --x-solid  the fill behind text (a button, a chosen chip)
 *   --x-on     the text on that fill
 *
 * A hue that white text almost reads on (≥ 3.6:1) is deepened just enough to
 * reach AA, which the eye hardly sees on red and pink. A bright hue (orange,
 * teal, gold, sky) keeps its fill and takes navy text instead, so it stays
 * bright. Either way the pair clears WCAG AA (4.5:1) for small text.
 */

export const INK_ON_LIGHT = "#0d1726";
const WHITE = "#ffffff";
const AA = 4.5;
/** A little above AA, so rounding never drops a pair below it. */
const TARGET = 4.6;
/** White this close to AA is reached by deepening the hue, not by navy text. */
const DEEPEN_FROM = 3.6;

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(rgb(a));
  const lb = luminance(rgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const toHex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** The fill and text colour for text drawn on `hex`. */
export function solidFor(hex: string): { solid: string; on: string } {
  const white = contrast(hex, WHITE);
  if (white >= AA) return { solid: hex, on: WHITE };
  if (white < DEEPEN_FROM && contrast(hex, INK_ON_LIGHT) >= AA) return { solid: hex, on: INK_ON_LIGHT };
  const base = rgb(hex);
  for (let k = 1; k > 0; k -= 0.01) {
    const solid = toHex(base.map((v) => v * k));
    if (contrast(solid, WHITE) >= TARGET) return { solid, on: WHITE };
  }
  return { solid: INK_ON_LIGHT, on: WHITE };
}

/** `--tone`, `--tone-solid` and `--tone-on` for an inline style. */
export function toneVars(hex: string): Record<"--tone" | "--tone-solid" | "--tone-on", string> {
  const { solid, on } = solidFor(hex);
  return { "--tone": hex, "--tone-solid": solid, "--tone-on": on };
}
