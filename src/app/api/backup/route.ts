import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, backupRuns } from "@/db/schema";
import { authorizeOwnerOrAdmin } from "@/lib/authGuard";
import { recordAuditEvent } from "@/lib/audit";
import { BACKUP_SCHEMA_VERSION, BACKUP_TABLES, exportColumns } from "@/features/backup/tables";

export const dynamic = "force-dynamic";

/*
 * The table list, the export column whitelist (audit M-01: no password or PIN
 * hash ever leaves the server) and the version all live in
 * `@/features/backup/tables`, derived from the schema, shared with restore.
 */

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
  // One read-only snapshot for every table, so a write landing mid-export can
  // never leave a posting in the file without its journal entry.
  await db.transaction(async (tx) => {
    await tx.execute(sql`set transaction isolation level repeatable read, read only`);
    for (const t of BACKUP_TABLES) {
      // `date` columns are exported as their literal text: the driver would
      // otherwise hand back a JS Date at LOCAL midnight, which JSON writes in
      // UTC — a day earlier on any server east of Greenwich.
      const columns = exportColumns(t).map((c) =>
        c.sqlType === "date"
          ? sql`${sql.identifier(c.name)}::text as ${sql.identifier(c.name)}`
          : sql.identifier(c.name),
      );
      const res = await tx.execute(sql`select ${sql.join(columns, sql`, `)} from ${sql.identifier(t)}`);
      data[t] = res.rows;
      rowCount += res.rows.length;
    }
  });

  await db.insert(backupRuns).values({ kind: "export", rowCount, schemaVersion: BACKUP_SCHEMA_VERSION });
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
    schemaVersion: BACKUP_SCHEMA_VERSION,
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
