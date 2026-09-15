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
  defaultOpen = false,
  children,
}: {
  anchor: string;
  label: string;
  /** Open on arrival — e.g. when the page has nothing else to show yet. */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const reveal = () => {
      setOpen(true);
      requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };
    const openFromHash = () => {
      if (window.location.hash === `#${anchor}`) reveal();
    };
    // A Next `<Link href="#anchor">` moves the hash with pushState, which fires
    // no `hashchange` — and a hash that is already `#anchor` fires nothing at
    // all. So a click on any link to this panel opens it directly.
    const openFromClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      const url = new URL(link.href, window.location.href);
      if (url.hash !== `#${anchor}` || url.pathname !== window.location.pathname) return;
      event.preventDefault();
      history.replaceState(history.state, "", `${url.pathname}${url.search}#${anchor}`);
      reveal();
    };
    const timer = window.setTimeout(openFromHash, 0);
    window.addEventListener("hashchange", openFromHash);
    document.addEventListener("click", openFromClick, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", openFromHash);
      document.removeEventListener("click", openFromClick, true);
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
