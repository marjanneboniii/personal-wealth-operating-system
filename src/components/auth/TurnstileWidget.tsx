"use client";
import { useEffect, useRef } from "react";

declare global { interface Window { turnstile?: { render: (el: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void }; } }

export default function TurnstileWidget({ siteKey }: { siteKey?: string }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!siteKey || !container.current) return;
    let widgetId: string | undefined;
    const setToken = (token: string) => {
      const input = container.current?.closest("form")?.querySelector<HTMLInputElement>('input[name="turnstileToken"]');
      if (input) input.value = token;
    };
    const render = () => {
      if (!container.current || !window.turnstile || widgetId) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey, action: "authentication", callback: setToken, "expired-callback": () => setToken(""),
      });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-pwos-turnstile]');
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", render);
    if (!existing) {
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true; script.defer = true; script.dataset.pwosTurnstile = "true";
      document.head.appendChild(script);
    } else render();
    return () => { script.removeEventListener("load", render); if (widgetId && window.turnstile) window.turnstile.remove(widgetId); };
  }, [siteKey]);
  if (!siteKey) return null;
  return <><input type="hidden" name="turnstileToken" /><div ref={container} className="flex justify-center" /></>;
}
