import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { isMemoryUrl } from "@/db/config";

/**
 * Explicit, traceable database migration runner.
 *
 *   npm run db:migrate
 *
 * Applies the SQL migrations in `drizzle/` (generated from `src/db/schema.ts`,
 * the single source of truth) against a real PostgreSQL database. Applied
 * migrations are recorded in `public.__drizzle_migrations`; already-applied
 * migrations are skipped, so the command is safe to re-run and never re-applies
 * a migration destructively.
 *
 * This is the ONLY path that changes the database structure. It must be run as
 * an explicit deployment step — never from the application runtime, never from
 * a request, and never from the build.
 */
async function main() {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (isMemoryUrl(url)) {
    console.error(
      "db:migrate requires a real PostgreSQL DATABASE_URL. " +
        "The embedded memory:// database has no server to migrate (it is rebuilt in-memory for development and tests).",
    );
    process.exit(1);
  }

  console.log("Applying database migrations from ./drizzle ...");

  // A dedicated, single-connection pool: migrations run sequentially, and the
  // pool is closed when finished so the CLI exits cleanly.
  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 15_000,
  });

  try {
    await migrate(drizzle(pool), {
      migrationsFolder: "./drizzle",
      migrationsTable: "__drizzle_migrations",
      migrationsSchema: "public",
    });
  } finally {
    await pool.end().catch(() => {});
  }

  console.log("Database migrations applied successfully.");
  process.exit(0);
}

/**
 * Drizzle wraps every driver error as «Failed query: <sql>», so the first
 * statement it runs (CREATE SCHEMA) is blamed for anything — a wrong database
 * name, a refused login, an unreachable host. The real reason is on `cause`.
 */
function describe(err: unknown): string {
  const parts: string[] = [];
  let cur: any = err;
  for (let depth = 0; cur && depth < 4; depth++) {
    const msg = cur instanceof Error ? cur.message : String(cur);
    const code = cur?.code ? ` [${cur.code}]` : "";
    if (msg && !parts.some((p) => p.startsWith(msg))) parts.push(msg.split("\nparams:")[0].trim() + code);
    cur = cur?.cause;
  }
  return parts.join("\n  caused by: ");
}

function hint(err: unknown): string | null {
  const text = describe(err);
  if (/database ".*" does not exist|3D000/.test(text)) return "The database name at the end of the connection string is wrong (e.g. «postgre» instead of «postgres»).";
  if (/password authentication failed|28P01/.test(text)) return "The user or password in the connection string is wrong.";
  if (/ENOTFOUND|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ETIMEDOUT/.test(text)) return "The database host is unreachable. On Supabase the direct host is IPv6-only — use the pooler connection string instead.";
  if (/permission denied|42501/.test(text)) return "This database user may not run DDL. Set MIGRATION_DATABASE_URL to the owner (postgres) connection string.";
  return null;
}

main().catch((err) => {
  // Driver messages may mention a username/host but never the password or the
  // full connection string. Keep the output generic and actionable.
  console.error("db:migrate failed:", describe(err));
  const h = hint(err);
  if (h) console.error("hint:", h);
  process.exit(1);
});
