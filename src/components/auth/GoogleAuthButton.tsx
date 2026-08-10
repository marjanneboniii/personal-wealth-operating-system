"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/ui/Icon";

type GoogleIdentity = {
  accounts?: {
    id?: {
      initialize: (options: {
        client_id: string;
        callback: (response: { credential?: string }) => void;
        cancel_on_tap_outside?: boolean;
      }) => void;
      renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

type Props = {
  clientId?: string;
  label?: string;
};

/**
 * Visible, real Google Identity Services entry point.
 *
 * The server still verifies the ID token in /api/auth/google; this component
 * only loads Google's button and sends the returned credential to that route.
 * When no client id is configured we intentionally show the unavailable state
 * instead of pretending that OAuth is working.
 */
export default function GoogleAuthButton({ clientId, label = "ورود با Google" }: Props) {
  const router = useRouter();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;

    let cancelled = false;
    const renderGoogleButton = () => {
      if (cancelled || !buttonRef.current || !window.google?.accounts?.id) return false;
      const googleId = window.google.accounts.id;
      googleId.initialize({
        client_id: clientId,
        cancel_on_tap_outside: true,
        callback: async (response) => {
          const credential = response?.credential;
          if (!credential) {
            setStatus("error");
            setMessage("Google توکن ورود را برنگرداند.");
            return;
          }

          setStatus("loading");
          setMessage(null);
          try {
            const result = await fetch("/api/auth/google", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credential }),
            });
            const data = (await result.json()) as { ok?: boolean; error?: string };
            if (!result.ok || !data.ok) {
              throw new Error(data.error || "ورود با Google انجام نشد.");
            }
            router.replace("/");
            router.refresh();
          } catch (error) {
            setStatus("error");
            setMessage(error instanceof Error ? error.message : "خطا در ورود با Google.");
          }
        },
      });
      buttonRef.current.replaceChildren();
      googleId.renderButton(buttonRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "rect",
        width: 360,
        logo_alignment: "left",
      });
      setStatus("ready");
      return true;
    };

    if (renderGoogleButton()) return () => {
      cancelled = true;
    };

    setStatus("loading");
    const existingScript = document.querySelector<HTMLScriptElement>("script[data-pwos-google-identity]");
    const script = existingScript ?? document.createElement("script");
    let onLoad: (() => void) | undefined;
    if (!existingScript) {
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.pwosGoogleIdentity = "true";
      onLoad = () => {
        if (!renderGoogleButton() && !cancelled) {
          setStatus("error");
          setMessage("کتابخانه ورود Google در دسترس نیست.");
        }
      };
      script.addEventListener("load", onLoad);
      document.head.appendChild(script);
    } else {
      // A previous auth form may have loaded the script but not finished yet.
      onLoad = () => renderGoogleButton();
      script.addEventListener("load", onLoad);
      window.setTimeout(() => {
        if (!renderGoogleButton() && !cancelled && !window.google) {
          setStatus("error");
          setMessage("کتابخانه ورود Google در دسترس نیست.");
        }
      }, 4000);
    }

    return () => {
      cancelled = true;
      if (onLoad) script.removeEventListener("load", onLoad);
    };
  }, [clientId, router]);

  if (!clientId) {
    return (
      <div className="space-y-2">
        <button type="button" disabled className="btn w-full opacity-60" aria-disabled="true">
          <Icon name="globe" size={16} />
          {label}
        </button>
        <p className="muted text-center text-[10.5px] leading-5">ورود با Google فعال نشده است؛ GOOGLE_CLIENT_ID را در تنظیمات محیط قرار دهید.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2" aria-live="polite">
      <div ref={buttonRef} className="flex min-h-[40px] justify-center overflow-hidden" aria-label={label} />
      {status === "loading" && <p className="muted text-center text-[10.5px]">در حال آماده‌سازی ورود با Google…</p>}
      {message && (
        <p className="rounded-[var(--r-md)] px-3 py-2 text-center text-[11px]" style={{ background: "var(--negative-soft)", color: "var(--negative)" }}>
          {message}
        </p>
      )}
    </div>
  );
}
