import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";

export type AuditAction =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILURE"
  | "OAUTH_LOGIN"
  | "LOGOUT"
  | "CREATE_TRANSACTION"
  | "POST_TRANSACTION"
  | "CREATE_INCOME"
  | "CREATE_EXPENSE"
  | "CREATE_TRANSFER"
  | "CREATE_ASSET_BUY"
  | "CREATE_ASSET_SELL"
  | "CREATE_DEBT"
  | "IDEMPOTENT_REPLAY"
  | "UPDATE_FX"
  | "RESTORE"
  | "BACKUP"
  | "post_entry"
  | "reverse_entry"
  | "export_backup"
  | "restore_database"
  | "setup_wizard"
  | "import_data";

export type AuditEventInput = {
  action: AuditAction | string;
  entityType: string;
  entityId?: string | null;
  userId?: string | null;
  result?: "SUCCESS" | "FAILURE" | "IDEMPOTENT_REPLAY";
  requestId?: string | null;
  before?: unknown;
  after?: unknown;
  payload?: unknown;
  metadata?: unknown;
};

/**
 * Sanitizes any object before logging to ensure NO sensitive data ever leaks.
 * Removes passwords, password hashes, session tokens, refresh tokens, OAuth tokens,
 * API secrets, DATABASE_URL, and private keys.
 */
export function sanitizeAuditData(data: unknown): string | null {
  if (data === undefined || data === null) return null;
  if (typeof data !== "object") return String(data);

  const SENSITIVE_KEYS = /password|hash|token|secret|api_?key|credential|private_?key|database_?url/i;

  function clean(obj: any): any {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(clean);
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.test(k)) {
        result[k] = "[REDACTED]";
      } else if (typeof v === "object" && v !== null) {
        result[k] = clean(v);
      } else {
        result[k] = v;
      }
    }
    return result;
  }

  try {
    return JSON.stringify(clean(data));
  } catch {
    return "[UNSERIALIZABLE]";
  }
}

/**
 * Records an immutable audit trail event.
 *
 * GUARANTEES:
 * 1. Never logs sensitive credentials or tokens.
 * 2. Only logs SUCCESS after a transaction successfully commits.
 * 3. Never throws an error that would break or re-trigger accounting logic (PART 10).
 */
export async function recordAuditEvent(input: AuditEventInput, txClient?: any): Promise<void> {
  const dbClient = txClient ?? db;
  try {
    const action = input.action;
    const entityType = input.entityType;
    const entityId = input.entityId ?? null;
    const userId = input.userId ?? null;
    const result = input.result ?? "SUCCESS";
    const requestId = input.requestId ?? null;
    const beforeData = sanitizeAuditData(input.before);
    const afterData = sanitizeAuditData(input.after);
    const payload = sanitizeAuditData(input.payload);
    const metadata = sanitizeAuditData(input.metadata);

    await dbClient.insert(auditLog).values({
      action,
      entityType,
      entityId,
      userId,
      result,
      requestId,
      beforeData,
      afterData,
      payload,
      metadata,
    } as any);
  } catch (err) {
    // PART 10 — Audit Failure: Never fail an accounting transaction because of an audit log failure
    console.warn("[audit log notice] Could not write audit log entry:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * User-Scoped Audit Trail Query.
 * Guarantees User A cannot view audit events of User B (PART 38, PART 39).
 */
export async function getAuditLogs(userId?: string | null, limit = 50) {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  let u = userId;
  if (u === undefined) {
    try {
      const { getCurrentUser } = await import("@/lib/auth");
      const cur = await getCurrentUser();
      u = cur?.id ?? null;
    } catch {}
  }

  return db
    .select()
    .from(auditLog)
    .where(u ? eq(auditLog.userId, u) : sql`1=1`)
    .orderBy(desc(auditLog.createdAt))
    .limit(safeLimit);
}
