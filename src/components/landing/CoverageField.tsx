"use client";

import { useEffect, useRef } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";

/**
 * The asset kinds توازن can hold, as a band of drifting chips that close the
 * hero.
 *
 * WHY IT IS A BAND OF ITS OWN, and not a field behind the hero copy:
 * the single most important thing on this page is that the headline and the
 * lede stay readable. Anything that could drift across them loses that
 * argument, and "it probably will not overlap" is not a guarantee. Here no text
 * is ever on top of the motion, so the readability risk is zero BY
 * CONSTRUCTION rather than by luck.
 *
 * HOW THE MOTION IS SPLIT — this is the whole trick:
 *   • The perpetual drift is a CSS animation on the OUTER element. The
 *     compositor runs it, no JavaScript ticks, no battery cost beyond painting,
 *     and it keeps running even while this component's script is idle.
 *   • The pointer reaction is a transform on the INNER element, driven by a
 *     small spring in `requestAnimationFrame`. That loop only exists while
 *     something is actually springing and shuts itself down when everything has
 *     settled, so the steady state is zero JavaScript.
 * Two nested elements because a single one cannot carry both transforms.
 *
 * A physics library was considered and rejected: ~87KB of JavaScript and a
 * permanent rAF loop, on a landing page that is often opened on a mid-range
 * Android over mobile data, to decorate a band. This is ~80 lines and 0 bytes
 * of dependency.
 *
 * The chips are REAL CONTENT — a labelled list of what the product covers — so
 * nothing here is aria-hidden and the words are read by everyone. The drift and
 * the bounce are decoration layered on top of that, and `prefers-reduced-motion`
 * removes both.
 */

export type CoverageKind = { icon: IconName; label: string; tone: string };

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
     * once, the CSS drift obeyed (it is a media query) while the tap spring
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
        /* Outer = the perpetual CSS drift. Inner = the pointer spring. `--i`
           staggers the drift so the row never pulses in unison. */
        <li key={kind.label} className="cf-chip" data-tone={kind.tone} style={{ ["--i" as string]: i }}>
          <span className="cf-chip-inner">
            <Icon name={kind.icon} size={15} />
            <span>{kind.label}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
