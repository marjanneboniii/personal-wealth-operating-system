"use client";

import Script from "next/script";
import { useEffect, useId, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
  }
}

export default function TurnstileWidget({ siteKey, resetKey }: { siteKey?: string; resetKey?: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  // Explicit rendering does NOT auto-inject a hidden `cf-turnstile-response`
  // input (implicit rendering does). We must surface the token returned by the
  // `callback` to the surrounding form ourselves, otherwise `verifyTurnstile`
  // always sees an empty token and rejects every login/register.
  const tokenInput = useRef<HTMLInputElement | null>(null);
  const id = useId();
  const [status, setStatus] = useState<"loading" | "ready" | "expired" | "error">("loading");

  const render = () => {
    if (!siteKey || !ref.current || !window.turnstile || widget.current) return;
    widget.current = window.turnstile.render(ref.current, {
      sitekey: siteKey,
      language: "fa",
      theme: "auto",
      size: "flexible",
      // `callback(token)` is the ONLY place the challenge token is delivered in
      // explicit mode. Write it into the hidden input so the form submits it.
      callback: (token: string) => {
        if (tokenInput.current) tokenInput.current.value = token;
        setStatus("ready");
      },
      // The token expired before the form was submitted: re-arm the widget and
      // ask the user to verify again (distinct from a load/network failure).
      "expired-callback": () => {
        if (tokenInput.current) tokenInput.current.value = "";
        setStatus("expired");
        if (widget.current) window.turnstile?.reset(widget.current);
      },
      // The widget could not reach / run the challenge (network or provider).
      "error-callback": () => {
        if (tokenInput.current) tokenInput.current.value = "";
        setStatus("error");
      },
    });
  };

  useEffect(() => {
    if (widget.current) {
      if (tokenInput.current) tokenInput.current.value = "";
      window.turnstile?.reset(widget.current);
      setStatus("loading");
    }
  }, [resetKey]);

  useEffect(() => () => {
    if (tokenInput.current) tokenInput.current.value = "";
    if (widget.current) window.turnstile?.remove(widget.current);
  }, []);

  return (
    <fieldset className="captcha-panel min-w-0" aria-describedby={`${id}-help`}>
      <legend className="label">تأیید امنیتی</legend>
      <p id={`${id}-help`} className="muted mb-2 text-[11px]">لطفاً تأیید کنید که ربات نیستید.</p>
      {siteKey ? (
        <>
          {/* Holds the challenge token for explicit rendering (see above). */}
          <input ref={tokenInput} type="hidden" name="cf-turnstile-response" />
          <Script
            src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
            strategy="afterInteractive"
            onLoad={render}
            onError={() => setStatus("error")}
          />
          <div ref={ref} className="turnstile-slot" dir="ltr" />
          {status === "error" ? (
            <p role="status" className="mt-2 text-[11px]" style={{ color: "var(--negative)" }}>
              ارتباط با سرویس تأیید امنیتی برقرار نشد. لطفاً دوباره تلاش کنید.
            </p>
          ) : status === "expired" ? (
            <p role="status" aria-live="polite" className="mt-2 text-[11px]" style={{ color: "var(--warning)" }}>
              تأیید امنیتی منقضی شده است. لطفاً دوباره تأیید کنید.
            </p>
          ) : (
            <span className="sr-only" aria-live="polite">{status === "loading" ? "در حال بررسی..." : "تأیید شد"}</span>
          )}
        </>
      ) : (
        <p role="status" className="text-[11px]" style={{ color: "var(--warning)" }}>تأیید امنیتی در حال حاضر در دسترس نیست.</p>
      )}
    </fieldset>
  );
}
