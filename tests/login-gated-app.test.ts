/**
 * LOGIN-GATED APP — Global System Directive §0 regression coverage.
 *
 * The product contract pinned here:
 *   1. A signed-out visitor NEVER sees app pages — `/` shows the public
 *      marketing landing and every protected page redirects to /login.
 *      (The old legacy branch — anonymous access while no auth users
 *      existed — is removed.)
 *   2. The app becomes visible only after login/registration, with the
 *      user's own (empty) tenant — never demo/test financial numbers.
 *   3. No demo financial data is ever seeded unless an explicit development
 *      flag (APP_MODE=development / ALLOW_DEMO_SEED=true) is set.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { sql } from "drizzle-orm";

const REDIRECT_MARK = "NEXT_REDIRECT:";

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
  namedExports: { revalidatePath: () => {} },
});
mock.module("next/navigation", {
  namedExports: {
    redirect: (url: string) => {
      throw new Error(`${REDIRECT_MARK}${url}`);
    },
  },
});

let db: any, createSchemaIfNotExists: any, users: any, sessions: any, accounts: any, institutions: any;
let createSession: any;
let ensureAuth: any, requireAuthForApi: any;
let resolveHomeMode: any;
let seedIfEmpty: any;
let completeSetupAction: any, fetchSetupStateAction: any;

async function loadModules() {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ users, sessions, accounts, institutions } = await import("../src/db/schema"));
  ({ createSession } = await import("../src/lib/auth"));
  ({ ensureAuth, requireAuthForApi } = await import("../src/lib/authGuard"));
  ({ resolveHomeMode } = await import("../src/lib/publicEntry"));
  ({ seedIfEmpty } = await import("../src/db/seed"));
  ({ completeSetupAction, fetchSetupStateAction } = await import("../src/app/actions"));
}
const modulesReady = loadModules();

async function clean() {
  await createSchemaIfNotExists();
  await db.delete(accounts);
  await db.delete(institutions);
  await db.delete(sessions);
  await db.delete(users);
}

async function redirectsToLogin(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (e: any) {
    return e?.message === `${REDIRECT_MARK}/login`;
  }
}

test("§0 a signed-out visitor is redirected from every app page — even on a fresh install", async () => {
  await modulesReady;
  await clean();
  cookieJar.value = null;

  // Fresh install, zero users: the old legacy branch allowed anonymous
  // browsing. The login-gated app must redirect instead.
  assert.equal(await redirectsToLogin(() => ensureAuth()), true, "fresh install must redirect to /login");

  // With auth users present: same result.
  await db.insert(users).values({ name: "U", username: "u1", role: "user" });
  assert.equal(await redirectsToLogin(() => ensureAuth()), true, "existing users must redirect to /login");

  // API mirror: anonymous callers are always unauthorized.
  await assert.rejects(() => requireAuthForApi(), /Unauthorized: login required/);

  // Home entry: anonymous → public landing (with or without users).
  assert.equal(await resolveHomeMode(null), "landing");

  // Authenticated session → the app renders and the user object flows through.
  const [alice] = await db
    .insert(users)
    .values({ name: "Alice", username: "alice-gate", role: "user" })
    .returning();
  cookieJar.value = (await createSession(alice.id)).token;
  const u = await ensureAuth();
  assert.equal(u.id, alice.id);
  assert.equal(await resolveHomeMode(u), "app");
  assert.ok(await requireAuthForApi());
  cookieJar.value = null;
});

test("§0 fail-closed: a session that cannot be validated against a broken DB never yields access", async () => {
  await modulesReady;
  await clean();
  const [alice] = await db
    .insert(users)
    .values({ name: "Alice FC", username: "alice-fc", role: "user" })
    .returning();
  cookieJar.value = (await createSession(alice.id)).token;

  // Simulate a total auth-store failure.
  await db.execute(sql`alter table sessions rename to sessions_broken_fc`);
  await db.execute(sql`alter table users rename to users_broken_fc`);
  try {
    await assert.rejects(() => ensureAuth(), /Authentication\/Database error/);
    await assert.rejects(() => requireAuthForApi(), /Authentication\/Database error|Unauthorized/);
  } finally {
    await db.execute(sql`alter table sessions_broken_fc rename to sessions`);
    await db.execute(sql`alter table users_broken_fc rename to users`);
  }
  cookieJar.value = null;
});

test("§0 a legacy unnamed owner no longer keeps an open dashboard — home stays the landing", async () => {
  await modulesReady;
  await clean();
  await db.insert(users).values({ name: "مالک خانواده", role: "owner" }); // pre-auth legacy row
  cookieJar.value = null;
  assert.equal(await resolveHomeMode(null), "landing");
  await assert.rejects(() => requireAuthForApi(), /Unauthorized: login required/);
});

test("§0 no demo/test financial data is seeded without an explicit development flag", async () => {
  await modulesReady;
  await clean();
  // Simulate the default environment: personal mode, no demo override.
  const savedMode = process.env.APP_MODE;
  const savedSeed = process.env.ALLOW_DEMO_SEED;
  delete process.env.APP_MODE;
  delete process.env.ALLOW_DEMO_SEED;
  try {
    await seedIfEmpty();
    const [acc] = await db.select().from(accounts);
    const [inst] = await db.select().from(institutions);
    assert.equal(acc, undefined, "no demo accounts may exist by default");
    assert.equal(inst, undefined, "no demo institutions may exist by default");
  } finally {
    if (savedMode !== undefined) process.env.APP_MODE = savedMode;
    if (savedSeed !== undefined) process.env.ALLOW_DEMO_SEED = savedSeed;
  }
});

test("§0 the setup wizard requires a session — anonymous bootstrap is closed", async () => {
  await modulesReady;
  await clean();
  cookieJar.value = null;

  const fd = new FormData();
  fd.set("userName", "نام");
  fd.set("baseCurrency", "USD");
  fd.set("displayCurrency", "IRT");
  fd.set("dateCalendar", "jalali");
  fd.set("digitStyle", "fa");
  fd.set("bankAccountName", "حساب من");
  fd.set("cashWalletName", "نقد");
  fd.set("bankAssetSymbol", "IRT");
  fd.set("cashAssetSymbol", "IRT");
  fd.set("bankOpeningBalance", "0");
  fd.set("cashOpeningBalance", "0");

  const res = await completeSetupAction(null, fd);
  assert.equal(res.ok, false);
  assert.match(res.message, /وارد شوید/);

  const state: any = await fetchSetupStateAction();
  assert.equal(state.loginRequired, true, "anonymous callers get the login marker, not wizard state");

  // No legacy owner was silently created by the anonymous attempt.
  const rows = await db.select().from(users);
  assert.equal(rows.length, 0);
});
