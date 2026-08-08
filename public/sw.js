/* PWOS Service Worker — "installed app" behaviour.
   Strategy:
     • Static assets (_next/static, fonts, icons): cache-first.
     • Page navigations: network-first, falling back to cache, then /offline.
       This gives cached READ-ONLY financial views when the network is down.
     • No API mutations are ever cached — accounting writes must hit the server. */

const VERSION = "pwos-v1";
const STATIC_CACHE = VERSION + "-static";
const PAGES_CACHE = VERSION + "-pages";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(["/offline", "/icon.svg", "/manifest.webmanifest"])).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    // Cache Vazirmatn fonts long-term (cross-origin, immutable CDN assets)
    if (url.hostname === "cdn.jsdelivr.net") {
      event.respondWith(
        caches.open(STATIC_CACHE).then(async (cache) => {
          const cached = await cache.match(req);
          if (cached) return cached;
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        }),
      );
    }
    return;
  }

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

  // Page navigations: network-first → cached copy → /offline shell
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGES_CACHE);
        try {
          const res = await fetch(req);
          // Only cache clean HTML pages (no errors, no redirects to auth)
          if (res.ok && res.type === "basic") cache.put(req, res.clone());
          return res;
        } catch (err) {
          const cached = await cache.match(req);
          if (cached) return cached;
          const offline = await caches.match("/offline");
          return offline || Response.error();
        }
      })(),
    );
    return;
  }

  // /api GETs (backup etc.): network only — never serve stale financial truth
});
