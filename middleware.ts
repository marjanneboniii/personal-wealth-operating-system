import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Middleware is kept minimal for PWA/static handling.
// Auth protection is enforced inside Server Components (getCurrentUser + redirect)
// so that we can check DB for legacy migration (single-tenant -> multi-tenant)
// without needing edge DB access here.
// This avoids breaking the initial legacy mode where no auth users exist yet.
//
// ── Route map (authorization is ALWAYS enforced server-side, not here) ──
// Public routes:
//   /login, /register                  auth pages
//   /api/auth/google, /api/auth/logout authentication endpoints (rate-limited)
//   /api/health                        health probe
//   /api/fx/latest                     public reference FX rate
//   /manifest.webmanifest, /sw.js, static assets (PWA)
// Authenticated routes (session required; enforced in page/action/API code):
//   all app pages (/, /portfolio, /transactions, /ledger, /accounts, ...)
//   /api/accounts, /api/transactions, /api/lots   (IDOR-checked per user)
//   /api/fx/rate                                  (per-user FX settings)
// Owner/Admin-only routes (authorizeOwnerOrAdmin):
//   /api/backup, /api/restore
// Middleware must never be the only line of defense: every Server Action,
// API route and service boundary performs its own authentication and
// ownership checks based on the server-side session.

export function middleware(req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
