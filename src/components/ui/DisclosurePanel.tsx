"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Icon from "@/components/ui/Icon";

/**
 * A form (or any heavy block) folded away until it is asked for.
 *
 * Opens from its own toggle or from any `#<anchor>` link on the page — a header
 * button or an empty state — so a page opens on the user's data, not on a
 * dozen empty fields.
 */
export default function DisclosurePanel({
  anchor,
  label,
  children,
}: {
  anchor: string;
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash !== `#${anchor}`) return;
      setOpen(true);
      requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };
    const timer = window.setTimeout(openFromHash, 0);
    window.addEventListener("hashchange", openFromHash);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", openFromHash);
    };
  }, [anchor]);

  const toggle = () => {
    const next = !open;
    // Clear the hash on close so the next `#anchor` click fires `hashchange` again.
    if (!next && window.location.hash === `#${anchor}`) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    setOpen(next);
  };

  return (
    <section id={anchor} ref={ref} className="card disclosure scroll-mt-24">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`${anchor}-body`}
        className="disclosure-toggle"
      >
        <span className="disclosure-icon" aria-hidden="true">
          <Icon name={open ? "x" : "plus"} size={16} />
        </span>
        <span className="text-[length:var(--fs-sm)] font-semibold">{label}</span>
      </button>
      {open && (
        <div id={`${anchor}-body`} className="disclosure-body">
          {children}
        </div>
      )}
    </section>
  );
}
