import { NextResponse } from "next/server";
import { authenticateApi } from "@/lib/authGuard";
import { countUnreadReminders } from "@/features/notifications/service";

export const dynamic = "force-dynamic";

/** Unread reminder count for the bell. Per signed-in user only. */
export async function GET(req: Request) {
  const auth = await authenticateApi(req);
  // The system admin token is not a person and has no reminders.
  if (!auth.authenticated || !auth.user || auth.user.id === "admin-token") {
    return NextResponse.json({ ok: false, unread: 0 }, { status: 401 });
  }
  try {
    const unread = await countUnreadReminders(auth.user.id);
    return NextResponse.json({ ok: true, unread }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, unread: 0 }, { status: 500 });
  }
}
