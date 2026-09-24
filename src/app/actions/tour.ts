"use server";

import { getCurrentUser } from "@/lib/auth";
import { markTourSeen } from "@/features/preferences/service";

/** Finished or skipped: the tour never shows again for this account, on any device. */
export async function markTourSeenAction(): Promise<{ ok: boolean }> {
  try {
    const user = await getCurrentUser();
    if (!user?.id) return { ok: false };
    await markTourSeen(user.id);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
