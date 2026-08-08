"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Icon from "@/components/ui/Icon";

/**
 * Sheet — bottom sheet on mobile, centered dialog on desktop.
 * Accessible: role=dialog, Escape closes, focus is moved inside,
 * body scroll is locked while open.
 */
export default function Sheet({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("a, button, input")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={title}>
      <button
        aria-label="بستن"
        className="fade-in absolute inset-0 cursor-default"
        style={{ background: "rgba(10,12,16,0.45)", backdropFilter: "blur(2px)" }}
        onClick={onClose}
      />
      <div
        ref={ref}
        className={`sheet-in absolute inset-x-0 bottom-0 mx-auto flex max-h-[86dvh] w-full flex-col overflow-hidden rounded-t-[var(--r-xl)] border sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:rounded-[var(--r-xl)] ${
          wide ? "sm:w-[640px]" : "sm:w-[440px]"
        }`}
        style={{
          background: "var(--surface-elev)",
          borderColor: "var(--border)",
          boxShadow: "var(--shadow-lg)",
          paddingBottom: "max(0px, env(safe-area-inset-bottom))",
        }}
      >
        <div className="mx-auto mt-2 h-1 w-9 rounded-full sm:hidden" style={{ background: "var(--border-strong)" }} />
        {title && (
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
            <button className="icon-btn !min-h-9 !min-w-9" onClick={onClose} aria-label="بستن">
              <Icon name="x" size={17} />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
