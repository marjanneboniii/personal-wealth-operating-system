import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaPgliteClient?: PGlite;
  __arenaDb?: ReturnType<typeof drizzlePg> | ReturnType<typeof drizzlePglite>;
};

function initDb() {
  if (databaseUrl && !databaseUrl.startsWith("memory://")) {
    const pool =
      globalForDb.__arenaNextJsPostgresqlPool ??
      new Pool({
        connectionString: databaseUrl,
        // Resilience against flaky / cold-starting remote databases:
        // fail fast on connect, recycle idle sockets, and keep TCP alive
        // so proxies that silently drop connections don't poison the pool.
        max: 5,
        connectionTimeoutMillis: 15_000,
        idleTimeoutMillis: 30_000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10_000,
      });

    if (process.env.NODE_ENV !== "production") {
      globalForDb.__arenaNextJsPostgresqlPool = pool;
    }
    return drizzlePg(pool);
  } else {
    const client = globalForDb.__arenaPgliteClient ?? new PGlite();
    if (process.env.NODE_ENV !== "production") {
      globalForDb.__arenaPgliteClient = client;
    }
    return drizzlePglite(client);
  }
}

export const db = globalForDb.__arenaDb ?? (globalForDb.__arenaDb = initDb());
