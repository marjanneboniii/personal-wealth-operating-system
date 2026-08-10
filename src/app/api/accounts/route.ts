import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
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

  await db.delete(accounts).where(eq(accounts.id, acc.id));

  return NextResponse.json({ ok: true, message: "حساب حذف شد." });
}
