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
import { isProductionRuntime } from "@/db/config";

export async function register() {
  const publicPrefix = ["NEXT", "PUBLIC"].join("_") + "_";
  const forbiddenPublicSecrets = [
    "DATABASE_URL",
    "REDIS_URL",
    "COINGECKO_API_KEY",
    "PWOS_AUTH_TOKEN",
    "FIELD_ENCRYPTION_KEY",
    "TURNSTILE_SECRET_KEY",
    "SUPABASE_SECRET_KEY",
  ].map((name) => publicPrefix + name);
  const exposed = forbiddenPublicSecrets.filter((name) => process.env[name]?.trim());
  if (exposed.length) {
    throw new Error(`Unsafe public environment variables configured: ${exposed.join(", ")}`);
  }
  if (isProductionRuntime(process.env)) {
    for (const required of ["DATABASE_URL", "REDIS_URL", "FIELD_ENCRYPTION_KEY", "SUPABASE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_TURNSTILE_SITE_KEY", "PWOS_BOOTSTRAP_OWNER_EMAIL"]) {
      if (!process.env[required]?.trim()) throw new Error(`Missing required production environment variable: ${required}`);
    }
  }
}
