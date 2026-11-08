/**
 * دستیار هوشمند — the model fallback chain, end to end through runChatTurn,
 * against a fake Gemini client (the suite never reaches the network).
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { users } from "../src/db/schema";

type Behaviour = "ok" | "503" | "404" | "403" | "partial-then-503";
const behaviour = new Map<string, Behaviour>();
const calls: string[] = [];

class FakeApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function* answer(model: string, kind: Behaviour) {
  if (kind === "partial-then-503") {
    yield { candidates: [{ content: { parts: [{ text: "نیمه‌کاره " }] } }] };
    throw new FakeApiError(503, "overloaded");
  }
  yield { candidates: [{ content: { parts: [{ text: `پاسخ از ${model}` }] } }] };
  yield { candidates: [{ content: { parts: [{ text: "\n[[FOLLOWUPS]]\n- بعدی؟" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
}

const fakeClient = {
  models: {
    generateContentStream: async ({ model }: { model: string }) => {
      calls.push(model);
      const kind = behaviour.get(model) ?? "ok";
      if (kind === "503") throw new FakeApiError(503, "The model is overloaded.");
      if (kind === "404") throw new FakeApiError(404, `models/${model} is not found`);
      if (kind === "403") throw new FakeApiError(403, "API key not valid");
      return answer(model, kind);
    },
  },
};
let cookie: string | null = null;
mock.module("next/headers", { namedExports: { cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined), set: () => {}, delete: () => {} }), headers: async () => new Headers() } });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

async function turn(models: string) {
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_MODELS = models;
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { runChatTurn } = await import("../src/features/assistant/chat");
  (await import("../src/features/assistant/gemini")).setGeminiClientForTests(fakeClient as any);
  await createSchemaIfNotExists();
  const [u] = await db.insert(users).values({ name: "f", username: `ai-f-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
  const events: any[] = [];
  for await (const ev of runChatTurn({ userId: u.id, message: "وضعیت مالی من؟" })) events.push(ev);
  return events;
}

test("an overloaded model hands over to the next one", async () => {
  behaviour.clear();
  calls.length = 0;
  behaviour.set("fb-a", "503");
  const ev = await turn("fb-a,fb-b,fb-c");
  const done = ev.find((e) => e.type === "done");
  assert.ok(done, JSON.stringify(ev.filter((e) => e.type === "error")));
  assert.equal(done.model, "fb-b");
  assert.equal(done.content, "پاسخ از fb-b");
  assert.deepEqual(done.suggestions, ["بعدی؟"]);
  assert.ok(ev.some((e) => e.type === "status" && /مدل دیگر/.test(e.label)));
  assert.ok(!calls.includes("fb-c"), "stops at the first model that answers");
});

test("text a failing model already streamed is withdrawn before the next one answers", async () => {
  behaviour.clear();
  calls.length = 0;
  behaviour.set("fb-p", "partial-then-503");
  const ev = await turn("fb-p,fb-q");
  const reset = ev.find((e) => e.type === "reset");
  assert.ok(reset, "a reset event clears the half answer");
  assert.equal(reset.content, "");
  assert.equal(ev.find((e) => e.type === "done").content, "پاسخ از fb-q");
});

test("a retired model is skipped on later turns", async () => {
  behaviour.clear();
  calls.length = 0;
  behaviour.set("fb-gone", "404");
  await turn("fb-gone,fb-live");
  await turn("fb-gone,fb-live");
  assert.equal(calls.filter((m) => m === "fb-gone").length, 1, "404 is remembered");
});

test("a bad key does not burn through the chain", async () => {
  behaviour.clear();
  calls.length = 0;
  behaviour.set("fb-k1", "403");
  const ev = await turn("fb-k1,fb-k2");
  assert.equal(ev.at(-1).type, "error");
  assert.equal(ev.at(-1).code, "invalid_key");
  assert.deepEqual(calls, ["fb-k1"]);
});

test("when every model fails the user gets one clear error", async () => {
  behaviour.clear();
  calls.length = 0;
  behaviour.set("fb-x", "503");
  behaviour.set("fb-y", "503");
  const ev = await turn("fb-x,fb-y");
  assert.equal(ev.at(-1).type, "error");
  assert.equal(ev.at(-1).code, "unavailable");
  assert.deepEqual(calls, ["fb-x", "fb-y"]);
});
