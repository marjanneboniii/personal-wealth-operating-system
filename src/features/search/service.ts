/**
 * جستجوی داده — the command palette finds the user's own records, not only pages.
 *
 * Read-only and tenant-scoped: every group filters on the caller's user id, so
 * a query can never surface another tenant's name, amount or counterparty.
 * Encrypted columns (vehicle plates and notes, bank SMS) are deliberately not
 * searched — they cannot be matched in SQL without decrypting every row.
 *
 * Persian text is compared NORMALISED on both sides: Arabic ي/ك, hamza-alef
 * forms and the zero-width non-joiner mean the same word typed on two
 * keyboards, and a digit typed in Persian is the same number in Latin.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import type { IconName } from "@/components/ui/Icon";
import { D } from "@/domain/decimal";
import { formatJalaliIso, formatMoney } from "@/lib/format";
import { containsPattern, normalizeSearch, normalizedColumn, searchAmount } from "@/lib/searchText";
import { normalizeTag } from "@/features/tags/normalize";

export type SearchHit = {
  group: string;
  label: string;
  hint: string;
  href: string;
  icon: IconName;
};

const PER_GROUP = 5;

const n = normalizedColumn;

const rows = async <T>(q: SQL): Promise<T[]> => ((await db.execute(q)) as { rows: T[] }).rows;

const tx = (params: Record<string, string>) => `/transactions?${new URLSearchParams({ range: "all", ...params }).toString()}`;

export async function searchEverything(userId: string, rawQuery: string): Promise<SearchHit[]> {
  const q = normalizeSearch(rawQuery).slice(0, 80);
  if (q.length < 2) return [];
  const like = containsPattern(q);
  const amount = searchAmount(rawQuery);
  const tag = normalizeTag(rawQuery.replace(/^#/, ""));

  const [accountRows, entryRows, tagRows, chequeRows, debtRows, depositRows, propertyRows, vehicleRows] = await Promise.all([
    rows<{ id: string; name: string; symbol: string | null }>(sql`
      select a.id, a.name, ast.symbol
      from accounts a left join assets ast on ast.id = a.asset_id
      where a.user_id = ${userId}::uuid and a.type = 'asset' and a.deleted_at is null
        and ${n(sql`a.name`)} like ${like}
      order by a.name limit ${PER_GROUP}
    `),
    rows<{ id: string; description: string; entryDate: string; type: string; toman: string | null }>(sql`
      select je.id, je.description, je.entry_date::text as "entryDate", je.type,
        (select s.irt_amount::text from entry_fx_snapshots s where s.entry_id = je.id limit 1) as toman
      from journal_entries je
      where je.user_id = ${userId}::uuid and je.status = 'posted'
        and (
          ${n(sql`je.description`)} like ${like}
          ${
            amount
              ? sql`or exists (select 1 from entry_fx_snapshots s where s.entry_id = je.id and round(s.irt_amount) = ${amount}::numeric)
                    or exists (select 1 from postings p join assets ast on ast.id = p.asset_id
                               where p.entry_id = je.id and ast.symbol = 'IRT' and abs(p.quantity) = ${amount}::numeric)`
              : sql``
          }
        )
      order by je.entry_date desc, je.created_at desc limit ${PER_GROUP}
    `),
    tag
      ? rows<{ tag: string; n: number }>(sql`
          select t.tag, count(*)::int as n
          from entry_tags t join journal_entries je on je.id = t.entry_id
          where je.user_id = ${userId}::uuid and je.status = 'posted' and t.tag like ${`%${tag}%`}
          group by t.tag order by n desc limit ${PER_GROUP}
        `)
      : Promise.resolve([]),
    rows<{ id: string; direction: string; counterparty: string; amountToman: string; dueDate: string; sayadId: string | null }>(sql`
      select c.id, c.direction, c.counterparty, c.amount_toman::text as "amountToman", c.due_date::text as "dueDate", c.sayad_id as "sayadId"
      from cheques c
      where c.user_id = ${userId}::uuid
        and (${n(sql`c.counterparty`)} like ${like} or ${n(sql`c.note`)} like ${like}
             or c.sayad_id like ${like} or c.serial like ${like}
             ${amount ? sql`or c.amount_toman = ${amount}::numeric` : sql``})
      order by c.due_date desc limit ${PER_GROUP}
    `),
    rows<{ title: string; creditor: string; status: string }>(sql`
      select d.title, d.creditor, d.status from debts d
      where d.user_id = ${userId}::uuid and (${n(sql`d.title`)} like ${like} or ${n(sql`d.creditor`)} like ${like})
      order by d.created_at desc limit ${PER_GROUP}
    `),
    rows<{ title: string; institution: string | null; status: string }>(sql`
      select d.title, d.institution, d.status from deposits d
      where d.user_id = ${userId}::uuid and (${n(sql`d.title`)} like ${like} or ${n(sql`d.institution`)} like ${like})
      order by d.created_at desc limit ${PER_GROUP}
    `),
    rows<{ area: string | null; city: string | null; address: string | null; propertyType: string }>(sql`
      select p.area, p.city, p.address, p.property_type as "propertyType"
      from real_estate_properties p join assets ast on ast.id = p.asset_id and ast.deleted_at is null
      where p.user_id = ${userId}::uuid
        and (${n(sql`p.area`)} like ${like} or ${n(sql`p.address`)} like ${like} or ${n(sql`p.city`)} like ${like})
      limit ${PER_GROUP}
    `).catch(() => []),
    rows<{ brand: string; model: string; year: number }>(sql`
      select v.brand, v.model, v.year from vehicle_assets v
      where v.user_id = ${userId}::uuid and v.status <> 'sold'
        and (${n(sql`v.brand`)} like ${like} or ${n(sql`v.model`)} like ${like} or ${n(sql`v.brand || ' ' || v.model`)} like ${like})
      limit ${PER_GROUP}
    `).catch(() => []),
  ]);

  const hits: SearchHit[] = [];
  for (const a of accountRows) {
    hits.push({ group: "حساب‌ها", label: a.name, hint: "تراکنش‌های این حساب", href: tx({ account: a.id }), icon: "accounts" });
  }
  for (const e of entryRows) {
    const money = e.toman ? formatMoney(D(e.toman).toFixed(0), "IRT") : null;
    hits.push({
      group: "تراکنش‌ها",
      label: e.description,
      hint: [formatJalaliIso(e.entryDate), money].filter(Boolean).join(" · "),
      href: tx({ q: e.description }),
      icon: e.type === "income" ? "arrow-up" : e.type === "expense" ? "arrow-down" : "transactions",
    });
  }
  for (const t of tagRows) {
    hits.push({ group: "برچسب‌ها", label: `#${t.tag}`, hint: `${t.n.toLocaleString("fa-IR")} تراکنش`, href: tx({ tag: t.tag }), icon: "transactions" });
  }
  for (const c of chequeRows) {
    hits.push({
      group: "چک‌ها",
      label: `چک ${c.direction === "issued" ? "به" : "از"} ${c.counterparty}`,
      hint: [formatMoney(D(c.amountToman).toFixed(0), "IRT"), `سررسید ${formatJalaliIso(c.dueDate)}`].join(" · "),
      href: "/debts/cheques",
      icon: "note",
    });
  }
  for (const d of debtRows) {
    hits.push({ group: "بدهی و طلب", label: d.title, hint: d.creditor, href: "/debts", icon: "debts" });
  }
  for (const d of depositRows) {
    hits.push({ group: "سپرده‌ها", label: d.title, hint: [d.institution, d.status === "closed" ? "بسته‌شده" : null].filter(Boolean).join(" · "), href: "/deposits", icon: "coins" });
  }
  for (const p of propertyRows) {
    hits.push({ group: "دارایی‌های واقعی", label: [p.area, p.city].filter(Boolean).join("، ") || "ملک", hint: p.address ?? "", href: "/asset-registry", icon: "home" });
  }
  for (const v of vehicleRows) {
    hits.push({ group: "دارایی‌های واقعی", label: `${v.brand} ${v.model}`, hint: String(v.year), href: "/asset-registry", icon: "home" });
  }
  return hits;
}
