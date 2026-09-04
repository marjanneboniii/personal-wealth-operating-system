/**
 * Expense Category Service — bootstrap, query and extension of the
 * hierarchical (parent-child) expense category tree.
 *
 * Rules:
 *  - The standard catalog is shared reference data (user_id NULL), like
 *    currencies and asset classes. Users may ADD their own sub-categories
 *    under any active top-level group; those rows carry their user_id.
 *  - Overlap prevention: a sub-category cannot duplicate the name of an
 *    existing sibling under the same parent.
 *  - Non-destructive legacy backfill: journal entries created before the
 *    category system get a category only when they have none yet.
 *  - The double-entry ledger is never modified by classification.
 */
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, expenseCategories, journalEntries } from "@/db/schema";
import { D } from "@/domain/decimal";
import { hasMultipleUsers, resolveQueryUserId } from "@/features/ledger/queries";
import {
  EXPENSE_CATEGORY_CATALOG,
  LEGACY_ACCOUNT_CATEGORY_MAP,
  MISC_CATEGORY_CODE,
} from "./catalog";

export type CategoryRow = typeof expenseCategories.$inferSelect;

export type CategoryTreeNode = CategoryRow & {
  children: CategoryRow[];
};

/** Account code of the non-cash reserve (equity) account. */
export const RESERVE_ACCOUNT_CODE = "3200";
export const RESERVE_ACCOUNT_NAME = "ذخیره استهلاک و تعمیرات آتی";

function tenantScope(userId?: string) {
  return userId
    ? or(isNull(expenseCategories.userId), eq(expenseCategories.userId, userId))
    : sql`1=1`;
}

/**
 * Guarantees the standard category catalog exists. Idempotent and
 * non-destructive: when any category row already exists, nothing is
 * inserted (the tree is then managed through the extension APIs).
 * Accepts a transaction client so setup/seed can run it atomically.
 */
export async function ensureCategoryCatalog(client: any = db): Promise<void> {
  const existing = await client
    .select({ c: sql<number>`count(*)::int` })
    .from(expenseCategories);
  if ((existing[0]?.c ?? 0) > 0) return;

  let sortOrder = 0;
  for (const parent of EXPENSE_CATEGORY_CATALOG) {
    const [parentRow] = await client
      .insert(expenseCategories)
      .values({
        userId: null,
        code: parent.code,
        name: parent.name,
        nameEn: parent.nameEn,
        parentId: null,
        level: 0,
        sortOrder: sortOrder++,
        nature: "cash",
        description: parent.description ?? null,
        isSystem: true,
        isActive: true,
      })
      .returning();

    const children = parent.children ?? [];
    if (!children.length) continue;
    await client.insert(expenseCategories).values(
      children.map((child, index) => ({
        userId: null,
        code: child.code,
        name: child.name,
        nameEn: child.nameEn,
        parentId: parentRow.id,
        level: 1,
        sortOrder: index,
        nature: child.nature ?? "cash",
        description: child.description ?? null,
        isSystem: true,
        isActive: true,
      })),
    );
  }

  await backfillLegacyCategories(client);
}

/**
 * One-time, non-destructive classification of pre-category-system expense
 * entries, based on the legacy expense account they posted to. Only entries
 * whose category_id IS NULL are touched; the ledger itself never changes.
 */
async function backfillLegacyCategories(client: any): Promise<void> {
  for (const [accountCode, categoryCode] of Object.entries(LEGACY_ACCOUNT_CATEGORY_MAP)) {
    try {
      await client.execute(sql`
        UPDATE journal_entries je
           SET category_id = cat.id
          FROM (
            SELECT id FROM expense_categories
             WHERE code = ${categoryCode} AND user_id IS NULL
             LIMIT 1
          ) cat
         WHERE je.category_id IS NULL
           AND je.type = 'expense'
           AND EXISTS (
             SELECT 1 FROM postings p
              WHERE p.entry_id = je.id
                AND p.account_id IN (
                  SELECT id FROM accounts WHERE code = ${accountCode} AND deleted_at IS NULL
                )
           )
      `);
    } catch {
      // Backfill is best-effort; classification can always be done later.
    }
  }
}

/** The full active tree visible to a tenant: parents with their children. */
export async function listCategoryTree(userId?: string): Promise<CategoryTreeNode[]> {
  await ensureCategoryCatalog();
  const rows: CategoryRow[] = await db
    .select()
    .from(expenseCategories)
    .where(
      and(
        isNull(expenseCategories.deletedAt),
        eq(expenseCategories.isActive, true),
        tenantScope(userId),
      ),
    )
    .orderBy(asc(expenseCategories.level), asc(expenseCategories.sortOrder), asc(expenseCategories.name));

  const parents: CategoryTreeNode[] = rows
    .filter((r) => r.level === 0)
    .map((r) => ({ ...r, children: [] }));
  const byId = new Map(parents.map((p) => [p.id, p]));
  for (const row of rows) {
    if (row.level === 0 || !row.parentId) continue;
    const parent = byId.get(row.parentId);
    if (parent) parent.children.push(row);
  }
  return parents;
}

/** Fetch one category by id (tenant visibility enforced). */
export async function getCategoryById(id: string, userId?: string): Promise<CategoryRow | null> {
  await ensureCategoryCatalog();
  const rows = await db
    .select()
    .from(expenseCategories)
    .where(
      and(
        eq(expenseCategories.id, id),
        isNull(expenseCategories.deletedAt),
        tenantScope(userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Fetch one category by its stable code (system catalog scope). */
export async function getCategoryByCode(code: string): Promise<CategoryRow | null> {
  await ensureCategoryCatalog();
  const rows = await db
    .select()
    .from(expenseCategories)
    .where(and(eq(expenseCategories.code, code), isNull(expenseCategories.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/** The fallback "miscellaneous" leaf — used when no category is supplied. */
export async function getMiscCategory(): Promise<CategoryRow | null> {
  return getCategoryByCode(MISC_CATEGORY_CODE);
}

/**
 * Adds a user-defined sub-category under an existing top-level group.
 *
 * Overlap prevention: rejects duplicate sibling names (same parent,
 * case/whitespace-insensitive). New sub-categories are always leaves
 * (level 1) — the standard hierarchy depth is parent → leaf.
 */
export async function addCustomCategory(
  userId: string | null,
  input: { name: string; parentId: string },
): Promise<CategoryRow> {
  const name = input.name.trim();
  if (name.length < 2) throw new Error("نام زیردسته را وارد کنید (حداقل ۲ حرف).");
  if (name.length > 80) throw new Error("نام زیردسته خیلی طولانی است (حداکثر ۸۰ حرف).");

  const [parent] = await db
    .select()
    .from(expenseCategories)
    .where(
      and(
        eq(expenseCategories.id, input.parentId),
        isNull(expenseCategories.deletedAt),
        eq(expenseCategories.isActive, true),
        tenantScope(userId ?? undefined),
      ),
    )
    .limit(1);
  if (!parent) throw new Error("دستهٔ والد معتبر نیست یا دسترسی به آن وجود ندارد.");
  if (parent.level !== 0) throw new Error("زیردسته فقط زیر دسته‌های اصلی قابل افزودن است.");

  const siblings = await db
    .select({ id: expenseCategories.id, name: expenseCategories.name })
    .from(expenseCategories)
    .where(
      and(
        eq(expenseCategories.parentId, parent.id),
        isNull(expenseCategories.deletedAt),
        eq(expenseCategories.isActive, true),
        tenantScope(userId ?? undefined),
      ),
    );
  const normalized = name.replace(/\s+/g, " ").toLowerCase();
  if (siblings.some((s) => s.name.replace(/\s+/g, " ").toLowerCase() === normalized)) {
    throw new Error("زیردسته‌ای با همین نام زیر این دسته وجود دارد (جلوگیری از دستهٔ هم‌پوشان).");
  }

  const code = `USR-${parent.code}-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296)
    .toString(36)
    .toUpperCase()}`;
  const [created] = await db
    .insert(expenseCategories)
    .values({
      userId: userId ?? null,
      code,
      name,
      nameEn: null,
      parentId: parent.id,
      level: 1,
      sortOrder: siblings.length,
      nature: "cash",
      description: null,
      isSystem: false,
      isActive: true,
    })
    .returning();
  return created;
}

/* ------------------------------------------------------------------ */
/* Report queries — category dimension of expense entries              */
/* ------------------------------------------------------------------ */

export type CategoryFlowRow = {
  categoryId: string;
  code: string;
  name: string;
  nature: string;
  parentId: string | null;
  parentCode: string | null;
  parentName: string | null;
  /** Total in the base (USD) book currency — canonical accounting view. */
  total: string;
  /**
   * FROZEN Toman aggregate (display only — never accounting): the sum of the
   * commit-time `entry_fx_snapshots.irt_amount` over the window's entries,
   * derived at read time. A later FX-rate change can NEVER move this figure;
   * recorded past expenses keep the exact Toman the user entered.
   * "0" when no entry of the window carries a snapshot (legacy data) — the
   * caller then falls back to a dynamic current-rate equivalent.
   */
  totalToman: string;
  /** Number of journal entries contributing a non-zero total in the window. */
  entries: number;
  /** How many of those entries carry a frozen commit-time FX snapshot. */
  entriesWithSnap: number;
};

/**
 * Expense totals grouped by category leaf for the last N months.
 * Counts ONLY real expenses (je.type = 'expense'); debt repayments and
 * transfers are excluded by definition of the transaction-type separation.
 *
 * TENANT ISOLATION — same fail-closed rule as the ledger read primitives:
 * the identity is resolved (explicit id → authenticated session → single-user
 * legacy), and in a multi-tenant database an unresolved identity must NEVER
 * degrade to a global (cross-tenant) read. One user's expense history can
 * never leak into another user's category report.
 *
 * FROZEN TOMAN — `totalToman` is aggregated in a first per-entry pass (so an
 * entry with several postings never double-counts its snapshot), then per
 * category. It is read from the immutable commit-time snapshot — it is never
 * stored as a derived figure and never re-derived from the current rate.
 */
export async function getFlowByCategory(months = 6, userId?: string): Promise<CategoryFlowRow[]> {
  await ensureCategoryCatalog();
  const u = await resolveQueryUserId(userId);
  // Fail-closed: never blend tenants' expense history.
  if (!u && (await hasMultipleUsers())) return [];
  const res = await db.execute(sql`
    with per_entry as (
      select c.id as cat_id,
             je.id as entry_id,
             coalesce(sum(p.base_value), 0) as total_usd,
             s.irt_amount::numeric as irt_amount
      from postings p
        join journal_entries je on je.id = p.entry_id
        join accounts a on a.id = p.account_id
        join expense_categories c on c.id = je.category_id
        left join entry_fx_snapshots s on s.entry_id = je.id
      where a.type = 'expense'
        and je.status = 'posted'
        and je.type = 'expense'
        and je.entry_date >= (current_date - (${months} || ' months')::interval)
        ${u ? sql`and je.user_id = ${u}` : sql``}
      group by c.id, je.id, s.irt_amount
    )
    select c.id::text as "categoryId",
           c.code,
           c.name,
           c.nature,
           pc.id::text as "parentId",
           pc.code as "parentCode",
           pc.name as "parentName",
           coalesce(sum(pe.total_usd), 0)::text as total,
           -- FROZEN Toman: derived at read time from the immutable
           -- commit-time snapshot. An FX-rate change can never move it.
           coalesce(sum(case when pe.total_usd != 0 then pe.irt_amount else 0 end), 0)::text as "totalToman",
           count(*) filter (where pe.total_usd != 0)::int as entries,
           count(*) filter (where pe.total_usd != 0 and pe.irt_amount is not null)::int as "entriesWithSnap"
    from per_entry pe
      join expense_categories c on c.id = pe.cat_id
      left join expense_categories pc on pc.id = c.parent_id
    group by c.id, c.code, c.name, c.nature, pc.id, pc.code, pc.name
    having abs(coalesce(sum(pe.total_usd), 0)) > 0.000000001
    order by sum(pe.total_usd) desc
  `);
  return res.rows as CategoryFlowRow[];
}

/** Total of posted expenses in the window, split cash vs non-cash. */
export async function getExpenseTotals(
  months = 6,
  userId?: string,
): Promise<{ cash: string; nonCash: string }> {
  const rows = await getFlowByCategory(months, userId);
  let cash = D("0");
  let nonCash = D("0");
  for (const row of rows) {
    if (row.nature === "non_cash") nonCash = nonCash.add(row.total);
    else cash = cash.add(row.total);
  }
  return { cash: cash.toString(), nonCash: nonCash.toString() };
}

/**
 * Ensures the non-cash reserve (equity) account exists for a tenant.
 * Non-cash expense entries (depreciation/reserve) post against this
 * account instead of a cash account, so no wallet balance ever moves.
 */
export async function ensureReserveAccount(userId?: string | null, client: any = db) {
  const scope = userId ? eq(accounts.userId, userId) : isNull(accounts.userId);
  const found = await client
    .select()
    .from(accounts)
    .where(and(eq(accounts.code, RESERVE_ACCOUNT_CODE), scope))
    .limit(1);
  if (found.length) return found[0];

  // Base asset: reuse the asset of the tenant's opening-equity account (3010).
  const equity = await client
    .select()
    .from(accounts)
    .where(and(eq(accounts.code, "3010"), userId ? or(eq(accounts.userId, userId), isNull(accounts.userId)) : sql`1=1`))
    .orderBy(asc(accounts.userId))
    .limit(1);

  const [created] = await client
    .insert(accounts)
    .values({
      userId: userId ?? null,
      code: RESERVE_ACCOUNT_CODE,
      name: RESERVE_ACCOUNT_NAME,
      type: "equity",
      assetId: equity[0]?.assetId ?? null,
      isActive: true,
    })
    .returning();
  return created;
}
