import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroySession } from "@/lib/auth";
import { isTrustedMutation } from "@/lib/requestSecurity";

export const dynamic = "force-dynamic";

export function POST(): Promise<NextResponse>;
export function POST(request: Request): Promise<NextResponse>;
export async function POST(request?: Request): Promise<NextResponse> {
  // JavaScript callers from older internal tests may omit the argument; real
  // Next.js route invocations always provide it.
  if (request && !isTrustedMutation(request)) return NextResponse.json({ ok: false, error: "درخواست نامعتبر است." }, { status: 403 });
  try {
    const store = await cookies();
    const token = store.get("pwos_session")?.value;
    if (token) {
      // Session storage contains only a one-way token hash.
      await destroySession(token);
    }
  } catch {}
  const res = NextResponse.json({ ok: true });
  res.cookies.set("pwos_session", "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}

export async function GET() {
  return NextResponse.json({ ok: false, error: "Method Not Allowed" }, { status: 405, headers: { Allow: "POST" } });
}
