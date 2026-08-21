import "dotenv/config";
import { isMemoryUrl } from "@/db/config";

/**
 * Phase 4 — Legacy Debt/Installment Toman migration runner (opt-in, explicit).
 *
 *   npx tsx src/scripts/migrate-debt-toman.ts
 *
 * SAFETY GATES (all required):
 *   1. PWOS_ALLOW_DEBT_TOMAN_MIGRATION=true — otherwise the script refuses to
 *      run (it must never run automatically as part of a deploy).
 *   2. A real PostgreSQL DATABASE_URL (never the embedded memory:// database).
 *   3. Classification runs FIRST and prints the full blocker report.
 *   4. Backfill is a SEPARATE explicit opt-in: PWOS_ALLOW_DEBT_TOMAN_BACKFILL=true.
 *      Without it the script only classifies and reports (read-only).
 *
 * The migration NEVER guesses: only deterministically reconstructable rows are
 * backfilled; blockers are reported and left untouched. It never rewrites
 * journal entries, postings, lots, or FX snapshots, and never drops legacy
 * USD fields.
 */
async function main() {
  if (process.env.PWOS_ALLOW_DEBT_TOMAN_MIGRATION !== "true") {
    console.error(
      "Refusing to run: the debt/installment Toman migration requires the explicit opt-in flag " +
        "PWOS_ALLOW_DEBT_TOMAN_MIGRATION=true. It must never run automatically as part of a deploy.",
    );
    process.exit(1);
  }
  if (isMemoryUrl(process.env.DATABASE_URL)) {
    console.error("Refusing to run: the migration needs a real PostgreSQL DATABASE_URL.");
    process.exit(1);
  }

  const [{ db }, { classifyLegacyDebtTomanMigration, backfillDeterministicDebtToman, verifyDebtTomanMigration }] =
    await Promise.all([
      import("@/db"),
      import("@/db/migrate-debt-toman"),
    ]);

  // 1. READ-ONLY classification — always first.
  const classification = await classifyLegacyDebtTomanMigration(db);
  console.log("=== DEBT/INSTALLMENT TOMAN MIGRATION — CLASSIFICATION (read-only) ===");
  console.log(`debts: total=${classification.debts.total} legacy=${classification.debts.legacyCandidates} ` +
    `reconstructable=${classification.debts.reconstructable} blocked=${classification.debts.blocked} ` +
    `(planningOnly=${classification.debts.planningOnly}, ledgerBacked=${classification.debts.ledgerBacked}, ` +
    `ambiguous=${classification.debts.ambiguous}, invalid=${classification.debts.invalid}, missing=${classification.debts.missingEvidence})`);
  console.log(`installments: total=${classification.installments.total} legacy=${classification.installments.legacyCandidates} ` +
    `reconstructable=${classification.installments.reconstructable} blocked=${classification.installments.blocked} ` +
    `(paid=${classification.installments.paid} paidReconstructable=${classification.installments.paidReconstructable} ` +
    `paidBlocked=${classification.installments.paidBlocked}, pending=${classification.installments.pending} ` +
    `pendingBlocked=${classification.installments.pendingBlocked})`);

  console.log(`\n=== MIGRATION BLOCKERS (${classification.blockers.length}) ===`);
  for (const b of classification.blockers) {
    console.log(
      `[${b.kind}] id=${b.id} userId=${b.userId ?? "<null>"} legacy=${b.legacyAmount} ` +
        `category=${b.category} reason="${b.reason}" evidence="${b.evidence}" missing="${b.missingEvidence}"`,
    );
  }

  // 2. Backfill — separate explicit opt-in.
  if (process.env.PWOS_ALLOW_DEBT_TOMAN_BACKFILL !== "true") {
    console.log("\nBackfill NOT requested (set PWOS_ALLOW_DEBT_TOMAN_BACKFILL=true to apply deterministic rows).");
    process.exit(0);
  }

  console.log("\n=== BACKFILL (deterministic rows only) ===");
  const { batches, total } = await backfillDeterministicDebtToman({ batchSize: 500, client: db });
  for (const [idx, b] of batches.entries()) {
    console.log(
      `batch ${idx + 1}: debtsScanned=${b.debtsScanned} debtsMigrated=${b.debtsMigrated} ` +
        `installmentsScanned=${b.installmentsScanned} installmentsMigrated=${b.installmentsMigrated}`,
    );
  }
  console.log(
    `TOTAL: debtsMigrated=${total.debtsMigrated} installmentsMigrated=${total.installmentsMigrated}`,
  );

  // 3. Verification.
  const verification = await verifyDebtTomanMigration(db);
  console.log("\n=== VERIFICATION ===");
  console.log(JSON.stringify(verification, null, 2));

  // 4. Post-backfill classification (blockers that remain are reported, never resolved here).
  const after = await classifyLegacyDebtTomanMigration(db);
  console.log(`\nRemaining blockers after backfill: ${after.blockers.length}`);
  console.log(
    `Remaining NULL principal_toman: ${after.debts.legacyCandidates}, ` +
      `remaining NULL amount_toman: ${after.installments.legacyCandidates}`,
  );

  process.exit(verification.ok ? 0 : 2);
}

main().catch((err) => {
  console.error("Debt/installment Toman migration failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
