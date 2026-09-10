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
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Remember what had focus so it can be restored on close.
    restoreRef.current = document.activeElement as HTMLElement | null;

    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Focus trap: Tab cycles inside the dialog and never escapes to the
      // page behind it.
      if (e.key !== "Tab") return;
      const panel = ref.current;
      if (!panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (!items.length) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
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
      const panel = ref.current;
      if (!panel) return;
      (panel.querySelector<HTMLElement>("a, button, input, [tabindex]") ?? panel).focus();
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.touchAction = prevTouchAction;
      (document.body.style as any).overscrollBehavior = prevOverscroll;
      // Return focus to the control that opened the sheet.
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="sheet-overlay fixed inset-0 z-[80] flex flex-col justify-end sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "sheet-title" : undefined}
      aria-label={title ? undefined : "گفتگو"}
      style={{ touchAction: "manipulation" }}
    >
      {/* Scrim — presentational only. It must NOT be a focusable button: the
          close affordance is the header button and Escape, so a screen-reader
          user never meets a second, meaningless «بستن» control in the tab order. */}
      <div
        aria-hidden="true"
        className="fade-in absolute inset-0"
        style={{
          background: "rgba(5,8,13,0.55)",
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
        tabIndex={-1}
        className={`sheet-panel sheet-in relative flex w-full flex-col overflow-hidden rounded-t-[var(--r-xl)] border outline-none sm:rounded-[var(--r-xl)] ${
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
            <h2 id="sheet-title" className="text-[15px] font-semibold tracking-tight">
              {title}
            </h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="بستن" style={{ touchAction: "manipulation" }}>
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
