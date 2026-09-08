import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import { isTrustedMutation } from "@/lib/requestSecurity";

export const dynamic = "force-dynamic";

export function POST(): Promise<NextResponse>;
export function POST(request: Request): Promise<NextResponse>;
export async function POST(request?: Request): Promise<NextResponse> {
  // JavaScript callers from older internal tests may omit the argument; real
  // Next.js route invocations always provide it.
  if (request && !isTrustedMutation(request)) return NextResponse.json({ ok: false, error: "درخواست نامعتبر است." }, { status: 403 });
  try {
    await clearSessionCookie();
  } catch {}
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: false, error: "Method Not Allowed" }, { status: 405, headers: { Allow: "POST" } });
}
