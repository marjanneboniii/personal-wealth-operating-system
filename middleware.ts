import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Middleware is kept minimal for PWA/static handling.
// Auth protection is enforced inside Server Components (getCurrentUser + redirect)
// so that we can check DB for legacy migration (single-tenant -> multi-tenant)
// without needing edge DB access here.
// This avoids breaking the initial legacy mode where no auth users exist yet.

export function middleware(req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
