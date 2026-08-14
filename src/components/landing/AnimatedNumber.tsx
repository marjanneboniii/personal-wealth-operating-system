"use client";

import { useEffect, useRef, useState } from "react";

/**
 * AnimatedNumber — calm count-up for financial figures.
 *
 * The final value is always part of the initial markup (no-JS and SEO
 * safe; no layout shift). When the element scrolls into view, JS animates
 * from zero with a subtle ease-out — skipped entirely for
 * prefers-reduced-motion users.
 *
 * Formatting stays inside the client boundary (en-US grouping), so the
 * component can be used directly from Server Components.
 */
export default function AnimatedNumber({
  value,
  duration = 950,
  className = "",
}: {
  value: number;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const start = performance.now();
        const tick = (t: number) => {
          const p = Math.min(1, (t - start) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          setDisplay(Math.round(value * eased).toLocaleString("en-US"));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, duration]);

  return (
    <span ref={ref} className={className}>
      {display ?? value.toLocaleString("en-US")}
    </span>
  );
}
