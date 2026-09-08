import { NextResponse } from "next/server";

/** Google OAuth is handled by Supabase Auth's PKCE redirect flow. */
export async function POST(_request: Request) {
  return NextResponse.json(
    { ok: false, error: "این مسیر بازنشسته شده است؛ از ورود Google در Supabase استفاده کنید." },
    { status: 410 },
  );
}

export async function GET() {
  return NextResponse.json({ ok: false, error: "Method Not Allowed" }, { status: 405, headers: { Allow: "POST" } });
}
