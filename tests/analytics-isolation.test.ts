/**
 * Phase 1 — Analytics tenant isolation (critical cross-user leak fix).
 *
 * Before the fix, getAnalyticsSummary() without a userId read every tenant's
 * portfolio_snapshots (WHERE 1=1) and capital-flow records with no user
 * filter, so one user's growth/risk/timeline/drawdown were computed over the
 * whole multi-tenant database.
 *
 * These tests pin the fixed behavior:
 *   - each user's analytics is scoped to their own snapshots;
 *   - with multiple users and no resolvable identity, analytics is DENIED
 *     (never a global read);
 *   - analytics_runs rows are user-scoped for authenticated tenants.
 *
 * NOTE: analytics_runs is append-only at the DB level (UPDATE/DELETE are
 * no-ops via CREATE RULE), so these tests never delete it or the users it
 * references; unique usernames are generated per run instead.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  analyticsRuns,
  portfolioSnapshots,
  users,
  userFxSettings,
} from "../src/db/schema";
import { getAnalyticsSummary } from "../src/features/analytics/service";

let seq = 0;

async function createUser(name: string) {
  seq += 1;
  const username = `an-isol-${Date.now()}-${seq}`;
  const [u] = await db
    .insert(users)
    .values({ name, username, role: "owner" } as any)
    .returning();
  return u;
}

async function cleanupDeletable() {
  await createSchemaIfNotExists();
  // portfolio_snapshots and user_fx_settings are deletable. analytics_runs is
  // append-only (DB rules) and users is referenced by it, so neither is deleted.
  await db.delete(portfolioSnapshots);
  await db.delete(userFxSettings);
}

test("Phase 1 — analytics is tenant-scoped: A never sees B's snapshot values", async () => {
  await cleanupDeletable();
  const userA = await createUser("Analytics A");
  const userB = await createUser("Analytics B");

  await db.insert(userFxSettings).values([
    { userId: userA.id, currentRate: "190000" },
    { userId: userB.id, currentRate: "200000" },
  ] as any);

  // Distinct, easily identifiable snapshot values per tenant.
  await db.insert(portfolioSnapshots).values([
    { userId: userA.id, snapshotDate: "2026-08-01", totalPortfolioValue: "1111.00" },
    { userId: userB.id, snapshotDate: "2026-08-01", totalPortfolioValue: "9999.00" },
  ] as any);

  const summaryA = await getAnalyticsSummary(userA.id);
  const summaryB = await getAnalyticsSummary(userB.id);

  const valuesA = summaryA.timeline.map((p) => Number(p.portfolioValue));
  const valuesB = summaryB.timeline.map((p) => Number(p.portfolioValue));

  assert.ok(valuesA.includes(1111), "A must see only A's snapshot values");
  assert.ok(!valuesA.includes(9999), "A must never see B's snapshot values");
  assert.ok(valuesB.includes(9999), "B must see only B's snapshot values");
  assert.ok(!valuesB.includes(1111), "B must never see A's snapshot values");

  // analytics_runs must be user-scoped (never null) for these tenants.
  const runsA = await db.select().from(analyticsRuns).where(eq(analyticsRuns.userId, userA.id));
  const runsB = await db.select().from(analyticsRuns).where(eq(analyticsRuns.userId, userB.id));
  assert.ok(runsA.length >= 1, "user A's run must be recorded under A");
  assert.ok(runsB.length >= 1, "user B's run must be recorded under B");
  assert.ok(runsA.every((r) => r.userId === userA.id));
  assert.ok(runsB.every((r) => r.userId === userB.id));
});

test("Phase 1 — no resolvable identity in a multi-tenant DB => analytics DENIED", async () => {
  await cleanupDeletable();
  // Guarantee at least two tenants exist regardless of prior test state.
  await createUser("Analytics C");
  await createUser("Analytics D");

  // No explicit id and no session: analytics must fail closed instead of
  // blending both tenants into one global dashboard.
  await assert.rejects(() => getAnalyticsSummary(), /Access denied/);
});
