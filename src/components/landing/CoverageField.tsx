"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";

/**
 * The asset kinds توازن can hold, as a band of chips that closes the hero.
 *
 * It is a band of its own, never a field behind the hero copy, so no motion can
 * sit under a sentence: readability is safe by construction.
 *
 * MOTION, in two independent layers:
 *   • CSS (globals.css, .cf-icon): each icon draws itself in once, then plays a
 *     gesture that says what it is (a car drives, a coin turns) as a wave along
 *     the row. Compositor-only, no JavaScript ticks.
 *   • JS (below): a tapped chip pops and nudges its neighbours on a small spring
 *     whose rAF loop exists only while something is moving.
 * `prefers-reduced-motion` stops both.
 *
 * The chips are REAL CONTENT — a labelled list of what the product covers — so
 * nothing here is aria-hidden.
 */

export type CoverageKind = { icon: IconName; label: string; tone: string };

/**
 * Each icon's idle gesture says what the thing does: a car drives (toward the
 * reading start, so left), a coin turns, a house rises, a pie turns, a
 * calendar flips. One gesture per icon, played as a wave along the row.
 */
const GESTURE: Partial<Record<IconName, string>> = {
  accounts: "lift",
  wallet: "tilt",
  crypto: "spin",
  coins: "spin",
  pie: "turn",
  portfolio: "lift",
  home: "lift",
  car: "drive",
  installments: "flip",
};
/** One wave crosses the whole row in this time, then the row rests. */
const WAVE_SECONDS = 9;

/** Spring constants. Stiff enough to feel like a tap, damped enough to settle fast. */
const STIFFNESS = 0.14;
const DAMPING = 0.72;
/** Below this, the eye cannot tell — so the loop stops instead of running forever. */
const REST = 0.12;
/**
 * How much a tapped chip swells. 0.13 peaks near 1.18× and dips to about 0.97×
 * on the rebound. It was 0.22 first, which peaked past 1.30× — on a page about
 * somebody's savings that lands as a cartoon rather than as a response.
 */
const POP = 0.13;
/** How hard a tapped chip shoves the ones beside it, and how far that reaches. */
const IMPULSE = 18;
const NEIGHBOUR_RADIUS = 170;

type Spring = { x: number; y: number; vx: number; vy: number; pop: number; vpop: number };

export default function CoverageField({ kinds }: { kinds: CoverageKind[] }) {
  const rootRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const chips = Array.from(root.querySelectorAll<HTMLElement>(".cf-chip-inner"));
    if (chips.length === 0) return;

    /**
     * Read LIVE, never once at mount. Someone who turns Reduce Motion on while
     * this page is open is asking for the motion to stop now — and they are
     * often turning it on BECAUSE of something moving in front of them. Checked
     * once, the CSS motion obeyed (it is a media query) while the tap spring
     * carried on, which is the half-obeyed state that makes the setting feel
     * broken.
     */
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const springs: Spring[] = chips.map(() => ({ x: 0, y: 0, vx: 0, vy: 0, pop: 0, vpop: 0 }));
    let frame = 0;
    let running = false;

    const tick = () => {
      let alive = false;
      for (let i = 0; i < chips.length; i++) {
        const s = springs[i];
        // Displacement and "pop" are three independent springs pulling to zero.
        s.vx = (s.vx - s.x * STIFFNESS) * DAMPING;
        s.vy = (s.vy - s.y * STIFFNESS) * DAMPING;
        s.vpop = (s.vpop - s.pop * STIFFNESS) * DAMPING;
        s.x += s.vx;
        s.y += s.vy;
        s.pop += s.vpop;

        if (Math.abs(s.x) > REST || Math.abs(s.vx) > REST || Math.abs(s.y) > REST || Math.abs(s.vy) > REST || Math.abs(s.pop) > 0.002 || Math.abs(s.vpop) > 0.002) {
          alive = true;
          chips[i].style.transform = `translate3d(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px, 0) scale(${(1 + s.pop).toFixed(4)})`;
        } else if (s.x !== 0 || s.y !== 0 || s.pop !== 0) {
          // Land exactly on zero, then hand the element back to CSS.
          s.x = s.y = s.vx = s.vy = s.pop = s.vpop = 0;
          chips[i].style.transform = "";
        }
      }
      if (alive) frame = requestAnimationFrame(tick);
      else running = false;
    };

    const start = () => {
      if (running) return;
      running = true;
      frame = requestAnimationFrame(tick);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (motionQuery.matches) return;
      const hit = (event.target as HTMLElement | null)?.closest<HTMLElement>(".cf-chip");
      if (!hit) return;
      const index = chips.findIndex((c) => hit.contains(c));
      if (index < 0) return;

      // One layout read for the whole interaction, never one per chip per frame.
      const boxes = chips.map((c) => c.getBoundingClientRect());
      const origin = boxes[index];
      const ox = origin.left + origin.width / 2;
      const oy = origin.top + origin.height / 2;

      springs[index].vpop += POP;
      for (let i = 0; i < chips.length; i++) {
        if (i === index) continue;
        const dx = boxes[i].left + boxes[i].width / 2 - ox;
        const dy = boxes[i].top + boxes[i].height / 2 - oy;
        const dist = Math.hypot(dx, dy);
        if (dist === 0 || dist > NEIGHBOUR_RADIUS) continue;
        // Falls off with distance, so the shove reads as a wave and not a jump.
        const force = (1 - dist / NEIGHBOUR_RADIUS) * IMPULSE;
        springs[i].vx += (dx / dist) * force;
        springs[i].vy += (dy / dist) * force;
      }
      start();
    };

    const halt = () => {
      if (!motionQuery.matches) return;
      cancelAnimationFrame(frame);
      running = false;
      for (let i = 0; i < chips.length; i++) {
        springs[i] = { x: 0, y: 0, vx: 0, vy: 0, pop: 0, vpop: 0 };
        chips[i].style.transform = "";
      }
    };

    root.addEventListener("pointerdown", onPointerDown);
    motionQuery.addEventListener("change", halt);
    return () => {
      root.removeEventListener("pointerdown", onPointerDown);
      motionQuery.removeEventListener("change", halt);
      cancelAnimationFrame(frame);
      for (const chip of chips) chip.style.transform = "";
    };
  }, []);

  return (
    <ul ref={rootRef} className="cf-list" aria-label="دارایی‌ها و بدهی‌هایی که می‌توانید اینجا نگه دارید">
      {kinds.map((kind, i) => (
        /* Outer = layout. Inner = the pointer spring. The icon inside plays the
           CSS gestures, offset per chip so they travel as a wave. */
        <li
          key={kind.label}
          className="cf-chip"
          data-tone={kind.tone}
        >
          <span className="cf-chip-inner">
            {/* Plain seconds in custom properties, never calc() in a <time> (iOS, see .cf-chip). */}
            <span
              className="cf-icon"
              data-gesture={GESTURE[kind.icon] ?? "lift"}
              style={{ "--cf-draw-delay": `${(0.15 + i * 0.09).toFixed(2)}s`, "--cf-wave-delay": `${(1.6 + i * 0.7).toFixed(2)}s`, "--cf-wave": `${WAVE_SECONDS}s` } as CSSProperties}
            >
              <Icon name={kind.icon} size={15} />
            </span>
            <span>{kind.label}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
