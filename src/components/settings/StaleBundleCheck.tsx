"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * The page HTML is rendered by the server now; this component's code was
 * bundled at build time and may come from the service worker's cache. When the
 * two builds differ, the app on screen is older than the server — offer the
 * reload that fetches the new one.
 */
export default function StaleBundleCheck({ serverCommit }: { serverCommit: string }) {
  const clientCommit = process.env.NEXT_PUBLIC_BUILD_COMMIT || "local";
  // The server always renders «not stale»; only the browser knows its own bundle.
  const stale = useSyncExternalStore(noSubscribe, () => serverCommit !== clientCommit, () => false);
  if (!stale) return null;
  return (
    <button
      type="button"
      className="btn btn-soft !min-h-8 !px-2.5 !py-1 text-[length:var(--fs-xs)]"
      onClick={() => {
        void (async () => {
          try {
            const regs = await navigator.serviceWorker?.getRegistrations();
            await Promise.all((regs ?? []).map((r) => r.update()));
          } catch {
            /* no service worker — a reload is enough */
          }
          window.location.reload();
        })();
      }}
    >
      نسخه‌ی تازه آماده است — به‌روزرسانی
    </button>
  );
}
