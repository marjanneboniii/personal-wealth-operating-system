/**
 * Phase 4 — Legacy Debt / Installment Toman migration (DATA backfill).
 *
 * RULES (hard invariants — never violated):
 *  - NEVER GUESS financial data. A Toman amount is only written when an
 *    authoritative historical source proves the exact contractual Toman.
 *  - Read-only classification ALWAYS precedes any backfill.
 *  - Backfill is idempotent (only fills rows where the target column is NULL;
 *    never overwrites an existing value) and batched (cursor + LIMIT, no giant
 *    transaction, no long table locks).
 *  - Tenant isolation: a debt belonging to User A must NEVER be reconstructed
 *    from User B's ledger entry, account, snapshot, or FX. Every join is
 *    user-matched (`IS NOT DISTINCT FROM` so NULL==NULL legacy rows match).
 *  - Immutability: journal_entries, postings, lot_consumptions and
 *    entry_fx_snapshots are READ-ONLY inputs. This module only adds missing
 *    source-of-truth fields on debts/installments. Legacy USD fields
 *    (principal_base / amount_base) are never modified.
 *
 * Evidence order (deterministic reconstruction):
 *   DEBT (CLASS A): debt.accountId is set, EXACTLY ONE `type='debt'` journal
 *     entry posts to that liability account, and the liability posting is
 *     denominated in IRT. The native IRT quantity IS the contractual Toman
 *     amount (1 native IRT unit = 1 Toman) => principal_toman = |quantity|.
 *   INSTALLMENT (CLASS B): installment is paid AND its paid_entry_id points to
 *     an entry with EXACTLY ONE entry_fx_snapshots row whose irt_amount > 0
 *     => amount_toman = paid_toman = irt_amount, paid_usd = usd_amount,
 *     paid_fx_rate = fx_rate.
 *
 * Everything else is a MIGRATION BLOCKER (missing / ambiguous / invalid /
 * quick-pay-without-snapshot / planning-only). Blockers are reported, never
 * fabricated.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { D, Decimal } from "@/domain/decimal";

export type MigrationClient = any;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type BlockerCategory =
  | "missing_evidence" // planning-only or no ledger/snapshot source
  | "ambiguous" // multiple possible source entries/snapshots
  | "invalid" // zero/negative/corrupt evidence
  | "quick_pay_no_snapshot" // paid via old path without frozen Toman
  | "non_irt_denomination" // liability posting not in native IRT (no Toman proof)
  | "pending_no_toman"; // unpaid installment without an authoritative Toman source

export type DebtTomanBlocker = {
  kind: "debt" | "installment";
  id: string;
  userId: string | null;
  legacyAmount: string;
  category: BlockerCategory;
  reason: string;
  evidence: string;
  missingEvidence: string;
};

export type DebtTomanClassification = {
  debts: {
    total: number;
    legacyCandidates: number; // principal_toman IS NULL
    reconstructable: number;
    blocked: number;
    planningOnly: number;
    ledgerBacked: number;
    ambiguous: number;
    invalid: number;
    missingEvidence: number;
  };
  installments: {
    total: number;
    legacyCandidates: number; // amount_toman IS NULL
    reconstructable: number;
    blocked: number;
    paid: number;
    paidReconstructable: number;
    paidBlocked: number;
    pending: number;
    pendingBlocked: number;
  };
  blockers: DebtTomanBlocker[];
  migratedDebtIds: string[];
  migratedInstallmentIds: string[];
};

/* ------------------------------------------------------------------ */
/* SQL helpers (tenant-safe joins)                                     */
/* ------------------------------------------------------------------ */

/** Cross-tenant-safe equality: NULL owner (legacy single-tenant) matches NULL. */
const sameTenant = (left: string, right: string) =>
  sql`${sql.raw(left)} IS NOT DISTINCT FROM ${sql.raw(right)}`;

type DebtEvidence =
  | { status: "deterministic"; principalToman: string; entryId: string; symbol: string }
  | { status: "blocked"; category: BlockerCategory; reason: string; evidence: string; missingEvidence: string };

/**
 * Classify ONE legacy debt (read-only). Never guesses: a deterministic
 * principal_toman requires EXACTLY ONE `type='debt'` ledger entry posting to
 * the debt's liability account, denominated in native IRT.
 */
export async function classifyDebtEvidence(
  client: MigrationClient,
  d: { id: string; userId: string | null; accountId: string | null; principalBase: string },
): Promise<DebtEvidence> {
  if (!d.accountId) {
    return {
      status: "blocked",
      category: "missing_evidence",
      reason: "planning-only debt (no liability account) — original Toman is not stored anywhere.",
      evidence: "debts.account_id IS NULL",
      missingEvidence: "ledger entry / native IRT quantity / historical Toman snapshot",
    };
  }

  const rows = await client.execute(sql`
    select p.quantity::text as qty,
           p.entry_id as entry_id,
           je.type as jtype,
           ast.symbol as symbol
    from postings p
      join accounts a on a.id = p.account_id
      join journal_entries je on je.id = p.entry_id
      left join assets ast on ast.id = p.asset_id
    where p.account_id = ${d.accountId}
      and je.type = 'debt'
      and ${sameTenant("je.user_id", "a.user_id")}
      and je.user_id IS NOT DISTINCT FROM ${d.userId ?? null}
  `);

  const entries = new Map<string, { symbol: string | null; qty: string }[]>();
  for (const r of rows.rows as { entry_id: string; symbol: string | null; qty: string }[]) {
    const list = entries.get(r.entry_id) ?? [];
    list.push({ symbol: r.symbol, qty: r.qty });
    entries.set(r.entry_id, list);
  }

  if (entries.size === 0) {
    return {
      status: "blocked",
      category: "missing_evidence",
      reason: "no `type='debt'` ledger entry posts to the liability account.",
      evidence: "0 matching journal entries",
      missingEvidence: "a debt-opening ledger entry with a native IRT liability posting",
    };
  }
  if (entries.size > 1) {
    return {
      status: "blocked",
      category: "ambiguous",
      reason: "multiple `type='debt'` entries post to the same liability account.",
      evidence: `${entries.size} matching journal entries`,
      missingEvidence: "a unique debt-opening entry",
    };
  }

  const [entryId, postings] = [...entries.entries()][0];
  const irt = postings.filter((p) => (p.symbol ?? "").toUpperCase() === "IRT");
  if (irt.length !== 1) {
    return {
      status: "blocked",
      category: "non_irt_denomination",
      reason: "the liability posting is not uniquely denominated in native IRT.",
      evidence: `liability postings: ${postings.map((p) => `${p.symbol ?? "null"}(${p.qty})`).join(", ")}`,
      missingEvidence: "a native IRT liability posting (its quantity is the contractual Toman)",
    };
  }

  const qty = D(irt[0].qty);
  if (qty.isZero()) {
    return {
      status: "blocked",
      category: "invalid",
      reason: "native IRT quantity is zero.",
      evidence: `quantity=${irt[0].qty}`,
      missingEvidence: "a positive native Toman amount",
    };
  }

  return { status: "deterministic", principalToman: qty.abs().toString(), entryId, symbol: "IRT" };
}

type InstallmentEvidence =
  | { status: "deterministic"; amountToman: string; paidToman: string; paidUsd: string; paidFxRate: string }
  | { status: "blocked"; category: BlockerCategory; reason: string; evidence: string; missingEvidence: string };

/**
 * Classify ONE legacy installment (read-only). Deterministic only when it was
 * paid through a path that froze a single authoritative Toman snapshot.
 */
export async function classifyInstallmentEvidence(
  client: MigrationClient,
  i: { id: string; debtUserId: string | null; status: string; amountBase: string; paidEntryId: string | null },
): Promise<InstallmentEvidence> {
  if (i.status !== "paid" || !i.paidEntryId) {
    return {
      status: "blocked",
      category: "pending_no_toman",
      reason: "unpaid installment without an authoritative Toman source.",
      evidence: `status=${i.status}, paid_entry_id=${i.paidEntryId ?? "null"}`,
      missingEvidence: "an immutable historical snapshot containing the Toman amount",
    };
  }

  const rows = await client.execute(sql`
    select fx.irt_amount::text as irt,
           fx.usd_amount::text as usd,
           fx.fx_rate::text as rate,
           je.user_id as entry_user
    from entry_fx_snapshots fx
      join journal_entries je on je.id = fx.entry_id
    where fx.entry_id = ${i.paidEntryId}
  `);

  if (rows.rows.length === 0) {
    return {
      status: "blocked",
      category: "quick_pay_no_snapshot",
      reason: "paid via the old quick-pay path that did not freeze a Toman snapshot.",
      evidence: "0 entry_fx_snapshots rows for paid_entry_id",
      missingEvidence: "entry_fx_snapshots with irt_amount (or an equivalent authoritative Toman source)",
    };
  }
  if (rows.rows.length > 1) {
    return {
      status: "blocked",
      category: "ambiguous",
      reason: "multiple FX snapshots exist for the paid entry.",
      evidence: `${rows.rows.length} entry_fx_snapshots rows`,
      missingEvidence: "a single authoritative snapshot",
    };
  }

  const snap = rows.rows[0] as { irt: string; usd: string; rate: string; entry_user: string | null };
  // Tenant isolation: the snapshot's entry must belong to the same user.
  if (!(snap.entry_user === null ? i.debtUserId === null : snap.entry_user === i.debtUserId)) {
    return {
      status: "blocked",
      category: "ambiguous",
      reason: "cross-user evidence: the snapshot entry belongs to another tenant.",
      evidence: `snapshot entry user=${snap.entry_user}, debt user=${i.debtUserId}`,
      missingEvidence: "a snapshot owned by the same tenant",
    };
  }

  const irt = D(snap.irt);
  if (irt.lte(0)) {
    return {
      status: "blocked",
      category: "invalid",
      reason: "snapshot irt_amount is not positive.",
      evidence: `irt_amount=${snap.irt}`,
      missingEvidence: "a positive historical Toman amount",
    };
  }

  return {
    status: "deterministic",
    amountToman: irt.toString(),
    paidToman: irt.toString(),
    paidUsd: D(snap.usd).toString(),
    paidFxRate: D(snap.rate).toString(),
  };
}

/* ------------------------------------------------------------------ */
/* Classification (READ-ONLY)                                          */
/* ------------------------------------------------------------------ */

export async function classifyLegacyDebtTomanMigration(
  client: MigrationClient = db,
): Promise<DebtTomanClassification> {
  const result: DebtTomanClassification = {
    debts: {
      total: 0,
      legacyCandidates: 0,
      reconstructable: 0,
      blocked: 0,
      planningOnly: 0,
      ledgerBacked: 0,
      ambiguous: 0,
      invalid: 0,
      missingEvidence: 0,
    },
    installments: {
      total: 0,
      legacyCandidates: 0,
      reconstructable: 0,
      blocked: 0,
      paid: 0,
      paidReconstructable: 0,
      paidBlocked: 0,
      pending: 0,
      pendingBlocked: 0,
    },
    blockers: [],
    migratedDebtIds: [],
    migratedInstallmentIds: [],
  };

  // ── Debts ─────────────────────────────────────────────────────────
  const debtTotals = await client.execute(sql`
    select count(*)::int as total,
           count(*) filter (where principal_toman is null)::int as legacy
    from debts
  `);
  result.debts.total = debtTotals.rows[0]?.total ?? 0;
  result.debts.legacyCandidates = debtTotals.rows[0]?.legacy ?? 0;

  // Cursor over legacy debt candidates (read-only).
  const debtRows = await client.execute(sql`
    select d.id, d.user_id, d.account_id, d.principal_base::text
    from debts d
    where d.principal_toman is null
    order by d.id
  `);
  for (const row of debtRows.rows as { id: string; user_id: string | null; account_id: string | null; principal_base: string }[]) {
    if (row.account_id) result.debts.ledgerBacked += 1;
    else result.debts.planningOnly += 1;
    const evidence = await classifyDebtEvidence(client, {
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id,
      principalBase: row.principal_base,
    });
    if (evidence.status === "deterministic") {
      result.debts.reconstructable += 1;
      result.migratedDebtIds.push(row.id);
    } else {
      result.debts.blocked += 1;
      if (evidence.category === "ambiguous") result.debts.ambiguous += 1;
      else if (evidence.category === "invalid") result.debts.invalid += 1;
      else if (evidence.category === "missing_evidence") result.debts.missingEvidence += 1;
      result.blockers.push({
        kind: "debt",
        id: row.id,
        userId: row.user_id,
        legacyAmount: row.principal_base,
        category: evidence.category,
        reason: evidence.reason,
        evidence: evidence.evidence,
        missingEvidence: evidence.missingEvidence,
      });
    }
  }

  // ── Installments ──────────────────────────────────────────────────
  const instTotals = await client.execute(sql`
    select count(*)::int as total,
           count(*) filter (where amount_toman is null)::int as legacy
    from installments
  `);
  result.installments.total = instTotals.rows[0]?.total ?? 0;
  result.installments.legacyCandidates = instTotals.rows[0]?.legacy ?? 0;

  const instRows = await client.execute(sql`
    select i.id, i.status, i.amount_base::text, i.paid_entry_id, d.user_id as debt_user
    from installments i
      join debts d on d.id = i.debt_id
    where i.amount_toman is null
    order by i.id
  `);
  for (const row of instRows.rows as {
    id: string;
    status: string;
    amount_base: string;
    paid_entry_id: string | null;
    debt_user: string | null;
  }[]) {
    if (row.status === "paid") result.installments.paid += 1;
    else result.installments.pending += 1;

    const evidence = await classifyInstallmentEvidence(client, {
      id: row.id,
      debtUserId: row.debt_user,
      status: row.status,
      amountBase: row.amount_base,
      paidEntryId: row.paid_entry_id,
    });
    if (evidence.status === "deterministic") {
      result.installments.reconstructable += 1;
      result.installments.paidReconstructable += 1;
      result.migratedInstallmentIds.push(row.id);
    } else {
      result.installments.blocked += 1;
      if (row.status === "paid") result.installments.paidBlocked += 1;
      else result.installments.pendingBlocked += 1;
      result.blockers.push({
        kind: "installment",
        id: row.id,
        userId: row.debt_user,
        legacyAmount: row.amount_base,
        category: evidence.category,
        reason: evidence.reason,
        evidence: evidence.evidence,
        missingEvidence: evidence.missingEvidence,
      });
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Backfill (guarded, batched, idempotent)                             */
/* ------------------------------------------------------------------ */

export type BackfillBatchStats = {
  debtsScanned: number;
  debtsMigrated: number;
  installmentsScanned: number;
  installmentsMigrated: number;
  skippedAlreadyPopulated: number;
};

export async function backfillDeterministicDebtToman(
  opts: { batchSize?: number; client?: MigrationClient } = {},
): Promise<{ batches: BackfillBatchStats[]; total: BackfillBatchStats }> {
  const client = opts.client ?? db;
  const batchSize = Math.max(1, opts.batchSize ?? 200);
  const batches: BackfillBatchStats[] = [];
  const total: BackfillBatchStats = {
    debtsScanned: 0,
    debtsMigrated: 0,
    installmentsScanned: 0,
    installmentsMigrated: 0,
    skippedAlreadyPopulated: 0,
  };

  // ── Debts (cursor-batched, idempotent) ────────────────────────────
  let lastDebtId: string | null = null;
  for (;;) {
    const batchStats: BackfillBatchStats = {
      debtsScanned: 0,
      debtsMigrated: 0,
      installmentsScanned: 0,
      installmentsMigrated: 0,
      skippedAlreadyPopulated: 0,
    };
    const rows = await client.execute(sql`
      select d.id, d.user_id, d.account_id, d.principal_base::text
      from debts d
      where d.principal_toman is null
        ${lastDebtId ? sql`and d.id > ${lastDebtId}` : sql``}
      order by d.id
      limit ${batchSize}
    `);
    const debtRows = rows.rows as { id: string; user_id: string | null; account_id: string | null; principal_base: string }[];
    if (debtRows.length === 0) break;

    const tx = await client.transaction(async (t: MigrationClient) => {
      let migrated = 0;
      for (const row of debtRows) {
        batchStats.debtsScanned += 1;
        const evidence = await classifyDebtEvidence(t, {
          id: row.id,
          userId: row.user_id,
          accountId: row.account_id,
          principalBase: row.principal_base,
        });
        if (evidence.status === "deterministic") {
          // Idempotent: only fill when still NULL (never overwrite).
          const upd = await t.execute(sql`
            update debts set principal_toman = ${evidence.principalToman}
            where id = ${row.id} and principal_toman is null
            returning id
          `);
          migrated += upd.rows.length;
        }
      }
      return migrated;
    });
    batchStats.debtsMigrated = tx;
    batches.push(batchStats);
    lastDebtId = debtRows[debtRows.length - 1].id;
    if (debtRows.length < batchSize) break;
  }

  // ── Installments (cursor-batched, idempotent) ─────────────────────
  let lastInstId: string | null = null;
  for (;;) {
    const batchStats: BackfillBatchStats = {
      debtsScanned: 0,
      debtsMigrated: 0,
      installmentsScanned: 0,
      installmentsMigrated: 0,
      skippedAlreadyPopulated: 0,
    };
    const rows = await client.execute(sql`
      select i.id, i.status, i.amount_base::text, i.paid_entry_id, d.user_id as debt_user
      from installments i
        join debts d on d.id = i.debt_id
      where i.amount_toman is null
        and i.status = 'paid'
        and i.paid_entry_id is not null
        ${lastInstId ? sql`and i.id > ${lastInstId}` : sql``}
      order by i.id
      limit ${batchSize}
    `);
    const instRows = rows.rows as {
      id: string;
      status: string;
      amount_base: string;
      paid_entry_id: string | null;
      debt_user: string | null;
    }[];
    if (instRows.length === 0) break;

    const tx = await client.transaction(async (t: MigrationClient) => {
      let migrated = 0;
      for (const row of instRows) {
        batchStats.installmentsScanned += 1;
        const evidence = await classifyInstallmentEvidence(t, {
          id: row.id,
          debtUserId: row.debt_user,
          status: row.status,
          amountBase: row.amount_base,
          paidEntryId: row.paid_entry_id,
        });
        if (evidence.status === "deterministic") {
          const upd = await t.execute(sql`
            update installments
            set amount_toman = ${evidence.amountToman},
                paid_toman = ${evidence.paidToman},
                paid_usd = ${evidence.paidUsd},
                paid_fx_rate = ${evidence.paidFxRate}
            where id = ${row.id} and amount_toman is null
            returning id
          `);
          migrated += upd.rows.length;
        }
      }
      return migrated;
    });
    batchStats.installmentsMigrated = tx;
    batches.push(batchStats);
    lastInstId = instRows[instRows.length - 1].id;
    if (instRows.length < batchSize) break;
  }

  for (const b of batches) {
    total.debtsScanned += b.debtsScanned;
    total.debtsMigrated += b.debtsMigrated;
    total.installmentsScanned += b.installmentsScanned;
    total.installmentsMigrated += b.installmentsMigrated;
    total.skippedAlreadyPopulated += b.skippedAlreadyPopulated;
  }
  return { batches, total };
}

/* ------------------------------------------------------------------ */
/* Post-backfill validation (READ-ONLY)                                */
/* ------------------------------------------------------------------ */

export type DebtTomanVerification = {
  remainingNullPrincipal: number;
  remainingNullAmount: number;
  negativeContractualAmounts: number;
  crossUserEvidence: number;
  nonIrtDebtsStillNull: number;
  ok: boolean;
};

export async function verifyDebtTomanMigration(
  client: MigrationClient = db,
): Promise<DebtTomanVerification> {
  const remainingPrincipal = await client.execute(sql`
    select count(*)::int as c from debts where principal_toman is null
  `);
  const remainingAmount = await client.execute(sql`
    select count(*)::int as c from installments where amount_toman is null
  `);
  const negative = await client.execute(sql`
    select count(*)::int as c
    from (
      select id from debts where principal_toman < 0
      union all
      select id from installments where amount_toman < 0
    ) t
  `);
  // No reconstructed row may reference another tenant's evidence: a migrated
  // installment must belong to the same user as its paid entry.
  const crossUser = await client.execute(sql`
    select count(*)::int as c
    from installments i
      join debts d on d.id = i.debt_id
      join journal_entries je on je.id = i.paid_entry_id
    where i.amount_toman is not null
      and je.user_id IS NOT NULL
      and d.user_id IS NOT NULL
      and je.user_id <> d.user_id
  `);

  const c = (r: any) => Number(r.rows?.[0]?.c ?? 0);
  const remainingNullPrincipalCount = c(remainingPrincipal);
  const remainingNullAmountCount = c(remainingAmount);
  const negativeCount = c(negative);
  const crossUserCount = c(crossUser);

  return {
    remainingNullPrincipal: remainingNullPrincipalCount,
    remainingNullAmount: remainingNullAmountCount,
    negativeContractualAmounts: negativeCount,
    crossUserEvidence: crossUserCount,
    nonIrtDebtsStillNull: remainingNullPrincipalCount,
    ok: negativeCount === 0 && crossUserCount === 0,
  };
}

// Re-export Decimal for convenient callers/tests.
export { D, Decimal };
