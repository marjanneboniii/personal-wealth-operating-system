import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getUserFxRate, updateUserFxRate } from "@/features/fx/userRate";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "نیاز به ورود" }, { status: 401 });
  const snap = await getUserFxRate(user.id);
  return NextResponse.json({ ok: true, ...snap });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "نیاز به ورود" }, { status: 401 });
  try {
    const body = await req.json();
    const rate = String(body.rate || body.currentRate || "").trim();
    if (!rate) return NextResponse.json({ ok: false, error: "نرخ را وارد کنید." }, { status: 400 });
    const result = await updateUserFxRate(user.id, rate);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.message }, { status: 429 });
    return NextResponse.json({ ok: true, message: result.message, ...result.snapshot });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "خطا" }, { status: 500 });
  }
}
