"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { journalEntries } from "@/db/schema";
import { getSetupReadyUser } from "@/lib/authGuard";
import { recordAuditEvent } from "@/lib/audit";
import { generateInsight } from "@/features/assistant/chat";
import { AssistantError, classifyGeminiError } from "@/features/assistant/gemini";
import { invalidateSnapshot } from "@/features/assistant/snapshot";
import {
  deleteConversation,
  deleteMemory,
  getMessageMeta,
  listConversations,
  listMemories,
  listMessages,
  renameConversation,
  setMessageMeta,
  updateMemory,
  type ConversationSummary,
  type Memory,
  type StoredMessage,
} from "@/features/assistant/store";
import { validateRecategorization } from "@/features/assistant/tools";

/**
 * دستیار هوشمند — conversation management and the ONE data change the
 * assistant can lead to: moving a transaction to another category, and only
 * when the user presses «اعمال» on a suggestion the assistant recorded.
 */

type Result<T = undefined> = { ok: true; data: T; message?: string } | { ok: false; message: string };

async function signedIn() {
  try {
    return (await getSetupReadyUser()) ?? null;
  } catch {
    return null;
  }
}
const LOGIN = "برای استفاده از دستیار وارد شوید.";
const uuid = z.uuid();

export async function listConversationsAction(): Promise<Result<ConversationSummary[]>> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: LOGIN };
  return { ok: true, data: await listConversations(user.id) };
}

export async function loadConversationAction(conversationId: string): Promise<Result<StoredMessage[]>> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: LOGIN };
  if (!uuid.safeParse(conversationId).success) return { ok: false, message: "گفتگو معتبر نیست." };
  return { ok: true, data: await listMessages(user.id, conversationId) };
}

export async function renameConversationAction(conversationId: string, title: string): Promise<Result> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: LOGIN };
  if (!uuid.safeParse(conversationId).success) return { ok: false, message: "گفتگو معتبر نیست." };
  await renameConversation(user.id, conversationId, String(title ?? ""));
  return { ok: true, data: undefined };
}

export async function deleteConversationAction(conversationId: string): Promise<Result> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: LOGIN };
  if (!uuid.safeParse(conversationId).success) return { ok: false, message: "گفتگو معتبر نیست." };
  await deleteConversation(user.id, conversationId);
  return { ok: true, data: undefined, message: "گفتگو حذف شد." };
}

export async function listMemoriesAction(): Promise<Result<Memory[]>> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: LOGIN };
  return { ok: true, data: await listMemories(user.id) };
}

export async function updateMemoryAction(id: string, content: string): Promise<Result> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: LOGIN };
  if (!uuid.safeParse(id).success) return { ok: false, message: "یادداشت معتبر نیست." };
  await updateMemory(user.id, id, String(content ?? ""));
  return { ok: true, data: undefined };
}

export async function deleteMemoryAction(id: string): Promise<Result> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: LOGIN };
  if (!uuid.safeParse(id).success) return { ok: false, message: "یادداشت معتبر نیست." };
  await deleteMemory(user.id, id);
  return { ok: true, data: undefined };
}

/** Decide a recorded suggestion: apply (changes the transaction's category) or dismiss. */
export async function decideProposalAction(messageId: string, proposalId: string, decision: "apply" | "dismiss"): Promise<Result> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: LOGIN };
  if (!uuid.safeParse(messageId).success || !uuid.safeParse(proposalId).success) return { ok: false, message: "پیشنهاد معتبر نیست." };
  const stored = await getMessageMeta(user.id, messageId);
  const proposal = stored?.meta.proposals?.find((p) => p.id === proposalId);
  if (!stored || !proposal) return { ok: false, message: "پیشنهاد پیدا نشد." };
  if (proposal.status !== "pending") return { ok: false, message: "این پیشنهاد قبلاً بررسی شده است." };

  if (decision === "apply") {
    // Re-validated now: the transaction or category may have changed since the suggestion.
    const v = await validateRecategorization(user.id, proposal.entryId, proposal.toCategoryId);
    if (!v.ok) return { ok: false, message: "این پیشنهاد دیگر قابل اعمال نیست (تراکنش یا دسته تغییر کرده است)." };
    await db
      .update(journalEntries)
      .set({ categoryId: proposal.toCategoryId })
      .where(and(eq(journalEntries.id, proposal.entryId), eq(journalEntries.userId, user.id)));
    await recordAuditEvent({
      action: "ENTRY_RECATEGORIZED",
      entityType: "journal_entry",
      entityId: proposal.entryId,
      userId: user.id,
      before: { categoryId: v.entry.categoryId },
      after: { categoryId: proposal.toCategoryId },
      metadata: { source: "assistant", confidence: proposal.confidence },
    });
    invalidateSnapshot(user.id);
    for (const p of ["/transactions", "/cash-flow", "/budgets", "/reports", "/insights", "/assistant"]) revalidatePath(p);
  }
  const proposals = (stored.meta.proposals ?? []).map((p) => (p.id === proposalId ? { ...p, status: decision === "apply" ? ("applied" as const) : ("dismissed" as const) } : p));
  await setMessageMeta(user.id, messageId, { ...stored.meta, proposals });
  return { ok: true, data: undefined, message: decision === "apply" ? `دسته به «${proposal.toCategoryName}» تغییر کرد.` : "پیشنهاد کنار گذاشته شد." };
}

export async function generateInsightAction(force = false): Promise<Result<{ content: string; createdAt: string; cached: boolean }>> {
  const user = await signedIn();
  if (!user?.id) return { ok: false, message: LOGIN };
  try {
    return { ok: true, data: await generateInsight(user.id, { force: Boolean(force) }) };
  } catch (e) {
    const err = e instanceof AssistantError ? e : classifyGeminiError(e);
    if (err.code === "unknown") console.error("[assistant] insight failed:", e instanceof Error ? e.message.slice(0, 200) : "error");
    return { ok: false, message: err.message };
  }
}
