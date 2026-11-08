import crypto from "node:crypto";
import { Type, type FunctionDeclaration } from "@google/genai";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries } from "@/db/schema";
import { getTransactions } from "@/features/ledger/queries";
import { getCategoryById, getFlowByCategory, listCategoryTree, type CategoryRow } from "@/features/categories/service";
import { listInstallmentSchedule } from "@/features/planning/service";
import { recentJalaliMonths, todayIso } from "@/lib/format";
import { txToman, type FinancialSnapshot } from "./snapshot";
import { addMemory, deleteMemory, type MemoryKind, type RecategorizeProposal } from "./store";

/**
 * Tools the model may call to look deeper than the summary snapshot.
 *
 * Every executor runs with the AUTHENTICATED user's id, fixed by the server —
 * the model can never name a user, and every read goes through the same
 * tenant-scoped services the pages use. Only two tools write, and neither
 * touches money:
 *   • save_memory / delete_memory — the user's own notes to the assistant;
 *   • propose_recategorization — only RECORDS a suggestion; the category of a
 *     transaction changes when the user presses «اعمال» (see actions/assistant).
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "search_transactions",
    description:
      "Search the user's posted transactions. Use it for questions about specific spending, merchants, descriptions, duplicates, or to inspect transactions before suggesting a category. Returns at most 60 rows, newest first; amounts in Toman.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        from: { type: Type.STRING, description: "Start date, ISO YYYY-MM-DD (Gregorian). Default: 30 days ago." },
        to: { type: Type.STRING, description: "End date inclusive, ISO YYYY-MM-DD. Default: today." },
        type: {
          type: Type.STRING,
          description: "Entry type filter.",
          enum: ["expense", "income", "transfer", "debt_repayment", "buy", "sell", "fx", "adjustment"],
        },
        query: { type: Type.STRING, description: "Text that must appear in the description (merchant, keyword)." },
        category: { type: Type.STRING, description: "Category or category-group name to filter by (substring match)." },
        min_toman: { type: Type.NUMBER, description: "Only transactions of at least this many Toman." },
        limit: { type: Type.INTEGER, description: "Max rows (1-60). Default 40." },
      },
    },
  },
  {
    name: "get_category_history",
    description: "Monthly totals per category group for the last N Jalali months (current month included, partial). Use for trends and month-over-month comparisons.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        months: { type: Type.INTEGER, description: "Number of months, 2-12. Default 6." },
        kind: { type: Type.STRING, enum: ["expense", "income"], description: "Default expense." },
      },
    },
  },
  {
    name: "get_installment_schedule",
    description: "Every unpaid installment (payable and receivable) due within the next N months, grouped by month. Use for the obligations calendar and cash-pressure questions.",
    parameters: {
      type: Type.OBJECT,
      properties: { months: { type: Type.INTEGER, description: "Horizon in months, 1-24. Default 6." } },
    },
  },
  {
    name: "list_categories",
    description: "The user's category tree (leaf ids, names and their group). Call before propose_recategorization to get a valid category_id.",
    parameters: {
      type: Type.OBJECT,
      properties: { kind: { type: Type.STRING, enum: ["expense", "income"], description: "Default expense." } },
    },
  },
  {
    name: "propose_recategorization",
    description:
      "Record a SUGGESTION to move one transaction to another category. Nothing changes until the user approves it in the UI. Only suggest when the evidence (description, amount, similar transactions) supports it; state confidence honestly. Max 10 per answer.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        entry_id: { type: Type.STRING, description: "Transaction id from search_transactions." },
        category_id: { type: Type.STRING, description: "Target leaf category id from list_categories." },
        confidence: { type: Type.NUMBER, description: "0..1 — how sure you are." },
        reason: { type: Type.STRING, description: "One short sentence, in the user's language, why." },
      },
      required: ["entry_id", "category_id", "confidence", "reason"],
    },
  },
  {
    name: "save_memory",
    description:
      "Remember a durable fact the user stated about themselves: a financial goal, a preference, a constraint (e.g. 'rent is fixed, cannot be reduced'), or a fact the data cannot show. Never store numbers that the app's data already holds (balances, totals) — those must always be read fresh.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        kind: { type: Type.STRING, enum: ["goal", "preference", "constraint", "fact"] },
        content: { type: Type.STRING, description: "One short sentence." },
      },
      required: ["kind", "content"],
    },
  },
  {
    name: "delete_memory",
    description: "Forget a remembered note that the user says is wrong or no longer true (id from the memory list). Save the corrected version with save_memory.",
    parameters: { type: Type.OBJECT, properties: { id: { type: Type.STRING } }, required: ["id"] },
  },
];

export type ToolContext = {
  userId: string;
  snapshot: FinancialSnapshot;
  proposals: RecategorizeProposal[];
  memoryChanged: boolean;
};

const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt;
};
const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>> {
  try {
    switch (name) {
      case "search_transactions":
        return await searchTransactions(args, ctx);
      case "get_category_history":
        return await categoryHistory(args, ctx);
      case "get_installment_schedule":
        return await installmentSchedule(args, ctx);
      case "list_categories":
        return await categories(args, ctx);
      case "propose_recategorization":
        return await propose(args, ctx);
      case "save_memory": {
        const kind = String(args.kind) as MemoryKind;
        if (!["goal", "preference", "constraint", "fact"].includes(kind)) return { error: "invalid kind" };
        const m = await addMemory(ctx.userId, kind, String(args.content ?? ""));
        ctx.memoryChanged = ctx.memoryChanged || m != null;
        return m ? { saved: true, id: m.id } : { saved: false, reason: "empty or already remembered" };
      }
      case "delete_memory": {
        const id = String(args.id ?? "");
        if (!UUID.test(id)) return { error: "invalid id" };
        await deleteMemory(ctx.userId, id);
        ctx.memoryChanged = true;
        return { deleted: true };
      }
      default:
        return { error: `unknown tool ${name}` };
    }
  } catch (e) {
    console.error("[assistant] tool failed:", name, e instanceof Error ? e.message : e);
    return { error: "tool failed; answer from the summary data and say this detail could not be loaded" };
  }
}

async function searchTransactions(args: Record<string, unknown>, ctx: ToolContext) {
  const today = todayIso();
  const from = typeof args.from === "string" && ISO.test(args.from) ? args.from : addDays(today, -30);
  const to = typeof args.to === "string" && ISO.test(args.to) ? args.to : today;
  const limit = clampInt(args.limit, 1, 60, 40);
  const query = typeof args.query === "string" ? args.query.trim().slice(0, 60) : "";
  const category = typeof args.category === "string" ? args.category.trim() : "";
  const minToman = Number(args.min_toman) || 0;
  const type = typeof args.type === "string" && /^[a-z_]{2,20}$/.test(args.type) ? args.type : undefined;
  const rows = await getTransactions({ userId: ctx.userId, from, to, type, q: query || undefined, limit: category || minToman ? 500 : limit });
  const rate = ctx.snapshot.usdToToman;
  const out = rows
    .map((t) => {
      const assetLeg = t.lines.find((l) => l.accountType === "asset" && Number(l.quantity) < 0) ?? t.lines.find((l) => l.accountType === "asset");
      return {
        id: t.id,
        date: t.entryDate,
        type: t.type,
        description: (t.description ?? "").slice(0, 90),
        amountToman: txToman(t, rate),
        category: t.categoryName ?? null,
        group: t.categoryParentName ?? null,
        account: assetLeg?.account ?? null,
        reviewed: t.reviewed,
      };
    })
    .filter((t) => !category || `${t.category ?? ""} ${t.group ?? ""}`.includes(category))
    .filter((t) => t.amountToman >= minToman)
    .slice(0, limit);
  return { from, to, count: out.length, transactions: out };
}

async function categoryHistory(args: Record<string, unknown>, ctx: ToolContext) {
  const months = clampInt(args.months, 2, 12, 6);
  const kind = args.kind === "income" ? "income" : "expense";
  const rate = ctx.snapshot.usdToToman;
  const today = todayIso();
  const buckets = recentJalaliMonths(months, today);
  const results = await Promise.all(
    buckets.map((b) => getFlowByCategory(1, ctx.userId, kind, { from: b.start, to: b.end > today ? addDays(today, 1) : b.end })),
  );
  return {
    kind,
    months: buckets.map((b, i) => {
      const groups = new Map<string, number>();
      for (const r of results[i]) {
        const toman = r.entries > 0 && r.entriesWithSnap === r.entries ? Number(r.totalToman) : Number(r.total) * rate;
        const g = r.parentName ?? r.name;
        groups.set(g, (groups.get(g) ?? 0) + toman);
      }
      return {
        monthStart: b.start,
        partial: b.end > today,
        totalToman: Math.round([...groups.values()].reduce((s, v) => s + v, 0)),
        groups: Object.fromEntries([...groups.entries()].sort((a, c) => c[1] - a[1]).map(([k, v]) => [k, Math.round(v)])),
      };
    }),
  };
}

async function installmentSchedule(args: Record<string, unknown>, ctx: ToolContext) {
  const months = clampInt(args.months, 1, 24, 6);
  const today = todayIso();
  const end = addDays(today, months * 31);
  const { rows } = await listInstallmentSchedule(ctx.userId);
  const open = rows.filter((r) => r.status !== "paid" && r.dueDate <= end && Number(r.dueToman) > 0);
  const byMonth = new Map<string, { payableToman: number; receivableToman: number; items: unknown[] }>();
  for (const r of open) {
    const key = String(r.dueDate).slice(0, 7);
    const b = byMonth.get(key) ?? { payableToman: 0, receivableToman: 0, items: [] };
    const toman = Math.round(Number(r.dueToman));
    if (r.direction === "receivable") b.receivableToman += toman;
    else b.payableToman += toman;
    b.items.push({ date: r.dueDate, title: r.title, toman, direction: r.direction, overdue: r.dueDate < today });
    byMonth.set(key, b);
  }
  return { horizonEnd: end, months: Object.fromEntries([...byMonth.entries()].sort()) };
}

async function categories(args: Record<string, unknown>, ctx: ToolContext) {
  const kind = args.kind === "income" ? "income" : "expense";
  const tree = await listCategoryTree(ctx.userId, kind);
  return {
    kind,
    groups: tree.map((g) => ({
      group: g.name,
      leaves: (g.children.length ? g.children : [g]).filter((c) => c.nature === "cash").map((c) => ({ id: c.id, name: c.name, rule: c.description?.slice(0, 80) ?? undefined })),
    })),
  };
}

/** Validates a suggestion against the same rules the apply step enforces, so the UI never offers one that would be refused. */
export async function validateRecategorization(userId: string, entryId: string, categoryId: string): Promise<{ ok: true; entry: { type: string; categoryId: string | null }; category: CategoryRow; from: CategoryRow | null } | { ok: false; error: string }> {
  if (!UUID.test(entryId) || !UUID.test(categoryId)) return { ok: false, error: "invalid id" };
  const [entry] = await db
    .select({ id: journalEntries.id, type: journalEntries.type, status: journalEntries.status, categoryId: journalEntries.categoryId })
    .from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.userId, userId)))
    .limit(1);
  if (!entry) return { ok: false, error: "transaction not found" };
  if (entry.status !== "posted") return { ok: false, error: "transaction is not posted" };
  if (entry.type !== "expense" && entry.type !== "income") return { ok: false, error: "only expense/income transactions carry a category" };
  const category = await getCategoryById(categoryId, userId);
  if (!category || !category.isActive) return { ok: false, error: "category not found" };
  if (category.kind !== entry.type) return { ok: false, error: `category kind ${category.kind} does not match transaction type ${entry.type}` };
  // A non-cash (depreciation/reserve) category posts against a different
  // account; moving into or out of one would need new postings. Category is
  // otherwise reporting-only metadata, which is why only cash ↔ cash moves.
  if (category.nature !== "cash") return { ok: false, error: "non-cash categories cannot be assigned here" };
  const from = entry.categoryId ? await getCategoryById(entry.categoryId, userId) : null;
  if (from && from.nature !== "cash") return { ok: false, error: "transaction is in a non-cash category" };
  if (entry.categoryId === categoryId) return { ok: false, error: "already in that category" };
  return { ok: true, entry, category, from };
}

async function propose(args: Record<string, unknown>, ctx: ToolContext) {
  if (ctx.proposals.length >= 10) return { error: "limit of 10 suggestions per answer reached" };
  const entryId = String(args.entry_id ?? "");
  const categoryId = String(args.category_id ?? "");
  const v = await validateRecategorization(ctx.userId, entryId, categoryId);
  if (!v.ok) return { accepted: false, error: v.error };
  const [tx] = await getTransactions({ userId: ctx.userId, id: entryId, limit: 1 });
  const confidence = Math.min(1, Math.max(0, Number(args.confidence) || 0));
  const proposal: RecategorizeProposal = {
    id: crypto.randomUUID(),
    kind: "recategorize",
    entryId,
    entryDate: tx?.entryDate ?? "",
    description: (tx?.description ?? "").slice(0, 90),
    amountToman: tx ? txToman(tx, ctx.snapshot.usdToToman) : 0,
    fromCategory: v.from?.name ?? null,
    toCategoryId: categoryId,
    toCategoryName: v.category.name,
    confidence,
    reason: String(args.reason ?? "").slice(0, 200),
    status: "pending",
  };
  ctx.proposals.push(proposal);
  return { accepted: true, note: "Shown to the user as a suggestion with an approve button. Do not claim it has been applied." };
}
