/**
 * Display Valuation Engine — User Preferences (Phase 2.6)
 *
 * CRITICAL ISOLATION GUARANTEE:
 * This service operates ONLY on the user_display_preferences table.
 * It NEVER touches journal_entries, postings, accounts, lots,
 * lot_consumptions, FIFO, or cost basis.
 *
 * Display currency is a UI preference only.
 * Changing display currency NEVER creates financial events.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userDisplayPreferences } from "@/db/schema";
import type { DisplayCurrency } from "@/features/fx/types";
import { isSupportedDisplayCurrency } from "@/features/fx/types";
import type { DisplayPreference } from "./types";

/**
 * Get the current display currency preference for a user.
 * Defaults to "USD" if no preference is set.
 *
 * SAFETY: Read-only from user_display_preferences.
 */
export async function getDisplayPreference(userId?: string): Promise<DisplayPreference> {
  const [row] = userId
    ? await db
        .select()
        .from(userDisplayPreferences)
        .where(eq(userDisplayPreferences.userId, userId))
        .limit(1)
    : await db
        .select()
        .from(userDisplayPreferences)
        .limit(1);

  if (!row) {
    return {
      id: "",
      userId: userId ?? null,
      displayCurrency: "USD",
    };
  }

  const currency = isSupportedDisplayCurrency(row.displayCurrency)
    ? row.displayCurrency
    : "USD";

  return {
    id: row.id,
    userId: row.userId,
    displayCurrency: currency,
  };
}

/**
 * Set the display currency preference for a user.
 *
 * SAFETY: Writes ONLY to user_display_preferences.
 * This NEVER creates journal entries, postings, or any financial events.
 *
 * @throws Error if the currency is not supported (e.g., IRR)
 */
export async function setDisplayPreference(
  displayCurrency: string,
  userId?: string,
): Promise<DisplayPreference> {
  if (!isSupportedDisplayCurrency(displayCurrency)) {
    throw new Error(
      `ارز نمایشی پشتیبانی نمی‌شود: ${displayCurrency}. ` +
      `ارزهای مجاز: USD, IRT, BTC, ETH, XAUT, PAXG`,
    );
  }

  // Check if preference already exists
  const existing = await getDisplayPreference(userId);

  if (existing.id) {
    const [updated] = await db
      .update(userDisplayPreferences)
      .set({
        displayCurrency,
        updatedAt: new Date(),
      })
      .where(eq(userDisplayPreferences.id, existing.id))
      .returning();

    return {
      id: updated.id,
      userId: updated.userId,
      displayCurrency: updated.displayCurrency as DisplayCurrency,
    };
  }

  // Create new preference
  const [created] = await db
    .insert(userDisplayPreferences)
    .values({
      userId: userId ?? null,
      displayCurrency,
    })
    .returning();

  return {
    id: created.id,
    userId: created.userId,
    displayCurrency: created.displayCurrency as DisplayCurrency,
  };
}
