import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getUserFxRate } from "@/features/fx/userRate";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "نیاز به ورود" }, { status: 401 });
  const snap = await getUserFxRate(user.id);
  return NextResponse.json({ ok: true, ...snap });
}

/**
 * Manual rate entry was removed by owner decision — the reference rate comes
 * from the live USDT/Toman market. This endpoint is read-only; a POST is
 * refused so no client can still write a rate by hand.
 */
export async function POST() {
  return NextResponse.json(
    { ok: false, error: "نرخ مرجع از بازار زنده خوانده می‌شود و دستی قابل ثبت نیست." },
    { status: 405 },
  );
}
