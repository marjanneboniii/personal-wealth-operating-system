import { listBankIdentifiers } from "./identifiers";
import { matchBankAccount } from "./matching";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { bankSmsConnections, bankSmsInbox, users } from "@/db/schema";
import { getSetupState } from "@/features/setup/service";
import { decryptSensitive, encryptSensitive } from "@/lib/fieldEncryption";
import { normalizeBankText, parseBankDate, parseBankMessage } from "./parser";

export const smsPayloadSchema = z.object({
  message: z.string().trim().min(1).max(8000),
  sender: z.string().trim().max(100).default(""),
  sentAt: z.iso.datetime({ offset: true }),
}).strict();
export const hashSmsToken = (token: string) => createHash("sha256").update(token).digest("hex");
function encryptSmsPayload(value: string, userId: string) {
  if (!process.env.FIELD_ENCRYPTION_KEY) throw new Error("SMS encryption is not configured");
  return encryptSensitive(value, context(userId));
}
const context = (userId: string) => `bank-sms:${userId}`;
const tehranDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

export class SmsError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export async function requireSmsSetup(userId: string) {
  if (!(await getSetupState(userId)).completed) throw new SmsError(403, "SETUP_REQUIRED");
}

export async function createSmsConnection(userId: string, name: string) {
  await requireSmsSetup(userId);
  // Fail before issuing credentials if production encryption is unavailable.
  encryptSmsPayload("{}", userId);
  const token = `tzsms_${randomBytes(32).toString("base64url")}`;
  const connection = await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    const active = await tx.select({ id: bankSmsConnections.id }).from(bankSmsConnections)
      .where(and(eq(bankSmsConnections.userId, userId), isNull(bankSmsConnections.revokedAt)));
    if (active.length >= 5) throw new SmsError(409, "CONNECTION_LIMIT");
    return (await tx.insert(bankSmsConnections).values({ userId, name, tokenHash: hashSmsToken(token) }).returning({ id: bankSmsConnections.id, createdAt: bankSmsConnections.createdAt }))[0];
  });
  return { ...connection, token };
}

export async function receiveSms(token: string, payload: z.infer<typeof smsPayloadSchema>) {
  const sentAt = new Date(payload.sentAt);
  const now = new Date();
  if (!Number.isFinite(sentAt.getTime()) || sentAt.getTime() > now.getTime() + 300_000) throw new SmsError(400, "INVALID_TIME");
  if (/رمز|یک\s*بار\s*مصرف|کد\s*(?:تأیید|تایید|فعال)/.test(normalizeBankText(payload.message))) throw new SmsError(422, "NOT_A_TRANSACTION");
  const fingerprint = createHash("sha256").update(JSON.stringify([normalizeBankText(payload.message), payload.sender, sentAt.toISOString()])).digest("hex");
  return db.transaction(async (tx) => {
    const [connection] = await tx.select().from(bankSmsConnections)
      .where(and(eq(bankSmsConnections.tokenHash, hashSmsToken(token)), isNull(bankSmsConnections.revokedAt))).for("update");
    if (!connection) throw new SmsError(401, "INVALID_CONNECTION");
    // Use the transaction handle throughout; embedded single-connection DBs cannot nest global reads.
    const state = await tx.execute(sql`select 1 from user_setup_state where user_id = ${connection.userId}::uuid and completed = true limit 1`);
    if (!state.rows.length) throw new SmsError(403, "SETUP_REQUIRED");
    if (sentAt < connection.createdAt) throw new SmsError(422, "BEFORE_ACTIVATION");
    const messageDate = parseBankDate(payload.message);
    if (messageDate && messageDate < tehranDate(connection.createdAt)) throw new SmsError(422, "BEFORE_ACTIVATION");
    await tx.select({ id: users.id }).from(users).where(eq(users.id, connection.userId)).for("update");
    const [previous] = await tx.select({ id: bankSmsInbox.id }).from(bankSmsInbox)
      .where(and(eq(bankSmsInbox.userId, connection.userId), eq(bankSmsInbox.fingerprint, fingerprint))).limit(1);
    if (previous) return { duplicate: true };
    const count = await tx.execute(sql`select count(*)::int as n from bank_sms_inbox where user_id = ${connection.userId}::uuid and status in ('pending','processing')`);
    if (Number(count.rows[0].n) >= 100) throw new SmsError(409, "INBOX_FULL");
    const encryptedPayload = encryptSmsPayload(JSON.stringify(payload), connection.userId);
    await tx.insert(bankSmsInbox).values({ userId: connection.userId, connectionId: connection.id, encryptedPayload, fingerprint, sentAt });
    await tx.update(bankSmsConnections).set({ lastReceivedAt: now }).where(eq(bankSmsConnections.id, connection.id));
    return { duplicate: false };
  });
}

export async function listSmsConnections(userId: string) {
  return db.select({ id: bankSmsConnections.id, name: bankSmsConnections.name, createdAt: bankSmsConnections.createdAt, lastReceivedAt: bankSmsConnections.lastReceivedAt })
    .from(bankSmsConnections).where(and(eq(bankSmsConnections.userId, userId), isNull(bankSmsConnections.revokedAt))).orderBy(desc(bankSmsConnections.createdAt));
}

export async function getSmsInboxItem(userId: string, id: string) {
  const [row] = await db.select().from(bankSmsInbox).where(and(eq(bankSmsInbox.userId, userId), eq(bankSmsInbox.id, id))).limit(1);
  return row;
}

/** The original message of a still-pending inbox row, decrypted on the server — never the client's copy. */
export function decryptInboxMessage(userId: string, row: { encryptedPayload: string | null }): string | null {
  if (!row.encryptedPayload) return null;
  try {
    return smsPayloadSchema.parse(JSON.parse(decryptSensitive(row.encryptedPayload, context(userId)) || "{}")).message;
  } catch {
    return null;
  }
}

export async function listSmsDrafts(userId: string) {
  const identifiers = await listBankIdentifiers(userId);
  const rows = await db.select().from(bankSmsInbox).where(and(eq(bankSmsInbox.userId, userId), sql`${bankSmsInbox.status} in ('pending','processing')`)).orderBy(desc(bankSmsInbox.receivedAt)).limit(100);
  return rows.map((row) => {
    const payload = smsPayloadSchema.parse(JSON.parse(decryptSensitive(row.encryptedPayload, context(userId)) || "{}"));
    const draft = parseBankMessage(payload.message);
    draft.warnings.push("این تراکنش باید پس از زمان مبنای موجودی افتتاحیهٔ حساب باشد؛ از ثبت دوبارهٔ مبالغ منظورشده در افتتاحیه خودداری کنید.");
    const match = matchBankAccount(payload.message, identifiers);
    return { ...draft, suggestedAccountId: match.accountId, accountMatchMessage: match.message, inboxId: row.id, sender: payload.sender, receivedAt: row.receivedAt.toISOString() };
  });
}
