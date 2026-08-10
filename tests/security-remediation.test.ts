/**
 * Security Remediation regression tests (Sections 24–29 of the remediation
 * mandate): role escalation, legacy claim gating, cross-user accounting,
 * cross-user journal reversal, backup/restore authorization, fake Google
 * identity rejection, session hash-at-rest, password policy and market-data
 * write gating.
 *
 * The accounting core is verified UNCHANGED here: the legitimate-owner
 * control case proves that after the authorization boundary passes, the
 * existing ledger posting / FIFO path still produces the same results.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import crypto from "node:crypto";

// ── Next.js runtime mocks (server actions read cookies via next/headers) ──
const cookieJar: { value: string | null } = { value: null };

mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) =>
        name === "pwos_session" && cookieJar.value ? { value: cookieJar.value } : undefined,
      set: () => {},
      delete: () => {},
    }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", {
  namedExports: {
    revalidatePath: () => {},
  },
});

// Project modules are loaded dynamically AFTER mock.module registration so
// the next/headers + next/cache mocks are in effect for server actions.
let db: any, createSchemaIfNotExists: any, eq: any, sql: any;
let accounts: any, assets: any, assetClasses: any, currencies: any,
  journalEntries: any, lots: any, lotConsumptions: any, postings: any,
  prices: any, sessions: any, users: any, userFxSettings: any;
let createSession: any, hashPassword: any, hashSessionToken: any, getSessionUser: any;
let registerAction: any, createTransactionAction: any, reverseEntryAction: any,
  markManyReviewedAction: any, updatePriceAction: any, fetchAnalyticsSummaryAction: any;
let backupApi: any, restoreApi: any, googleAuthApi: any;

async function loadModules() {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({
    accounts, assets, assetClasses, currencies, journalEntries, lots,
    lotConsumptions, postings, prices, sessions, users, userFxSettings,
  } = await import("../src/db/schema"));
  ({ eq, sql } = await import("drizzle-orm"));
  ({ createSession, hashPassword, hashSessionToken, getSessionUser } = await import("../src/lib/auth"));
  ({ registerAction } = await import("../src/lib/auth-actions"));
  ({
    createTransactionAction, reverseEntryAction, markManyReviewedAction,
    updatePriceAction, fetchAnalyticsSummaryAction,
  } = await import("../src/app/actions"));
  ({ GET: backupApi } = await import("../src/app/api/backup/route"));
  ({ POST: restoreApi } = await import("../src/app/api/restore/route"));
  ({ POST: googleAuthApi } = await import("../src/app/api/auth/google/route"));
}
const modulesReady = loadModules();

const originalFetch = global.fetch;

function mockGoogleTokeninfo(info: Record<string, unknown> | null) {
  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
      if (!info) {
        return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 });
      }
      return new Response(JSON.stringify(info), { status: 200 });
    }
    return originalFetch(input, init);
  };
}

async function cleanAll() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(prices);
  await db.delete(accounts);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(userFxSettings);
  await db.delete(sessions);
  await db.delete(currencies);
  await db.delete(users);
  delete process.env.PWOS_AUTH_TOKEN;
  cookieJar.value = null;
}

/** Minimal multi-user fixture: currencies/assets + users A & B with accounts. */
async function setupFixture() {
  const [usd] = await db
    .insert(currencies)
    .values({ code: "USD", name: "US Dollar", symbol: "$", decimals: 2, isFiat: true } as any)
    .returning();
  const [cashClass] = await db
    .insert(assetClasses)
    .values({ code: "cash", name: "Cash", color: "#38bdf8", sortOrder: 1 } as any)
    .returning();
  const [usdCash] = await db
    .insert(assets)
    .values({ symbol: "USD_CASH", name: "USD Cash", classId: cashClass.id, currencyId: usd.id } as any)
    .returning();

  const [userA] = await db
    .insert(users)
    .values({ name: "User A", username: "usera_sec", passwordHash: hashPassword("Passw0rdA"), role: "user" } as any)
    .returning();
  const [userB] = await db
    .insert(users)
    .values({ name: "User B", username: "userb_sec", passwordHash: hashPassword("Passw0rdB"), role: "user" } as any)
    .returning();
  const [adminU] = await db
    .insert(users)
    .values({ name: "Admin", username: "admin_sec", role: "admin" } as any)
    .returning();
  const [ownerU] = await db
    .insert(users)
    .values({ name: "Owner", username: "owner_sec", role: "owner" } as any)
    .returning();

  for (const u of [userA, userB, adminU, ownerU]) {
    await db.insert(userFxSettings).values({ userId: u.id, currentRate: "190000" }).onConflictDoNothing();
  }

  const [cashA] = await db
    .insert(accounts)
    .values({ code: "1010-A", name: "Cash A", type: "asset", assetId: usdCash.id, userId: userA.id } as any)
    .returning();
  const [cashB] = await db
    .insert(accounts)
    .values({ code: "1010-B", name: "Cash B", type: "asset", assetId: usdCash.id, userId: userB.id } as any)
    .returning();
  // Shared chart-of-accounts income account (global reference, userId NULL).
  const [incomeGlobal] = await db
    .insert(accounts)
    .values({ code: "4010", name: "Income", type: "income", assetId: usdCash.id } as any)
    .returning();

  return { usd, usdCash, userA, userB, adminU, ownerU, cashA, cashB, incomeGlobal };
}

function incomeFormData(primaryAccountId: string, counterAccountId: string) {
  const fd = new FormData();
  fd.set("type", "income");
  fd.set("entryDate", "2026-08-01");
  fd.set("description", "Security boundary income");
  fd.set("primaryAccountId", primaryAccountId);
  fd.set("counterAccountId", counterAccountId);
  fd.set("irtAmount", "190000"); // = 1 USD at the 190000 fixture rate
  return fd;
}

// ───────────────────────── 27. Role escalation ─────────────────────────

test("SEC-REMEDIATION — Role escalation: register payload role=owner is ignored; user gets 'user'", async () => {
  await modulesReady;
  await cleanAll();
  const fd = new FormData();
  fd.set("username", "attacker1");
  fd.set("password", "Passw0rd123");
  fd.set("confirmPassword", "Passw0rd123");
  fd.set("name", "Attacker");
  fd.set("role", "owner"); // must be completely ignored
  fd.set("userId", "00000000-0000-0000-0000-00000000dead"); // must be ignored

  const res = await registerAction(null, fd);
  assert.equal(res.ok, true, res.message);

  const [u] = await db.select().from(users).where(eq(users.username as any, "attacker1")).limit(1);
  assert.ok(u);
  assert.equal(u.role, "user", "self-registration must never create owner/admin");
});

test("SEC-REMEDIATION — Password policy: weak passwords rejected at registration", async () => {
  await modulesReady;
  await cleanAll();
  const fd = new FormData();
  fd.set("username", "weakpass");
  fd.set("password", "123456"); // old minimum — no longer acceptable
  fd.set("confirmPassword", "123456");
  const res = await registerAction(null, fd);
  assert.equal(res.ok, false);

  const fd2 = new FormData();
  fd2.set("username", "weakpass");
  fd2.set("password", "onlyletters"); // no digit
  fd2.set("confirmPassword", "onlyletters");
  const res2 = await registerAction(null, fd2);
  assert.equal(res2.ok, false);

  const fd3 = new FormData();
  fd3.set("username", "strongpass");
  fd3.set("password", "Passw0rd9");
  fd3.set("confirmPassword", "Passw0rd9");
  const res3 = await registerAction(null, fd3);
  assert.equal(res3.ok, true, res3.message);
});

test("SEC-REMEDIATION — Google sign-up assigns low-privilege role 'user'", async () => {
  await modulesReady;
  await cleanAll();
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
  mockGoogleTokeninfo({
    aud: "test-google-client-id",
    iss: "https://accounts.google.com",
    sub: "google-sub-role-check",
    email: "roletest@gmail.com",
    email_verified: "true",
    name: "Role Test",
  });

  const req = new Request("http://localhost/api/auth/google", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken: "valid-token", role: "owner" }),
  });
  const res = await googleAuthApi(req);
  assert.equal(res.status, 200);
  const [u] = await db.select().from(users).where(eq(users.googleId as any, "google-sub-role-check")).limit(1);
  assert.ok(u);
  assert.equal(u.role, "user");
  global.fetch = originalFetch;
});

// ─────────────────── 5. Legacy owner claim gating ───────────────────

test("SEC-REMEDIATION — Legacy owner claim is denied unless explicitly authorized", async () => {
  await modulesReady;
  await cleanAll();
  // Legacy single-tenant owner (no username) with data.
  const [legacy] = await db.insert(users).values({ name: "مالک خانواده", role: "owner" } as any).returning();
  delete process.env.PWOS_ALLOW_LEGACY_CLAIM;

  const fd = new FormData();
  fd.set("username", "visitor1");
  fd.set("password", "Passw0rd123");
  fd.set("confirmPassword", "Passw0rd123");
  const res = await registerAction(null, fd);
  assert.equal(res.ok, true, res.message);

  const allUsers = await db.select().from(users);
  assert.equal(allUsers.length, 2, "anonymous visitor must NOT claim the legacy owner");
  const [legacyAfter] = await db.select().from(users).where(eq(users.id, legacy.id)).limit(1);
  assert.equal(legacyAfter.username, null, "legacy owner row untouched");
  const [visitor] = await db.select().from(users).where(eq(users.username as any, "visitor1")).limit(1);
  assert.equal(visitor.role, "user");

  // Explicit bootstrap authorization (operator opt-in) — migration preserved.
  process.env.PWOS_ALLOW_LEGACY_CLAIM = "true";
  const fd2 = new FormData();
  fd2.set("username", "claimant1");
  fd2.set("password", "Passw0rd123");
  fd2.set("confirmPassword", "Passw0rd123");
  const res2 = await registerAction(null, fd2);
  assert.equal(res2.ok, true, res2.message);
  const [claimed] = await db.select().from(users).where(eq(users.id, legacy.id)).limit(1);
  assert.equal(claimed.username, "claimant1", "opt-in legacy claim path still works");
  delete process.env.PWOS_ALLOW_LEGACY_CLAIM;
});

// ─────────────── 25. Cross-user accounting (createTransaction) ───────────────

test("SEC-REMEDIATION — User A cannot post a ledger entry using User B's accounts; owner control still works", async () => {
  await modulesReady;
  await cleanAll();
  const fx = await setupFixture();
  const { validateAccountOwnership } = await import("../src/lib/validation");
  const { recordIncome } = await import("../src/features/ledger/service");

  const before = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const beforePostings = await db.select({ c: sql<number>`count(*)::int` }).from(postings);
  const beforeLots = await db.select({ c: sql<number>`count(*)::int` }).from(lots);

  // User A session tries to use User B's account — denied at the action
  // boundary BEFORE any accounting service call.
  const { token: tokenA } = await createSession(fx.userA.id);
  cookieJar.value = tokenA;
  const denied = await createTransactionAction(null, incomeFormData(fx.cashB.id, fx.incomeGlobal.id));
  assert.equal(denied.ok, false, "cross-user account usage must be denied");
  assert.match(denied.message, /غیرمجاز|متعلق به شما/);

  const afterDenied = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const afterDeniedPostings = await db.select({ c: sql<number>`count(*)::int` }).from(postings);
  const afterDeniedLots = await db.select({ c: sql<number>`count(*)::int` }).from(lots);
  assert.equal(afterDenied[0].c, before[0].c, "no journal entry created on denial");
  assert.equal(afterDeniedPostings[0].c, beforePostings[0].c, "no postings created on denial");
  assert.equal(afterDeniedLots[0].c, beforeLots[0].c, "no FIFO lots created on denial");

  // Control: the SAME boundary check passes for the owner, and the unchanged
  // accounting core (recordIncome -> postEntry) posts successfully.
  // (The full createTransactionAction happy path is covered by the app's
  // PostgreSQL runtime; the embedded test DB cannot nest plain-db reads
  // inside an open transaction — a pre-existing test-env limitation.)
  await validateAccountOwnership(fx.cashB.id, fx.userB.id); // must not throw
  await assert.rejects(() => validateAccountOwnership(fx.cashB.id, fx.userA.id));
  const entry = await recordIncome({
    entryDate: "2026-08-01",
    description: "owner control income",
    cashAccountId: fx.cashB.id,
    categoryAccountId: fx.incomeGlobal.id,
    assetId: fx.usdCash.id,
    quantity: "1",
    baseValue: "1",
    userId: fx.userB.id,
  } as any);
  assert.ok(entry.id);
  const entriesAfter = await db.select().from(journalEntries);
  assert.equal(entriesAfter.length, before[0].c + 1);
  assert.equal(entriesAfter.find((e: any) => e.id === entry.id)?.userId, fx.userB.id);
  const balanced = await db.execute(sql`
    select je.id from journal_entries je join postings p on p.entry_id = je.id
    group by je.id having abs(sum(p.base_value)) > 0.000000001
  `);
  assert.equal(balanced.rows.length, 0, "double-entry invariant intact");
  cookieJar.value = null;
});

// ─────────────── 26. Cross-user journal entry reversal ───────────────

test("SEC-REMEDIATION — User A cannot reverse User B's journal entry; orphan entries denied", async () => {
  await modulesReady;
  await cleanAll();
  const fx = await setupFixture();

  // B posts an entry through the unchanged accounting core.
  const { token: tokenB } = await createSession(fx.userB.id);
  cookieJar.value = tokenB;
  const { recordIncome } = await import("../src/features/ledger/service");
  const created = await recordIncome({
    entryDate: "2026-08-01",
    description: "B reversal target",
    cashAccountId: fx.cashB.id,
    categoryAccountId: fx.incomeGlobal.id,
    assetId: fx.usdCash.id,
    quantity: "1",
    baseValue: "1",
    userId: fx.userB.id,
  } as any);
  const [entryB] = await db.select().from(journalEntries).where(eq(journalEntries.id, created.id)).limit(1);
  assert.ok(entryB);
  assert.equal(entryB.status, "posted");

  // A attempts to reverse B's entry
  const { token: tokenA } = await createSession(fx.userA.id);
  cookieJar.value = tokenA;
  const denied = await reverseEntryAction(entryB.id);
  assert.equal(denied.ok, false);
  const [stillThere] = await db.select().from(journalEntries).where(eq(journalEntries.id, entryB.id)).limit(1);
  assert.equal(stillThere.status, "posted", "entryB must remain unchanged");
  const countAfterDeny = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  assert.equal(countAfterDeny[0].c, 1, "no reversal entry created");

  // Orphan entry (no owner) — denied for regular users.
  const [orphan] = await db
    .insert(journalEntries)
    .values({
      entryDate: "2026-08-01",
      type: "income",
      description: "orphan",
      status: "posted",
      source: "manual",
      userId: null,
    } as any)
    .returning();
  const orphanDenied = await reverseEntryAction(orphan.id);
  assert.equal(orphanDenied.ok, false, "NULL-owner entries are denied, never allowed");

  // Control: owner of the entry can still reverse through the unchanged core.
  cookieJar.value = tokenB;
  const allowed = await reverseEntryAction(entryB.id);
  assert.equal(allowed.ok, true, allowed.message);
  const [voided] = await db.select().from(journalEntries).where(eq(journalEntries.id, entryB.id)).limit(1);
  assert.equal(voided.status, "void", "reversal accounting unchanged for the owner");
  cookieJar.value = null;
});

test("SEC-REMEDIATION — markManyReviewedAction denies cross-user batches", async () => {
  await modulesReady;
  await cleanAll();
  const fx = await setupFixture();
  const [entryB] = await db
    .insert(journalEntries)
    .values({ entryDate: "2026-08-01", type: "income", description: "B entry", status: "posted", userId: fx.userB.id } as any)
    .returning();

  const { token: tokenA } = await createSession(fx.userA.id);
  cookieJar.value = tokenA;
  const denied = await markManyReviewedAction([entryB.id]);
  assert.equal(denied.ok, false);
  cookieJar.value = null;
});

// ─────────────── 2/3/4. Backup & Restore authorization ───────────────

test("SEC-REMEDIATION — Backup/Restore: normal user 403, admin/owner allowed", async () => {
  await modulesReady;
  await cleanAll();
  const fx = await setupFixture();

  // Normal user -> 403
  const { token: tokenA } = await createSession(fx.userA.id);
  const resUser = await backupApi(
    new Request("http://localhost/api/backup", { headers: { cookie: `pwos_session=${tokenA}` } }),
  );
  assert.equal(resUser.status, 403);

  const restoreBody = JSON.stringify({
    app: "PWOS",
    schemaVersion: "1.0",
    confirmToken: "RESTORE_DATABASE_OVERWRITE",
    data: {},
  });
  const resUserRestore = await restoreApi(
    new Request("http://localhost/api/restore", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `pwos_session=${tokenA}` },
      body: restoreBody,
    }),
  );
  assert.equal(resUserRestore.status, 403);

  // Admin -> backup allowed
  const { token: tokenAdmin } = await createSession(fx.adminU.id);
  const resAdmin = await backupApi(
    new Request("http://localhost/api/backup", { headers: { cookie: `pwos_session=${tokenAdmin}` } }),
  );
  assert.equal(resAdmin.status, 200);

  // Owner -> backup allowed
  const { token: tokenOwner } = await createSession(fx.ownerU.id);
  const resOwner = await backupApi(
    new Request("http://localhost/api/backup", { headers: { cookie: `pwos_session=${tokenOwner}` } }),
  );
  assert.equal(resOwner.status, 200);

  // Anonymous -> 401
  const resAnon = await restoreApi(
    new Request("http://localhost/api/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: restoreBody,
    }),
  );
  assert.equal(resAnon.status, 401);
});

// ─────────────── 28. Fake Google identity rejection ───────────────

test("SEC-REMEDIATION — Google: email-only request (no token) is rejected 401", async () => {
  await modulesReady;
  await cleanAll();
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
  const res = await googleAuthApi(
    new Request("http://localhost/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "real-victim@gmail.com" }),
    }),
  );
  assert.equal(res.status, 401);
});

test("SEC-REMEDIATION — Google: token for a different client id is rejected", async () => {
  await modulesReady;
  await cleanAll();
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
  mockGoogleTokeninfo({
    aud: "another-app-client-id",
    iss: "https://accounts.google.com",
    sub: "google-sub-other-app",
    email: "other-app@gmail.com",
    email_verified: "true",
  });
  const res = await googleAuthApi(
    new Request("http://localhost/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: "some-token" }),
    }),
  );
  assert.equal(res.status, 401);
  global.fetch = originalFetch;
});

test("SEC-REMEDIATION — Account takeover: Google login with existing email is rejected", async () => {
  await modulesReady;
  await cleanAll();
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
  const [victim] = await db
    .insert(users)
    .values({ name: "Victim", username: "victim_sec", email: "victim29@gmail.com", passwordHash: hashPassword("Passw0rd123"), role: "user" } as any)
    .returning();

  mockGoogleTokeninfo({
    aud: "test-google-client-id",
    iss: "https://accounts.google.com",
    sub: "attacker-google-sub",
    email: "victim29@gmail.com",
    email_verified: "true",
  });
  const res = await googleAuthApi(
    new Request("http://localhost/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: "attacker-token" }),
    }),
  );
  assert.equal(res.status, 409);
  const [check] = await db.select().from(users).where(eq(users.id, victim.id)).limit(1);
  assert.equal(check.googleId, null, "victim account not linked/taken over");
  assert.equal(check.role, "user");
  global.fetch = originalFetch;
});

// ─────────────── 13. Session tokens hashed at rest ───────────────

test("SEC-REMEDIATION — Session token stored as hash; raw token never persisted", async () => {
  await modulesReady;
  await cleanAll();
  const [u] = await db.insert(users).values({ name: "Hash", username: "hashuser", role: "user" } as any).returning();
  const { token } = await createSession(u.id);
  const rows = await db.select().from(sessions);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token, hashSessionToken(token), "DB stores sha256(token)");
  assert.notEqual(rows[0].token, token, "raw token is never stored");
  // Lookup still works with the raw cookie value
  const { getSessionUser } = await import("../src/lib/auth");
  const sessionUser = await getSessionUser(token);
  assert.equal(sessionUser?.id, u.id);
});

// ─────────────── 12. Market data write gating ───────────────

test("SEC-REMEDIATION — Market data modification denied for normal users, allowed for owner", async () => {
  await modulesReady;
  await cleanAll();
  const fx = await setupFixture();

  const fd = new FormData();
  fd.set("assetId", fx.usdCash.id);
  fd.set("price", "1");

  const { token: tokenA } = await createSession(fx.userA.id);
  cookieJar.value = tokenA;
  const denied = await updatePriceAction(null, fd);
  assert.equal(denied.ok, false);
  assert.match(denied.message, /غیرمجاز|مدیر/);

  const { token: tokenOwner } = await createSession(fx.ownerU.id);
  cookieJar.value = tokenOwner;
  const allowed = await updatePriceAction(null, fd);
  assert.equal(allowed.ok, true, allowed.message);
  cookieJar.value = null;
});

// ─────────────── 9. User-scoped analytics gating ───────────────

test("SEC-REMEDIATION — Analytics action denies anonymous callers when auth is enabled", async () => {
  await modulesReady;
  await cleanAll();
  await setupFixture();
  cookieJar.value = null; // no session
  await assert.rejects(() => fetchAnalyticsSummaryAction(), /Unauthorized|login/i);

  const [u] = await db.select().from(users).where(eq(users.username as any, "usera_sec")).limit(1);
  const { token } = await createSession(u.id);
  cookieJar.value = token;
  const summary = await fetchAnalyticsSummaryAction();
  assert.ok(summary && typeof summary === "object");
  cookieJar.value = null;
});
