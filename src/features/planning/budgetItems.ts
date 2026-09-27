/**
 * ریز اقلام بودجه — the lines of a tag budget (see `budgetItems` in schema).
 *
 * Every write is scoped to the budget's owner: a budget of another tenant is
 * «not found», never edited. A line's tag is fixed once created, so the
 * expenses already carrying it keep counting when the line is renamed.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { budgetItems, budgets } from "@/db/schema";
import { D } from "@/domain/decimal";
import { MAX_TAG_LENGTH, normalizeTag } from "@/features/tags/normalize";

export type BudgetItemInput = { title: string; amountToman: string };

export const MAX_BUDGET_ITEMS = 30;

const ownerClause = (userId: string | null) => (userId ? eq(budgets.userId, userId) : isNull(budgets.userId));

async function ownedBudget(budgetId: string, userId: string | null, client: any = db) {
  const [b] = await client
    .select({ id: budgets.id, tag: budgets.tag })
    .from(budgets)
    .where(and(eq(budgets.id, budgetId), isNull(budgets.deletedAt), ownerClause(userId)))
    .limit(1);
  if (!b) throw new Error("بودجه یافت نشد.");
  return b as { id: string; tag: string | null };
}

function cleanTitle(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length < 1 || t.length > 60) throw new Error("عنوان هر قلم باید بین ۱ تا ۶۰ نویسه باشد.");
  return t;
}

function cleanAmount(raw: string): string {
  const v = D(raw || "0");
  if (v.isNegative()) throw new Error("مبلغ قلم نمی‌تواند منفی باشد.");
  return v.toFixed(0);
}

/** «عروسی» + «لباس عروس» → «عروسی_لباس_عروس», unique inside the budget. */
export function lineTag(parentTag: string, title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = normalizeTag(`${parentTag}_${title}`) ?? normalizeTag(parentTag) ?? "قلم";
  let tag = base;
  for (let n = 2; used.has(tag); n++) {
    const suffix = `_${String(n).replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d)))}`;
    tag = Array.from(base).slice(0, MAX_TAG_LENGTH - suffix.length).join("") + suffix;
  }
  return tag;
}

export async function addBudgetItems(budgetId: string, items: BudgetItemInput[], userId: string | null, client: any = db) {
  if (!items.length) return [];
  const budget = await ownedBudget(budgetId, userId, client);
  if (!budget.tag) throw new Error("ریز اقلام فقط برای بودجه رویداد یا پروژه (بودجه روی برچسب) است.");
  const existing = await client.select({ tag: budgetItems.tag, sort: budgetItems.sort }).from(budgetItems).where(eq(budgetItems.budgetId, budgetId));
  if (existing.length + items.length > MAX_BUDGET_ITEMS) throw new Error(`حداکثر ${MAX_BUDGET_ITEMS} قلم برای هر بودجه.`);
  const taken = [budget.tag, ...existing.map((e: { tag: string }) => e.tag)];
  let sort = existing.reduce((m: number, e: { sort: number }) => Math.max(m, e.sort), -1);
  const rows = items.map((i) => {
    const title = cleanTitle(i.title);
    const tag = lineTag(budget.tag!, title, taken);
    taken.push(tag);
    return { budgetId, title, amountToman: cleanAmount(i.amountToman), tag, sort: ++sort };
  });
  return client.insert(budgetItems).values(rows).returning();
}

async function ownedItem(itemId: string, userId: string | null) {
  const [row] = await db
    .select({ id: budgetItems.id })
    .from(budgetItems)
    .innerJoin(budgets, eq(budgets.id, budgetItems.budgetId))
    .where(and(eq(budgetItems.id, itemId), isNull(budgets.deletedAt), ownerClause(userId)))
    .limit(1);
  if (!row) throw new Error("قلم یافت نشد.");
}

export async function updateBudgetItem(itemId: string, input: BudgetItemInput, userId: string | null) {
  await ownedItem(itemId, userId);
  await db
    .update(budgetItems)
    .set({ title: cleanTitle(input.title), amountToman: cleanAmount(input.amountToman), updatedAt: new Date() })
    .where(eq(budgetItems.id, itemId));
}

export async function deleteBudgetItem(itemId: string, userId: string | null) {
  await ownedItem(itemId, userId);
  await db.delete(budgetItems).where(eq(budgetItems.id, itemId));
}

/** Soft delete — the lines go with it; no expense or tag is touched. */
export async function deleteBudget(budgetId: string, userId: string | null) {
  await ownedBudget(budgetId, userId);
  await db.update(budgets).set({ deletedAt: new Date() } as never).where(eq(budgets.id, budgetId));
  await db.delete(budgetItems).where(sql`${budgetItems.budgetId} = ${budgetId}`);
}

/** Tags of this user's budgets still running (and of their lines) — offered first when tagging an expense. */
export async function listActiveBudgetTags(userId: string | null, today: string): Promise<string[]> {
  const res = await db.execute(sql`
    select b.tag, i.tag as item_tag
    from budgets b
      left join budget_items i on i.budget_id = b.id
    where b.deleted_at is null and b.tag is not null and b.period_end >= ${today}
      and ${userId ? sql`b.user_id = ${userId}` : sql`b.user_id is null`}
    order by b.period_end, i.sort
  `);
  const out: string[] = [];
  for (const r of res.rows as { tag: string; item_tag: string | null }[]) {
    for (const t of [r.tag, r.item_tag]) if (t && !out.includes(t)) out.push(t);
  }
  return out;
}
