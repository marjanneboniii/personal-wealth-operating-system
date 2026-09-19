/**
 * SIGN-IN IS ALWAYS REQUIRED once anyone can sign in — including a Google-only
 * install.
 *
 * Pins the audit finding: "auth is enabled" was decided by the presence of a
 * user with a USERNAME. A Google / email sign-up has an email and no username,
 * so an install whose users all came through Google looked like the legacy
 * anonymous single-tenant mode, and a server action called without a session
 * ran with no user at all.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";

mock.module("next/headers", {
  namedExports: {
    // No session cookie: every call below is anonymous.
    cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

let db: any, createSchemaIfNotExists: any, users: any, wallets: any;
let authUsersExistCached: any, invalidateTenantStateCache: any, hasMultipleUsers: any, createWalletAction: any;
const ready = (async () => {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ users, wallets } = await import("../src/db/schema"));
  ({ authUsersExistCached, invalidateTenantStateCache } = await import("../src/lib/tenantState"));
  ({ hasMultipleUsers } = await import("../src/features/ledger/queries"));
  ({ createWalletAction } = await import("../src/app/actions"));
})();

test("a Google-only user (email, no username) turns sign-in on", async () => {
  await ready;
  await createSchemaIfNotExists();
  await db.insert(users).values({ name: "Google user", email: "g@example.com", role: "user" } as any);
  invalidateTenantStateCache();
  assert.equal(await authUsersExistCached(), true);
});

test("an anonymous server action is refused on a Google-only install", async () => {
  invalidateTenantStateCache();
  const before = (await db.select().from(wallets)).length;
  const res = await createWalletAction({ name: "کیف ناشناس", kind: "cash" });
  assert.equal(res.ok, false, "an anonymous caller must not write");
  assert.equal((await db.select().from(wallets)).length, before, "no wallet was created");
});

test("with Supabase configured, sign-in is required and an unresolved identity fails closed", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  try {
    // Even with no user row at all.
    await db.delete(users);
    invalidateTenantStateCache();
    assert.equal(await authUsersExistCached(), true);
    assert.equal(await hasMultipleUsers(), true);
  } finally {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  }
});
