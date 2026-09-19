import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, backupRuns, users } from "@/db/schema";
import { authorizeOwnerOrAdmin } from "@/lib/authGuard";
import { clearSessionCookie, invalidateAllSessions } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { invalidateTenantStateCache } from "@/lib/tenantState";
import { isTrustedMutation } from "@/lib/requestSecurity";
import { BACKUP_SCHEMA_VERSION, BACKUP_TABLES, RESTORE_TABLES, restorableColumns } from "@/features/backup/tables";

export const dynamic = "force-dynamic";
const MAX_RESTORE_BYTES = 5 * 1024 * 1024;

const backupPayloadSchema = z.object({
  app: z.literal("PWOS"),
  schemaVersion: z.string(),
  confirmToken: z.literal("RESTORE_DATABASE_OVERWRITE"),
  data: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

const SAFE_IDENTIFIER = /^[a-z0-9_]+$/i;

/**
 * Checks a parsed backup against the CURRENT schema before anything is
 * deleted. Returns a user-facing error, or null when the file is complete:
 * every restorable table present (an empty array is fine), no unknown table,
 * no unknown column. A file that fails here never reaches the transaction.
 */
function validateBackupData(data: Record<string, Record<string, unknown>[]>): string | null {
  const missing = RESTORE_TABLES.filter((t) => !Array.isArray(data[t]));
  if (missing.length) {
    return `فایل پشتیبان کامل نیست؛ این جدول‌ها در آن نیستند: ${missing.join("، ")}`;
  }
  const known = new Set(BACKUP_TABLES);
  const unknown = Object.keys(data).filter((t) => !known.has(t));
  if (unknown.length) return `فایل پشتیبان جدول ناشناخته دارد: ${unknown.join("، ")}`;
  for (const t of RESTORE_TABLES) {
    const columns = restorableColumns(t);
    for (const row of data[t]) {
      const bad = Object.keys(row).find((c) => !SAFE_IDENTIFIER.test(c) || !columns.has(c));
      if (bad) return `ستون «${bad}» در جدول «${t}» شناخته‌شده نیست.`;
    }
  }
  return null;
}

/** A JSON value is sent as JSON text, never as a Postgres array/record literal. */
function restoreValue(sqlType: string | undefined, value: unknown): unknown {
  if (value !== null && value !== undefined && (sqlType === "json" || sqlType === "jsonb")) {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Security-Hardened Transactional Restore Endpoint.
 * Requires Authenticated Owner or Admin user.
 * Supabase Auth identities are never imported, overwritten, or deleted.
 */
export async function POST(request: Request) {
  if (!isTrustedMutation(request)) {
    return NextResponse.json({ ok: false, error: "درخواست نامعتبر است." }, { status: 403 });
  }
  // A database-wide restore is intentionally disabled in ordinary web
  // runtime. Operators must explicitly enable a short maintenance window.
  if (process.env.NODE_ENV === "production" && process.env.PWOS_ENABLE_RESTORE !== "true") {
    return NextResponse.json({ ok: false, error: "بازیابی در این محیط غیرفعال است." }, { status: 503 });
  }

  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_RESTORE_BYTES) {
    return NextResponse.json({ ok: false, error: "فایل بازیابی بیش از حد بزرگ است." }, { status: 413 });
  }
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
    const rawText = await request.text();
    if (Buffer.byteLength(rawText, "utf8") > MAX_RESTORE_BYTES) {
      return NextResponse.json({ ok: false, error: "فایل بازیابی بیش از حد بزرگ است." }, { status: 413 });
    }
    const rawBody = JSON.parse(rawText);
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

    if (parseResult.data.schemaVersion !== BACKUP_SCHEMA_VERSION) {
      return NextResponse.json(
        {
          ok: false,
          error: `این فایل پشتیبان با نسخهٔ ${parseResult.data.schemaVersion} ساخته شده و با نسخهٔ فعلی (${BACKUP_SCHEMA_VERSION}) سازگار نیست. یک پشتیبان تازه بگیرید.`,
        },
        { status: 400 },
      );
    }
    const { data } = parseResult.data;
    const invalid = validateBackupData(data);
    if (invalid) return NextResponse.json({ ok: false, error: invalid }, { status: 400 });
    const expectedRows = RESTORE_TABLES.reduce((sum, t) => sum + data[t].length, 0);
    let inserted = 0;

    // Pre-restore safety snapshot: record what is about to be overwritten.
    // The operator should take a full backup (GET /api/backup) before a
    // restore; this marker captures the row counts of the critical
    // accounting tables as a last-line audit trail.
    let preRestoreRowCount = 0;
    try {
      const criticalTables = ["accounts", "journal_entries", "postings", "lots", "lot_consumptions", "audit_log"];
      for (const t of criticalTables) {
        const res = await db.execute(sql`select count(*)::int as cnt from ${sql.identifier(t)}`);
        preRestoreRowCount += Number((res.rows[0] as { cnt?: number })?.cnt ?? 0);
      }
      // backup_runs is intentionally NOT part of the restore table list, so
      // this marker survives the restore itself.
      await db.insert(backupRuns).values({
        kind: "pre_restore_snapshot",
        rowCount: preRestoreRowCount,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        note: "row counts captured immediately before restore overwrite",
      });
    } catch {}

    await db.transaction(async (tx) => {
      // Clear existing tables children-first, then insert parents-first; the
      // order is the schema's foreign-key order (see features/backup/tables).
      for (const t of [...RESTORE_TABLES].reverse()) {
        await tx.execute(sql`delete from ${sql.identifier(t)}`);
      }

      for (const t of RESTORE_TABLES) {
        const columns = restorableColumns(t);
        for (const row of data[t]) {
          // Column names were checked against the schema by validateBackupData.
          const cols = Object.keys(row);
          if (!cols.length) continue;
          const colSql = cols.map((c) => sql.identifier(c));
          const valSql = cols.map((c) => sql`${restoreValue(columns.get(c), row[c])}`);
          await tx.execute(
            sql`insert into ${sql.identifier(t)} (${sql.join(colSql, sql`, `)}) values (${sql.join(valSql, sql`, `)})`,
          );
          inserted++;
        }
      }
      // Everything in the file must be back, or nothing is: a partial restore
      // is worse than none, so a short count rolls the whole transaction back.
      if (inserted !== expectedRows) {
        throw new Error(`بازیابی ناقص بود (${inserted} از ${expectedRows} ردیف)؛ هیچ تغییری اعمال نشد.`);
      }

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

    // Identity rows are deliberately preserved; restored tenant data must
    // continue to reference an existing, authenticated account.
    invalidateTenantStateCache();

    // 10. Supabase owns production sessions and local sign-out revokes the
    // caller's refresh token. The legacy invalidation remains only for the
    // embedded test/development auth fallback.
    try {
      await invalidateAllSessions();
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
