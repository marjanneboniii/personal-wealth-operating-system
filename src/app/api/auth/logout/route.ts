import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroySession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const store = await cookies();
    const token = store.get("pwos_session")?.value;
    if (token) {
      // destroySession matches the stored hash (and any legacy raw row).
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
