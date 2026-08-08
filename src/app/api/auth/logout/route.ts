import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const store = await cookies();
    const token = store.get("pwos_session")?.value;
    if (token) {
      await db.delete(sessions).where(eq(sessions.token, token));
    }
    store.delete("pwos_session");
  } catch {}
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return POST();
}
