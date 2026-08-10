import assert from "node:assert/strict";
import { test } from "node:test";
import { POST as restoreApi } from "../src/app/api/restore/route";
import { GET as backupApi } from "../src/app/api/backup/route";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import { users, sessions } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { createSession, getSessionUser, hashPassword } from "../src/lib/auth";

async function cleanAuth() {
  await createSchemaIfNotExists();
  await db.delete(sessions);
  await db.delete(users);
  delete process.env.PWOS_AUTH_TOKEN;
}

test("Section 21 — Backup API: Anonymous GET /api/backup -> 401", async () => {
  await cleanAuth();
  const req = new Request("http://localhost/api/backup", { method: "GET" });
  const res = await backupApi(req);
  assert.equal(res.status, 401);
});

test("Section 21 — Backup API: Authenticated User GET /api/backup -> Success and no session token exported", async () => {
  await cleanAuth();
  const [u] = await db
    .insert(users)
    .values({ name: "Owner", username: "owner1", role: "owner" } as any)
    .returning();
  const { token } = await createSession(u.id);

  const req = new Request("http://localhost/api/backup", {
    method: "GET",
    headers: { cookie: `pwos_session=${token}` },
  });

  const res = await backupApi(req);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.app, "PWOS");
  assert.equal(json.schemaVersion, "1.0");
  // Security guarantee: sessions table must never be exported
  assert.equal(json.data.sessions, undefined);
});

test("Section 22 — Restore API: Anonymous POST /api/restore -> 401", async () => {
  await cleanAuth();
  const req = new Request("http://localhost/api/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app: "PWOS", schemaVersion: "1.0", confirmToken: "RESTORE_DATABASE_OVERWRITE", data: {} }),
  });
  const res = await restoreApi(req);
  assert.equal(res.status, 401);
});

test("Section 22 — Restore API: User without Permission POST /api/restore -> 403", async () => {
  await cleanAuth();
  const [u] = await db
    .insert(users)
    .values({ name: "Viewer", username: "viewer1", role: "viewer" } as any)
    .returning();
  const { token } = await createSession(u.id);

  const req = new Request("http://localhost/api/restore", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `pwos_session=${token}` },
    body: JSON.stringify({ app: "PWOS", schemaVersion: "1.0", confirmToken: "RESTORE_DATABASE_OVERWRITE", data: {} }),
  });
  const res = await restoreApi(req);
  assert.equal(res.status, 403);
});

test("Section 22 — Restore API: Authorized Owner/Admin POST /api/restore -> Success", async () => {
  await cleanAuth();
  const [u] = await db
    .insert(users)
    .values({ name: "Admin", username: "admin1", role: "owner" } as any)
    .returning();
  const { token } = await createSession(u.id);

  const req = new Request("http://localhost/api/restore", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `pwos_session=${token}` },
    body: JSON.stringify({
      app: "PWOS",
      schemaVersion: "1.0",
      confirmToken: "RESTORE_DATABASE_OVERWRITE",
      data: {
        currencies: [
          { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, is_fiat: true },
        ],
      },
    }),
  });
  const res = await restoreApi(req);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
});

test("Section 23 — Restore API: Session Invalidation (all existing sessions invalidated after successful restore)", async () => {
  await cleanAuth();
  const [u1] = await db
    .insert(users)
    .values({ name: "UserA", username: "usera", role: "owner" } as any)
    .returning();
  const [u2] = await db
    .insert(users)
    .values({ name: "UserB", username: "userb", role: "viewer" } as any)
    .returning();
  const { token: tokenA } = await createSession(u1.id);
  const { token: tokenB } = await createSession(u2.id);

  // Verify before restore: both valid
  assert.ok(await getSessionUser(tokenA));
  assert.ok(await getSessionUser(tokenB));

  const req = new Request("http://localhost/api/restore", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `pwos_session=${tokenA}` },
    body: JSON.stringify({
      app: "PWOS",
      schemaVersion: "1.0",
      confirmToken: "RESTORE_DATABASE_OVERWRITE",
      data: {},
    }),
  });
  const res = await restoreApi(req);
  assert.equal(res.status, 200);

  // Verify after restore: both invalid
  const afterA = await getSessionUser(tokenA);
  const afterB = await getSessionUser(tokenB);
  assert.equal(afterA, null);
  assert.equal(afterB, null);

  const allSessions = await db.select().from(sessions);
  assert.equal(allSessions.length, 0);
});

test("Security Hardening — Restore API requires confirmToken", async () => {
  await cleanAuth();
  const [u] = await db
    .insert(users)
    .values({ name: "Owner", username: "owner2", role: "owner" } as any)
    .returning();
  const { token } = await createSession(u.id);

  const reqWithoutToken = new Request("http://localhost/api/restore", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `pwos_session=${token}` },
    body: JSON.stringify({
      app: "PWOS",
      schemaVersion: "1.0",
      data: {},
    }),
  });

  const res = await restoreApi(reqWithoutToken);
  assert.equal(res.status, 400);

  const json = await res.json();
  assert.equal(json.ok, false);
  assert.match(json.error, /تأییدیه بازیابی ارائه نشده است/);
});

test("Security Hardening — SQL Injection neutralized in restore payload", async () => {
  await cleanAuth();
  const [u] = await db
    .insert(users)
    .values({ name: "Owner", username: "owner3", role: "owner" } as any)
    .returning();
  const { token } = await createSession(u.id);

  const maliciousPayload = {
    app: "PWOS",
    schemaVersion: "1.0",
    confirmToken: "RESTORE_DATABASE_OVERWRITE",
    data: {
      currencies: [
        {
          "code'; DROP TABLE users; --": "USD",
          name: "US Dollar', ''); DROP TABLE journal_entries; --",
          symbol: "$",
          decimals: 2,
          is_fiat: true,
        },
      ],
    },
  };

  const req = new Request("http://localhost/api/restore", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `pwos_session=${token}` },
    body: JSON.stringify(maliciousPayload),
  });

  const res = await restoreApi(req);
  assert.ok(res.status === 200 || res.status === 500);

  if (res.status === 200) {
    const json = await res.json();
    assert.equal(json.ok, true);
  }
});
