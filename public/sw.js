/* PWOS Service Worker — "installed app" behaviour.
   Strategy:
     • Static assets (_next/static, fonts, icons): cache-first.
     • Page navigations: NETWORK-ONLY, falling back to the /offline shell.
       SECURITY (L-03): private, per-user financial pages are NEVER stored in
       Cache Storage. In a previous version navigations were cached
       network-first; on a shared device the next user could open a cached
       page of the previous user after logout.
     • Fonts are self-hosted now (L-02) — no cross-origin caching at all.
     • No API responses are ever cached — accounting reads/writes hit the server.
     • On logout/login the client posts {type:"PURGE_CACHES"} → every cache is
       wiped so no residue of the previous tenant survives on the device. */

const VERSION = "pwos-v2"; // bump → old versioned caches (incl. legacy page cache) are deleted on activate
const STATIC_CACHE = VERSION + "-static";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(["/offline", "/icon.svg", "/manifest.webmanifest"]))
      .catch(() => {}),
  );
  self.skipWaiting();
});

async function purgeAllCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // Delete any cache from older SW versions — removes the legacy
      // "pwos-v1-pages" cache that may hold another user's private pages.
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Explicit tenant-switch signal from the app (logout / login / register).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "PURGE_CACHES") {
    event.waitUntil(purgeAllCaches());
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // nothing cross-origin is cached

  // Next.js build assets: immutable → cache-first
  if (url.pathname.startsWith("/_next/static") || url.pathname === "/icon.svg") {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Page navigations: network only → /offline shell. Private HTML is never
  // written to Cache Storage (tenant isolation on shared devices).
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch (err) {
          const offline = await caches.match("/offline");
          return offline || Response.error();
        }
      })(),
    );
    return;
  }

  // /api GETs (backup etc.): network only — never serve stale financial truth
});
