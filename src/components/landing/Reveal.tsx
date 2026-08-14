"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Reveal — premium calm scroll entrance (fade + subtle slide).
 *
 * Progressive enhancement: content is visible by default in markup; the
 * hidden state only ever applies when JS adds `html.js` (see layout.tsx)
 * and the visitor has not opted into reduced motion. No-JS and
 * prefers-reduced-motion users always see the content instantly.
 */
export default function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    if (!root.classList.contains("js") || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Async so content is never hidden when JS is absent or motion is reduced.
      const id = requestAnimationFrame(() => setSeen(true));
      return () => cancelAnimationFrame(id);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -7% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${seen ? "is-in" : ""} ${className}`}
      style={delay && !seen ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
