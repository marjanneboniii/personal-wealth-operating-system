async function main() {
  // Demo data must never be loaded into a production database by accident.
  // An explicit, deliberate production seed still requires the operator to set
  // ALLOW_DEMO_SEED=true for this single invocation. The guard runs BEFORE the
  // database module is imported, so a misconfigured production run refuses
  // cleanly instead of touching the database.
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    console.error(
      "Refusing to seed: demo data is blocked in production. " +
        "To load demo data into a production database deliberately, re-run with ALLOW_DEMO_SEED=true.",
    );
    process.exit(1);
  }

  console.log("Running manual demo database seed...");
  const { ensureSchema, runSeed } = await import("@/db/seed");
  // Bootstraps the embedded memory:// schema for local development. For a real
  // PostgreSQL database this is a no-op — the schema must already be applied
  // with `npm run db:migrate` (runSeed will fail with a clear "relation does
  // not exist" error if that step was skipped).
  await ensureSchema();
  await runSeed();
  console.log("Seed completed successfully.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
