"use server";

/**
 * Server actions for the onboarding checklist.
 *
 * SECURITY — every action is fail-closed and login-gated. A checklist answer
 * states what a named person owns, so it is personal data: an anonymous caller
 * gets nothing, and a row is only ever written for the authenticated user's own
 * id. The id is never accepted from the client.
 *
 * These actions record a CLAIM. They never post a journal entry, create an
 * asset, or touch a balance — asset creation stays in each category's own flow.
 */
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import {
  dismissReminder,
  evaluateChecklist,
  isAssetCategory,
  listIntents,
  pendingReminders,
  recordIntent,
  type AssetCategory,
} from "@/features/onboarding/service";
import { countAssetsByCategory } from "@/features/onboarding/counts";

export type OnboardingResult = { ok: boolean; message?: string };

export async function recordIntentAction(
  category: string,
  answer: string,
): Promise<OnboardingResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "برای ثبت پاسخ باید وارد شوید." };
  if (!isAssetCategory(category)) return { ok: false, message: "دستهٔ نامعتبر." };
  if (answer !== "yes" && answer !== "no") return { ok: false, message: "پاسخ نامعتبر." };

  const counts = await countAssetsByCategory(user.id);
  await recordIntent({
    userId: user.id,
    category,
    answer,
    itemsAtAnswer: counts[category] ?? 0,
  });
  revalidatePath("/onboarding");
  return { ok: true };
}

export async function dismissReminderAction(category: string): Promise<OnboardingResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "برای این کار باید وارد شوید." };
  if (!isAssetCategory(category)) return { ok: false, message: "دستهٔ نامعتبر." };
  await dismissReminder(user.id, category);
  revalidatePath("/");
  return { ok: true };
}

export type ChecklistView = {
  loginRequired?: boolean;
  answers: Partial<Record<AssetCategory, "yes" | "no">>;
  counts: Partial<Record<AssetCategory, number>>;
  unanswered: AssetCategory[];
  promisedButEmpty: AssetCategory[];
  reminders: AssetCategory[];
  complete: boolean;
};

export async function fetchChecklistAction(): Promise<ChecklistView> {
  const empty: ChecklistView = {
    answers: {},
    counts: {},
    unanswered: [],
    promisedButEmpty: [],
    reminders: [],
    complete: false,
  };
  const user = await getCurrentUser();
  if (!user) return { ...empty, loginRequired: true };

  const [intents, counts] = await Promise.all([
    listIntents(user.id),
    countAssetsByCategory(user.id),
  ]);
  const status = evaluateChecklist(intents, counts);

  return {
    answers: Object.fromEntries(intents.map((i) => [i.category, i.answer])),
    counts,
    unanswered: status.unanswered,
    promisedButEmpty: status.promisedButEmpty,
    reminders: pendingReminders(intents, counts),
    complete: status.complete,
  };
}
