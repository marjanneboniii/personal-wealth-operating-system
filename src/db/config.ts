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
