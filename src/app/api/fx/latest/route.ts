import { NextResponse } from "next/server";
import { getLatestUsdIrtRate, getLatestUsdIrtRateForUser } from "@/lib/fx";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser().catch(() => null);
    const snap = user ? await getLatestUsdIrtRateForUser(user.id) : await getLatestUsdIrtRate();
    return NextResponse.json({ ok: true, ...snap });
  } catch (e) {
    return NextResponse.json({ ok: false, rate: "190000", source: "fallback" }, { status: 200 });
  }
}
