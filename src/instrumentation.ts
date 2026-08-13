/**
 * Server start-up hook.
 *
 * Deliberately does NOT touch the database:
 *  - The schema is applied explicitly by `npm run db:migrate` (see `drizzle/`).
 *  - Demo data is seeded only by the development page bootstrap
 *    (`seedIfEmpty`), which is hard-disabled in production.
 *
 * Running DDL or seeding here would couple the application runtime to
 * migration/seed work — exactly what must be avoided on a serverless
 * production runtime (no request may trigger schema initialization).
 */
export async function register() {
  // Intentionally empty — production runtime must not perform migrations or seeding.
}
