import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { refreshSupabaseSession } from "@/lib/supabase/proxy";

/** Refreshes signed Supabase SSR cookies. Authorization remains server-side. */
export async function proxy(request: NextRequest) {
  if (!hasSupabaseConfig()) return NextResponse.next();
  return refreshSupabaseSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
