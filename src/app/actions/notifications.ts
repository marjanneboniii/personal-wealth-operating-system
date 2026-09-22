"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { markRemindersRead } from "@/features/notifications/service";

/** Mark reminders as seen by the signed-in user. Seen-state only — nothing else changes. */
export async function markRemindersReadAction(keys: string[]): Promise<{ ok: boolean }> {
  const user = await getCurrentUser().catch(() => null);
  if (!user?.id || !Array.isArray(keys)) return { ok: false };
  await markRemindersRead(user.id, keys);
  revalidatePath("/notifications");
  return { ok: true };
}
