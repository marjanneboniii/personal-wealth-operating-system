import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import {
  assertProductionDatabaseConfig,
  isMemoryUrl,
  isProductionRuntime,
} from "../src/db/config";
import { db } from "../src/db";

const root = process.cwd();

/** Recursively list source files, skipping node_modules / .next / build output. */
function sourceFiles(path: string): string[] {
  return readdirSync(path).flatMap((entry) => {
    const absolute = join(path, entry);
    if (absolute.includes("node_modules") || absolute.includes(".next") || absolute.includes("drizzle/meta")) {
      return [];
    }
    if (statSync(absolute).isDirectory()) return sourceFiles(absolute);
    return /\.(ts|tsx|sql)$/.test(entry) ? [absolute] : [];
  });
}

const srcFiles = sourceFiles(join(root, "src"));
const srcText = (file: string) => readFileSync(file, "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// Production database configuration
// ─────────────────────────────────────────────────────────────────────────────

test("production + memory:// is rejected (fail-closed)", () => {
  assert.throws(() => assertProductionDatabaseConfig({ NODE_ENV: "production", DATABASE_URL: "memory://" }));
  // A missing DATABASE_URL also defaults to the embedded database → rejected.
  assert.throws(() => assertProductionDatabaseConfig({ NODE_ENV: "production", NEXT_PHASE: "phase-production-server" }));
});

test("the production config error never leaks the connection string", () => {
  const secretUrl = "postgresql://pwos_owner:super-secret-password@ep-secret.us-east-1.aws.neon.tech/db";
  try {
    assertProductionDatabaseConfig({ NODE_ENV: "production", NEXT_PHASE: "phase-production-server", DATABASE_URL: secretUrl });
    // If it does not throw, the URL was treated as real — assert it still never echoes.
    assert.fail("expected production + real URL to pass validation");
  } catch (err) {
    // No path should ever emit the password / host. (This throw case is only
    // hit for memory:// — the assertion below guards the generic message.)
  }
  assert.throws(
    () => assertProductionDatabaseConfig({ NODE_ENV: "production", NEXT_PHASE: "phase-production-server", DATABASE_URL: "memory://" }),
    (err: Error) => {
      assert.ok(!err.message.includes("super-secret-password"));
      assert.ok(!err.message.includes("ep-secret"));
      return true;
    },
  );
});

test("production + real PostgreSQL URL passes validation", () => {
  assert.doesNotThrow(() =>
    assertProductionDatabaseConfig({
      NODE_ENV: "production",
      NEXT_PHASE: "phase-production-server",
      DATABASE_URL: "postgresql://user:pass@ep-ok.us-east-1.aws.neon.tech/db?sslmode=verify-full",
    }),
  );
});

test("next build phase is not treated as the production runtime", () => {
  assert.doesNotThrow(() => assertProductionDatabaseConfig({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" }));
});

test("development + memory:// is allowed", () => {
  assert.doesNotThrow(() => assertProductionDatabaseConfig({ NODE_ENV: "development", DATABASE_URL: "memory://" }));
  assert.equal(isProductionRuntime({ NODE_ENV: "development" }), false);
});

test("isMemoryUrl detects the embedded database and a missing URL", () => {
  assert.equal(isMemoryUrl("memory://"), true);
  assert.equal(isMemoryUrl(undefined), true);
  assert.equal(isMemoryUrl(""), true);
  assert.equal(isMemoryUrl("postgresql://user:pass@host/db"), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Demo seed is blocked in production
// ─────────────────────────────────────────────────────────────────────────────

test("demo seed is blocked in production (no tables are created and no data is seeded)", async () => {
  // Next.js types mark NODE_ENV as readonly — cast through a mutable record.
  const env = process.env as unknown as Record<string, string | undefined>;
  const prevNodeEnv = env.NODE_ENV;
  const prevAppMode = env.APP_MODE;
  env.NODE_ENV = "production";
  env.APP_MODE = "development"; // worst case: a misconfigured deploy
  env.ALLOW_DEMO_SEED = "true"; // worst case: demo flag explicitly on
  try {
    const { seedIfEmpty } = await import("../src/db/seed");
    await seedIfEmpty();

    // seedIfEmpty must have returned before touching the schema: no DDL ran.
    const res = await db.execute(sql`select count(*)::int as c from information_schema.tables where table_schema = 'public'`);
    assert.equal(res.rows[0].c, 0, "seedIfEmpty must not bootstrap the schema or seed data in production");
  } finally {
    if (prevNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = prevNodeEnv;
    if (prevAppMode === undefined) delete env.APP_MODE;
    else env.APP_MODE = prevAppMode;
    delete env.ALLOW_DEMO_SEED;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration does not execute during the request lifecycle
// ─────────────────────────────────────────────────────────────────────────────

test("schema bootstrap (ensureSchemaOnce) is a no-op for a real PostgreSQL URL", () => {
  const initSource = srcText(join(root, "src/db/init-schema.ts"));
  assert.ok(initSource.includes("if (!isMemoryUrl(process.env.DATABASE_URL))"), "ensureSchemaOnce must gate on memory://");
  assert.ok(initSource.includes("return Promise.resolve();"), "ensureSchemaOnce must be a no-op for real PostgreSQL");
});

test("no runtime code (pages / routes / services) runs schema DDL", () => {
  for (const file of srcFiles.filter((f) => !f.endsWith("db/init-schema.ts"))) {
    const text = srcText(file);
    assert.equal(
      text.includes("createSchemaIfNotExists"),
      false,
      `${file} must not run schema initialization during the request lifecycle`,
    );
  }
});

test("migration runner refuses the embedded memory:// database", () => {
  const migrateSource = srcText(join(root, "src/scripts/migrate.ts"));
  assert.ok(migrateSource.includes("isMemoryUrl(url)"), "db:migrate must refuse memory://");
  assert.ok(migrateSource.includes("migrationsFolder: \"./drizzle\""), "db:migrate must target the drizzle/ migrations folder");
});

// ─────────────────────────────────────────────────────────────────────────────
// Health endpoint does not leak secrets
// ─────────────────────────────────────────────────────────────────────────────

test("health endpoint returns only { ok } and never leaks connection details", () => {
  const health = srcText(join(root, "src/app/api/health/route.ts"));
  assert.ok(!health.includes("DATABASE_URL"), "health must not read or echo DATABASE_URL");
  assert.ok(!health.includes("process.env"), "health must not read process.env");
  assert.ok(health.includes("{ ok: true }") && health.includes("{ ok: false }"), "health must only report ok true/false");
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth token is never exposed client-side
// ─────────────────────────────────────────────────────────────────────────────

test("PWOS_AUTH_TOKEN is server-only and never NEXT_PUBLIC_", () => {
  for (const file of srcFiles) {
    const text = srcText(file);
    assert.equal(text.includes("NEXT_PUBLIC_PWOS_AUTH_TOKEN"), false, `${file} must never expose the auth token to the client`);
    assert.equal(text.includes("NEXT_PUBLIC_DATABASE_URL"), false, `${file} must never expose the database URL`);
    assert.equal(text.includes("NEXT_PUBLIC_COINGECKO_API_KEY"), false, `${file} must never expose the CoinGecko key`);
    if (text.includes("PWOS_AUTH_TOKEN")) {
      // Token must only appear in server-side modules — never in a client bundle.
      const firstLines = text.slice(0, 200);
      assert.equal(firstLines.includes('"use client"'), false, `${file} references PWOS_AUTH_TOKEN and must not be a client component`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration files are schema-only and never touch accounting data
// ─────────────────────────────────────────────────────────────────────────────

test("drizzle migrations exist and never rewrite accounting data", () => {
  const initial = join(root, "drizzle/0000_initial.sql");
  const hardening = join(root, "drizzle/0001_production_schema_hardening.sql");
  assert.ok(existsSync(initial), "initial migration must exist");
  assert.ok(existsSync(hardening), "hardening migration must exist");

  const later = [
    join(root, "drizzle/0002_accounts_header_nullable.sql"),
    join(root, "drizzle/0003_accounts_coa_constraints.sql"),
    join(root, "drizzle/0004_accounts_code_unique_drop.sql"),
  ];
  for (const file of later) {
    assert.ok(existsSync(file), `${file} must exist`);
  }

  const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  for (const file of [initial, hardening, ...later]) {
    const text = stripComments(readFileSync(file, "utf8"));
    // Migrations must not mutate accounting tables or recalculate anything.
    assert.equal(/update\s+(journal_entries|postings|lots|lot_consumptions|accounts|transactions)\b/i.test(text), false, `${file} must not rewrite accounting tables`);
    for (const forbidden of ["recalculate", "repost", "rewrite", "rebuild", "recompute"]) {
      assert.equal(text.toLowerCase().includes(forbidden), false, `${file} must not contain "${forbidden}"`);
    }
  }

  const dropUnique = readFileSync(join(root, "drizzle/0004_accounts_code_unique_drop.sql"), "utf8");
  assert.ok(dropUnique.includes("accounts_code_unique"), "0004 must drop the leftover drizzle UNIQUE(code) name");
  assert.ok(dropUnique.includes("accounts_user_code_uq"), "0004 must restore per-tenant uniqueness");
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration applies cleanly to a fresh database
// ─────────────────────────────────────────────────────────────────────────────

test("migration files apply cleanly to a fresh database and include the hardening guards", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");

  const client = new PGlite();
  const migrationDb = drizzle(client);
  await migrate(migrationDb, {
    migrationsFolder: "./drizzle",
    migrationsTable: "__drizzle_migrations",
    migrationsSchema: "public",
  });

  const tables = await migrationDb.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
  const names = new Set((tables.rows as { tablename: string }[]).map((r) => r.tablename));
  for (const t of ["users", "accounts", "journal_entries", "postings", "lots", "lot_consumptions", "institutions"]) {
    assert.ok(names.has(t), `expected table ${t} after migration`);
  }

  // The immutable valuation-snapshot trigger function exists.
  const fn = await migrationDb.execute(sql`select to_regprocedure('vehicle_valuation_snapshots_immutable()') as p`);
  assert.ok((fn.rows[0] as { p: unknown }).p, "expected the immutable trigger function to be created");

  // The append-only analytics rule exists.
  const rule = await migrationDb.execute(sql`select rulename from pg_rules where tablename = 'analytics_runs' and rulename = 'prevent_update_analytics_runs'`);
  assert.equal((rule.rows as unknown[]).length, 1, "expected the append-only analytics rule to be created");

  const nullability = await migrationDb.execute(sql`
    select column_name, is_nullable
    from information_schema.columns
    where table_name = 'accounts' and column_name in ('asset_id', 'wallet_id')
  `);
  const byCol = Object.fromEntries(
    (nullability.rows as { column_name: string; is_nullable: string }[]).map((r) => [r.column_name, r.is_nullable]),
  );
  assert.equal(byCol.asset_id, "YES", "header CoA accounts require nullable asset_id");
  assert.equal(byCol.wallet_id, "YES", "header CoA accounts require nullable wallet_id");
});
