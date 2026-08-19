import "dotenv/config";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

/**
 * ONE-TIME, GUARDED migration-history repair (baseline).
 *
 *   npm run db:repair-baseline            (actual run — needs your approval)
 *   DRY_RUN=1 npm run db:repair-baseline  (guards + preview only, zero writes)
 *
 * Problem being repaired: the production schema exists, but
 * public.__drizzle_migrations is EMPTY, so `npm run db:migrate` replays every
 * migration from 0000 and dies on `CREATE TABLE "accounts"`.
 *
 * What this script does — and nothing else:
 *   1. Reads ./drizzle/meta/_journal.json and hashes every drizzle/*.sql with
 *      sha256, EXACTLY like the drizzle runner does (drizzle-orm/migrator.js).
 *   2. Verifies preconditions in one transaction:
 *        - DATABASE_URL is a real PostgreSQL URL (not memory://),
 *        - public.__drizzle_migrations exists or is created with the runner's
 *          exact DDL (id SERIAL PK, hash text NOT NULL, created_at bigint),
 *        - it is EMPTY (refuses otherwise — never double-baselines),
 *        - public.accounts exists (the schema really is built).
 *   3. INSERTs one journal row per migration for ALL BUT THE LAST entry
 *      (0000…0003), using the file's real hash and the journal's `when`.
 *      No business table, no account, no ledger, no data row is touched.
 *   4. Commits, prints the recorded rows, and tells you the next step:
 *      `npm run db:migrate`, which then applies ONLY the last migration
 *      (0004) — the runner skips every migration whose folderMillis is
 *      <= the newest row's created_at (drizzle-orm pg-core/dialect.js).
 *
 * Rollback: delete the inserted rows (they are identifiable by hash), or
 * restore the Neon restore point taken before running this.
 */

const DRY_RUN = process.env.DRY_RUN === "1";

function fail(hint: string): never {
  console.error(`\n✗ ${hint}\n`);
  process.exit(1);
}

function localMigrations(folder = "drizzle") {
  const journal = JSON.parse(
    fs.readFileSync(path.join(folder, "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string; when: number }[] };
  if (journal.entries.length < 2) {
    fail("drizzle/meta/_journal.json has fewer than 2 entries — nothing to baseline.");
  }
  return journal.entries.map((e) => {
    const sql = fs.readFileSync(path.join(folder, `${e.tag}.sql`), "utf8");
    return {
      tag: e.tag,
      when: e.when,
      hash: crypto.createHash("sha256").update(sql).digest("hex"), // identical to drizzle-orm/migrator.js
    };
  });
}

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) fail("DATABASE_URL is not set (.env or inline).");
  if (raw.startsWith("memory://")) fail("DATABASE_URL is memory:// — there is no server to repair.");

  const all = localMigrations();
  const baseline = all.slice(0, -1); // 0000 … N-1
  const pending = all[all.length - 1]; // 0004 — applied afterwards by the official runner

  let rev = "unknown";
  try {
    rev = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    /* git not available — informational only */
  }

  console.log(`Repair plan (from ./drizzle at commit ${rev}):`);
  for (const m of baseline) console.log(`  BASELINE  ${m.tag}  created_at=${m.when}  hash=${m.hash.slice(0, 16)}…`);
  console.log(`  APPLY LATER via 'npm run db:migrate': ${pending.tag} (created_at=${pending.when})`);
  console.log(`  DRY_RUN=${DRY_RUN ? "1 — no writes will happen" : "0 — writes WILL happen"}`);

  const client = new Client({ connectionString: raw, connectionTimeoutMillis: 15_000 });
  await client.connect();

  try {
    await client.query("BEGIN");

    /* ── Guards (any violation ⇒ ROLLBACK, database untouched) ─────────── */
    const migTable = await client.query<{ t: string | null }>(
      `select to_regclass('public.__drizzle_migrations')::text as t`,
    );
    if (!migTable.rows[0].t) {
      // Same DDL the runner itself uses; only created if missing.
      await client.query(
        `CREATE TABLE IF NOT EXISTS public.__drizzle_migrations (
           id SERIAL PRIMARY KEY,
           hash text NOT NULL,
           created_at bigint
         )`,
      );
      console.log("✓ public.__drizzle_migrations did not exist — created with the runner's exact DDL.");
    }
    const cnt = await client.query<{ c: number }>(`select count(*)::int as c from public.__drizzle_migrations`);
    if (cnt.rows[0].c !== 0) {
      await client.query("ROLLBACK");
      fail(
        `public.__drizzle_migrations already has ${cnt.rows[0].c} row(s). ` +
          "Refusing to double-baseline. If this is unexpected, inspect first: npm run db:inspect-readonly",
      );
    }
    const accounts = await client.query<{ t: string | null }>(`select to_regclass('public.accounts')::text as t`);
    if (!accounts.rows[0].t) {
      await client.query("ROLLBACK");
      fail("public.accounts does not exist — the schema is NOT pre-built; run npm run db:migrate instead.");
    }

    /* ── The only writes this script ever makes ─────────────────────────── */
    if (DRY_RUN) {
      await client.query("ROLLBACK");
      console.log("\nDRY RUN — guards passed, nothing written. Re-run without DRY_RUN=1 to baseline.");
      return;
    }
    for (const m of baseline) {
      await client.query(
        `INSERT INTO public.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
        [m.hash, m.when],
      );
    }
    await client.query("COMMIT");

    const after = await client.query<{ id: number; hash: string; created_at: string }>(
      `select id, hash, created_at from public.__drizzle_migrations order by id`,
    );
    console.log(`\n✓ Baseline committed — ${after.rows.length} row(s) now in public.__drizzle_migrations:`);
    for (const r of after.rows)
      console.log(`    id=${r.id}  created_at=${r.created_at}  hash=${r.hash.slice(0, 16)}…`);

    console.log(`\nNEXT STEP: npm run db:migrate   → applies ONLY ${pending.tag} and records it.`);
    console.log("THEN VERIFY:  npm run db:inspect-readonly");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    fail(`Repair failed and was rolled back: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("db:repair-baseline crashed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
