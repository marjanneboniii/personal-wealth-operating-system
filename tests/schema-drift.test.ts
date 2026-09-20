/**
 * The two schema paths must not separate.
 *
 * `src/db/schema.ts` is the source of truth. `drizzle/*.sql` is generated from
 * it and is what production runs. `src/db/init-schema.ts` is a SECOND,
 * hand-written implementation of the same schema, used to stand a database up
 * in-memory for tests — and a hand-maintained mirror drifts.
 *
 * It had. Comparing the two database by database found 57 indexes production
 * had and tests did not, on the tables the ledger reads hardest:
 * postings(entry_id), postings(account_id, entry_id), journal_entries(entry_date),
 * lots(asset_id, opened_at), installments(due_date, status). The suite's own
 * query-shape tests — N+1 elimination, page-size capping — were passing against
 * a schema missing the indexes those queries exist for.
 *
 * Nothing announced that. This test does.
 *
 * It compares what an index DOES — table, columns, uniqueness — rather than
 * what it is called, because Postgres names an inline UNIQUE constraint
 * `t_col_key` while Drizzle emits `t_col_unique` for the identical thing, and
 * a name-based comparison would report that as drift forever.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";

const require_ = createRequire(import.meta.url);

/** table(col,…)[ UNIQUE] — identity by behaviour, not by index name. */
const INDEX_SHAPES = `
  select t.relname||'('||array_to_string(array(
           select pg_get_indexdef(i.indexrelid, k + 1, true)
           from generate_subscripts(i.indkey, 1) as k order by k
         ), ',')||')'||case when i.indisunique then ' UNIQUE' else '' end as shape
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_class t on t.oid = i.indrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'`;

const TABLES = `
  select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'`;

const COLUMNS = `
  select table_name || '.' || column_name as c
  from information_schema.columns where table_schema = 'public'`;

/**
 * Differences that are DELIBERATE. Every entry states why, and anything not
 * listed here is a failure. Keep this list shrinking.
 */
const EXPECTED_ONLY_IN_INIT = {
  tables: [
    // drizzle/0017 drops `sessions`: after the Supabase cutover, Supabase Auth
    // is the sole session authority, and every function in src/lib/auth.ts that
    // touches this table returns or throws early under hasSupabaseConfig().
    // init-schema keeps it so the pre-Supabase path still has a database to
    // run against.
    "sessions",
  ],
  columns: ["sessions.id", "sessions.user_id", "sessions.token", "sessions.expires_at", "sessions.created_at"],
  indexes: [
    "sessions(id) UNIQUE",
    "sessions(token)",
    "sessions(token) UNIQUE",
    "sessions(user_id)",

    // NOT deliberate — a gap in PRODUCTION, recorded here so it is not
    // mistaken for one.
    //
    // These two partial unique indexes enforce "one valuation snapshot per
    // model per day, and per car per day". They exist ONLY in init-schema:
    // schema.ts declares the two plain indexes on these columns but neither
    // unique one, so no migration ever created them. Tests therefore reject a
    // duplicate same-day snapshot while production accepts it — and snapshots
    // are append-only by contract, so duplicates would accumulate silently and
    // a valuation read would pick between them arbitrarily.
    //
    // Closing it needs a migration AND a check for rows that already violate
    // it, so it is deliberately not done here.
    "vehicle_valuation_snapshots(user_vehicle_id,snapshot_date) UNIQUE",
    "vehicle_valuation_snapshots(vehicle_catalog_id,snapshot_date) UNIQUE",
  ],
};

/** Builds the migration-path schema in a throwaway embedded database. */
async function schemaFromMigrations() {
  const { PGlite } = require_("@electric-sql/pglite");
  const pg = new PGlite();
  const dir = new URL("../drizzle/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  assert.ok(files.length > 0, "no migrations found to compare against");

  for (const file of files) {
    const sql = readFileSync(new URL(file, dir), "utf8");
    for (const chunk of sql.split("--> statement-breakpoint")) {
      const statement = chunk.trim();
      if (!statement) continue;
      // A migration may legitimately fail here: several target hosted-Supabase
      // objects, and one references a temp table from an earlier session. The
      // comparison is of the RESULTING schema, so a statement that cannot
      // apply to an empty embedded database is skipped rather than fatal.
      try {
        await pg.exec(statement);
      } catch {}
    }
  }

  const rows = async (q: string) => (await pg.query(q)).rows as Record<string, string>[];
  return {
    tables: (await rows(TABLES)).map((r) => r.table_name),
    columns: (await rows(COLUMNS)).map((r) => r.c),
    indexes: (await rows(INDEX_SHAPES)).map((r) => r.shape),
  };
}

async function schemaFromInit() {
  await createSchemaIfNotExists();
  const rows = async (q: string) => (await db.execute(q)).rows as unknown as Record<string, string>[];
  return {
    tables: (await rows(TABLES)).map((r) => r.table_name),
    columns: (await rows(COLUMNS)).map((r) => r.c),
    indexes: (await rows(INDEX_SHAPES)).map((r) => r.shape),
  };
}

test("init-schema and the migrations build the same database", async () => {
  const migrations = await schemaFromMigrations();
  const init = await schemaFromInit();

  for (const kind of ["tables", "columns", "indexes"] as const) {
    const expected = new Set((EXPECTED_ONLY_IN_INIT as Record<string, string[]>)[kind] ?? []);

    const missingFromInit = migrations[kind].filter((x) => !init[kind].includes(x));
    assert.deepEqual(
      missingFromInit,
      [],
      `${kind} the MIGRATIONS create and init-schema does not — tests would run against a schema production does not have:\n  ${missingFromInit.join("\n  ")}`,
    );

    const extraInInit = init[kind].filter((x) => !migrations[kind].includes(x) && !expected.has(x));
    assert.deepEqual(
      extraInInit,
      [],
      `${kind} only init-schema creates — tests would enforce something production does not. Fix it, or add it to EXPECTED_ONLY_IN_INIT with a reason:\n  ${extraInInit.join("\n  ")}`,
    );

    // A deliberate exception that has since been resolved should be deleted
    // from the list, not left to rot.
    const stale = [...expected].filter((x) => !init[kind].includes(x));
    assert.deepEqual(stale, [], `EXPECTED_ONLY_IN_INIT lists ${kind} that no longer exist: ${stale.join(", ")}`);
  }
});
