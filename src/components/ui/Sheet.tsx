"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Icon from "@/components/ui/Icon";

/**
 * Sheet — bottom sheet on mobile, centered dialog on desktop.
 * Accessible: role=dialog, Escape closes, focus is moved inside,
 * body scroll is locked while open.
 * Mobile-hardened: touch-action, pointer-events isolation, scroll lock fix.
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
    // Lock scroll: use fixed + overflow hidden with overscroll containment
    const prevOverflow = document.body.style.overflow;
    const prevTouchAction = document.body.style.touchAction;
    const prevOverscroll = (document.body.style as any).overscrollBehavior;
    document.body.style.overflow = "hidden";
    (document.body.style as any).overscrollBehavior = "contain";
    document.body.style.touchAction = "none";
    // Move focus inside
    requestAnimationFrame(() => {
      ref.current?.querySelector<HTMLElement>("a, button, input, [tabindex]")?.focus();
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.touchAction = prevTouchAction;
      (document.body.style as any).overscrollBehavior = prevOverscroll;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col justify-end sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{ touchAction: "manipulation" }}
    >
      {/* Overlay — pointer events isolated, does not capture touches meant for sheet */}
      <button
        type="button"
        aria-label="بستن"
        className="fade-in absolute inset-0 cursor-default"
        style={{
          background: "rgba(10,12,16,0.45)",
          backdropFilter: "blur(2px)",
          touchAction: "manipulation",
        }}
        onClick={onClose}
        onTouchStart={(e) => {
          // Prevent ghost clicks on mobile when sheet is open
          e.preventDefault();
        }}
      />
      <div
        ref={ref}
        className={`sheet-in relative flex w-full flex-col overflow-hidden rounded-t-[var(--r-xl)] border sm:rounded-[var(--r-xl)] ${
          wide ? "sm:w-[640px]" : "sm:w-[440px]"
        }`}
        style={{
          background: "var(--surface-elev)",
          borderColor: "var(--border)",
          boxShadow: "var(--shadow-lg)",
          /* The panel is a flex child of a `fixed inset-0` overlay, so 100% is
             always the *real* visible viewport — including iOS standalone PWA,
             where `dvh`/`vh` can overshoot behind the home indicator. The sheet
             therefore can never extend below the bottom of the screen. */
          maxHeight: "calc(100% - 1.25rem)",
          touchAction: "pan-y",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch" as any,
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full sm:hidden" style={{ background: "var(--border-strong)" }} />
        {title && (
          <div className="flex shrink-0 items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
            <button type="button" className="icon-btn !min-h-9 !min-w-9" onClick={onClose} aria-label="بستن" style={{ touchAction: "manipulation" }}>
              <Icon name="x" size={17} />
            </button>
          </div>
        )}
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          style={{
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch" as any,
            /* Last row stays reachable above the iOS home indicator. */
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
          onTouchMove={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
