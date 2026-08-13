import "dotenv/config";
import { isMemoryUrl } from "@/db/config";

/**
 * One-time LEGACY single-tenant → multi-tenant data migration (opt-in).
 *
 *   PWOS_ALLOW_LEGACY_CLAIM=true npm run db:legacy-claim
 *
 * This is deliberately separate from schema migrations and is never run by the
 * application runtime or by any deploy step. It assigns rows that still have
 * `user_id = NULL` to the single legacy "owner" user, and only when the
 * operator explicitly opts in via PWOS_ALLOW_LEGACY_CLAIM.
 *
 * - One-time: the underlying function is idempotent (rows already owned are
 *   never touched; with zero unowned rows it is a no-op).
 * - Opt-in: it refuses to run unless PWOS_ALLOW_LEGACY_CLAIM=true is set.
 * - After it succeeds, the flag must be removed so a later deploy cannot
 *   re-run it by accident.
 * - It never rewrites journal entries, postings, lots or cost basis — it only
 *   fills in the owning user on rows that had none.
 */
async function main() {
  // Guards run before the database module is imported so refusal is clean and
  // never touches the database.
  if (process.env.PWOS_ALLOW_LEGACY_CLAIM !== "true") {
    console.error(
      "Refusing to run: the legacy claim migration requires the explicit opt-in flag " +
        "PWOS_ALLOW_LEGACY_CLAIM=true. It must never run automatically as part of a deploy.",
    );
    process.exit(1);
  }
  if (isMemoryUrl(process.env.DATABASE_URL)) {
    console.error("Refusing to run: the legacy claim migration needs a real PostgreSQL DATABASE_URL.");
    process.exit(1);
  }

  const [{ db }, { migrateLegacyFinancialData }] = await Promise.all([
    import("@/db"),
    import("@/db/migrate-multiuser"),
  ]);
  const result = await migrateLegacyFinancialData(db);
  console.log(
    `Legacy claim migration complete: migrated=${result.migrated}, rowsMigrated=${result.rowsMigrated}, strategy=${result.strategy}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Legacy claim migration failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
