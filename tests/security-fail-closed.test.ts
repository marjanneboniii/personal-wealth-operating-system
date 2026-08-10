import assert from "node:assert/strict";
import { test } from "node:test";
import { GET as backupApi } from "../src/app/api/backup/route";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import { users, sessions } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { createSession, getSessionUser } from "../src/lib/auth";
import { ensureAuth, requireAuthForApi } from "../src/lib/authGuard";
import { sql } from "drizzle-orm";

async function cleanDb() {
  await createSchemaIfNotExists();
  await db.delete(sessions);
  await db.delete(users);
  delete process.env.PWOS_AUTH_TOKEN;
}

test("Section 20 — Fail-Closed Test 1: No Session -> Protected API returns 401", async () => {
  await cleanDb();
  const req = new Request("http://localhost/api/backup", { method: "GET" });
  const res = await backupApi(req);
  assert.equal(res.status, 401);
});

test("Section 20 — Fail-Closed Test 2: Invalid Session -> Protected API returns 401", async () => {
  await cleanDb();
  const req = new Request("http://localhost/api/backup", {
    method: "GET",
    headers: { cookie: "pwos_session=invalid-fake-token-12345" },
  });
  const res = await backupApi(req);
  assert.equal(res.status, 401);
  const user = await getSessionUser("invalid-fake-token-12345");
  assert.equal(user, null);
});

test("Section 20 — Fail-Closed Test 3: Expired Session -> Protected API returns 401 and removes expired session", async () => {
  await cleanDb();
  const [u] = await db
    .insert(users)
    .values({ name: "Expired User", username: "expired1", role: "owner" } as any)
    .returning();

  const expiredToken = "expired-token-xyz";
  await db.insert(sessions).values({
    userId: u.id,
    token: expiredToken,
    expiresAt: new Date(Date.now() - 3600 * 1000), // 1 hour ago
  });

  const req = new Request("http://localhost/api/backup", {
    method: "GET",
    headers: { cookie: `pwos_session=${expiredToken}` },
  });

  const res = await backupApi(req);
  assert.equal(res.status, 401);

  const [row] = await db.select().from(sessions).where(eq(sessions.token, expiredToken));
  assert.equal(row, undefined);
});

test("Section 20 — Fail-Closed Test 4: Database Error -> Auth DB failure denies access (throws error, never allows)", async () => {
  await cleanDb();
  const [u] = await db
    .insert(users)
    .values({ name: "User 1", username: "user1", role: "owner" } as any)
    .returning();
  const { token } = await createSession(u.id);

  // Rename tables to simulate database failure / connection error
  await db.execute(sql`alter table sessions rename to sessions_broken`);
  await db.execute(sql`alter table users rename to users_broken`);

  try {
    let errThrown = false;
    try {
      await getSessionUser(token);
    } catch (e: any) {
      errThrown = true;
      assert.match(e.message, /Authentication\/Database error/);
    }
    assert.equal(errThrown, true, "getSessionUser must throw on DB failure instead of returning fake allow");

    let ensureAuthDenied = false;
    try {
      await ensureAuth();
    } catch (e: any) {
      ensureAuthDenied = true;
      assert.match(e.message, /Authentication\/Database error/);
    }
    assert.equal(ensureAuthDenied, true, "ensureAuth must throw on DB failure instead of allowing access");

    let apiDenied = false;
    try {
      await requireAuthForApi();
    } catch (e: any) {
      apiDenied = true;
      assert.match(e.message, /Authentication\/Database error/);
    }
    assert.equal(apiDenied, true, "requireAuthForApi must throw on DB failure instead of allowing access");
  } finally {
    // Restore table names for subsequent tests
    await db.execute(sql`alter table sessions_broken rename to sessions`);
    await db.execute(sql`alter table users_broken rename to users`);
  }
});
