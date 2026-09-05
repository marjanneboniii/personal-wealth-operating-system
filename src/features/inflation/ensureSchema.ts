/**
 * Self-healing schema guard for «ردیاب تورم شخصی».
 *
 * WHY THIS EXISTS
 * ---------------
 * The module went independent in migration 0012, which ADDS `user_id` to the
 * three `commodity_*` tables and `region` to `commodity_price_records`. Every
 * read in `service.ts` filters on `user_id`, so on a database where 0012 has
 * NOT been applied yet (a deployment that pulled the new code before running
 * `npm run db:migrate`) the very first query throws and the whole
 * `/inflation` route renders NOTHING — a blank page, which is exactly the bug
 * users reported.
 *
 * `ensureSchemaOnce()` cannot cover this: by design it is a no-op on real
 * PostgreSQL (the request lifecycle must never run migrations).
 *
 * SAFETY CONTRACT
 * ---------------
 *   • ADDITIVE ONLY — `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT
 *     EXISTS`. No table is created, dropped, renamed or truncated here and no
 *     row is written, so this can never destroy or rewrite data.
 *   • Touches ONLY the three isolated `commodity_*` tables — never the
 *     accounting core (no journal, posting, lot, account, asset, price).
 *   • Idempotent and memoised per process; every statement is individually
 *     best-effort, so a read-only role or a already-migrated database simply
 *     skips it instead of breaking the page.
 *   • It is a SAFETY NET, not a replacement for `drizzle/0012_inflation_tracker.sql`.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";

/** Additive, idempotent, non-destructive. Order matters only for the indexes. */
const HEAL_STATEMENTS = [
  `ALTER TABLE commodity_categories ADD COLUMN IF NOT EXISTS user_id uuid`,
  `ALTER TABLE commodity_items ADD COLUMN IF NOT EXISTS user_id uuid`,
  `ALTER TABLE commodity_price_records ADD COLUMN IF NOT EXISTS user_id uuid`,
  `ALTER TABLE commodity_price_records ADD COLUMN IF NOT EXISTS region text`,
  `CREATE INDEX IF NOT EXISTS commodity_categories_user_idx ON commodity_categories(user_id)`,
  `CREATE INDEX IF NOT EXISTS commodity_items_user_idx ON commodity_items(user_id)`,
  `CREATE INDEX IF NOT EXISTS commodity_price_user_idx ON commodity_price_records(user_id)`,
];

let healPromise: Promise<void> | null = null;

async function heal(): Promise<void> {
  for (const stmt of HEAL_STATEMENTS) {
    try {
      await db.execute(sql.raw(stmt));
    } catch {
      // Already migrated, or the role may not ALTER — the caller degrades
      // gracefully instead of blanking the page.
    }
  }
}

/**
 * Guarantees the columns the inflation read model selects actually exist.
 * Safe to call on every request: the work happens at most once per process.
 */
export function ensureInflationSchema(): Promise<void> {
  healPromise ??= heal().catch(() => {
    healPromise = null;
  });
  return healPromise;
}
