import { createRequire } from "node:module";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { assertProductionDatabaseConfig, isMemoryUrl } from "@/db/config";

/**
 * Shared runtime database handle.
 *
 * Two modes:
 *  1. Real PostgreSQL (DATABASE_URL) — used in production and for local
 *     development against a real database. The schema is applied explicitly
 *     with `npm run db:migrate`; this module NEVER runs DDL.
 *  2. Embedded PGlite (memory:// or no DATABASE_URL) — local development and
 *     tests only. PGlite is a devDependency and is loaded lazily so the
 *     production bundle never references it.
 *
 * The handle is cached on `globalThis` so a serverless warm invocation reuses
 * one pool instead of opening a new one per module evaluation.
 */

type Db = ReturnType<typeof drizzlePg>;

const databaseUrl = process.env.DATABASE_URL;

const globalForDb = globalThis as typeof globalThis & {
  __pwosDb?: Db;
  __pwosPgPool?: Pool;
  // The embedded PGlite client; kept opaque (`unknown`) so the dev-only
  // package is never part of the production type graph or bundle.
  __pwosPgliteClient?: unknown;
};

// Used only for the dev/test memory:// path. Requires are deferred to runtime
// (inside createMemoryDb) so the production bundle never statically imports
// the embedded database driver.
const nodeRequire = createRequire(import.meta.url);

function createMemoryDb(): Db {
  const { PGlite: PGliteCtor } = nodeRequire("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = nodeRequire("drizzle-orm/pglite");

  const client = globalForDb.__pwosPgliteClient ?? new PGliteCtor();
  // Keep the in-memory database across dev hot-reloads.
  if (process.env.NODE_ENV !== "production") {
    globalForDb.__pwosPgliteClient = client;
  }
  return drizzlePglite(client);
}

function initDb(): Db {
  // Fail-closed: production must never run on the embedded memory database.
  assertProductionDatabaseConfig();

  if (!isMemoryUrl(databaseUrl)) {
    const pool =
      globalForDb.__pwosPgPool ??
      new Pool({
        connectionString: databaseUrl,
        // Serverless-safe defaults:
        //  - `max` bounds the connections a single instance opens (each
        //    serverless instance only ever holds a handful);
        //  - fail fast on connect so a sleeping/cold database surfaces an
        //    error instead of hanging the request;
        //  - recycle idle sockets quickly so frozen instances do not hold
        //    connections open;
        //  - keepAlive re-checks connections so pooled endpoints (e.g. Neon's
        //    pgbouncer) that silently drop idle connections don't poison the
        //    pool.
        max: 5,
        connectionTimeoutMillis: 15_000,
        idleTimeoutMillis: 30_000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10_000,
        application_name: "pwos",
      });

    // Reuse the pool across hot-reloads in development; in production the pool
    // is kept alive through the globally cached `db` handle above.
    if (process.env.NODE_ENV !== "production") {
      globalForDb.__pwosPgPool = pool;
    }
    return drizzlePg(pool);
  }

  // Embedded database — dev/test only (production is rejected above).
  return createMemoryDb();
}

export const db = globalForDb.__pwosDb ?? (globalForDb.__pwosDb = initDb());
