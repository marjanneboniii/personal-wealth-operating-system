import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, backupRuns } from "@/db/schema";
import { authorizeOwnerOrAdmin } from "@/lib/authGuard";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

const TABLES = [
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
  "journal_entries",
  "real_estate_properties",
  "entry_reviews",
  "postings",
  "entry_fx_snapshots",
  "lots",
  "lot_consumptions",
  "prices",
  "market_price_sources",
  "market_prices",
  "market_snapshots",
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
  "user_fx_settings",
  "user_setup_state",
  "exchange_rates",
  "settings",
  "notifications",
  "audit_log",
];

const ALLOWED_TABLES = new Set(TABLES);

/**
 * Security-Hardened Backup Endpoint.
 * Requires Authenticated Owner or Admin user.
 * Never exports sensitive session tokens ("sessions" table excluded).
 */
export async function GET(request: Request) {
  const auth = await authorizeOwnerOrAdmin(request);
  if (!auth.ok) {
    // Audit every denied backup attempt (role comes from the server-side
    // session only — request body/query is never consulted for identity).
    try {
      await recordAuditEvent({
        action: "BACKUP_DENIED",
        entityType: "database",
        userId: auth.user?.id ?? null,
        result: "FAILURE",
        metadata: { status: auth.status },
      });
    } catch {}
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const data: Record<string, unknown[]> = {};
  let rowCount = 0;
  for (const t of TABLES) {
    if (!ALLOWED_TABLES.has(t)) continue;
    const res = await db.execute(sql`select * from ${sql.identifier(t)}`);
    data[t] = res.rows;
    rowCount += res.rows.length;
  }

  await db.insert(backupRuns).values({ kind: "export", rowCount, schemaVersion: "1.0" });
  await db.insert(auditLog).values({
    action: "export_backup",
    entityType: "database",
    payload: JSON.stringify({ rowCount, exportedAt: new Date().toISOString() }),
  });
  await recordAuditEvent({
    action: "BACKUP",
    entityType: "database",
    userId: auth.user?.id ?? null,
    result: "SUCCESS",
    metadata: { rowCount },
  });

  const payload = {
    app: "PWOS",
    schemaVersion: "1.0",
    exportedAt: new Date().toISOString(),
    rowCount,
    data,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="pwos-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
