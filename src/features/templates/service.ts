/**
 * تکرار و میان‌بر — record a familiar transaction again without typing it again.
 *
 * Presentation only. Nothing here posts: a repeated entry and a saved shortcut
 * both open the ORDINARY form pre-filled, and the user reviews and confirms
 * as for any other transaction (same validation, same FX freeze, same
 * ownership checks on the server).
 *
 * Only the everyday shapes are offered — expense, income, transfer. A buy, a
 * sell or a repayment depends on prices, lots and schedules that a copy would
 * get wrong.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, transactionTemplates } from "@/db/schema";
import { D } from "@/domain/decimal";

export type RepeatableType = "expense" | "income" | "transfer";
const REPEATABLE: ReadonlySet<string> = new Set(["expense", "income", "transfer"]);
export const MAX_TEMPLATES = 12;

export type TxPrefill = {
  type: RepeatableType;
  accountId: string;
  counterAccountId: string | null;
  categoryId: string | null;
  amountToman: string | null;
  description: string;
  tags: string;
};

const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => ((await db.execute(q)) as { rows: T[] }).rows;

/** A past entry of this user, as the values to record it again with — or null. */
export async function entryPrefill(userId: string, entryId: string): Promise<TxPrefill | null> {
  const [entry] = await rows<{ type: string; description: string; categoryId: string | null; toman: string | null }>(sql`
    select je.type, je.description, je.category_id as "categoryId",
      (select s.irt_amount::text from entry_fx_snapshots s where s.entry_id = je.id limit 1) as toman
    from journal_entries je
    where je.id = ${entryId}::uuid and je.user_id = ${userId}::uuid and je.status = 'posted'
  `);
  if (!entry || !REPEATABLE.has(entry.type)) return null;
  const legs = await rows<{ accountId: string; quantity: string; symbol: string | null }>(sql`
    select p.account_id as "accountId", p.quantity::text as quantity, ast.symbol
    from postings p
      join accounts a on a.id = p.account_id and a.type = 'asset' and a.deleted_at is null and a.user_id = ${userId}::uuid
      left join assets ast on ast.id = p.asset_id
    where p.entry_id = ${entryId}::uuid
  `);
  const out = legs.find((l) => D(l.quantity).isNegative());
  const into = legs.find((l) => D(l.quantity).isPositive());
  const money = entry.type === "income" ? into : out;
  if (!money) return null;
  if (entry.type === "transfer" && !into) return null;
  const tags = await rows<{ tag: string }>(sql`select tag from entry_tags where entry_id = ${entryId}::uuid order by tag`);
  const toman = entry.toman ? D(entry.toman) : money.symbol === "IRT" ? D(money.quantity).abs() : null;
  return {
    type: entry.type as RepeatableType,
    accountId: money.accountId,
    counterAccountId: entry.type === "transfer" ? into!.accountId : null,
    categoryId: entry.type === "transfer" ? null : entry.categoryId,
    amountToman: toman && toman.gt(0) ? toman.toFixed(0) : null,
    description: entry.description,
    tags: tags.map((t) => `#${t.tag}`).join(" "),
  };
}

export type TemplateRow = TxPrefill & { id: string; label: string };

export async function listTemplates(userId: string): Promise<TemplateRow[]> {
  const list = (
    await db
      .select({ t: transactionTemplates })
      .from(transactionTemplates)
      // A shortcut whose account was deleted since is not offered.
      .innerJoin(accounts, and(eq(accounts.id, transactionTemplates.accountId), isNull(accounts.deletedAt)))
      .where(eq(transactionTemplates.userId, userId))
      .orderBy(asc(transactionTemplates.createdAt))
  ).map((r) => r.t);
  return list.map((t) => ({
    id: t.id,
    label: t.label,
    type: t.type as RepeatableType,
    accountId: t.accountId,
    counterAccountId: t.counterAccountId,
    categoryId: t.categoryId,
    amountToman: t.amountToman ? D(t.amountToman).toFixed(0) : null,
    description: t.description,
    tags: t.tags ?? "",
  }));
}

export async function getTemplate(userId: string, id: string): Promise<TemplateRow | null> {
  return (await listTemplates(userId)).find((t) => t.id === id) ?? null;
}

/**
 * Save an entry's shape as a shortcut. `keepAmount: false` stores no amount —
 * for a bill whose figure changes every month, the form then asks for it.
 */
export async function saveTemplateFromEntry(userId: string, entryId: string, input: { label?: string | null; keepAmount?: boolean }): Promise<string> {
  const prefill = await entryPrefill(userId, entryId);
  if (!prefill) throw new Error("فقط هزینه، درآمد یا انتقالِ ثبت‌شده‌ی خودتان را می‌توان میان‌بر کرد.");
  const label = (input.label ?? "").trim() || prefill.description.slice(0, 40);
  if (label.length > 40) throw new Error("نام میان‌بر حداکثر ۴۰ نویسه است.");
  const [{ n }] = await rows<{ n: number }>(sql`select count(*)::int as n from transaction_templates where user_id = ${userId}::uuid`);
  if (n >= MAX_TEMPLATES) throw new Error(`حداکثر ${MAX_TEMPLATES.toLocaleString("fa-IR")} میان‌بر؛ یکی را حذف کنید.`);
  const [row] = await db
    .insert(transactionTemplates)
    .values({
      userId,
      label,
      type: prefill.type,
      accountId: prefill.accountId,
      counterAccountId: prefill.counterAccountId,
      categoryId: prefill.categoryId,
      amountToman: input.keepAmount === false ? null : prefill.amountToman,
      description: prefill.description.slice(0, 200),
      tags: prefill.tags.slice(0, 200) || null,
    })
    .returning({ id: transactionTemplates.id });
  return row.id;
}

export async function deleteTemplate(userId: string, id: string): Promise<void> {
  const res = await db
    .delete(transactionTemplates)
    .where(and(eq(transactionTemplates.id, id), eq(transactionTemplates.userId, userId)))
    .returning({ id: transactionTemplates.id });
  if (!res.length) throw new Error("میان‌بر پیدا نشد.");
}

/**
 * The quick actions the user reaches for most, in order: counts of recorded
 * entry types over the last 90 days. No settings page — the order follows use.
 */
export async function quickActionUsage(userId: string): Promise<Record<string, number>> {
  const list = await rows<{ type: string; n: number }>(sql`
    select je.type, count(*)::int as n from journal_entries je
    where je.user_id = ${userId}::uuid and je.status = 'posted' and je.source <> 'plan'
      and je.entry_date >= (current_date - interval '90 days')
      and je.type in ('expense','income','transfer','buy','sell')
    group by je.type
  `);
  return Object.fromEntries(list.map((r) => [r.type, r.n]));
}
