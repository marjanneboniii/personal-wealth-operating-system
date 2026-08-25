import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Proxy (Next.js 16 middleware convention) is kept minimal for PWA/static handling.
// Auth protection is enforced inside Server Components (getCurrentUser +
// redirect to /login). The app is LOGIN-GATED: signed-out visitors only ever
// see the public landing at `/` — every app page redirects them to /login
// and each user sees only their own tenant's data after login/registration.
//
// ── Route map (authorization is ALWAYS enforced server-side, not here) ──
// Public routes:
//   /                                   marketing landing (the only public page surface)
//   /login, /register                   auth pages
//   /about, /privacy, /terms, /offline  marketing / PWA support
//   /api/*                              APIs enforce their own auth (401s, not redirects)
//   /manifest.webmanifest, /sw.js, static assets (PWA)
// Authenticated routes (session required; enforced in page/action/API code):
//   all app pages (/, /portfolio, /transactions, /ledger, /accounts, ...)
//   /api/accounts, /api/transactions, /api/lots   (IDOR-checked per user)
//   /api/fx/rate                                  (per-user FX settings)
// Owner/Admin-only routes (authorizeOwnerOrAdmin):
//   /api/backup, /api/restore
// The proxy must never be the only line of defense: every Server Action,
// API route and service boundary performs its own authentication and
// ownership checks based on the server-side session.

/**
 * Login-gated fast path (UX only, NOT the security boundary): a request
 * WITHOUT a session cookie can never be authenticated downstream, so it is
 * redirected to /login immediately — before any app shell streams. Requests
 * that DO carry a cookie continue to the server components, where the
 * session is actually validated against the database (a forged or expired
 * cookie still results in the server-side redirect).
 */
const PUBLIC_PAGES = new Set(["/", "/login", "/register", "/about", "/privacy", "/terms", "/offline"]);
const PUBLIC_PREFIXES = [
  "/api/",
  "/_next/",
  "/fonts/",
  // Brand/asset logo artwork (PersianLabs icons). Static images with no user
  // data — serving them without a session avoids a redirect-to-/login for
  // every logo request and keeps them cacheable for the offline PWA.
  "/ir-icons/",
  "/icon-",
  "/apple-",
  "/logo-",
  "/favicon",
  "/manifest",
  "/sw.js",
];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic =
    PUBLIC_PAGES.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isPublic && !req.cookies.get("pwos_session")?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
