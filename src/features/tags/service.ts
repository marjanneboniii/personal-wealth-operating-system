/**
 * Transaction hashtags — a reporting dimension beside the immutable ledger.
 *
 * Tags live in `entry_tags`, keyed by entry; they never touch postings, so
 * adding or removing one after posting is safe (a void entry keeps its tags,
 * and every total below counts posted entries only). Tenancy follows
 * journal_entries.user_id with the same fail-closed resolution as the ledger
 * reads. Writers must verify entry ownership before calling in here.
 */
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { entryTags } from "@/db/schema";
import { hasMultipleUsers, resolveQueryUserId } from "@/features/ledger/queries";
import { MAX_TAGS_PER_ENTRY, normalizeTag, parseTags } from "./normalize";

export type TagCount = { tag: string; entries: number };

export type TagSummary = {
  tag: string;
  /** Posted entries carrying the tag. */
  entries: number;
  /** Net spend on expense accounts, USD base. */
  expenseUsd: string;
  /** FROZEN commit-time Toman of the expense entries — display only. */
  expenseToman: string;
  expenseEntries: number;
  /** Expense entries with a frozen Toman snapshot; < expenseEntries = partial Toman. */
  expenseEntriesWithSnap: number;
  incomeUsd: string;
  incomeToman: string;
  incomeEntries: number;
  incomeEntriesWithSnap: number;
  firstDate: string | null;
  lastDate: string | null;
};

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const res = await db.execute(query);
  return res.rows as T[];
}

/** Replace the tag set of one entry. Returns the stored tags. */
export async function setEntryTags(entryId: string, input: string | string[]): Promise<string[]> {
  const tags = parseTags(input);
  if (tags.length > MAX_TAGS_PER_ENTRY) throw new Error(`حداکثر ${MAX_TAGS_PER_ENTRY} برچسب برای هر تراکنش مجاز است.`);
  await db.transaction(async (tx) => {
    await tx
      .delete(entryTags)
      .where(tags.length ? and(eq(entryTags.entryId, entryId), notInArray(entryTags.tag, tags)) : eq(entryTags.entryId, entryId));
    if (tags.length) {
      await tx
        .insert(entryTags)
        .values(tags.map((tag) => ({ entryId, tag })))
        .onConflictDoNothing();
    }
  });
  return tags;
}

/** Add one tag to many entries (bulk action). Entries already at the cap are refused as a whole. */
export async function addTagToEntries(entryIds: string[], raw: string): Promise<string> {
  const tag = normalizeTag(raw);
  if (!tag) throw new Error("برچسب معتبر نیست.");
  if (!entryIds.length) return tag;
  const full = await db
    .select({ entryId: entryTags.entryId, n: sql<number>`count(*)::int` })
    .from(entryTags)
    .where(inArray(entryTags.entryId, entryIds))
    .groupBy(entryTags.entryId)
    .having(sql`count(*) >= ${MAX_TAGS_PER_ENTRY} and bool_and(${entryTags.tag} <> ${tag})`);
  if (full.length) throw new Error(`برخی تراکنش‌ها از قبل ${MAX_TAGS_PER_ENTRY} برچسب دارند.`);
  await db
    .insert(entryTags)
    .values(entryIds.map((entryId) => ({ entryId, tag })))
    .onConflictDoNothing();
  return tag;
}

/** Every tag the tenant uses, most used first. */
export async function listTags(userId?: string): Promise<TagCount[]> {
  const u = await resolveQueryUserId(userId);
  if (!u && (await hasMultipleUsers())) return [];
  return rows<TagCount>(sql`
    select t.tag, count(*)::int as entries
    from entry_tags t
      join journal_entries je on je.id = t.entry_id
    where je.status = 'posted'
      ${u ? sql`and je.user_id = ${u}` : sql``}
    group by t.tag
    order by count(*) desc, t.tag asc
    limit 200
  `);
}

/**
 * All-time totals for one tag (a trip, a renovation). Mirrors the cash-flow
 * rules: posted entries only, debt repayments are never spend, and Toman is
 * the frozen commit-time snapshot — never a re-derivation at today's rate.
 */
export async function getTagSummary(rawTag: string, userId?: string): Promise<TagSummary | null> {
  const tag = normalizeTag(rawTag);
  if (!tag) return null;
  const u = await resolveQueryUserId(userId);
  if (!u && (await hasMultipleUsers())) return null;
  const [r] = await rows<Omit<TagSummary, "tag">>(sql`
    with tagged as (
      select je.id, je.entry_date, je.type
      from entry_tags t
        join journal_entries je on je.id = t.entry_id
      where t.tag = ${tag} and je.status = 'posted'
        ${u ? sql`and je.user_id = ${u}` : sql``}
    ),
    per_entry as (
      select tg.id,
             coalesce(sum(p.base_value) filter (where a.type = 'expense'), 0) as exp_usd,
             coalesce(sum(-p.base_value) filter (where a.type = 'income'), 0) as inc_usd,
             (select s.irt_amount::numeric from entry_fx_snapshots s where s.entry_id = tg.id limit 1) as irt
      from tagged tg
        left join postings p on p.entry_id = tg.id
        left join accounts a on a.id = p.account_id
      where tg.type <> 'debt_repayment'
      group by tg.id
    )
    select (select count(*)::int from tagged) as entries,
           coalesce(sum(exp_usd), 0)::text as "expenseUsd",
           coalesce(sum(irt) filter (where exp_usd <> 0), 0)::text as "expenseToman",
           count(*) filter (where exp_usd <> 0)::int as "expenseEntries",
           count(*) filter (where exp_usd <> 0 and irt is not null)::int as "expenseEntriesWithSnap",
           coalesce(sum(inc_usd), 0)::text as "incomeUsd",
           coalesce(sum(irt) filter (where inc_usd <> 0), 0)::text as "incomeToman",
           count(*) filter (where inc_usd <> 0)::int as "incomeEntries",
           count(*) filter (where inc_usd <> 0 and irt is not null)::int as "incomeEntriesWithSnap",
           (select min(entry_date)::text from tagged) as "firstDate",
           (select max(entry_date)::text from tagged) as "lastDate"
    from per_entry
  `);
  return r ? { tag, ...r } : null;
}
