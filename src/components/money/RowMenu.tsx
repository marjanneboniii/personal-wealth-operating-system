"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Icon from "@/components/ui/Icon";

/**
 * «…» — a row's rarer actions (delete, see its transactions) out of the way.
 *
 * A destructive icon on every row was both noise and a mis-tap waiting to
 * happen. This is a native <details>, so it works before hydration and keeps
 * its items in the server HTML; the script only closes it on an outside tap or
 * Escape, the way a menu is expected to behave.
 */
export default function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const close = (e: Event) => {
      if (!el.open) return;
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") {
          el.open = false;
          el.querySelector("summary")?.focus();
        }
        return;
      }
      if (!el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details ref={ref} className="mny-menu">
      <summary className="mny-menu-trigger" aria-label={label} title={label}>
        <Icon name="more" size={16} />
      </summary>
      <div className="mny-menu-panel" role="group" aria-label={label}>
        {children}
      </div>
    </details>
  );
}
