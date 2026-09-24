/**
 * ملک: درآمد، هزینه و بازده خالص — what a property actually earns.
 *
 * The same rule as a car (features/vehicles): each property has ONE stable
 * hashtag, and its rent and running costs are ordinary transactions carrying
 * it — rent as income (usually «اجارهٔ ملک»), charges, repairs, bills and the
 * owner's taxes as expenses. Tags are editable after posting, so past rent and
 * bills can be linked retroactively. Premiums of insurance policies linked to
 * the property count as its costs too.
 *
 * Over the last 12 months:
 *   gross yield = rent ÷ current value
 *   net yield   = (rent − costs) ÷ current value
 * Read-only; nothing here posts.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, realEstateProperties } from "@/db/schema";
import { D } from "@/domain/decimal";
import { normalizeTag } from "@/features/tags/normalize";
import { todayIso } from "@/lib/format";

/** «سعادت_اباد», suffixed with the property's number only on a clash. PURE. */
export function propertyTag(area: string | null, seq: number | null | undefined, taken: ReadonlySet<string>): string {
  const base = normalizeTag(area ?? "") ?? `ملک_${seq ?? taken.size + 1}`;
  if (!taken.has(base)) return base;
  return normalizeTag(`${base}_${seq ?? taken.size + 1}`) ?? `${base}_${taken.size + 1}`;
}

type PropertyRow = { id: string; area: string | null; city: string | null; seq: number | null; tag: string | null; value: string | null; purchase: string | null; acquired: string | null };

async function ownProperties(userId: string): Promise<PropertyRow[]> {
  return db
    .select({
      id: realEstateProperties.id,
      area: realEstateProperties.area,
      city: realEstateProperties.city,
      seq: realEstateProperties.userSeq,
      tag: realEstateProperties.expenseTag,
      value: realEstateProperties.currentValueToman,
      purchase: realEstateProperties.purchasePriceToman,
      acquired: realEstateProperties.acquisitionDate,
    })
    .from(realEstateProperties)
    .innerJoin(assets, eq(assets.id, realEstateProperties.assetId))
    .where(and(eq(realEstateProperties.userId, userId), sql`${assets.deletedAt} is null`))
    .orderBy(asc(realEstateProperties.createdAt));
}

/** Give every property of this user its tag (once); returns property id → tag. */
export async function ensurePropertyTags(userId: string): Promise<Map<string, string>> {
  const list = await ownProperties(userId);
  const taken = new Set(list.map((p) => p.tag).filter((t): t is string => !!t));
  const out = new Map<string, string>();
  for (const p of list) {
    let tag = p.tag;
    if (!tag) {
      tag = propertyTag(p.area, p.seq, taken);
      taken.add(tag);
      await db.update(realEstateProperties).set({ expenseTag: tag }).where(and(eq(realEstateProperties.id, p.id), eq(realEstateProperties.userId, userId)));
    }
    out.set(p.id, tag);
  }
  return out;
}

export type PropertyEconomics = {
  id: string;
  label: string;
  tag: string;
  valueToman: string | null;
  purchaseToman: string | null;
  rent12: string;
  costs12: string;
  net12: string;
  /** percent, one decimal; null without a current value */
  grossYield: string | null;
  netYield: string | null;
};

/** Gross and net yield in percent, one decimal. PURE. */
export function yields(rent: string, costs: string, value: string | null): { gross: string | null; net: string | null } {
  if (!value || !D(value).gt(0)) return { gross: null, net: null };
  return {
    gross: D(rent).mul(100).div(value).toFixed(1),
    net: D(rent).sub(costs).mul(100).div(value).toFixed(1),
  };
}

export async function listPropertyEconomics(userId: string, today = todayIso()): Promise<PropertyEconomics[]> {
  const [list, tags] = await Promise.all([ownProperties(userId), ensurePropertyTags(userId)]);
  const yearAgo = new Date(`${today}T00:00:00Z`);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const since = yearAgo.toISOString().slice(0, 10);
  const out: PropertyEconomics[] = [];
  for (const p of list) {
    const tag = tags.get(p.id)!;
    const res = await db.execute(sql`
      with linked as (
        select je.type, coalesce((select s.irt_amount from entry_fx_snapshots s where s.entry_id = je.id limit 1), 0) as toman
        from journal_entries je
        where je.user_id = ${userId}::uuid and je.status = 'posted' and je.type in ('income','expense')
          and je.entry_date >= ${since}::date and je.entry_date <= ${today}::date
          and (
            exists (select 1 from entry_tags t where t.entry_id = je.id and t.tag = ${tag})
            or je.id in (
              select pt.executed_entry_id from planned_transactions pt join insurance_policies ip on ip.id = pt.insurance_policy_id
              where ip.user_id = ${userId}::uuid and ip.insured_property_id = ${p.id}::uuid and pt.executed_entry_id is not null
            )
          )
      )
      select coalesce(sum(toman) filter (where type = 'income'), 0)::text as rent,
             coalesce(sum(toman) filter (where type = 'expense'), 0)::text as costs
      from linked
    `);
    const r = res.rows[0] as { rent: string; costs: string };
    const rent = D(r.rent).toFixed(0);
    const costs = D(r.costs).toFixed(0);
    const y = yields(rent, costs, p.value);
    out.push({
      id: p.id,
      label: [p.area, p.city].filter(Boolean).join("، ") || "ملک",
      tag,
      valueToman: p.value ? D(p.value).toFixed(0) : null,
      purchaseToman: p.purchase ? D(p.purchase).toFixed(0) : null,
      rent12: rent,
      costs12: costs,
      net12: D(rent).sub(costs).toFixed(0),
      grossYield: y.gross,
      netYield: y.net,
    });
  }
  return out;
}

/** For the transaction form: the user's properties, with the tag their rent and costs go under. */
export async function propertyTagOptions(userId: string): Promise<{ label: string; tag: string }[]> {
  const [list, tags] = await Promise.all([ownProperties(userId), ensurePropertyTags(userId)]);
  return list.map((p) => ({ label: [p.area, p.city].filter(Boolean).join("، ") || "ملک", tag: tags.get(p.id)! }));
}
