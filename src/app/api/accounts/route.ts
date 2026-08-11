import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, lots, postings } from "@/db/schema";
import { authenticateApi } from "@/lib/authGuard";

export const dynamic = "force-dynamic";

/**
 * Security-Hardened Accounts REST Endpoint with 100% IDOR Protection.
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
      .select()
      .from(accounts)
      .where(eq(accounts.userId, auth.user.id));
    return NextResponse.json({ ok: true, accounts: list });
  }

  const [acc] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, auth.user.id)))
    .limit(1);

  if (!acc) {
    return NextResponse.json({ ok: false, error: "حساب یافت نشد یا متعلق به شما نیست." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, account: acc });
}

export async function PUT(req: Request) {
  const auth = await authenticateApi(req);
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ ok: false, error: "نیاز به ورود (401)" }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "شناسه حساب الزامی است." }, { status: 400 });
  }

  const [acc] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, auth.user.id)))
    .limit(1);

  if (!acc) {
    return NextResponse.json({ ok: false, error: "حساب یافت نشد یا متعلق به شما نیست." }, { status: 404 });
  }

  const body = await req.json();
  const [updated] = await db
    .update(accounts)
    .set({
      name: body.name ?? acc.name,
    })
    .where(eq(accounts.id, acc.id))
    .returning();

  return NextResponse.json({ ok: true, account: updated });
}

export async function DELETE(req: Request) {
  const auth = await authenticateApi(req);
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ ok: false, error: "نیاز به ورود (401)" }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "شناسه حساب الزامی است." }, { status: 400 });
  }

  const [acc] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, auth.user.id)))
    .limit(1);

  if (!acc) {
    return NextResponse.json({ ok: false, error: "حساب یافت نشد یا متعلق به شما نیست." }, { status: 404 });
  }

  // SECURITY (M-02 Accounts): destructive DELETE against bookkeeping history is
  // blocked. An account referenced by immutable ledger data (postings / FIFO
  // lots) must never be physically removed — it is soft-archived instead so
  // historical balances stay intact. Only accounts with ZERO financial usage
  // may be physically removed (no postings, no lots).
  const [postingUsage] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postings)
    .where(eq(postings.accountId, acc.id));
  const [lotUsage] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(lots)
    .where(eq(lots.accountId, acc.id));

  const inUse = (postingUsage?.count ?? 0) > 0 || (lotUsage?.count ?? 0) > 0;

  if (inUse) {
    await db
      .update(accounts)
      .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(accounts.id, acc.id));
    return NextResponse.json({
      ok: true,
      archived: true,
      message: "این حساب دارای سوابق مالی است و حذف فیزیکی آن ممنوع است؛ حساب آرشیو (غیرفعال) شد.",
    });
  }

  try {
    await db.delete(accounts).where(eq(accounts.id, acc.id));
    return NextResponse.json({ ok: true, archived: false, message: "حساب بدون سابقه مالی حذف شد." });
  } catch {
    // FK references from non-ledger children (budgets/goals/planned rows …):
    // history exists elsewhere, so archive instead of deleting.
    await db
      .update(accounts)
      .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(accounts.id, acc.id));
    return NextResponse.json({
      ok: true,
      archived: true,
      message: "به علت داشتن ارتباطات مالی، حساب آرشیو (غیرفعال) شد.",
    });
  }
}
