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
    store.delete("pwos_session");
  } catch {}
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return POST();
}
