import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/**
 * Database migration configuration.
 *
 * `src/db/schema.ts` is the single source of truth for the schema. Migrations
 * are GENERATED from it (`npm run db:generate`) and APPLIED explicitly
 * (`npm run db:migrate`) — never from inside the request lifecycle.
 *
 * DATABASE_URL is loaded from .env. The local fallback only exists so that
 * `db:generate` (which does not connect) and local development work without a
 * .env file. Real deploys must set DATABASE_URL to a hosted PostgreSQL
 * connection string (e.g. Neon).
 *
 * (In `memory://` mode there is no server to migrate — `db:migrate` refuses it.)
 */
const url = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/pwos";

if (url.startsWith("memory://")) {
  throw new Error(
    "Database migrations require a real PostgreSQL DATABASE_URL — the embedded memory:// database has no server to migrate. " +
      "Use memory:// only for local development and tests.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  verbose: true,
  strict: true,
  migrations: {
    table: "__drizzle_migrations",
    schema: "public",
  },
});
