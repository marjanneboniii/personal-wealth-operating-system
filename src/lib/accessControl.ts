import { eq } from "drizzle-orm";
import { db } from "@/db";
import { debts, installments, journalEntries } from "@/db/schema";

/**
 * Authorization / ownership helpers enforced at the Action / API boundary,
 * BEFORE any accounting service is invoked. Nothing in this module mutates
 * ledger state — it only decides allow/deny so the existing accounting core
 * (postEntry, FIFO, ledger posting) stays untouched.
 *
 * Ownership semantics used across the app:
 * - A record with `userId` set belongs exclusively to that user.
 * - A record with `userId = NULL` is shared/global reference data
 *   (chart of accounts, system accounts like fee/PnL, legacy single-tenant
 *   rows before migration).
 * Journal entries are STRICTER for sensitive operations (reverse/review/
 * edit/delete): an entry must belong to the current user exactly; entries
 * without an owner are denied to regular users.
 */

export type AuthenticatedUser = { id: string; role?: string | null };

export class OwnershipError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 403, code = "OWNERSHIP_VIOLATION") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Strict journal-entry ownership for sensitive financial operations
 * (reverse / edit / delete / review).
 *
 * - Entry not found → 404.
 * - Entry owner differs from the current user → 403 (includes entries owned
 *   by another user AND owner-less entries: `userId === currentUser.id` is a
 *   hard condition, never `allow` on NULL).
 */
export async function assertJournalEntryOwnership(
  entryId: string,
  user: AuthenticatedUser,
  txClient: any = db,
): Promise<void> {
  if (!entryId) throw new OwnershipError("شناسه سند الزامی است.", 400, "MISSING_ID");
  const [je] = await txClient
    .select({ id: journalEntries.id, userId: journalEntries.userId })
    .from(journalEntries)
    .where(eq(journalEntries.id, entryId))
    .limit(1);
  if (!je) {
    throw new OwnershipError("سند یافت نشد یا متعلق به شما نیست.", 404, "NOT_FOUND");
  }
  if (je.userId !== user.id) {
    throw new OwnershipError("دسترسی غیرمجاز: این سند متعلق به شما نیست.", 403, "OWNERSHIP_VIOLATION");
  }
}

/**
 * Debt ownership. Debts with a NULL owner are shared/legacy planning records
 * (consistent with the app-wide shared-record semantics); a debt owned by
 * another user is always denied.
 */
export async function assertDebtOwnership(
  debtId: string,
  user: AuthenticatedUser,
  txClient: any = db,
): Promise<void> {
  if (!debtId) return;
  const [row] = await txClient
    .select({ id: debts.id, userId: debts.userId })
    .from(debts)
    .where(eq(debts.id, debtId))
    .limit(1);
  if (!row) {
    throw new OwnershipError("بدهی انتخاب‌شده یافت نشد.", 404, "NOT_FOUND");
  }
  if (row.userId && row.userId !== user.id) {
    throw new OwnershipError("دسترسی غیرمجاز: این بدهی متعلق به شما نیست.", 403, "OWNERSHIP_VIOLATION");
  }
}

/**
 * Installment ownership — verified through its parent debt.
 */
export async function assertInstallmentOwnership(
  installmentId: string,
  user: AuthenticatedUser,
  txClient: any = db,
): Promise<void> {
  if (!installmentId) return;
  const [row] = await txClient
    .select({ id: installments.id, debtId: installments.debtId })
    .from(installments)
    .where(eq(installments.id, installmentId))
    .limit(1);
  if (!row) {
    throw new OwnershipError("قسط انتخاب‌شده یافت نشد.", 404, "NOT_FOUND");
  }
  await assertDebtOwnership(row.debtId, user, txClient);
}
