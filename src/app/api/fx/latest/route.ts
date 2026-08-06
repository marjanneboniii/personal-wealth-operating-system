import { NextResponse } from "next/server";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snap = await getLatestUsdIrtRate();
    return NextResponse.json({ ok: true, ...snap });
  } catch (e) {
    return NextResponse.json({ ok: false, rate: "100000", source: "fallback" }, { status: 200 });
  }
}
