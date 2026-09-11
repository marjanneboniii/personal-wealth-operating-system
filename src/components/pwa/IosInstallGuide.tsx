"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Icon from "@/components/ui/Icon";

/**
 * iOS / PWA install helpers.
 *
 * Detection is conservative:
 *  - iPhone / iPad / iPod, plus iPadOS desktop-mode (MacIntel + touch).
 *  - Safari is WebKit without CriOS / FxiOS / EdgiOS.
 *  - Chrome / Firefox / Edge on iOS are NOT treated as Safari.
 *  - Standalone (installed) is `navigator.standalone` or `(display-mode: standalone)`.
 *
 * This module is presentation-only. It never imports ledger, accounting, or APIs.
 */

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const iosStandalone =
    "standalone" in window.navigator &&
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
  return Boolean(mq || iosStandalone);
}

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return iOS;
}

export function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  const criOS = /CriOS|FxiOS|EdgiOS/.test(ua);
  return iOS && webkit && !criOS;
}

export function IosInstallGuide({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const prevOverflow = document.body.style.overflow;
    const prevTouchAction = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";

    const focusable = () =>
      panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ) ?? [];

    requestAnimationFrame(() => {
      closeRef.current?.focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = Array.from(focusable());
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.touchAction = prevTouchAction;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col justify-end sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      style={{ touchAction: "manipulation" }}
    >
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
      />
      <div
        ref={panelRef}
        className="ios-guide sheet-in relative flex w-full flex-col overflow-hidden rounded-t-[var(--r-xl)] border sm:rounded-[var(--r-xl)]"
        style={{
          background: "var(--surface-elev)",
          borderColor: "var(--border)",
          boxShadow: "var(--shadow-lg)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full sm:hidden" style={{ background: "var(--border-strong)" }} />
        <div className="flex items-center justify-end px-3 pt-2">
          <button
            ref={closeRef}
            type="button"
            className="icon-btn !min-h-12 !min-w-12"
            onClick={onClose}
            aria-label="بستن"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 text-center sm:px-7"
          style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        >
          <span
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[18px]"
            style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
            aria-hidden="true"
          >
            <Icon name="safari" size={28} />
          </span>

          <h2 id={titleId} className="text-[18px] font-bold tracking-tight">
            نصب توازن روی آیفون
          </h2>
          <p id={descId} className="sub mx-auto mt-2 max-w-sm text-[length:var(--fs-sm)] leading-7">
            برای تجربه بهتر، توازن را به صفحه اصلی گوشی اضافه کنید.
          </p>

          <ol className="mt-6 space-y-3 text-right">
            <li className="ios-guide-step">
              <span className="ios-guide-num" aria-hidden="true">
                ۱
              </span>
              <span className="flex min-h-11 items-center gap-1.5 leading-6">
                <Icon name="share" size={15} />
                در Safari روی دکمه Share بزنید.
              </span>
            </li>
            <li className="ios-guide-step">
              <span className="ios-guide-num" aria-hidden="true">
                ۲
              </span>
              <span className="flex min-h-11 items-center leading-6">
                از منو گزینه «Add to Home Screen» را انتخاب کنید.
              </span>
            </li>
            <li className="ios-guide-step">
              <span className="ios-guide-num" aria-hidden="true">
                ۳
              </span>
              <span className="flex min-h-11 items-center leading-6">در مرحله آخر روی «Add» بزنید.</span>
            </li>
          </ol>

          <button type="button" className="btn btn-primary mt-6 w-full !min-h-12" onClick={onClose}>
            متوجه شدم
          </button>
        </div>
      </div>
    </div>
  );
}

function subscribeStandalone(cb: () => void) {
  const mq = window.matchMedia?.("(display-mode: standalone)");
  mq?.addEventListener?.("change", cb);
  return () => mq?.removeEventListener?.("change", cb);
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * What this device can actually do about installing.
 *
 *   "ios"    — iOS Safari: no beforeinstallprompt exists, so the only route is
 *              the Share → Add to Home Screen walkthrough.
 *   "prompt" — Chromium (Android, desktop): the browser fired
 *              beforeinstallprompt, so a real native install sheet is available.
 *   "none"   — already installed, or a browser that cannot install at all
 *              (desktop Firefox/Safari, Chrome on iOS). Show nothing rather
 *              than a button that leads nowhere.
 */
function useInstallCapability(): {
  kind: "ios" | "prompt" | "none";
  promptInstall: () => Promise<void>;
} {
  const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, () => false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    // Device detection must run on the CLIENT — doing it during render would
    // make server and client disagree and hydrate wrong. Deferred by a
    // microtask (the same shape InstallPromotion uses) so the effect does not
    // set state synchronously and trigger a cascading render.
    if (isIosSafari()) queueMicrotask(() => setIos(true));

    const onBip = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);

    const onInstalled = () => setDeferred(null);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* the user dismissed the native sheet */
    }
    setDeferred(null);
  };

  const kind = standalone ? "none" : deferred ? "prompt" : ios ? "ios" : "none";
  return { kind, promptInstall };
}

/**
 * Install button for the public header.
 *
 * Two bugs this replaces, which were exact opposites of each other:
 *
 *   1. It rendered «نصب روی آیفون» for EVERYONE. The old version checked only
 *      `isStandalone()` and never the device, so an Android user — and a
 *      Windows desktop user — was told to install on an iPhone. This file even
 *      exported `isIosDevice`/`isIosSafari`; the button just never called them.
 *
 *   2. The header wrapped it in `hidden sm:inline-flex`, so it disappeared
 *      below 640px — hiding it on the phone, which is the one device where
 *      installing a PWA is the point.
 *
 * Shown to the wrong people, hidden from the right ones. Now the label follows
 * the device: iOS gets the Share walkthrough, Chromium gets the real native
 * prompt, and anything that cannot install renders nothing at all.
 */
export function DownloadIosButton({
  className = "",
  children,
  variant = "ghost",
}: {
  className?: string;
  children?: ReactNode;
  variant?: "primary" | "ghost" | "default";
}) {
  const [open, setOpen] = useState(false);
  const { kind, promptInstall } = useInstallCapability();

  if (kind === "none") return null;

  const variantClass = variant === "primary" ? "btn-primary" : variant === "ghost" ? "btn-ghost" : "";
  // «نصب برنامه» is platform-neutral; only the iOS path names the iPhone,
  // because there the instruction genuinely is iPhone-specific.
  const label = children ?? (kind === "ios" ? "نصب روی آیفون" : "نصب برنامه");

  return (
    <>
      <button
        type="button"
        className={`btn ${variantClass} ${className}`.trim()}
        onClick={() => (kind === "ios" ? setOpen(true) : void promptInstall())}
        aria-haspopup={kind === "ios" ? "dialog" : undefined}
        aria-expanded={kind === "ios" ? open : undefined}
      >
        <Icon name="download" size={15} />
        {label}
      </button>
      {kind === "ios" && <IosInstallGuide open={open} onClose={() => setOpen(false)} />}
    </>
  );
}

export default IosInstallGuide;
