import type { Content, GenerateContentResponseUsageMetadata, Part } from "@google/genai";
import { checkRateLimit } from "@/lib/rateLimit";
import { AssistantError, attemptSignal, classifyGeminiError, getAssistantConfig, getGeminiClient, markModelUnavailable, shouldFallBack, usableModels } from "./gemini";
import { buildSystemInstruction, INSIGHT_PROMPT, splitFollowups } from "./prompt";
import { buildFinancialSnapshot, snapshotHash } from "./snapshot";
import {
  appendMessage,
  createConversation,
  getCachedInsight,
  getConversation,
  listMemories,
  listMessages,
  saveInsight,
  truncateFrom,
  type RecategorizeProposal,
} from "./store";
import { runTool, TOOL_DECLARATIONS, type ToolContext } from "./tools";

export type ChatEvent =
  | { type: "meta"; conversationId: string; title: string }
  | { type: "status"; label: string }
  | { type: "text"; delta: string }
  /** A model failed mid-answer and the next one starts over: replace the streamed text with `content`. */
  | { type: "reset"; content: string }
  | { type: "done"; messageId: string; model: string; content: string; suggestions: string[]; proposals: RecategorizeProposal[]; memoryChanged: boolean }
  | { type: "error"; code: string; message: string };

export const MAX_MESSAGE_CHARS = 4000;
const HISTORY_MESSAGES = 30;
const HISTORY_CHARS_EACH = 6000;
const MAX_TOOL_ROUNDS = 6;
/** Whole-turn budget, inside the route's 60 s maxDuration with room to save the answer. */
const TURN_BUDGET_MS = 54_000;
const MIN_ATTEMPT_MS = 8_000;

/** Silence allowed for the next attempt: the per-model limit, cut to what is left of the turn. */
function attemptBudget(deadline: number, perModel: number): number {
  const left = deadline - Date.now();
  if (left < MIN_ATTEMPT_MS) throw new AssistantError("timeout", 504);
  return Math.min(perModel, left);
}

const TOOL_STATUS: Record<string, string> = {
  search_transactions: "در حال بررسی تراکنش‌ها…",
  get_category_history: "در حال مقایسه‌ی هزینه‌ها در ماه‌های گذشته…",
  get_installment_schedule: "در حال بررسی تقویم اقساط…",
  list_categories: "در حال خواندن دسته‌بندی‌ها…",
  propose_recategorization: "در حال آماده کردن پیشنهاد دسته‌بندی…",
  save_memory: "در حال به خاطر سپردن…",
  delete_memory: "در حال به‌روز کردن یادداشت‌ها…",
};

/**
 * Thought signatures are bound to the model that produced them. When a later
 * round of the same turn runs on a different model, the documented
 * placeholder tells Gemini not to validate the foreign ones.
 */
function neutralizeSignatures(contents: Content[]): Content[] {
  return contents.map((c) =>
    c.role === "model" && c.parts?.some((p) => p.thoughtSignature)
      ? { ...c, parts: c.parts.map((p) => (p.thoughtSignature ? { ...p, thoughtSignature: "skip_thought_signature_validator" } : p)) }
      : c,
  );
}

/** Per-user request budget: protects the key's quota from a runaway client. */
async function enforceLimits(userId: string) {
  const minute = await checkRateLimit(`assistant:m:${userId}`, 10, 60);
  if (!minute.ok) throw new AssistantError("rate_limited", 429);
  const day = await checkRateLimit(`assistant:d:${userId}`, 200, 86_400);
  if (!day.ok) throw new AssistantError("quota", 429);
}

/**
 * One chat turn, as a stream of events. The user's message is stored before
 * the model is called (so it survives a failure); the answer is stored when it
 * is complete. Financial data is read fresh for every turn.
 */
export async function* runChatTurn(input: {
  userId: string;
  conversationId?: string | null;
  message: string;
  /** Edit-and-resend: replace this user message and everything after it. */
  editMessageId?: string | null;
  signal?: AbortSignal;
}): AsyncGenerator<ChatEvent> {
  const { userId } = input;
  const message = input.message.trim();
  const deadline = Date.now() + TURN_BUDGET_MS;
  try {
    if (!message) throw new AssistantError("unknown", 400);
    const config = getAssistantConfig();
    if (!config.configured) throw new AssistantError("not_configured", 503);
    await enforceLimits(userId);

    let conversationId = input.conversationId ?? null;
    let title = "";
    if (conversationId) {
      const conv = await getConversation(userId, conversationId);
      if (!conv) {
        yield { type: "error", code: "not_found", message: "این گفتگو پیدا نشد." };
        return;
      }
      title = conv.title;
      if (input.editMessageId) await truncateFrom(userId, conversationId, input.editMessageId);
    } else {
      conversationId = await createConversation(userId, message);
      title = message.slice(0, 60);
    }
    yield { type: "meta", conversationId, title };

    const history = await listMessages(userId, conversationId, HISTORY_MESSAGES);
    await appendMessage(userId, conversationId, "user", message);

    yield { type: "status", label: "در حال خواندن داده‌های مالی شما…" };
    const [snapshot, memories] = await Promise.all([buildFinancialSnapshot(userId), listMemories(userId)]);

    const contents: Content[] = [
      ...history
        .filter((m) => m.content && !m.meta.error)
        .map((m) => ({ role: m.role, parts: [{ text: m.content.slice(0, HISTORY_CHARS_EACH) }] })),
      { role: "user", parts: [{ text: message }] },
    ];
    // Gemini requires the conversation to start with a user turn and to
    // alternate; a turn that failed earlier leaves two user messages in a row.
    while (contents.length && contents[0].role !== "user") contents.shift();
    for (let i = contents.length - 1; i > 0; i--) {
      if (contents[i].role === contents[i - 1].role) {
        contents[i - 1] = { role: contents[i].role, parts: [...(contents[i - 1].parts ?? []), ...(contents[i].parts ?? [])] };
        contents.splice(i, 1);
      }
    }

    const ctx: ToolContext = { userId, snapshot, proposals: [], memoryChanged: false };
    const ai = getGeminiClient();
    const systemInstruction = buildSystemInstruction(snapshot, memories);
    let fullText = "";
    const usage = { input: 0, output: 0 };

    yield { type: "status", label: "در حال تحلیل…" };
    // The chain, strongest first. Once a model answers, later tool rounds of
    // this turn start with it (no point re-trying one that just failed).
    const chain = usableModels(config.models);
    let modelIdx = 0;
    let usedModel = chain[0];
    let switchedModel = false;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let parts: Part[] = [];
      let calls: { name: string; args: Record<string, unknown>; id?: string }[] = [];
      let finish: string | undefined;
      let blocked = false;
      let roundUsage: GenerateContentResponseUsageMetadata | undefined;
      const textBefore = fullText;
      for (;;) {
        const model = chain[modelIdx];
        const attempt = attemptSignal(input.signal, attemptBudget(deadline, config.attemptTimeoutMs));
        parts = [];
        calls = [];
        finish = undefined;
        blocked = false;
        roundUsage = undefined;
        try {
          const stream = await ai.models.generateContentStream({
            model,
            contents: switchedModel ? neutralizeSignatures(contents) : contents,
            config: {
              systemInstruction,
              tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
              temperature: 0.4,
              maxOutputTokens: 8192,
              abortSignal: attempt.signal,
            },
          });
          for await (const chunk of stream) {
            attempt.touch();
            if (chunk.promptFeedback?.blockReason) blocked = true;
            const cand = chunk.candidates?.[0];
            if (cand?.finishReason) finish = cand.finishReason;
            for (const part of cand?.content?.parts ?? []) {
              parts.push(part);
              if (part.functionCall?.name) calls.push({ name: part.functionCall.name, args: part.functionCall.args ?? {}, id: part.functionCall.id });
              else if (part.text && !part.thought) {
                fullText += part.text;
                yield { type: "text", delta: part.text };
              }
            }
            if (chunk.usageMetadata) roundUsage = chunk.usageMetadata;
          }
          attempt.done();
          usedModel = model;
          break;
        } catch (err) {
          attempt.done();
          if (input.signal?.aborted) throw err;
          const e = attempt.timedOut() ? new AssistantError("timeout", 504) : classifyGeminiError(err);
          if (e.code === "bad_model") {
            markModelUnavailable(model);
          } else if (e.code === "rate_limited" || e.code === "quota") {
            markModelUnavailable(model, 60_000);
          } else if (e.code === "unavailable") {
            markModelUnavailable(model, 30_000);
          }
          console.warn(`[assistant] model ${model} failed (${e.code}); ${modelIdx + 1 < chain.length && shouldFallBack(e) ? `falling back to ${chain[modelIdx + 1]}` : "no fallback left"}`);
          if (!shouldFallBack(e) || modelIdx + 1 >= chain.length || deadline - Date.now() < MIN_ATTEMPT_MS) throw e;
          modelIdx++;
          switchedModel = true;
          // Discard whatever the failed model streamed in this round.
          if (fullText !== textBefore) {
            fullText = textBefore;
            yield { type: "reset", content: textBefore };
          }
          yield { type: "status", label: `در حال تلاش با مدل جایگزین (${chain[modelIdx]})…` };
        }
      }
      // Each round is billed in full (the prompt is resent with the tool results).
      usage.input += roundUsage?.promptTokenCount ?? 0;
      usage.output += (roundUsage?.candidatesTokenCount ?? 0) + (roundUsage?.thoughtsTokenCount ?? 0);
      if (blocked || (!fullText && (finish === "SAFETY" || finish === "PROHIBITED_CONTENT" || finish === "BLOCKLIST"))) throw new AssistantError("blocked", 422);
      if (!calls.length) break;

      // Keep the model's own turn verbatim (thought signatures included) before answering its calls.
      contents.push({ role: "model", parts });
      const responses: Part[] = [];
      for (const call of calls) {
        yield { type: "status", label: TOOL_STATUS[call.name] ?? "در حال بررسی…" };
        const response = await runTool(call.name, call.args, ctx);
        responses.push({ functionResponse: { name: call.name, id: call.id, response } });
      }
      contents.push({ role: "user", parts: responses });
      if (fullText && !fullText.endsWith("\n")) {
        fullText += "\n\n";
        yield { type: "text", delta: "\n\n" };
      }
      if (round === MAX_TOOL_ROUNDS - 1) throw new AssistantError("timeout", 504);
    }

    const { answer, suggestions } = splitFollowups(fullText);
    if (!answer) throw new AssistantError("blocked", 422);
    const messageId = await appendMessage(userId, conversationId, "model", answer, {
      proposals: ctx.proposals,
      suggestions,
      model: usedModel,
      usage,
    });
    // Operational visibility without content: who-agnostic token accounting.
    console.info(`[assistant] turn model=${usedModel} in=${usage.input} out=${usage.output} proposals=${ctx.proposals.length}`);
    yield { type: "done", messageId, model: usedModel, content: answer, suggestions, proposals: ctx.proposals, memoryChanged: ctx.memoryChanged };
  } catch (err) {
    if (input.signal?.aborted) return;
    const e = classifyGeminiError(err);
    if (e.code === "unknown") console.error("[assistant] chat failed:", err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : "error");
    yield { type: "error", code: e.code, message: e.message };
  }
}

/**
 * The dashboard's written analysis. Cached per user against a hash of the
 * data it was written from: the same data never costs a second API call; a
 * change in the data (or the model) makes the cached text stale.
 */
export async function generateInsight(userId: string, opts: { force?: boolean } = {}): Promise<{ content: string; createdAt: string; cached: boolean; model?: string }> {
  const config = getAssistantConfig();
  if (!config.configured) throw new AssistantError("not_configured", 503);
  const snapshot = await buildFinancialSnapshot(userId, { fresh: true });
  const hash = snapshotHash(snapshot);
  // Keyed by the chain, not the model that happened to answer: a fallback's
  // analysis is just as reusable for the same data.
  const cacheKey = config.models.join(",");
  if (!opts.force) {
    const hit = await getCachedInsight(userId, hash, cacheKey);
    if (hit) return { ...hit, cached: true };
  }
  const limit = await checkRateLimit(`assistant:insight:${userId}`, 6, 3600);
  if (!limit.ok) throw new AssistantError("rate_limited", 429);
  const chain = usableModels(config.models);
  const deadline = Date.now() + TURN_BUDGET_MS;
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    const attempt = attemptSignal(undefined, attemptBudget(deadline, config.attemptTimeoutMs));
    try {
      const res = await getGeminiClient().models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: INSIGHT_PROMPT }] }],
        config: { systemInstruction: buildSystemInstruction(snapshot, []), temperature: 0.3, maxOutputTokens: 4096, abortSignal: attempt.signal },
      });
      attempt.done();
      const text = splitFollowups(res.text ?? "").answer;
      if (!text) throw new AssistantError("blocked", 422);
      await saveInsight(userId, hash, cacheKey, text);
      console.info(`[assistant] insight model=${model} in=${res.usageMetadata?.promptTokenCount ?? 0} out=${res.usageMetadata?.candidatesTokenCount ?? 0}`);
      return { content: text, createdAt: new Date().toISOString(), cached: false, model };
    } catch (err) {
      attempt.done();
      const e = attempt.timedOut() ? new AssistantError("timeout", 504) : classifyGeminiError(err);
      if (e.code === "bad_model") {
        markModelUnavailable(model);
      } else if (e.code === "rate_limited" || e.code === "quota") {
        markModelUnavailable(model, 60_000);
      } else if (e.code === "unavailable") {
        markModelUnavailable(model, 30_000);
      }
      if (!shouldFallBack(e) || i + 1 >= chain.length || deadline - Date.now() < MIN_ATTEMPT_MS) throw e;
      console.warn(`[assistant] insight model ${model} failed (${e.code}); falling back to ${chain[i + 1]}`);
    }
  }
  throw new AssistantError("unavailable", 503);
}
