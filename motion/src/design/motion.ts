/**
 * Motion language: calm, precise, weighty.
 *
 * - One camera. Scenes sit on one strip and the camera whip-pans between them
 *   (RTL: the next scene is to the left, so content travels right). Never a
 *   scene-to-scene crossfade.
 * - Entrances decelerate long (expo out, ~20 frames); exits accelerate short
 *   (~8 frames) and travel only ~70% as far.
 * - One lead element, the rest 2–4 frames behind on a curve.
 * - No overshoot on text; under 2% on UI.
 * - Everything sits on a 120 BPM grid: a beat is 15 frames, a bar 60.
 */
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const ease = {
  /** Product ease (--ease in globals.css), for small UI changes. */
  brand: Easing.bezier(0.22, 0.61, 0.36, 1),
  /** Entrances, counters, bars. */
  enter: Easing.bezier(0.16, 1, 0.3, 1),
  /** Exits: quick and decisive. */
  exit: Easing.bezier(0.7, 0, 0.84, 0),
  /** Camera whip: slow wind-up, fastest at the cut, long settle. */
  whip: Easing.bezier(0.55, 0, 0.45, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
} as const;

export const springs = {
  /** Text and panels: critically damped, no overshoot. */
  settle: { damping: 200, stiffness: 120, mass: 1 },
  /** UI hits (buttons, badges): ~1.5% overshoot. */
  ui: { stiffness: 100, damping: 16, mass: 1 },
  /** Fast settle (~0.25s) for presses. */
  snap: { stiffness: 350, damping: 32, mass: 1 },
} as const;

export const BPM = 120;
export const beat = (fps: number) => (fps * 60) / BPM;

/** Timings in frames at 30fps. */
export const timing = {
  beat: 15,
  bar: 60,
  enter: 20,
  exit: 8,
  stagger: 3,
  count: 40,
  /** Whole whip-pan length, centred on the scene boundary. */
  whip: 20,
  /** Content starts building while the camera settles. */
  lead: 4,
} as const;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const progress = (frame: number, start: number, length: number, easing = ease.enter) =>
  interpolate(frame, [start, start + length], [0, 1], { ...clamp, easing });

/** Stagger on a curve: later items crowd closer, so the group lands together. */
export const stagger = (index: number, base: number = timing.stagger) => Math.round(base * index * (1 - index * 0.06));

/** Entrance values for an element appearing `delay` frames into its scene. */
export function useEnter(delay = 0, distance = 36) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: springs.settle, durationInFrames: timing.enter });
  return {
    p,
    style: {
      opacity: interpolate(p, [0, 0.5], [0, 1], clamp),
      transform: `translateY(${(1 - p) * distance}px)`,
      filter: p < 0.995 ? `blur(${(1 - p) * 12}px)` : undefined,
    },
  } as const;
}

export { clamp };
