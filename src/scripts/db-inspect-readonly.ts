import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client, type QueryResultRow } from "pg";

/**
 * STRICTLY READ-ONLY database inspector.
 *
 *   npx tsx src/scripts/db-inspect-readonly.ts
 *   DATABASE_URL=postgresql://... npx tsx src/scripts/db-inspect-readonly.ts
 *
 * Answers, without changing a single byte on the server:
 *   1. Which database does DATABASE_URL point at (name, user, host, Neon markers)?
 *   2. Does public.accounts exist?
 *   3. Does public.__drizzle_migrations exist?
 *   4. Which migrations are recorded there (matched to local drizzle/*.sql by sha256)?
 *   5. Which UNIQUE constraints/indexes exist on accounts?
 *   6. Is the leftover `accounts_code_unique` still there?
 *   7. Is the intended UNIQUE (user_id, code) in place?
 *
 * Safety: the session is opened with default_transaction_read_only=on so the
 * server itself rejects any write, and every statement below is a catalog
 * SELECT (no INSERT/UPDATE/DELETE/ALTER/DROP, no DDL, no temp objects).
 */

function fail(hint: string): never {
  console.error(`\n✗ ${hint}\n`);
  process.exit(1);
}

interface MigrationRow {
  id: number | string;
  hash: string;
  created_at: string | number;
}

/* Local journal: map sha256(file) → migration tag, and list local tags in order. */
function localMigrations(folder = "drizzle") {
  const journalPath = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries: { tag: string; when: number }[];
  };
  return journal.entries.map((e) => {
    const sql = fs.readFileSync(path.join(folder, `${e.tag}.sql`), "utf8");
    return {
      tag: e.tag,
      when: e.when,
      hash: crypto.createHash("sha256").update(sql).digest("hex"),
    };
  });
}

function redact(raw: string): string {
  return raw.replace(/\/\/([^:]+):[^@]*@/, "//$1:***@");
}

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    fail(
      "DATABASE_URL is not set. Put it in .env (see .env.example) or pass it inline:\n" +
        "  DATABASE_URL='postgresql://...' npx tsx src/scripts/db-inspect-readonly.ts",
    );
  }
  if (raw.startsWith("memory://")) {
    fail("DATABASE_URL is memory:// — there is no server to inspect.");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail("DATABASE_URL is not a valid URL.");
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    fail(`DATABASE_URL must start with postgresql:// (got "${url.protocol}//").`);
  }

  const local = localMigrations();
  const hashToTag = new Map(local.map((m) => [m.hash, m.tag]));

  // Force the session read-only at the server level on top of only issuing
  // catalog SELECTs. If the server refuses startup options, retry without
  // them (statements below are still SELECT-only).
  const connect = async (withGuard: boolean) =>
    new Client({
      connectionString: raw,
      connectionTimeoutMillis: 15_000,
      ...(withGuard
        ? { options: "-c default_transaction_read_only=on -c statement_timeout=20000" }
        : { statement_timeout: 20_000 }),
    });

  console.log("Connecting (read-only session requested) ...");
  let client = await connect(true);
  try {
    await client.connect();
    console.log("✓ Session is server-enforced READ-ONLY (default_transaction_read_only=on).");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await client.end().catch(() => {});
    // Only a rejection of the `options` startup parameter justifies a retry.
    // Real connectivity/auth problems will fail identically on the second try.
    if (!/startup parameter|options/i.test(msg)) {
      fail(
        `Connection failed: ${msg}\n` +
          "  Check the host/password and that the Neon compute is awake; see also: npm run db:check",
      );
    }
    console.log(`! Server rejected the read-only startup option (${msg}).`);
    console.log("  Retrying without it — every statement issued is still a catalog SELECT only.");
    client = await connect(false);
    await client.connect();
  }

  const q = async <T extends QueryResultRow>(text: string): Promise<T[]> =>
    (await client.query<T>(text)).rows;

  try {
    /* 1 ── Which database is this? ---------------------------------------- */
    console.log("\n━━ 1. Current Database " + "━".repeat(36));
    const who = await q<{ db: string; usr: string; addr: string | null; port: number; ver: string }>(
      `select current_database() as db, current_user as usr,
              coalesce(inet_server_addr()::text, 'unix-socket/local') as addr,
              inet_server_port() as port, version() as ver`,
    );
    const w = who[0];
    const neon = await q<{ name: string; setting: string }>(
      `select name, setting from pg_settings where name like 'neon.%' order by name`,
    );
    console.log(`  URL (password hidden): ${redact(raw)}`);
    console.log(`  host:                 ${url.hostname}${url.port ? ":" + url.port : ""}`);
    console.log(`  database:             ${w.db}`);
    console.log(`  user:                 ${w.usr}`);
    console.log(`  server address:port:  ${w.addr}:${w.port}`);
    console.log(`  server version:       ${w.ver.split("(")[0].trim()}`);
    if (neon.length > 0) {
      for (const n of neon) console.log(`  Neon marker ${n.name} = ${n.setting}`);
    } else {
      console.log("  Neon markers:         none visible (not a Neon instance?)");
    }

    /* 2 + 3 ─ Do the two tables exist? ------------------------------------ */
    console.log("\n━━ 2/3. Table existence " + "━".repeat(39));
    const reg = await q<{ accounts: string | null; migrations: string | null; institutions: string | null }>(
      `select to_regclass('public.accounts')::text as accounts,
              to_regclass('public.__drizzle_migrations')::text as migrations,
              to_regclass('public.institutions')::text as institutions`,
    );
    const hasAccounts = !!reg[0].accounts;
    const hasMigrationsTable = !!reg[0].migrations;
    console.log(`  public.accounts              : ${reg[0].accounts ?? "✗ MISSING"}`);
    console.log(`  public.__drizzle_migrations  : ${reg[0].migrations ?? "✗ MISSING"}`);
    console.log(`  public.institutions          : ${reg[0].institutions ?? "✗ MISSING"}`);

    /* 4 ── Migration history ---------------------------------------------- */
    console.log("\n━━ 4. Migration history (public.__drizzle_migrations) " + "━".repeat(10));
    let rows: MigrationRow[] = [];
    if (hasMigrationsTable) {
      rows = await q<MigrationRow>(
        `select id, hash, created_at from public.__drizzle_migrations order by id`,
      );
    }
    if (!hasMigrationsTable) {
      console.log("  ✗ The journal table does not exist → drizzle will think NO migration");
      console.log("    has ever run and will replay from 0000 — exactly the failure you saw.");
    } else if (rows.length === 0) {
      console.log("  ✗ The journal table exists but is EMPTY → drizzle replays from 0000.");
    } else {
      console.log(`  ${rows.length} recorded migration(s):`);
      for (const r of rows) {
        const tag = hashToTag.get(r.hash);
        const when = new Date(Number(r.created_at)).toISOString();
        console.log(`    id=${r.id}  ${when}  ${r.hash.slice(0, 12)}…  → ${tag ?? "⚠ no local file matches this hash"}`);
      }
      const recordedTags = new Set(rows.map((r) => hashToTag.get(r.hash)).filter(Boolean));
      const missing = local.filter((m) => !recordedTags.has(m.tag));
      if (missing.length > 0) {
        console.log("  Local migrations NOT recorded in the DB yet:");
        for (const m of missing) console.log(`    - ${m.tag}`);
      } else {
        console.log("  All local migrations are recorded. ✓");
      }
    }

    /* 5/6/7 ─ accounts uniqueness ------------------------------------------ */
    if (hasAccounts) {
      console.log("\n━━ 5. UNIQUE constraints & indexes on public.accounts " + "━".repeat(12));
      const cons = await q<{ conname: string; contype: string; def: string }>(
        `select conname, contype, pg_get_constraintdef(oid, true) as def
           from pg_constraint
          where conrelid = 'public.accounts'::regclass and contype in ('u', 'p')
          order by contype desc, conname`,
      );
      const uniqCons = cons.filter((c) => c.contype === "u");
      for (const c of cons) {
        console.log(`  [${c.contype === "u" ? "UNIQUE" : "PK"}] ${c.conname}: ${c.def}`);
      }
      if (uniqCons.length === 0) console.log("  (no UNIQUE constraints beyond the primary key)");

      const idx = await q<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef from pg_indexes
          where schemaname = 'public' and tablename = 'accounts'
            and indexdef ilike 'create unique%'
          order by indexname`,
      );
      const plainIdx = await q<{ c: number }>(
        `select count(*)::int as c from pg_indexes
          where schemaname = 'public' and tablename = 'accounts'`,
      );
      console.log(`  UNIQUE indexes (${idx.length}):`);
      for (const i of idx) console.log(`    - ${i.indexname}: ${i.indexdef}`);
      console.log(`  (${plainIdx[0].c} indexes on accounts in total)`);

      console.log("\n━━ 6. Status of `accounts_code_unique` " + "━".repeat(26));
      const leftover = await q<{ kind: string; name: string; def: string }>(
        `select 'constraint' as kind, conname as name, pg_get_constraintdef(oid, true) as def
           from pg_constraint
          where conrelid = 'public.accounts'::regclass
            and conname in ('accounts_code_unique', 'accounts_code_key')
         union all
         select 'index' as kind, indexname as name, indexdef as def
           from pg_indexes
          where schemaname = 'public' and tablename = 'accounts'
            and indexname in ('accounts_code_unique', 'accounts_code_key')`,
      );
      if (leftover.length === 0) {
        console.log("  ✓ Not present — no leftover UNIQUE(code) under either known name.");
      } else {
        for (const l of leftover) console.log(`  ✗ Still exists as ${l.kind}: ${l.name} → ${l.def}`);
      }

      console.log("\n━━ 7. Status of UNIQUE (user_id, code) " + "━".repeat(26));
      const wanted =
        uniqCons.filter((c) => c.def.replace(/\s+/g, "").match(/^unique\(user_id,code\)$/i)).length > 0 ||
        idx.filter((i) => i.indexdef.replace(/\s+/g, "").match(/unique.*\(user_id,code\)/i)).length > 0;
      if (wanted) {
        console.log("  ✓ YES — a UNIQUE (user_id, code) constraint/index is in place:");
        for (const c of uniqCons)
          if (/unique\s*\(user_id,\s*code\)/i.test(c.def)) console.log(`    - constraint ${c.conname}: ${c.def}`);
        for (const i of idx)
          if (/\(user_id,\s*code\)/i.test(i.indexdef)) console.log(`    - index ${i.indexname}: ${i.indexdef}`);
      } else {
        console.log("  ✗ NO — the intended UNIQUE (user_id, code) is missing on accounts.");
      }

      const counts = await q<{ rows: number; users: number }>(
        `select count(*)::int as rows, count(distinct user_id)::int as users from public.accounts`,
      );
      console.log(`\n  accounts rows: ${counts[0].rows} across ${counts[0].users} user(s) (data-presence hint).`);

      /* ── Pre-flight markers: does prod match the state after 0000–0003? ── */
      console.log("\n━━ 8. Pre-flight markers for baselining 0000–0003 " + "━".repeat(13));
      const nullab = await q<{ column_name: string; is_nullable: string }>(
        `select column_name, is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'accounts'
            and column_name in ('user_id', 'code', 'asset_id', 'wallet_id')
          order by column_name`,
      );
      for (const c of nullab)
        console.log(`  accounts.${c.column_name.padEnd(9)} nullable: ${c.is_nullable === "YES" ? "YES" : "NO"}`);
      console.log("    (0002/0003 expect asset_id, wallet_id = YES)");

      const fks = await q<{ conname: string; def: string }>(
        `select conname, pg_get_constraintdef(oid, true) as def
           from pg_constraint
          where conrelid = 'public.accounts'::regclass and contype = 'f'
          order by conname`,
      );
      console.log(`  FKs on accounts (${fks.length}) — 0000 declares 3 (user_id, asset_id, wallet_id):`);
      for (const f of fks) console.log(`    - ${f.conname}: ${f.def}`);

      const rules = await q<{ rulename: string }>(
        `select rulename from pg_rules
          where tablename in ('analytics_runs','wealth_performance_snapshots','asset_performance_analysis',
                              'portfolio_risk_metrics','benchmark_results')
            and rulename like 'prevent_%'
          order by rulename`,
      );
      console.log(`  0001 immutability rules present: ${rules.length}/10`);
      for (const r of rules) console.log(`    - ${r.rulename}`);
      if (rules.length < 10)
        console.log("    ⚠ some 0001 guards missing — informational; they are idempotent CREATE OR REPLACE,");

      const trig = await q<{ tgname: string }>(
        `select tgname from pg_trigger
          where tgname = 'vehicle_valuation_snapshots_no_update' and not tgisinternal`,
      );
      console.log(`  0001 trigger vehicle_valuation_snapshots_no_update: ${trig.length > 0 ? "present ✓" : "MISSING ⚠"}`);

      const dups = await q<{ code: string; users: number; rows: number }>(
        `select code, count(distinct user_id)::int as users, count(*)::int as rows
           from public.accounts group by code having count(distinct user_id) > 1 order by code`,
      );
      if (dups.length === 0) {
        console.log("  Cross-user duplicate codes: NONE → UNIQUE(code) could theoretically be re-added.");
      } else {
        console.log(`  Cross-user duplicate codes: ${dups.length} → re-adding UNIQUE(code) would FAIL;`);
        console.log("    the only rollback for dropping it is a Neon restore point. Duplicate codes:");
        for (const d of dups.slice(0, 10)) console.log(`    - code=${d.code} (${d.users} users, ${d.rows} rows)`);
      }
    } else {
      console.log("\n  (accounts does not exist — skipping sections 5–7.)");
    }
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("db-inspect-readonly crashed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
