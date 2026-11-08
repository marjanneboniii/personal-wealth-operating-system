import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { assistantConversations, assistantInsights, assistantMemories, assistantMessages } from "@/db/schema";
import { decryptSensitive, encryptSensitive } from "@/lib/fieldEncryption";

/**
 * Persistence for the assistant. Every read and write is scoped by user_id in
 * SQL (the app's tenant-isolation mechanism — see src/db/index.ts). Message,
 * memory and analysis text is encrypted at rest with the app's field
 * encryption, bound to the owning user (AAD), so a row copied to another
 * tenant does not decrypt.
 */

export type RecategorizeProposal = {
  id: string;
  kind: "recategorize";
  entryId: string;
  entryDate: string;
  description: string;
  amountToman: number;
  fromCategory: string | null;
  toCategoryId: string;
  toCategoryName: string;
  confidence: number;
  reason: string;
  status: "pending" | "applied" | "dismissed";
};

export type MessageMeta = {
  proposals?: RecategorizeProposal[];
  suggestions?: string[];
  model?: string;
  usage?: { input: number; output: number };
  error?: boolean;
};

export type StoredMessage = { id: string; role: "user" | "model"; content: string; meta: MessageMeta; createdAt: string };
export type ConversationSummary = { id: string; title: string; updatedAt: string };
export type MemoryKind = "goal" | "preference" | "constraint" | "fact";
export type Memory = { id: string; kind: MemoryKind; content: string; createdAt: string };

const ctx = (userId: string) => `assistant:${userId}`;
const enc = (userId: string, text: string) => encryptSensitive(text, ctx(userId)) ?? "";
function dec(userId: string, value: string): string {
  try {
    return decryptSensitive(value, ctx(userId)) ?? "";
  } catch {
    return "";
  }
}
const iso = (d: Date | string | null) => (d instanceof Date ? d.toISOString() : d ? String(d) : "");

export const MAX_MEMORIES = 40;

export async function listConversations(userId: string, limit = 50): Promise<ConversationSummary[]> {
  const rows = await db
    .select({ id: assistantConversations.id, title: assistantConversations.title, createdAt: assistantConversations.createdAt, updatedAt: assistantConversations.updatedAt })
    .from(assistantConversations)
    .where(and(eq(assistantConversations.userId, userId), isNull(assistantConversations.deletedAt)))
    .orderBy(desc(sql`coalesce(${assistantConversations.updatedAt}, ${assistantConversations.createdAt})`))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: iso(r.updatedAt ?? r.createdAt) }));
}

export async function getConversation(userId: string, id: string): Promise<ConversationSummary | null> {
  const [r] = await db
    .select()
    .from(assistantConversations)
    .where(and(eq(assistantConversations.id, id), eq(assistantConversations.userId, userId), isNull(assistantConversations.deletedAt)))
    .limit(1);
  return r ? { id: r.id, title: r.title, updatedAt: iso(r.updatedAt ?? r.createdAt) } : null;
}

export async function createConversation(userId: string, firstMessage: string): Promise<string> {
  const title = firstMessage.replace(/\s+/g, " ").trim().slice(0, 60) || "گفتگوی تازه";
  const [r] = await db.insert(assistantConversations).values({ userId, title, updatedAt: new Date() }).returning({ id: assistantConversations.id });
  return r.id;
}

export async function renameConversation(userId: string, id: string, title: string) {
  await db
    .update(assistantConversations)
    .set({ title: title.trim().slice(0, 80) || "گفتگو", updatedAt: new Date() })
    .where(and(eq(assistantConversations.id, id), eq(assistantConversations.userId, userId)));
}

/** Hard delete: the messages hold financial detail the user asked to be rid of. */
export async function deleteConversation(userId: string, id: string) {
  await db.delete(assistantConversations).where(and(eq(assistantConversations.id, id), eq(assistantConversations.userId, userId)));
}

export async function listMessages(userId: string, conversationId: string, limit = 200): Promise<StoredMessage[]> {
  const rows = await db
    .select()
    .from(assistantMessages)
    .where(and(eq(assistantMessages.conversationId, conversationId), eq(assistantMessages.userId, userId)))
    .orderBy(desc(assistantMessages.createdAt))
    .limit(limit);
  return rows.reverse().map((r) => ({ id: r.id, role: r.role as "user" | "model", content: dec(userId, r.contentEnc), meta: (r.meta ?? {}) as MessageMeta, createdAt: iso(r.createdAt) }));
}

export async function appendMessage(userId: string, conversationId: string, role: "user" | "model", content: string, meta: MessageMeta = {}): Promise<string> {
  const [r] = await db
    .insert(assistantMessages)
    .values({ userId, conversationId, role, contentEnc: enc(userId, content), meta })
    .returning({ id: assistantMessages.id });
  await db
    .update(assistantConversations)
    .set({ updatedAt: new Date() })
    .where(and(eq(assistantConversations.id, conversationId), eq(assistantConversations.userId, userId)));
  return r.id;
}

/** Replace a user message's text and drop everything after it (edit-and-resend). */
export async function truncateFrom(userId: string, conversationId: string, messageId: string) {
  const [m] = await db
    .select({ createdAt: assistantMessages.createdAt })
    .from(assistantMessages)
    .where(and(eq(assistantMessages.id, messageId), eq(assistantMessages.userId, userId), eq(assistantMessages.conversationId, conversationId)))
    .limit(1);
  if (!m) return false;
  await db
    .delete(assistantMessages)
    .where(and(eq(assistantMessages.conversationId, conversationId), eq(assistantMessages.userId, userId), sql`${assistantMessages.createdAt} >= ${m.createdAt}`));
  return true;
}

export async function getMessageMeta(userId: string, messageId: string): Promise<{ conversationId: string; meta: MessageMeta } | null> {
  const [r] = await db
    .select({ conversationId: assistantMessages.conversationId, meta: assistantMessages.meta })
    .from(assistantMessages)
    .where(and(eq(assistantMessages.id, messageId), eq(assistantMessages.userId, userId)))
    .limit(1);
  return r ? { conversationId: r.conversationId, meta: (r.meta ?? {}) as MessageMeta } : null;
}

export async function setMessageMeta(userId: string, messageId: string, meta: MessageMeta) {
  await db.update(assistantMessages).set({ meta }).where(and(eq(assistantMessages.id, messageId), eq(assistantMessages.userId, userId)));
}

/* ── memory: what the user asked the assistant to keep in mind ── */

export async function listMemories(userId: string): Promise<Memory[]> {
  const rows = await db.select().from(assistantMemories).where(eq(assistantMemories.userId, userId)).orderBy(asc(assistantMemories.createdAt)).limit(MAX_MEMORIES);
  return rows.map((r) => ({ id: r.id, kind: r.kind as MemoryKind, content: dec(userId, r.contentEnc), createdAt: iso(r.createdAt) })).filter((m) => m.content);
}

export async function addMemory(userId: string, kind: MemoryKind, content: string): Promise<Memory | null> {
  const text = content.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!text) return null;
  const existing = await listMemories(userId);
  if (existing.some((m) => m.content === text)) return null;
  if (existing.length >= MAX_MEMORIES) {
    await db.delete(assistantMemories).where(and(eq(assistantMemories.id, existing[0].id), eq(assistantMemories.userId, userId)));
  }
  const [r] = await db.insert(assistantMemories).values({ userId, kind, contentEnc: enc(userId, text) }).returning();
  return { id: r.id, kind, content: text, createdAt: iso(r.createdAt) };
}

export async function updateMemory(userId: string, id: string, content: string) {
  const text = content.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!text) return deleteMemory(userId, id);
  await db.update(assistantMemories).set({ contentEnc: enc(userId, text), updatedAt: new Date() }).where(and(eq(assistantMemories.id, id), eq(assistantMemories.userId, userId)));
}

export async function deleteMemory(userId: string, id: string) {
  await db.delete(assistantMemories).where(and(eq(assistantMemories.id, id), eq(assistantMemories.userId, userId)));
}

/* ── cached dashboard analysis ── */

export async function getCachedInsight(userId: string, hash: string, model: string): Promise<{ content: string; createdAt: string } | null> {
  const [r] = await db.select().from(assistantInsights).where(eq(assistantInsights.userId, userId)).limit(1);
  if (!r || r.snapshotHash !== hash || r.model !== model) return null;
  const content = dec(userId, r.contentEnc);
  return content ? { content, createdAt: iso(r.createdAt) } : null;
}

export async function getLatestInsight(userId: string): Promise<{ content: string; createdAt: string; hash: string } | null> {
  const [r] = await db.select().from(assistantInsights).where(eq(assistantInsights.userId, userId)).limit(1);
  if (!r) return null;
  const content = dec(userId, r.contentEnc);
  return content ? { content, createdAt: iso(r.createdAt), hash: r.snapshotHash } : null;
}

export async function saveInsight(userId: string, hash: string, model: string, content: string) {
  const values = { userId, snapshotHash: hash, model, contentEnc: enc(userId, content), createdAt: new Date() };
  await db
    .insert(assistantInsights)
    .values(values)
    .onConflictDoUpdate({ target: assistantInsights.userId, set: { snapshotHash: hash, model, contentEnc: values.contentEnc, createdAt: values.createdAt } });
}
