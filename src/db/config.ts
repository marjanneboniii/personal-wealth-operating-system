/**
 * Database configuration helpers — pure and side-effect free.
 *
 * Kept separate from `src/db/index.ts` (which actually connects) so that the
 * production-environment rules below can be unit-tested without opening a
 * database connection and without importing driver code.
 */

export interface RuntimeEnvironment {
  NODE_ENV?: string;
  NEXT_PHASE?: string;
  DATABASE_URL?: string;
  DATABASE_POOL_MAX?: string;
}

/* ------------------------------------------------------------------ *
 * Connection-pool sizing
 *
 * The pool `max` is read from `DATABASE_POOL_MAX` so operators can size a
 * single instance (or a serverless runtime) without a code change. The
 * default is environment-aware and deliberately conservative:
 *
 *   - production  → 10 (one app instance may serve hundreds of concurrent
 *                    requests; PgBouncer/Neon pooled endpoints still cap the
 *                    real backend connections, so a handful per instance is
 *                    plenty — more than ~10 per instance rarely helps and
 *                    can exhaust the database when many instances run);
 *   - development → 5  (previous hard-coded value).
 *
 * The value is clamped to [1, 50]: 0/negative/NaN/unparseable values fall
 * back to the environment default and absurd values are capped so a typo
 * cannot open hundreds of connections against the database.
 * ------------------------------------------------------------------ */

export const DEFAULT_DATABASE_POOL_MAX = 5;
export const PRODUCTION_DATABASE_POOL_MAX = 10;
export const MAX_DATABASE_POOL_MAX = 50;
export const MIN_DATABASE_POOL_MAX = 1;

/** Default pool size for the active runtime environment. */
export function defaultPoolMax(env: RuntimeEnvironment): number {
  return isProductionRuntime(env) ? PRODUCTION_DATABASE_POOL_MAX : DEFAULT_DATABASE_POOL_MAX;
}

/** Parse + clamp `DATABASE_POOL_MAX`. Invalid input falls back to the default. */
export function resolvePoolMax(env: RuntimeEnvironment): number {
  const raw = env.DATABASE_POOL_MAX?.trim();
  const fallback = defaultPoolMax(env);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < MIN_DATABASE_POOL_MAX) return fallback;
  return Math.min(Math.floor(parsed), MAX_DATABASE_POOL_MAX);
}

/**
 * `memory://` — or a missing DATABASE_URL, which defaults to it — selects the
 * embedded PGlite database. That is for local development and tests only.
 */
export function isMemoryUrl(url: string | undefined): boolean {
  return !url || url.startsWith("memory://");
}

/** True only while `next build` is running (as opposed to `next start`). */
export function isBuildPhase(phase: string | undefined): boolean {
  return phase === "phase-production-build";
}

/**
 * True when the code is executing as the production server. `next build` also
 * sets NODE_ENV=production but must not be treated as the running server: the
 * database connection is never opened during a build (all routes are dynamic).
 */
export function isProductionRuntime(env: RuntimeEnvironment): boolean {
  return env.NODE_ENV === "production" && !isBuildPhase(env.NEXT_PHASE);
}

/**
 * Fail-closed production guard.
 *
 * Pointing the production runtime at the embedded `memory://` database (or
 * leaving DATABASE_URL unset, which defaults to it) is a configuration error.
 * Throws a generic message — the connection string is never included.
 */
export function assertProductionDatabaseConfig(env: RuntimeEnvironment = process.env): void {
  if (isProductionRuntime(env) && isMemoryUrl(env.DATABASE_URL)) {
    throw new Error(
      "PWOS production configuration error: DATABASE_URL must be a real PostgreSQL connection string. " +
        "The embedded memory:// database is only allowed for local development and tests.",
    );
  }
}
