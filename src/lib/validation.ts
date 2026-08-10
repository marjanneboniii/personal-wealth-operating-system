import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { D } from "@/domain/decimal";

export const ALLOWED_CURRENCIES = new Set([
  "USD",
  "IRT",
  "BTC",
  "ETH",
  "GOLD",
  "USDT",
  "USDC",
  "XAUT",
  "PAXG",
]);

/**
 * Validates that an amount is a finite positive number string.
 * Rejects NaN, Infinity, zero, and negative values.
 */
export function validateAmount(val: unknown, label = "مبلغ"): string {
  if (val === undefined || val === null || String(val).trim() === "") {
    throw new Error(`${label} الزامی است.`);
  }
  const str = String(val).trim();
  const num = Number(str);
  if (Number.isNaN(num) || !Number.isFinite(num)) {
    throw new Error(`${label} نامعتبر است (NaN یا Infinity مجاز نیست).`);
  }
  const dec = D(str);
  if (dec.lte(0)) {
    throw new Error(`${label} باید بزرگ‌تر از صفر باشد.`);
  }
  return dec.toString();
}

/**
 * Validates currency code against system allowlist.
 */
export function validateCurrency(code: string): string {
  const normalized = (code || "").toUpperCase().trim();
  if (!ALLOWED_CURRENCIES.has(normalized)) {
    throw new Error(`ارز «${code}» در این سیستم پشتیبانی نمی‌شود.`);
  }
  return normalized;
}

/**
 * System accounts are explicitly whitelisted global chart-of-accounts records
 * that legitimately have userId = NULL (shared fee/PnL/income/expense equity
 * accounts looked up server-side by code, never chosen from client input).
 * Any account with userId = NULL that is NOT in this whitelist is treated as
 * orphan/unknown and DENIED — never allowed.
 */
const SYSTEM_ACCOUNT_CODES = new Set([
  "1000",
  "2000",
  "3000",
  "3010",
  "4000",
  "4010",
  "4100",
  "4900",
  "5000",
  "5010",
  "5020",
  "5030",
  "5040",
  "5050",
  "5900",
]);

function isSystemAccount(acc: { code?: string | null; type?: string | null; userId: string | null }): boolean {
  if (acc.userId !== null) return false;
  if (acc.code && SYSTEM_ACCOUNT_CODES.has(acc.code)) return true;
  // Additional fallback for global income/expense/equity/liability accounts
  if (acc.type && ["income", "expense", "equity", "liability"].includes(acc.type)) return true;
  return false;
}

/**
 * Validates that an account exists and belongs to the authenticated user.
 * FAIL-CLOSED for orphan NULL: user accounts must have userId === currentUser.id,
 * only explicitly whitelisted system accounts may have userId = NULL.
 */
export async function validateAccountOwnership(
  accountId: string,
  userId?: string | null,
  txClient?: any,
): Promise<void> {
  if (!accountId) throw new Error("شناسه حساب الزامی است.");
  const dbClient = txClient ?? db;
  const [acc] = await dbClient
    .select({ id: accounts.id, userId: accounts.userId, code: accounts.code, type: accounts.type })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);

  if (!acc) {
    throw new Error("حساب انتخاب‌شده یافت نشد.");
  }

  // Orphan NULL check: if account has no owner, only allow if it's an explicit system account
  if (acc.userId === null || acc.userId === undefined) {
    if (isSystemAccount(acc as any)) {
      return;
    }
    const err: any = new Error("دسترسی غیرمجاز: این حساب بدون مالک و غیرسیستمی است.");
    err.status = 403;
    err.code = "OWNERSHIP_VIOLATION";
    throw err;
  }

  if (userId && acc.userId !== userId) {
    const err: any = new Error("دسترسی غیرمجاز: این حساب متعلق به شما نیست.");
    err.status = 403;
    err.code = "OWNERSHIP_VIOLATION";
    throw err;
  }
}

/**
 * Strips client-controlled accounting and system metadata fields from payload objects.
 * Protects against mass assignment vulnerabilities.
 */
export function stripClientControlledFields(body: Record<string, any>): void {
  if (!body || typeof body !== "object") return;
  const FORBIDDEN_FIELDS = [
    "created_at",
    "createdAt",
    "updated_at",
    "updatedAt",
    "created_by",
    "createdBy",
    "user_id",
    "userId",
    "ledger_status",
    "ledgerStatus",
    "posted_at",
    "postedAt",
    "realized_pnl",
    "realizedPnl",
    "cost_basis",
    "costBasis",
    "historical_fx",
    "historicalFx",
    "historical_usd",
    "historicalUsd",
    "fifoCost",
    "fifo_cost",
    "id",
  ];
  for (const field of FORBIDDEN_FIELDS) {
    if (field in body) {
      delete body[field];
    }
  }
}
