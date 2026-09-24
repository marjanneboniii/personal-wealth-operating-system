/**
 * The first-run tour: once per ACCOUNT (not per device), and every step points
 * at a control that exists on both the phone and the desktop layout.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { readFileSync } from "node:fs";
import { users } from "../src/db/schema";

let cookie: string | null = null;
mock.module("next/headers", { namedExports: { cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined), set: () => {}, delete: () => {} }), headers: async () => new Headers() } });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

test("every tour step has a target on phone and on desktop", () => {
  const shell = readFileSync(new URL("../src/components/layout/Shell.tsx", import.meta.url), "utf8");
  const targets = [...shell.matchAll(/target: "([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(targets, ["record", "search", "reminders", "more"]);
  for (const t of targets) {
    const marks = shell.split(`data-tour="${t}"`).length - 1;
    assert.ok(marks >= 2, `«${t}» is marked on both layouts (found ${marks})`);
  }
});

test("seen once per account, on any device", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { createSession } = await import("../src/lib/auth");
  const { hasSeenTour } = await import("../src/features/preferences/service");
  const { markTourSeenAction } = await import("../src/app/actions/tour");
  await createSchemaIfNotExists();
  const [a] = await db.insert(users).values({ name: "a", username: `tour-a-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
  const [b] = await db.insert(users).values({ name: "b", username: `tour-b-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
  assert.equal(await hasSeenTour(a.id), false);
  assert.equal(await hasSeenTour(null), true, "no account → never shown");
  assert.equal((await markTourSeenAction()).ok, false, "signed out cannot mark it");
  cookie = (await createSession(a.id)).token;
  assert.equal((await markTourSeenAction()).ok, true);
  assert.equal(await hasSeenTour(a.id), true);
  assert.equal(await hasSeenTour(b.id), false, "another account still gets it");
  assert.equal((await markTourSeenAction()).ok, true, "idempotent");
});
