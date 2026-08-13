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
  const url = process.env.DATABASE_URL;
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

main().catch((err) => {
  // Driver messages may mention a username/host but never the password or the
  // full connection string. Keep the output generic and actionable.
  console.error("db:migrate failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
