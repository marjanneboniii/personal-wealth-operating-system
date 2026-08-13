"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";

const DISMISS_KEY = "pwos-install-dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const iosStandalone = "standalone" in window.navigator && Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
  return Boolean(mq || iosStandalone);
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  const criOS = /CriOS|FxiOS|EdgiOS/.test(ua);
  return iOS && webkit && !criOS;
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Listen from Shell on every route (including the public landing) so
 * `beforeinstallprompt` is not lost before the signed-in banner mounts.
 */
export function usePwaInstallState() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (isStandalone() || wasDismissed()) return;

    const iosDevice = isIosSafari();
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setIos(false);
      setHidden(false);
    };
    window.addEventListener("beforeinstallprompt", onBip);

    if (iosDevice) {
      queueMicrotask(() => {
        setIos(true);
        setHidden(false);
      });
    }

    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setHidden(true);
  };

  const install = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* native sheet dismissed */
    }
    setDeferred(null);
    dismiss();
  };

  return { show: !hidden, ios, canPrompt: Boolean(deferred), install, dismiss };
}

export default function InstallPromotion({
  ios,
  canPrompt,
  onInstall,
  onDismiss,
}: {
  ios: boolean;
  canPrompt: boolean;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="install-promo" role="dialog" aria-labelledby="install-title" aria-describedby="install-body">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
          <Icon name="download" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p id="install-title" className="text-[13.5px] font-semibold">
            این داشبورد را همیشه همراه خود داشته باشید
          </p>
          <p id="install-body" className="sub mt-1 text-[12.5px] leading-6">
            {ios
              ? "برای نصب روی iPhone: دکمه Share را بزنید، سپس Add to Home Screen را انتخاب کنید."
              : "برای دسترسی سریع‌تر، اپ را به صفحه اصلی اضافه کنید."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {canPrompt && (
              <button type="button" className="btn btn-primary !min-h-12 !px-4 text-[12.5px]" onClick={onInstall}>
                افزودن به صفحه اصلی
              </button>
            )}
            <button type="button" className="btn btn-ghost !min-h-12 !px-4 text-[12.5px]" onClick={onDismiss}>
              فعلاً نه
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
