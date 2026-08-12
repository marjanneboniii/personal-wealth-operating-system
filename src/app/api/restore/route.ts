import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, backupRuns, sessions, users } from "@/db/schema";
import { authorizeOwnerOrAdmin } from "@/lib/authGuard";
import { clearSessionCookie } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

const ORDER = [
  "currencies",
  "asset_classes",
  "networks",
  "institutions",
  "assets",
  "cities",
  "neighborhoods",
  "property_types",
  "wallets",
  "accounts",
  "expense_categories",
  "journal_entries",
  "real_estate_properties",
  "entry_reviews",
  "postings",
  "lots",
  "lot_consumptions",
  "prices",
  "coingecko_asset_catalog",
  "portfolio_valuations",
  "portfolio_snapshots",
  "asset_performance",
  "wealth_performance_snapshots",
  "asset_performance_analysis",
  "portfolio_risk_metrics",
  "benchmark_definitions",
  "benchmark_snapshots",
  "benchmark_results",
  "analytics_runs",
  "snapshots",
  "snapshot_lines",
  "goals",
  "goal_contributions",
  "events",
  "event_items",
  "budgets",
  "planned_transactions",
  "debts",
  "installments",
  "obligations",
  "funds",
  "users",
  "user_setup_state",
  "settings",
  "notifications",
  "audit_log",
];

const ALLOWED_TABLES = new Set(ORDER);

const backupPayloadSchema = z.object({
  app: z.literal("PWOS"),
  schemaVersion: z.literal("1.0"),
  confirmToken: z.literal("RESTORE_DATABASE_OVERWRITE"),
  data: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

/**
 * Security-Hardened Transactional Restore Endpoint.
 * Requires Authenticated Owner or Admin user.
 * Invalidation rule: deletes all sessions within the transaction and clears the session cookie to force re-login.
 * Rollback guarantee: Any failure rolls back all table modifications and preserves existing sessions.
 */
export async function POST(request: Request) {
  const auth = await authorizeOwnerOrAdmin(request);
  if (!auth.ok) {
    // Audit every denied restore attempt. Identity/role come only from the
    // server-side session — never from the request payload.
    try {
      await recordAuditEvent({
        action: "RESTORE_DENIED",
        entityType: "database",
        userId: auth.user?.id ?? null,
        result: "FAILURE",
        metadata: { status: auth.status },
      });
    } catch {}
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  try {
    const rawBody = await request.json();
    const parseResult = backupPayloadSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "تأییدیه بازیابی ارائه نشده است یا ساختار فایل پشتیبان نامعتبر است",
        },
        { status: 400 },
      );
    }

    const { data } = parseResult.data;
    let inserted = 0;

    // Pre-restore safety snapshot: record what is about to be overwritten.
    // The operator should take a full backup (GET /api/backup) before a
    // restore; this marker captures the row counts of the critical
    // accounting tables as a last-line audit trail.
    let preRestoreRowCount = 0;
    try {
      const criticalTables = ["users", "accounts", "journal_entries", "postings", "lots", "lot_consumptions", "audit_log"];
      for (const t of criticalTables) {
        const res = await db.execute(sql`select count(*)::int as cnt from ${sql.identifier(t)}`);
        preRestoreRowCount += Number((res.rows[0] as { cnt?: number })?.cnt ?? 0);
      }
      // backup_runs is intentionally NOT part of the restore table list, so
      // this marker survives the restore itself.
      await db.insert(backupRuns).values({
        kind: "pre_restore_snapshot",
        rowCount: preRestoreRowCount,
        schemaVersion: "1.0",
        note: "row counts captured immediately before restore overwrite",
      });
    } catch {}

    await db.transaction(async (tx) => {
      // Clear existing tables in reverse dependency order using parameterized identifiers
      for (const t of [...ORDER].reverse()) {
        await tx.execute(sql`delete from ${sql.identifier(t)}`);
      }

      // Re-insert rows in direct dependency order using fully parameterized queries
      for (const t of ORDER) {
        if (!ALLOWED_TABLES.has(t)) continue;
        const rows = data[t] ?? [];
        for (const row of rows) {
          const rawCols = Object.keys(row);
          // Strictly validate column names to allow only safe alphanumeric identifiers
          const cols = rawCols.filter((c) => /^[a_z0_9_]+$/i.test(c));
          if (!cols.length) continue;

          const colSql = cols.map((c) => sql.identifier(c));
          const valSql = cols.map((c) => sql`${row[c]}`);

          await tx.execute(
            sql`insert into ${sql.identifier(t)} (${sql.join(colSql, sql`, `)}) values (${sql.join(valSql, sql`, `)})`,
          );
          inserted++;
        }
      }

      // 7. Security Hardening: Invalidate all sessions in database upon successful restore
      await tx.delete(sessions);

      let auditUserId: string | null = null;
      try {
        if (auth.user?.id) {
          const [checkUser] = await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, auth.user.id))
            .limit(1);
          if (checkUser) auditUserId = checkUser.id;
        }
      } catch {}

      await tx.insert(auditLog).values({
        action: "restore_database",
        entityType: "database",
        payload: JSON.stringify({ rowCount: inserted, restoredAt: new Date().toISOString() }),
      });
      await recordAuditEvent(
        {
          action: "RESTORE",
          entityType: "database",
          userId: auditUserId,
          result: "SUCCESS",
          metadata: { rowCount: inserted },
        },
        tx,
      );
    });

    // 10. Clear session cookie to force caller re-login
    try {
      await clearSessionCookie();
    } catch {}

    return NextResponse.json({ ok: true, inserted });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "خطای بازیابی" },
      { status: 500 },
    );
  }
}
