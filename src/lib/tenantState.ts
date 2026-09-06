import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Tenant/user-presence state cache.
 *
 * A handful of hot read paths (ledger queries, analytics, planning, server
 * actions) answer a "how many users / is auth enabled" question on almost
 * every request. Each of those calls used to run its own
 * `SELECT ... FROM users LIMIT 2` / `... WHERE username IS NOT NULL LIMIT 1`
 * against the database, which multiplied into a database spam as the request
 * fan-out grew (each page render fans out to many read services).
 *
 * This module memoises that probe in-process with a short TTL (60 s) and an
 * in-flight dedupe, so the whole instance asks the database at most once per
 * window instead of once per request. It is a pure *gate* helper:
 *
 *  - It never feeds ledger math. The double-entry balances / FIFO / net-worth
 *    computations are always derived from the ledger rows returned by the
 *    queries — this cache only decides between "resolve a tenant / deny"
 *    and "legacy global view".
 *  - FAIL-CLOSED on errors: database failures are propagated to the caller,
 *    and every caller maps a failure to DENY. Errors are never cached, so a
 *    recovering database is re-probed on the next call.
 *
 * Correctness across user-table mutations is preserved by explicit
 * invalidation: every code path that inserts/updates/deletes user rows calls
 * `invalidateTenantStateCache()` right after its write (registration, Google
 * OAuth provisioning, setup bootstrap, seeding, restore). Until the next
 * probe the cache may therefore never be stale in the dangerous direction
 * (e.g. still reporting "single user" right after a second user registered).
 */

const USER_PRESENCE_TTL_MS = 60_000;

export type TenantState = {
  /** Number of user rows, capped at 2 (0 | 1 | 2). */
  userCount: 0 | 1 | 2;
  /** Id of the user row when exactly one exists (legacy claim helper). */
  singleUserId: string | null;
  /** True when at least one user has a non-null username (auth enabled). */
  authUsersExist: boolean;
  expiresAt: number;
};

let cachedState: TenantState | null = null;
let inflightState: Promise<TenantState> | null = null;

/** Drop the cached probe. Call after any insert/update/delete on `users`. */
export function invalidateTenantStateCache(): void {
  cachedState = null;
}

/**
 * Verifies a cached multi-tenant claim against the database. Concurrent
 * verifiers share one probe.
 */
let inflightVerify: Promise<boolean> | null = null;

async function verifyMultiTenantLive(): Promise<boolean> {
  if (inflightVerify) return inflightVerify;
  inflightVerify = (async () => {
    const fresh = await loadTenantState();
    cachedState = fresh;
    return fresh.userCount > 1;
  })().finally(() => {
    inflightVerify = null;
  });
  return inflightVerify;
}

async function loadTenantState(): Promise<TenantState> {
  const res = await db.execute(sql`select id from users limit 2`);
  const rows = res.rows as Array<{ id?: string }>;
  const count = Math.min(rows.length, 2) as 0 | 1 | 2;
  const singleUserId = count === 1 ? (rows[0]?.id ?? null) : null;

  const authRes = await db.execute(sql`select id from users where username is not null limit 1`);
  const authUsersExist = authRes.rows.length > 0;

  return {
    userCount: count,
    singleUserId,
    authUsersExist,
    expiresAt: Date.now() + USER_PRESENCE_TTL_MS,
  };
}

/**
 * Reads the cached tenant state, probing the database at most once per 60 s
 * window (per process). Concurrent first callers share a single probe.
 * Database errors propagate to the caller — callers MUST map them to DENY.
 */
export async function readTenantState(): Promise<TenantState> {
  const now = Date.now();
  if (cachedState && cachedState.expiresAt > now) return cachedState;

  if (!inflightState) {
    inflightState = loadTenantState()
      .then((state) => {
        cachedState = state;
        return state;
      })
      .finally(() => {
        inflightState = null;
      });
  }
  return inflightState;
}

/**
 * "Database holds more than one identity" gate. Throws on DB errors.
 *
 * Asymmetric caching on purpose — the cache may ALLOW (legacy global view)
 * but must never be the reason a request is DENIED:
 *
 *  - A cached "single-user / no users" answer is trusted for the 60 s TTL.
 *    It only ever grants the legacy global view, and every real user-table
 *    writer (registration, OAuth, setup, seed, restore) invalidates the cache
 *    immediately, so the single→multi transition can never widen the window.
 *  - A cached "multi-tenant" answer is re-verified against the database
 *    before it is used to deny an unresolved request. Denials are fail-closed
 *    and therefore never served from a possibly-stale snapshot (e.g. after an
 *    operator/test removes users directly).
 */
export async function isMultiTenantCached(): Promise<boolean> {
  const state = await readTenantState();
  if (state.userCount <= 1) return false;
  return verifyMultiTenantLive();
}

/** Cached "at least one username-bearing user exists (auth is on)". Throws on DB errors. */
export async function authUsersExistCached(): Promise<boolean> {
  const state = await readTenantState();
  return state.authUsersExist;
}

/** Test/ops helper: returns true when a fresh probe is currently cached. */
export function isTenantStateCached(): boolean {
  return cachedState !== null;
}
