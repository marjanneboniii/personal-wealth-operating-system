"use client";

/**
 * SECURITY (L-03): tenant-switch hygiene for Cache Storage.
 *
 * On logout (and as defense-in-depth on a fresh login/register) every
 * Service-Worker Cache Storage bucket is wiped and the SW itself is told to
 * purge. A shared device must never keep bytes of the previous user's data.
 * Best-effort: failures must never block the auth flow.
 */
export async function purgeClientCaches(): Promise<void> {
  try {
    if (typeof window !== "undefined" && "caches" in window) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((k) => window.caches.delete(k)));
    }
  } catch {}
  try {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      reg?.active?.postMessage({ type: "PURGE_CACHES" });
    }
  } catch {}
}
