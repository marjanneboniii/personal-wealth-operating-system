import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Health probe — verifies database connectivity only.
 *
 * The database handle is imported lazily so a broken production configuration
 * (e.g. production pointed at `memory://`) surfaces here as `{ ok: false }`
 * with HTTP 500 rather than an unhandled module-load failure.
 *
 * The response never includes the connection string, hostname, username, SQL
 * errors, stack traces or internal paths.
 */
export async function GET() {
  try {
    const { db } = await import("@/db");
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
