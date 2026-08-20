/**
 * Net-worth snapshot history isolation.
 *
 * Bug: after user A logged out and user B logged in, B's Overview module
 * showed "۰ دلار ↓ −۳۴٬۰۰۸٫۵۱ (−۱۰۰٪) از ۲۸ مرداد" — the delta badge (and
 * the chart) were built from an UNSCOPED `select * from snapshots`, so the
 * previous user's net-worth history leaked into the new user's dashboard.
 *
 * These tests pin the read side of the `snapshots` history table to the
 * current tenant. The accounting core (ledger, postings, FIFO lots) is not
 * involved and is deliberately untouched here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import { snapshotLines, snapshots, users } from "../src/db/schema";
import {
  getFirstSnapshotAfter,
  getSnapshotAsOf,
  getSnapshotSeries,
} from "../src/features/ledger/queries";

async function seedTwoUsersWithHistory() {
  await createSchemaIfNotExists();
  await db.delete(snapshotLines);
  await db.delete(snapshots);
  await db.delete(users);

  const [userA] = await db
    .insert(users)
    .values({ name: "User A", username: "user_a_snap", role: "owner" } as any)
    .returning();
  const [userB] = await db
    .insert(users)
    .values({ name: "User B", username: "user_b_snap", role: "owner" } as any)
    .returning();

  // User A has real history (the 34,008.51 net worth from the bug report).
  await db.insert(snapshots).values([
    {
      userId: userA.id,
      asOf: "2026-08-10",
      baseCurrency: "USD",
      totalAssets: "30000.000000",
      totalLiabilities: "0.000000",
      netWorth: "30000.000000",
    },
    {
      userId: userA.id,
      asOf: "2026-08-19",
      baseCurrency: "USD",
      totalAssets: "34008.510000",
      totalLiabilities: "0.000000",
      netWorth: "34008.510000",
    },
  ] as any);

  return { userA, userB };
}

test("Overview history: a brand-new user sees NO snapshots from the previous user", async () => {
  const { userA, userB } = await seedTwoUsersWithHistory();

  const seriesB = await getSnapshotSeries(40, userB.id);
  assert.equal(seriesB.length, 0, "user B must start with an empty net-worth history");

  // Which is exactly what removes the bogus "−34,008.51 (−100%)" delta badge:
  // with no snapshot row there is no baseline to compare today's 0 against.
  const lastSnapB = seriesB[0];
  assert.equal(lastSnapB, undefined);

  // User A keeps their own history intact (newest first).
  const seriesA = await getSnapshotSeries(40, userA.id);
  assert.equal(seriesA.length, 2);
  assert.equal(seriesA[0].asOf, "2026-08-19");
  assert.equal(Number(seriesA[0].netWorth), 34008.51);
  assert.ok(seriesA.every((s) => Number(s.netWorth) > 0));
});

test("Net-worth page baselines are tenant-scoped (no cross-user baseline)", async () => {
  const { userA, userB } = await seedTwoUsersWithHistory();

  assert.equal(await getSnapshotAsOf("2026-08-20", userB.id), null);
  assert.equal(await getFirstSnapshotAfter("2026-01-01", userB.id), null);

  const baselineA = await getSnapshotAsOf("2026-08-20", userA.id);
  assert.ok(baselineA);
  assert.equal(baselineA!.asOf, "2026-08-19");
  assert.equal(Number(baselineA!.netWorth), 34008.51);
});

test("Multi-tenant DB without a resolvable identity reads no history (fail-closed)", async () => {
  await seedTwoUsersWithHistory();

  // No explicit user id and no web session: with several identities in the
  // database a global read would blend tenants — it must return nothing.
  assert.deepEqual(await getSnapshotSeries(40), []);
  assert.equal(await getSnapshotAsOf("2026-08-20"), null);
  assert.equal(await getFirstSnapshotAfter("2026-01-01"), null);
});

test("Single-user legacy database still sees its own (possibly unowned) history", async () => {
  await createSchemaIfNotExists();
  await db.delete(snapshotLines);
  await db.delete(snapshots);
  await db.delete(users);

  const [legacy] = await db
    .insert(users)
    .values({ name: "Legacy", role: "owner" } as any)
    .returning();
  assert.ok(legacy);

  // Pre-migration rows carry no owner; the legacy single-tenant view keeps them.
  await db.insert(snapshots).values({
    userId: null,
    asOf: "2026-08-01",
    baseCurrency: "USD",
    totalAssets: "1456.000000",
    totalLiabilities: "0.000000",
    netWorth: "1456.000000",
  } as any);

  const series = await getSnapshotSeries(40);
  assert.equal(series.length, 1);
  assert.equal(Number(series[0].netWorth), 1456);
});
