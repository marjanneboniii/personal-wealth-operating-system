import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { backupRuns } from "@/db/schema";

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
  "postings",
  "lots",
  "lot_consumptions",
  "prices",
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
  "settings",
  "notifications",
  "audit_log",
];

/** Full, human-readable, self-hosted backup of the whole wealth database. */
export async function GET() {
  const data: Record<string, unknown[]> = {};
  let rowCount = 0;
  for (const t of TABLES) {
    const res = await db.execute(sql.raw(`select * from ${t}`));
    data[t] = res.rows;
    rowCount += res.rows.length;
  }
  await db.insert(backupRuns).values({ kind: "export", rowCount, schemaVersion: "1.0" });

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
