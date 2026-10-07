"use server";
import { getSetupReadyUser } from "@/lib/authGuard";

import { revalidatePath } from "next/cache";
import { markRemindersRead } from "@/features/notifications/service";

/** Mark reminders as seen by the signed-in user. Seen-state only — nothing else changes. */
export async function markRemindersReadAction(keys: string[]): Promise<{ ok: boolean }> {
  const user = await getSetupReadyUser().catch(() => null);
  if (!user?.id || !Array.isArray(keys)) return { ok: false };
  await markRemindersRead(user.id, keys);
  revalidatePath("/notifications");
  return { ok: true };
}
