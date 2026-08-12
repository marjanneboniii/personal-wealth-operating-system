/**
 * Server start-up hook.
 *
 * Warms the database schema (and the optional demo seed) before the first
 * request lands. Pages enforce auth BEFORE they call seedIfEmpty(), so on a
 * completely fresh database (e.g. memory:// PGlite) the very first request
 * would otherwise fail closed against missing tables. All statements are
 * idempotent; seeding still respects APP_MODE / ALLOW_DEMO_SEED rules.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { seedIfEmpty } = await import("@/db/seed");
    await seedIfEmpty();
  } catch (err) {
    // The database may be unreachable at boot (serverless cold start with a
    // sleeping DB). Pages retry per request — never crash the server here.
    console.warn(
      "[instrumentation] db warm-up deferred to first request:",
      err instanceof Error ? err.message : err,
    );
  }
}
