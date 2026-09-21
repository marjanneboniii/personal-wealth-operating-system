/**
 * Which layer actually isolates tenants — pinned, because getting it wrong is
 * silent.
 *
 * drizzle/0016_tenant_rls.sql creates row-level security policies keyed on
 * `current_setting('app.user_id')`. They are inert: nothing sets that setting,
 * and a table owner bypasses RLS anyway without FORCE ROW LEVEL SECURITY. The
 * real mechanism is that every tenant-scoped query filters on user_id, which
 * tests/security-isolation-hardening.test.ts proves behaviourally.
 *
 * The danger is a HALF-DONE activation of the dormant layer. Introducing
 * set_config('app.user_id', …) without also moving to a non-owner role, or
 * moving to a non-owner role without setting it, produces no error at all:
 * `user_id::text = NULL` is simply never true, so every tenant query returns
 * nothing. A test suite that runs as the owner would stay green throughout.
 *
 * So this asserts the current arrangement is intact and internally consistent.
 * It is not a rule against ever activating RLS — it is a requirement that
 * doing so be a deliberate change that updates this test and says why.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";

const SRC = new URL("../src/", import.meta.url);
const DRIZZLE = new URL("../drizzle/", import.meta.url);

/** Every .ts/.tsx file under src/, read once. */
function sourceFiles(dir = SRC): { path: string; code: string }[] {
  const out: { path: string; code: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) out.push(...sourceFiles(child));
    else if (/\.tsx?$/.test(entry.name)) out.push({ path: child.pathname, code: readFileSync(child, "utf8") });
  }
  return out;
}

test("the app.user_id RLS layer stays dormant, and nothing half-activates it", () => {
  const files = sourceFiles();
  assert.ok(files.length > 100, "sanity: the source tree should have been walked");

  // Nothing sets the GUC the 0016 policies read. A single call site that is
  // not on EVERY tenant query is worse than none: the queries that do set it
  // would work and the rest would quietly return nothing.
  const setters = files.filter((f) => /set_config\(\s*['"`]app\.user_id/.test(f.code));
  assert.deepEqual(
    setters.map((f) => f.path.replace(SRC.pathname, "src/")),
    [],
    "something now sets app.user_id. Activating the 0016 policies requires a non-owner runtime role AND every tenant query routed through it — see the comment in src/db/index.ts, and update this test as part of that change.",
  );

  // The policies themselves are still there, unforced. Keeping them costs
  // nothing and preserves the option; dropping them is a separate decision.
  const tenantRls = readFileSync(new URL("0016_tenant_rls.sql", DRIZZLE), "utf8");
  assert.match(tenantRls, /current_setting\(''app\.user_id''/, "0016 should still define the dormant policies");

  const migrations = readdirSync(DRIZZLE)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(new URL(f, DRIZZLE), "utf8"))
    .join("\n");
  assert.doesNotMatch(
    migrations,
    /FORCE\s+ROW\s+LEVEL\s+SECURITY/i,
    "FORCE ROW LEVEL SECURITY would make the dormant policies bite the owner role, and nothing sets app.user_id",
  );
});

test("tenant isolation is enforced by explicit user_id filters in the services", () => {
  // A representative sample of the tenant-scoped read paths. Each must name
  // userId in its query rather than relying on the database to scope it.
  const paths = [
    "features/rwa/realEstate/service.ts",
    "features/rwa/vehicle/service.ts",
    "features/ledger/queries.ts",
    "features/planning/service.ts",
    "features/accounts/service.ts",
  ];
  for (const rel of paths) {
    const code = readFileSync(new URL(rel, SRC), "utf8");
    assert.match(
      code,
      /userId/,
      `${rel} is a tenant-scoped service and must scope on userId itself — the database does not do it`,
    );
  }
});
