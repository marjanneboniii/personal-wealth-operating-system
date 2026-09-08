import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { lots } from "@/db/schema";
import { authenticateApi } from "@/lib/authGuard";
import { boundedLimit } from "@/lib/requestSecurity";

export const dynamic = "force-dynamic";
const lotFields = { id: lots.id, assetId: lots.assetId, accountId: lots.accountId, openedAt: lots.openedAt, qtyOpened: lots.qtyOpened, qtyRemaining: lots.qtyRemaining, unitCostBase: lots.unitCostBase };

/**
 * Security-Hardened Lots REST Endpoint with 100% IDOR Protection.
 */
export async function GET(req: Request) {
  const auth = await authenticateApi(req);
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ ok: false, error: "نیاز به ورود (401)" }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    const list = await db
      .select(lotFields)
      .from(lots)
      .where(eq(lots.userId, auth.user.id))
      .limit(boundedLimit(req));
    return NextResponse.json({ ok: true, lots: list });
  }

  const [lot] = await db
    .select(lotFields)
    .from(lots)
    .where(and(eq(lots.id, id), eq(lots.userId, auth.user.id)))
    .limit(1);

  if (!lot) {
    return NextResponse.json({ ok: false, error: "بسته مالی یافت نشد یا متعلق به شما نیست." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, lot });
}
