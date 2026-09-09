"use client";

import { useEffect, useRef } from "react";

/**
 * Ambient background for the landing hero.
 *
 * • Purely decorative: absolutely positioned behind the content, `pointer-events:none`,
 *   `aria-hidden`, and it never participates in layout.
 * • Pointer tracking is opt-in: only on devices with a fine pointer (mouse/trackpad)
 *   and only while the user is actually over the hero. Phones and tablets keep the
 *   static ambient glow, so no cursor work happens on low-power devices.
 * • Positions are written once per animation frame through requestAnimationFrame
 *   (never setInterval, never a scroll listener) and only as CSS custom properties,
 *   so the browser repaints a gradient instead of reflowing the page.
 * • `prefers-reduced-motion` disables tracking entirely.
 */
export default function LandingAmbience() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    const host = node?.parentElement;
    if (!node || !host) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointerQuery = window.matchMedia("(pointer: fine)");

    let frame = 0;
    let running = false;
    let pointerX = 0;
    let pointerY = 0;
    let currentX = 70;
    let currentY = 12;
    let targetX = 70;
    let targetY = 12;

    const tick = () => {
      // One layout read per frame, never per event.
      const rect = host.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        targetX = ((pointerX - rect.left) / rect.width) * 100;
        targetY = ((pointerY - rect.top) / rect.height) * 100;
      }

      currentX += (targetX - currentX) * 0.08;
      currentY += (targetY - currentY) * 0.08;
      node.style.setProperty("--mx", `${currentX.toFixed(2)}%`);
      node.style.setProperty("--my", `${currentY.toFixed(2)}%`);

      if (Math.abs(targetX - currentX) > 0.15 || Math.abs(targetY - currentY) > 0.15) {
        frame = requestAnimationFrame(tick);
      } else {
        running = false;
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (!running) {
        running = true;
        frame = requestAnimationFrame(tick);
      }
    };

    const stop = () => {
      host.removeEventListener("pointermove", onPointerMove);
      cancelAnimationFrame(frame);
      running = false;
    };

    const sync = () => {
      stop();
      if (motionQuery.matches || !pointerQuery.matches) return;
      host.addEventListener("pointermove", onPointerMove, { passive: true });
    };

    sync();
    motionQuery.addEventListener("change", sync);
    pointerQuery.addEventListener("change", sync);

    return () => {
      stop();
      motionQuery.removeEventListener("change", sync);
      pointerQuery.removeEventListener("change", sync);
    };
  }, []);

  return <div ref={ref} className="landing-ambience" aria-hidden="true" />;
}
