import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, backupRuns } from "@/db/schema";

export const dynamic = "force-dynamic";

const TABLES = [
  "currencies",
  "asset_classes",
  "networks",
  "institutions",
  "assets",
  "wallets",
  "accounts",
  "journal_entries",
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
  "sessions",
  "user_fx_settings",
  "user_setup_state",
  "import_jobs",
  "import_records",
  "exchange_rates",
  "user_display_preferences",
  "settings",
  "notifications",
  "audit_log",
];

const ALLOWED_TABLES = new Set(TABLES);

function checkAuth(request: Request): boolean {
  const authToken = process.env.PWOS_AUTH_TOKEN;
  if (!authToken) return true;
  const headerToken =
    request.headers.get("x-pwos-auth") ??
    request.headers.get("authorization")?.replace("Bearer ", "");
  return headerToken === authToken;
}

/** Full, human-readable, self-hosted backup of the whole wealth database. */
export async function GET(request: Request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: "دسترسی غیرمجاز" }, { status: 401 });
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
