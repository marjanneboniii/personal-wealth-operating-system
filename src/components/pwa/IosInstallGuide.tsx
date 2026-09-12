"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
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

/**
 * Which set of instructions this device actually needs.
 *
 * Every browser installs a PWA differently, and an instruction for the wrong
 * one is worse than none — it sends the user hunting a menu item that is not
 * there. So the guide names the real route per platform, and admits it when
 * there is none.
 */
export type InstallPlatform = "ios-safari" | "ios-other" | "android" | "desktop" | "unsupported";

export function detectInstallPlatform(): InstallPlatform {
  if (typeof navigator === "undefined") return "unsupported";
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (iOS) {
    // Chrome/Firefox/Edge ON iOS cannot install at all — every iOS browser is
    // WebKit, but only Safari exposes «Add to Home Screen».
    return /CriOS|FxiOS|EdgiOS/.test(ua) ? "ios-other" : "ios-safari";
  }
  if (/Android/.test(ua)) return "android";
  // Chromium on the desktop can install; Firefox and desktop Safari cannot.
  const chromium = /Chrome|Chromium|Edg\//.test(ua) && !/OPR\//.test(ua);
  return chromium ? "desktop" : "unsupported";
}

/** One platform's route to an installed app, named exactly. */
type GuideCopy = {
  title: string;
  intro: string;
  icon: "safari" | "download" | "info";
  steps: { text: string; icon?: "share" | "more" | "plus" | "download" }[];
  /** Shown instead of steps when the browser simply cannot install. */
  note?: string;
};

function copyFor(platform: InstallPlatform): GuideCopy {
  switch (platform) {
    case "ios-safari":
      return {
        title: "نصب توازن روی آیفون",
        intro: "توازن را به صفحهٔ اصلی اضافه کنید تا مثل یک اپ مستقل باز شود — بدون نوار مرورگر.",
        icon: "safari",
        steps: [
          { text: "در Safari روی دکمهٔ Share (مربع با فلش رو به بالا) بزنید.", icon: "share" },
          { text: "کمی پایین بروید و «Add to Home Screen» را انتخاب کنید.", icon: "plus" },
          { text: "در گوشهٔ بالا روی «Add» بزنید. آیکون توازن روی صفحهٔ اصلی ظاهر می‌شود." },
        ],
      };
    case "ios-other":
      return {
        title: "برای نصب، Safari را باز کنید",
        intro: "روی آیفون فقط Safari می‌تواند اپ را به صفحهٔ اصلی اضافه کند.",
        icon: "info",
        steps: [
          { text: "همین صفحه را در Safari باز کنید.", icon: "share" },
          { text: "روی دکمهٔ Share بزنید و «Add to Home Screen» را انتخاب کنید.", icon: "plus" },
        ],
        note: "مرورگرهای دیگر روی iOS (Chrome، Firefox، Edge) این گزینه را ندارند — محدودیت خود iOS است، نه توازن.",
      };
    case "android":
      return {
        title: "نصب توازن روی اندروید",
        intro: "توازن را روی صفحهٔ اصلی نصب کنید تا مثل یک اپ مستقل باز شود.",
        icon: "download",
        steps: [
          { text: "روی منوی سه‌نقطهٔ مرورگر بزنید.", icon: "more" },
          { text: "گزینهٔ «Install app» یا «Add to Home screen» را انتخاب کنید.", icon: "download" },
          { text: "نصب را تأیید کنید." },
        ],
      };
    case "desktop":
      return {
        title: "نصب توازن روی رایانه",
        intro: "توازن را نصب کنید تا در پنجرهٔ مستقل خودش باز شود.",
        icon: "download",
        steps: [
          { text: "در نوار آدرس، آیکون نصب را بزنید.", icon: "download" },
          { text: "یا از منوی مرورگر گزینهٔ «Install توازن» را انتخاب کنید.", icon: "more" },
        ],
      };
    default:
      return {
        title: "این مرورگر نصب را پشتیبانی نمی‌کند",
        intro: "توازن در همین مرورگر کامل کار می‌کند؛ فقط نصب روی صفحهٔ اصلی ممکن نیست.",
        icon: "info",
        steps: [],
        note: "برای نصب، صفحه را در Chrome یا Edge (رایانه و اندروید) یا Safari (آیفون و آیپد) باز کنید.",
      };
  }
}

/**
 * راهنمای نصب — a modal that works on every device and every theme.
 *
 * WHY THIS IS PORTALLED TO document.body, WHICH IS THE WHOLE BUG FIX
 *
 * The install button lives in the landing header, and the dialog used to
 * render as its DOM sibling. Two properties of that header broke it:
 *
 *   1. `.landing-header` sets `backdrop-filter: blur(...)`. A filter, like a
 *      transform, makes the element a CONTAINING BLOCK for `position: fixed`
 *      descendants — so `fixed inset-0` stopped meaning «the viewport» and
 *      started meaning «this 3.5rem-tall header». The dialog was squeezed into
 *      the header's box, which is exactly the «به ریخته» the user saw.
 *
 *   2. That header also opens a stacking context at `z-index: 30`, so the
 *      dialog's `z-90` could only ever compete INSIDE the header and never
 *      rise above the page.
 *
 * Portalling to `document.body` fixes both, and a third problem with it: the
 * header carries `.landing-ink`, which remaps `--surface-elev`, `--text`,
 * `--border`, `--sunken` and the rest to the landing's dark palette. CSS
 * variables inherit down the DOM TREE, not the visual position, so the dialog
 * was painted with landing tokens over an app-themed page — washed-out text on
 * a mismatched surface, the «کم‌رنگ» half of the report. Outside that subtree
 * the tokens resolve from `:root` and the dialog matches whatever theme the
 * viewer is actually in.
 *
 * Rendering is deferred to an effect because `document` does not exist during
 * the server pass; the dialog only ever opens from a click, so nothing is lost.
 */
export function IosInstallGuide({
  open,
  onClose,
  platform,
}: {
  open: boolean;
  onClose: () => void;
  /** Override for tests and for callers that already detected the device. */
  platform?: InstallPlatform;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const [mounted, setMounted] = useState(false);
  const [detected, setDetected] = useState<InstallPlatform>("ios-safari");

  useEffect(() => {
    // Deferred by a microtask — the same shape `useInstallCapability` uses —
    // so the effect does not set state synchronously and trigger a cascading
    // render. `document` only exists here, which is also why the portal target
    // cannot be resolved during the server pass.
    queueMicrotask(() => {
      setMounted(true);
      setDetected(detectInstallPlatform());
    });
  }, []);

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

  if (!open || !mounted) return null;

  const copy = copyFor(platform ?? detected);

  const dialog = (
    <div
      className="install-guide-root fixed inset-0 z-[2000] flex flex-col justify-end sm:items-center sm:justify-center"
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
          background: "rgba(10,12,16,0.55)",
          backdropFilter: "blur(3px)",
          WebkitBackdropFilter: "blur(3px)",
          touchAction: "manipulation",
        }}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        dir="rtl"
        className="ios-guide sheet-in relative flex w-full flex-col overflow-hidden rounded-t-[var(--r-xl)] border sm:rounded-[var(--r-xl)]"
        style={{
          background: "var(--surface-elev)",
          color: "var(--text)",
          borderColor: "var(--border)",
          boxShadow: "var(--shadow-lg)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grab handle — the affordance that says «this sheet can be dismissed»
            on a phone, where there is no visible page behind it to click. */}
        <div
          className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full sm:hidden"
          style={{ background: "var(--border-strong)" }}
        />

        <div className="flex items-center justify-end px-2.5 pt-1.5">
          <button
            ref={closeRef}
            type="button"
            className="icon-btn !min-h-11 !min-w-11"
            onClick={onClose}
            aria-label="بستن"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-7"
          style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        >
          <div className="text-center">
            <span
              className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[18px]"
              style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
              aria-hidden="true"
            >
              <Icon name={copy.icon} size={28} />
            </span>

            <h2 id={titleId} className="text-[length:var(--fs-md)] font-bold tracking-tight">
              {copy.title}
            </h2>
            <p id={descId} className="sub mx-auto mt-2 max-w-sm text-[length:var(--fs-sm)] leading-7">
              {copy.intro}
            </p>
          </div>

          {copy.steps.length > 0 && (
            <ol className="mt-6 space-y-2.5">
              {copy.steps.map((step, index) => (
                <li key={step.text} className="ios-guide-step">
                  <span className="ios-guide-num" aria-hidden="true">
                    {["۱", "۲", "۳", "۴"][index] ?? String(index + 1)}
                  </span>
                  <span className="flex min-h-11 flex-1 items-center gap-1.5 text-[length:var(--fs-sm)] leading-6">
                    {step.icon && (
                      <span className="shrink-0" style={{ color: "var(--text-3)" }} aria-hidden="true">
                        <Icon name={step.icon} size={15} />
                      </span>
                    )}
                    {step.text}
                  </span>
                </li>
              ))}
            </ol>
          )}

          {copy.note && (
            <p
              className="mt-4 rounded-[var(--r-md)] p-3 text-[length:var(--fs-xs)] leading-6"
              style={{ background: "var(--sunken)", color: "var(--text-2)" }}
            >
              {copy.note}
            </p>
          )}

          <button type="button" className="btn btn-primary mt-6 w-full !min-h-12" onClick={onClose}>
            متوجه شدم
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
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
 * What the BUTTON should do, which is not quite the same question.
 *
 * `useInstallCapability` answers «can this device install right now?» and
 * returns "none" for a browser that never fires `beforeinstallprompt` — which
 * on Android is the common case, because the event only fires once per install
 * eligibility window and never again after a dismissal. The old button hid
 * itself in exactly that situation, so a user who dismissed the native sheet
 * once could never find the install route again.
 *
 * The guide is always a truthful answer: it names the manual route for the
 * platform, or says plainly that the browser cannot install. So the button is
 * shown whenever the app is not ALREADY installed, and falls back to the guide
 * whenever no native prompt is available.
 */
function useInstallAffordance(): {
  visible: boolean;
  hasNativePrompt: boolean;
  platform: InstallPlatform;
  promptInstall: () => Promise<void>;
} {
  const { kind, promptInstall } = useInstallCapability();
  const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, () => false);
  const [platform, setPlatform] = useState<InstallPlatform>("unsupported");

  useEffect(() => {
    // Client-only: detecting during render would desynchronise hydration.
    queueMicrotask(() => setPlatform(detectInstallPlatform()));
  }, []);

  return {
    visible: !standalone,
    hasNativePrompt: kind === "prompt",
    platform,
    promptInstall,
  };
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
  const { visible, hasNativePrompt, platform, promptInstall } = useInstallAffordance();

  // Already installed — there is nothing left to offer.
  if (!visible) return null;

  const variantClass = variant === "primary" ? "btn-primary" : variant === "ghost" ? "btn-ghost" : "";
  // «نصب برنامه» is platform-neutral. Only the iOS wording names the device,
  // because there the instruction genuinely is iPhone-specific.
  const label =
    children ?? (platform === "ios-safari" || platform === "ios-other" ? "نصب روی آیفون" : "نصب برنامه");

  return (
    <>
      <button
        type="button"
        className={`btn ${variantClass} ${className}`.trim()}
        onClick={() => (hasNativePrompt ? void promptInstall() : setOpen(true))}
        aria-haspopup={hasNativePrompt ? undefined : "dialog"}
        aria-expanded={hasNativePrompt ? undefined : open}
      >
        <Icon name="download" size={15} />
        {label}
      </button>
      {/* The guide is mounted regardless of platform: it is the fallback for
          every browser that cannot raise a native sheet, and it says so
          honestly for the ones that cannot install at all. */}
      <IosInstallGuide open={open} onClose={() => setOpen(false)} platform={platform} />
    </>
  );
}

export default IosInstallGuide;
