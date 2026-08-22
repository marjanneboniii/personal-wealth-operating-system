import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";

/*
 * ──────────────────────────────────────────────────────────────────────────
 * Global Pro Mode — per-user UI vocabulary preference (Directive §2).
 *
 * DEFAULT IS SIMPLE VIEW (proMode = false): the general UI never shows
 * accounting jargon (کد معین، بدهکار/بستانکار، جزئیات دفتر کل). Those details
 * are revealed across the WHOLE app only when the user enables Pro Mode in
 * تنظیمات → نمایش و حالت حرفه‌ای.
 *
 * TENANCY: every read/write is keyed by the authenticated userId. No shared
 * cache, no global state — the flag of one user can never influence another
 * tenant's render. A missing row, a missing user or a DB error all resolve
 * to the safe default (SIMPLE), never to a privileged view.
 * ──────────────────────────────────────────────────────────────────────────
 */

export const PRO_MODE_DEFAULT = false;

export async function getUserProMode(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return PRO_MODE_DEFAULT;
  try {
    const [row] = await db
      .select({ proMode: userPreferences.proMode })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    return row ? row.proMode : PRO_MODE_DEFAULT;
  } catch {
    // Fail-safe: any error resolves to the simple, non-jargon view.
    return PRO_MODE_DEFAULT;
  }
}

export async function setUserProMode(
  userId: string,
  proMode: boolean,
): Promise<{ ok: boolean; message: string; proMode: boolean }> {
  try {
    const [existing] = await db
      .select({ id: userPreferences.id, proMode: userPreferences.proMode })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    const now = new Date();
    if (existing) {
      await db
        .update(userPreferences)
        .set({ proMode, updatedAt: now })
        .where(eq(userPreferences.userId, userId));
    } else {
      await db.insert(userPreferences).values({ userId, proMode }).onConflictDoNothing();
      await db
        .update(userPreferences)
        .set({ proMode, updatedAt: now })
        .where(eq(userPreferences.userId, userId));
    }

    await recordAuditEvent({
      action: "UPDATE_USER_PREFERENCES",
      entityType: "user_preferences",
      entityId: userId,
      userId,
      before: { proMode: existing?.proMode ?? PRO_MODE_DEFAULT },
      after: { proMode },
      result: "SUCCESS",
    });

    return {
      ok: true,
      message: proMode ? "حالت حرفه‌ای فعال شد." : "نمای ساده فعال شد.",
      proMode,
    };
  } catch {
    return { ok: false, message: "ذخیره تنظیمات ممکن نشد — دوباره تلاش کنید.", proMode: !proMode };
  }
}
