/**
 * دستیار هوشمند — the deterministic analysis, the Gemini error/config layer,
 * the safe Markdown renderer, tenant isolation of the stored conversations,
 * and the rule that a category only changes when the user approves it.
 *
 * No test reaches the network: the model is never called here.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createReadySession } from "./support/ready-session";
import { users } from "../src/db/schema";
import {
  analyze,
  categoryTrends,
  findDuplicateCandidates,
  findSmallFrequent,
  forecastBudget,
  type AnalysisInput,
} from "../src/features/assistant/analysis";
import { splitFollowups, FOLLOWUPS_MARKER } from "../src/features/assistant/prompt";
import { AssistantError, attemptSignal, classifyGeminiError, DEFAULT_GEMINI_MODEL, getAssistantConfig, shouldFallBack } from "../src/features/assistant/gemini";
import Markdown from "../src/components/assistant/Markdown";

let cookie: string | null = null;
mock.module("next/headers", { namedExports: { cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined), set: () => {}, delete: () => {} }), headers: async () => new Headers() } });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

const baseInput = (over: Partial<AnalysisInput> = {}): AnalysisInput => ({
  today: "2026-11-08",
  availableCashToman: 0,
  convertibleToman: 0,
  liquidToman: 0,
  avgMonthlyExpenseToman: 0,
  avgMonthlyIncomeToman: 0,
  months: [],
  monthProgress: 0.5,
  budgets: [],
  categoryTrends: [],
  obligationsNext30Toman: 0,
  overdueInstallments: { count: 0, toman: 0 },
  debts: [],
  projectionDeficit: null,
  duplicates: [],
  smallFrequent: [],
  miscShare: null,
  unreviewed: 0,
  reconcileMismatches: 0,
  topClassShare: null,
  ...over,
});

test("budget forecast: pace, exhaust date and status", () => {
  // 10 of 30 days gone, 50% spent → projected 150%: at risk, ceiling hit on day 20.
  const f = forecastBudget({ name: "خوراک", limitToman: 3_000_000, spentToman: 1_500_000, periodStart: "2026-11-01", periodEnd: "2026-11-30" }, "2026-11-10");
  assert.equal(f.status, "at_risk");
  assert.equal(f.projectedToman, 4_500_000);
  assert.equal(f.exhaustDate, "2026-11-20");
  assert.equal(f.daysLeft, 20);
  assert.equal(forecastBudget({ name: "x", limitToman: 100, spentToman: 120, periodStart: "2026-11-01", periodEnd: "2026-11-30" }, "2026-11-10").status, "over");
  assert.equal(forecastBudget({ name: "x", limitToman: 3000, spentToman: 500, periodStart: "2026-11-01", periodEnd: "2026-11-30" }, "2026-11-10").status, "ok");
});

test("duplicate candidates need the same amount and description within a few days", () => {
  const tx = [
    { id: "1", date: "2026-11-01", description: "پرداخت قبض برق ۱۲۳۴", amountToman: 450_000, category: "قبوض" },
    { id: "2", date: "2026-11-02", description: "پرداخت قبض برق ۹۹۹۹", amountToman: 450_000, category: "قبوض" },
    { id: "3", date: "2026-11-20", description: "پرداخت قبض برق", amountToman: 450_000, category: "قبوض" },
    { id: "4", date: "2026-11-02", description: "اسنپ", amountToman: 450_000, category: "حمل‌ونقل" },
  ];
  const d = findDuplicateCandidates(tx);
  assert.equal(d.length, 1);
  assert.deepEqual([d[0].a.id, d[0].b.id], ["1", "2"]);
});

test("small frequent spending is grouped and ranked", () => {
  const tx = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, date: "2026-11-01", description: "کافه", amountToman: 80_000, category: "کافه و رستوران" }));
  tx.push({ id: "big", date: "2026-11-01", description: "اجاره", amountToman: 20_000_000, category: "مسکن" });
  const s = findSmallFrequent(tx, 40_000_000);
  assert.equal(s.length, 1);
  assert.equal(s[0].label, "کافه و رستوران");
  assert.equal(s[0].totalToman, 800_000);
});

test("category trends extrapolate the partial month against the baseline", () => {
  const t = categoryTrends([{ name: "خوراک", toman: 3_000_000 }], [{ name: "خوراک", toman: 12_000_000 }], 3, 0.5);
  assert.equal(t[0].paceToman, 6_000_000);
  assert.equal(t[0].baselineToman, 4_000_000);
  assert.equal(Math.round(t[0].changePct!), 50);
});

test("analysis invents nothing from empty data", () => {
  assert.deepEqual(analyze(baseInput()), []);
});

test("a cash shortfall outranks everything else, reported once", () => {
  const findings = analyze(
    baseInput({
      projectionDeficit: { month: "دی ۱۴۰۵", cumulativeToman: -5_000_000 },
      unreviewed: 3,
      topClassShare: { name: "طلا", pct: 80 },
      obligationsNext30Toman: 10_000_000,
      availableCashToman: 2_000_000,
    }),
  );
  assert.equal(findings[0].severity, "critical");
  assert.equal(findings[0].id, "obligations_exceed_cash", "the larger of the two gaps (8M now vs 5M later) is the one reported");
  assert.equal(findings.filter((f) => f.severity === "critical").length, 1, "one shortfall, one finding");
  assert.ok(findings.findIndex((f) => f.id === "unreviewed") > 0);
});

test("stablecoins covering a low Toman bank balance are a timing task, not a deficit", () => {
  const base = { projectionDeficit: { month: "بهمن ۱۴۰۵", cumulativeToman: -28_000_000 }, availableCashToman: 6_000_000, obligationsNext30Toman: 600_000 };
  const covered = analyze(baseInput({ ...base, convertibleToman: 1_200_000_000 }));
  assert.ok(!covered.some((f) => f.severity === "critical"), "no crisis when stablecoins cover the gap");
  const timing = covered.find((f) => f.id === "convert_in_time");
  assert.ok(timing, "says to convert in time instead");
  assert.match(timing!.detail, /۲۸ میلیون/);
  const short = analyze(baseInput({ ...base, convertibleToman: 10_000_000 }));
  assert.equal(short[0].id, "projection_deficit", "still a deficit when even the stablecoins are not enough");
  assert.match(short[0].detail, /۱۸ میلیون/, "reports only the part conversion cannot cover");
});

test("category spikes are one grouped finding, and small baselines or early-month pace don't trigger it", () => {
  const trends = [
    { name: "خوراک", currentToman: 3_000_000, paceToman: 6_000_000, baselineToman: 2_000_000, changePct: 200 },
    { name: "هدیه", currentToman: 1_900_000, paceToman: 3_800_000, baselineToman: 300_000, changePct: 1166 },
    { name: "سلامت", currentToman: 650_000, paceToman: 1_300_000, baselineToman: 200_000, changePct: 550 },
  ];
  const f = analyze(baseInput({ categoryTrends: trends, avgMonthlyExpenseToman: 10_000_000, monthProgress: 0.55 }));
  const spikes = f.filter((x) => x.id.startsWith("category_spike"));
  assert.equal(spikes.length, 1);
  assert.match(spikes[0].title, /۲ دسته/, "سلامت's 200k baseline is below 3% of monthly spending — its «+۵۵۰٪» is noise");
  assert.doesNotMatch(spikes[0].detail, /سلامت/);
  const early = analyze(baseInput({ categoryTrends: trends, avgMonthlyExpenseToman: 10_000_000, monthProgress: 0.15 }));
  assert.ok(!early.some((x) => x.id.startsWith("category_spike")), "four days into a month the pace is guesswork");
});

test("idle cash is an opportunity only when obligations and a 6-month buffer are covered", () => {
  const f = analyze(baseInput({ availableCashToman: 200_000_000, liquidToman: 200_000_000, avgMonthlyExpenseToman: 20_000_000, obligationsNext30Toman: 5_000_000 }));
  assert.ok(f.some((x) => x.id === "idle_cash"));
  const thin = analyze(baseInput({ availableCashToman: 10_000_000, liquidToman: 10_000_000, avgMonthlyExpenseToman: 20_000_000, obligationsNext30Toman: 15_000_000 }));
  assert.ok(!thin.some((x) => x.id === "idle_cash"));
});

test("follow-up suggestions are split off the answer", () => {
  const { answer, suggestions } = splitFollowups(`## پاسخ\nمتن\n${FOLLOWUPS_MARKER}\n- سؤال اول؟\n- سؤال دوم؟\n`);
  assert.equal(answer, "## پاسخ\nمتن");
  assert.deepEqual(suggestions, ["سؤال اول؟", "سؤال دوم؟"]);
  assert.deepEqual(splitFollowups("فقط پاسخ").suggestions, []);
});

test("config: the key is required; the fallback chain is strongest Flash first and configurable", () => {
  const dflt = getAssistantConfig({} as NodeJS.ProcessEnv);
  assert.equal(dflt.configured, false);
  assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.8-flash");
  assert.deepEqual(dflt.models, ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-flash-latest", "gemini-2.5-flash"]);
  assert.ok(!dflt.models.includes("gemini-3.7-flash"), "3.7 is routed to 3.8 by Google — useless as a fallback");
  assert.equal(dflt.attemptTimeoutMs, 30_000);
  const single = getAssistantConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-2.5-pro" } as unknown as NodeJS.ProcessEnv);
  assert.equal(single.configured, true);
  assert.deepEqual(single.models.slice(0, 2), ["gemini-2.5-pro", "gemini-3.8-flash"]);
  assert.deepEqual(getAssistantConfig({ GEMINI_MODELS: "a-1, b-2 ,bad model;" } as unknown as NodeJS.ProcessEnv).models, ["a-1", "b-2"]);
  assert.equal(getAssistantConfig({ GEMINI_MODEL: "bad model; drop" } as unknown as NodeJS.ProcessEnv).model, DEFAULT_GEMINI_MODEL);
  assert.equal(getAssistantConfig({ GEMINI_ATTEMPT_TIMEOUT_MS: "5" } as unknown as NodeJS.ProcessEnv).attemptTimeoutMs, 30_000);
  assert.equal(getAssistantConfig({ GEMINI_ATTEMPT_TIMEOUT_MS: "200000" } as unknown as NodeJS.ProcessEnv).attemptTimeoutMs, 30_000, "never beyond the function limit");
});

test("the silence timer aborts a model that stops answering, and every chunk restarts it", async () => {
  const quiet = attemptSignal(undefined, 40);
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(quiet.signal.aborted, true);
  assert.equal(quiet.timedOut(), true);
  quiet.done();

  const talking = attemptSignal(undefined, 40);
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 25));
    talking.touch();
  }
  assert.equal(talking.signal.aborted, false, "a model that keeps streaming is never cut off");
  talking.done();

  const parent = new AbortController();
  const child = attemptSignal(parent.signal, 10_000);
  parent.abort();
  assert.equal(child.signal.aborted, true, "the user's «توقف» aborts the attempt");
  assert.equal(child.timedOut(), false);
  child.done();
});

test("fallback happens only for errors another model could fix", () => {
  const e = (code: ConstructorParameters<typeof AssistantError>[0]) => shouldFallBack(new AssistantError(code));
  for (const c of ["timeout", "unavailable", "rate_limited", "quota", "bad_model"] as const) assert.equal(e(c), true, c);
  for (const c of ["invalid_key", "region", "blocked", "not_configured"] as const) assert.equal(e(c), false, c);
});

test("upstream failures map to clear messages and never echo upstream text", () => {
  const err = (status: number, message: string) => Object.assign(new Error(message), { status });
  assert.equal(classifyGeminiError(err(429, "Resource exhausted: rate per minute")).code, "rate_limited");
  assert.equal(classifyGeminiError(err(403, "API key not valid secret-ish")).code, "invalid_key");
  assert.equal(classifyGeminiError(err(400, "API key not valid. Please pass a valid API key.")).code, "invalid_key");
  assert.equal(classifyGeminiError(err(404, "models/x is not found")).code, "bad_model");
  assert.equal(classifyGeminiError(err(503, "overloaded")).code, "unavailable");
  assert.equal(classifyGeminiError(err(400, "User location is not supported for the API use.")).code, "region");
  assert.equal(classifyGeminiError(Object.assign(new Error("x"), { name: "AbortError" })).code, "timeout");
  const e = classifyGeminiError(err(403, "key AIzaSECRET leaked"));
  assert.ok(e instanceof AssistantError);
  assert.doesNotMatch(e.message, /AIza/);
});

test("Markdown renders tables and never injects model HTML", () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, { text: "## عنوان\n<script>alert(1)</script>\n\n| ماه | هزینه |\n|---|---|\n| آبان | **۱۰** |\n\n- یک\n- دو" }),
  );
  assert.match(html, /<table/);
  assert.match(html, /<strong>۱۰<\/strong>/);
  assert.match(html, /<ul/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("conversations, memories and suggestions are isolated per user; a category changes only on approval", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { journalEntries, expenseCategories } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const store = await import("../src/features/assistant/store");
  const { decideProposalAction, loadConversationAction, deleteConversationAction } = await import("../src/app/actions/assistant");
  const { ensureCategoryCatalog } = await import("../src/features/categories/service");
  await createSchemaIfNotExists();
  await ensureCategoryCatalog();
  const tag = Math.random().toString(36).slice(2, 8);
  const [a] = await db.insert(users).values({ name: "a", username: `ai-a-${tag}`, role: "user" } as any).returning();
  const [b] = await db.insert(users).values({ name: "b", username: `ai-b-${tag}`, role: "user" } as any).returning();

  const convA = await store.createConversation(a.id, "وضعیت مالی من؟");
  await store.appendMessage(a.id, convA, "user", "وضعیت مالی من؟");
  assert.equal((await store.listConversations(b.id)).length, 0, "B sees none of A's conversations");
  assert.equal(await store.getConversation(b.id, convA), null);
  assert.equal((await store.listMessages(b.id, convA)).length, 0);
  assert.equal((await store.listMessages(a.id, convA))[0].content, "وضعیت مالی من؟", "A reads its own message back decrypted");

  await store.addMemory(a.id, "goal", "تا تابستان برای خرید خودرو پس‌انداز می‌کنم");
  assert.equal((await store.listMemories(b.id)).length, 0);
  assert.equal((await store.listMemories(a.id)).length, 1);

  // A recorded suggestion on A's expense.
  const cats = await db.select().from(expenseCategories).where(eq(expenseCategories.kind, "expense"));
  const leaves = cats.filter((c) => c.level === 1 && c.nature === "cash" && !c.userId);
  assert.ok(leaves.length >= 2, "catalog has cash leaves");
  const [entry] = await db
    .insert(journalEntries)
    .values({ userId: a.id, entryDate: "2026-11-01", type: "expense", description: "اسنپ", status: "posted", source: "manual", categoryId: leaves[0].id } as any)
    .returning();
  const proposal = {
    id: crypto.randomUUID(),
    kind: "recategorize" as const,
    entryId: entry.id,
    entryDate: "2026-11-01",
    description: "اسنپ",
    amountToman: 150_000,
    fromCategory: leaves[0].name,
    toCategoryId: leaves[1].id,
    toCategoryName: leaves[1].name,
    confidence: 0.9,
    reason: "test",
    status: "pending" as const,
  };
  const msgId = await store.appendMessage(a.id, convA, "model", "پیشنهاد", { proposals: [proposal] });
  const categoryOf = async () => (await db.select({ c: journalEntries.categoryId }).from(journalEntries).where(eq(journalEntries.id, entry.id)))[0].c;
  assert.equal(await categoryOf(), leaves[0].id, "recording a suggestion changes nothing");

  // B cannot approve A's suggestion, read A's conversation, or delete it.
  cookie = (await createReadySession(b.id)).token;
  assert.equal((await decideProposalAction(msgId, proposal.id, "apply")).ok, false);
  assert.equal(await categoryOf(), leaves[0].id);
  const read = await loadConversationAction(convA);
  assert.ok(read.ok && read.data.length === 0);
  await deleteConversationAction(convA);
  assert.ok(await store.getConversation(a.id, convA), "B's delete did not touch A's conversation");

  // A approves → the category moves, once.
  cookie = (await createReadySession(a.id)).token;
  assert.equal((await decideProposalAction(msgId, proposal.id, "apply")).ok, true);
  assert.equal(await categoryOf(), leaves[1].id);
  assert.equal((await decideProposalAction(msgId, proposal.id, "apply")).ok, false, "a decided suggestion cannot be replayed");
  cookie = null;
});

test("the snapshot and every read tool run against a real database for a fresh user", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { buildFinancialSnapshot, snapshotHash } = await import("../src/features/assistant/snapshot");
  const { runTool } = await import("../src/features/assistant/tools");
  await createSchemaIfNotExists();
  const [u] = await db.insert(users).values({ name: "s", username: `ai-s-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
  cookie = (await createReadySession(u.id)).token;
  const snap = await buildFinancialSnapshot(u.id, { fresh: true });
  assert.equal(snap.cashflow.months.length, 6);
  assert.deepEqual(snap.budgets, []);
  assert.deepEqual(snap.debts, []);
  assert.ok(!snap.findings.some((f) => f.severity === "critical"), "an empty account has nothing critical");
  assert.equal(snapshotHash(snap), snapshotHash(snap));
  assert.doesNotMatch(JSON.stringify(snap), /password|token|iban|card_number/i);

  const ctx = { userId: u.id, snapshot: snap, proposals: [], memoryChanged: false };
  for (const [name, args] of [
    ["search_transactions", { limit: 5 }],
    ["get_category_history", { months: 3 }],
    ["get_installment_schedule", { months: 3 }],
    ["list_categories", {}],
  ] as const) {
    const out = await runTool(name, args, ctx);
    assert.equal(out.error, undefined, `${name} ran: ${JSON.stringify(out).slice(0, 200)}`);
  }
  const bad = await runTool("propose_recategorization", { entry_id: crypto.randomUUID(), category_id: crypto.randomUUID(), confidence: 0.9, reason: "x" }, ctx);
  assert.equal(bad.accepted, false, "a suggestion for a transaction the user does not own is refused");
  assert.equal(ctx.proposals.length, 0);
  cookie = null;
});
