/**
 * Onboarding checklist — بخش ۲ of the brief.
 *
 * THE PROBLEM, STATED PRECISELY
 * A user does not forget their apartment. They scroll past the field for it.
 * A single long form cannot tell «I own no property» from «I never got to the
 * property part», so it can never follow up without nagging everybody equally.
 *
 * The fix is not a prettier form, it is a recorded ANSWER. Once «نه، ملک ندارم»
 * exists as a row, three things become possible that were not before:
 *
 *   1. The review screen can list what the user claimed, not what they typed.
 *   2. «مطمئنید دارایی دیگری نمانده؟» becomes a real question with a baseline.
 *   3. The day-N reminder can target only the mismatch — someone who said «بله»
 *      to رمزارز and then registered nothing — instead of banner-spamming
 *      users who already answered honestly.
 *
 * This module owns the answers and the mismatch logic. It deliberately does NOT
 * own asset creation: each category already has its own registration flow, and
 * the checklist's job is to route the user into them and notice what never
 * happened.
 *
 * No ledger, FIFO, valuation or pricing imports — recording a claim is not an
 * accounting event and must never post one.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { onboardingIntents } from "@/db/schema";
import { isAssetCategory, type AssetCategory, type IntentAnswer, type IntentRow } from "./categories";

export {
  ASSET_CATEGORIES,
  CATEGORY_META,
  REMINDER_DELAY_DAYS,
  evaluateChecklist,
  isAssetCategory,
  pendingReminders,
} from "./categories";
export type {
  AssetCategory,
  ChecklistStatus,
  IntentAnswer,
  IntentRow,
} from "./categories";

/**
 * Record (or change) one answer. Idempotent per user+category: re-answering
 * overwrites, because the user is allowed to change their mind and the row is
 * a current claim, not an audit trail.
 */
export async function recordIntent(input: {
  userId: string;
  category: AssetCategory;
  answer: IntentAnswer;
  itemsAtAnswer?: number;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(onboardingIntents)
    .values({
      userId: input.userId,
      category: input.category,
      answer: input.answer,
      answeredAt: now,
      itemsAtAnswer: input.itemsAtAnswer ?? 0,
    })
    .onConflictDoUpdate({
      target: [onboardingIntents.userId, onboardingIntents.category],
      set: {
        answer: input.answer,
        answeredAt: now,
        itemsAtAnswer: input.itemsAtAnswer ?? 0,
        updatedAt: now,
        // Changing the answer re-opens the follow-up: a user who switches from
        // «نه» to «بله» has just told us there IS something to add.
        reminderDismissedAt: null,
      },
    });
}

export async function listIntents(userId: string): Promise<IntentRow[]> {
  const rows = await db
    .select()
    .from(onboardingIntents)
    .where(eq(onboardingIntents.userId, userId));

  return rows
    .filter((r) => isAssetCategory(r.category))
    .map((r) => ({
      category: r.category as AssetCategory,
      answer: r.answer === "yes" ? "yes" : "no",
      answeredAt: r.answeredAt.toISOString(),
      itemsAtAnswer: r.itemsAtAnswer,
      reminderDismissedAt: r.reminderDismissedAt?.toISOString() ?? null,
    }));
}

/** Stop reminding about one category without changing the answer. */
export async function dismissReminder(userId: string, category: AssetCategory): Promise<void> {
  await db
    .update(onboardingIntents)
    .set({ reminderDismissedAt: new Date(), updatedAt: new Date() })
    .where(
      and(eq(onboardingIntents.userId, userId), eq(onboardingIntents.category, category)),
    );
}

