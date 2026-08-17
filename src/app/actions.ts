"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  accounts,
  assets,
  budgets,
  debts,
  entryFxSnapshots,
  entryReviews,
  events,
  goals,
  installments,
  journalEntries,
  plannedTransactions,
  prices,
  snapshotLines,
  snapshots,
  users,
  wallets,
} from "@/db/schema";
import { getLatestUsdIrtRateForUser, getLatestUsdIrtRate } from "@/lib/fx";
import { getCurrentUser } from "@/lib/auth";
import { isAdminOrOwner } from "@/lib/authGuard";
import { validateAccountOwnership } from "@/lib/validation";
import {
  assertDebtOwnership,
  assertInstallmentOwnership,
  assertJournalEntryOwnership,
} from "@/lib/accessControl";
import { recordAuditEvent } from "@/lib/audit";
import { D, Decimal } from "@/domain/decimal";
import {
  postEntry,
  recordBuy,
  recordExpense,
  recordIncome,
  recordSell,
  recordTransfer,
  reverseEntry,
} from "@/features/ledger/service";
import {
  addCustomCategory,
  ensureCategoryCatalog,
  ensureReserveAccount,
  getCategoryById,
  getMiscCategory,
} from "@/features/categories/service";
import { executePlanned, payInstallment } from "@/features/planning/service";
import { completeSetup, getSetupState } from "@/features/setup/service";
import { registerMoneyAccount } from "@/features/accounts/service";
import { createPortfolioSnapshot, getCurrentNetWorth, getPortfolioValuation } from "@/features/portfolio/service";
import { getAnalyticsSummary } from "@/features/analytics/service";
import { addMonthsIso, todayIso } from "@/lib/format";

export type ActionResult = { ok: boolean; message: string };

/**
 * Security boundary helper for Server Actions.
 *
 * Resolves the current session user and whether auth is enabled (any user
 * with a username exists). In legacy single-tenant mode (no auth users) the
 * app keeps working without login; once auth users exist, user-specific data
 * access requires a session — "no userId -> DENY", never global data.
 *
 * Authorization decisions live HERE (Action boundary); the accounting core
 * (postEntry / FIFO / ledger) is invoked unchanged afterwards.
 *
 * FAIL-CLOSED: Any Database/Auth/Session error is DENIED (throws), never
 * converted to anonymous/null and continued.
 */
async function getAuthContext(): Promise<{ user: any; hasAuth: boolean }> {
  // getCurrentUser throws on DB/auth error -> fail-closed (propagates as 500/DENY)
  const user = await getCurrentUser();
  let hasAuth = false;
  try {
    const [row] = await db.select().from(users).where(isNotNull(users.username)).limit(1);
    hasAuth = !!row;
  } catch (e: any) {
    // DB error -> DENY, never anonymous
    throw new Error("Authentication/Database error: Access denied");
  }
  return { user, hasAuth };
}

/**
 * Fail-closed helper for Server Actions that mutate data.
 * Returns the authenticated user (or null in legacy single-tenant mode where
 * no auth users exist). Throws on DB/auth errors or when auth is required
 * but no session exists.
 */
async function requireAuthenticatedUserStrict(): Promise<any> {
  const { user, hasAuth } = await getAuthContext();
  if (hasAuth && !user) {
    throw new Error("Unauthorized: login required");
  }
  return user;
}

function loginRequiredMessage() {
  return "برای این عملیات ابتدا وارد شوید.";
}

/**
 * Uniform fail-closed auth guard for Server Actions.
 * Returns { user } on success, or { error } string if auth is required but
 * no session exists. Throws (DENY) on DB/auth errors — never returns
 * anonymous success.
 */
async function guardActionAuth(): Promise<{ user: any; hasAuth: boolean } | { error: string }> {
  try {
    const ctx = await getAuthContext();
    if (ctx.hasAuth && !ctx.user) {
      return { error: loginRequiredMessage() };
    }
    return ctx;
  } catch (e: any) {
    // Propagate login-required as error string, but DB/auth errors throw DENY
    if (e?.message === "Unauthorized: login required" || e?.message?.includes("وارد شوید")) {
      return { error: e.message.includes("وارد شوید") ? e.message : loginRequiredMessage() };
    }
    if (e?.message?.includes("Authentication/Database error")) {
      throw e;
    }
    // Any other unexpected error -> fail-closed DENY
    throw new Error("Authentication/Database error: Access denied");
  }
}

/** Presentation flow confirms creation before writing the reference record. */
export async function createWalletAction(input: { name: string; kind: string; note?: string }): Promise<ActionResult> {
  let user: any = null;
  try {
    const ctx = await getAuthContext();
    if (ctx.hasAuth && !ctx.user) return { ok: false, message: loginRequiredMessage() };
    user = ctx.user;
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      return { ok: false, message: "خطای احراز هویت/پایگاه داده: دسترسی رد شد" };
    }
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
    return { ok: false, message: "خطای احراز هویت: دسترسی رد شد" };
  }

  const allowed = ["bank", "exchange", "hot", "cold", "cash", "fund"];
  const name = input.name.trim();
  if (!name || !allowed.includes(input.kind)) return { ok: false, message: "نام و نوع حساب را بررسی کنید." };
  await db.insert(wallets).values({ name, kind: input.kind, note: input.note?.trim() || null, userId: user?.id ?? null } as any);
  revalidatePath("/accounts");
  return { ok: true, message: "حساب جدید با موفقیت ایجاد شد." };
}

const moneyAccountSchema = z.object({
  name: z.string().trim().min(2, "نام حساب را وارد کنید"),
  kind: z.enum(["bank", "cash", "exchange", "hot", "cold", "fund"]),
  assetId: z.string().min(1, "ارز / دارایی حساب را انتخاب کنید"),
  openingQty: z.string().optional().default(""),
  openingUnitPriceUsd: z.string().optional().default(""),
  openingDate: z.string().optional().default(""),
  note: z.string().optional().default(""),
});

/**
 * Registers a user-defined bank account / cash box / wallet together with its
 * opening balance and links it into the ledger (see
 * `registerMoneyAccount`). The accounting core is never touched — this action
 * only guards auth/ownership at the boundary and delegates the write.
 */
export async function createMoneyAccountAction(input: unknown): Promise<ActionResult> {
  let user: any = null;
  try {
    const ctx = await getAuthContext();
    if (ctx.hasAuth && !ctx.user) return { ok: false, message: loginRequiredMessage() };
    user = ctx.user;
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      return { ok: false, message: "خطای احراز هویت/پایگاه داده: دسترسی رد شد" };
    }
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
    return { ok: false, message: "خطای احراز هویت: دسترسی رد شد" };
  }

  try {
    const v = moneyAccountSchema.parse(input);
    await registerMoneyAccount({
      name: v.name,
      kind: v.kind,
      assetId: v.assetId,
      openingQty: v.openingQty || undefined,
      openingUnitPriceUsd: v.openingUnitPriceUsd || undefined,
      openingDate: v.openingDate || undefined,
      note: v.note || undefined,
      // SECURITY: tenant identity comes ONLY from the session, never the client.
      userId: user?.id ?? undefined,
    });
    refreshAll();
    return { ok: true, message: "حساب با موفقیت ایجاد و به دفترکل متصل شد." };
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : "خطا";
    return { ok: false, message: msg };
  }
}

function refreshAll() {
  for (const p of [
    "/",
    "/portfolio",
    "/crypto",
    "/net-worth",
    "/ledger",
    "/transactions",
    "/cash-flow",
    "/planning",
    "/budgets",
    "/goals",
    "/debts",
    "/installments",
    "/reports",
    "/audit",
    "/accounts",
    "/settings",
  ]) {
    revalidatePath(p);
  }
}

/** A human reviewed a record — metadata only, ledger stays immutable. */
export async function markReviewedAction(entryId: string, reviewed: boolean): Promise<ActionResult> {
  // Auth guard — FAIL-CLOSED: DB/auth errors DENY, never anonymous
  let user: any = null;
  try {
    const ctx = await getAuthContext();
    if (ctx.hasAuth && !ctx.user) return { ok: false, message: loginRequiredMessage() };
    user = ctx.user;
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      return { ok: false, message: "خطای احراز هویت/پایگاه داده: دسترسی رد شد" };
    }
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
    return { ok: false, message: "خطای احراز هویت: دسترسی رد شد" };
  }

  try {
    if (user) {
      // SECURITY: strict ownership — review state may only be changed on the
      // current user's own entries (NULL-owner entries are denied).
      try {
        await assertJournalEntryOwnership(entryId, user);
      } catch (e: any) {
        return { ok: false, message: e?.message || "دسترسی غیرمجاز." };
      }
    }
    if (reviewed) {
      await db.insert(entryReviews).values({ entryId }).onConflictDoNothing();
    } else {
      await db.delete(entryReviews).where(eq(entryReviews.entryId, entryId));
    }
    revalidatePath("/transactions");
    revalidatePath("/audit");
    return { ok: true, message: reviewed ? "رکورد تأیید شد." : "رکورد به حالت «بررسی‌نشده» برگشت." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

export async function markManyReviewedAction(entryIds: string[]): Promise<ActionResult> {
  // Auth guard — FAIL-CLOSED
  let user: any = null;
  try {
    const ctx = await getAuthContext();
    if (ctx.hasAuth && !ctx.user) return { ok: false, message: loginRequiredMessage() };
    user = ctx.user;
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      return { ok: false, message: "خطای احراز هویت/پایگاه داده: دسترسی رد شد" };
    }
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
    return { ok: false, message: "خطای احراز هویت: دسترسی رد شد" };
  }

  try {
    // SECURITY: verify ownership of every entry in the batch. If any entry is
    // missing or belongs to another user (or has no owner), the whole batch
    // is denied — never partially applied.
    if (user && entryIds.length) {
      const rows = await db
        .select({ id: journalEntries.id, userId: journalEntries.userId })
        .from(journalEntries)
        .where(inArray(journalEntries.id, entryIds));
      const allOwned = rows.length === entryIds.length && rows.every((r) => r.userId === user.id);
      if (!allOwned) {
        return { ok: false, message: "دسترسی غیرمجاز: برخی اسناد متعلق به شما نیستند." };
      }
    }
    if (entryIds.length) {
      await db
        .insert(entryReviews)
        .values(entryIds.map((entryId) => ({ entryId })))
        .onConflictDoNothing();
    }
    revalidatePath("/transactions");
    revalidatePath("/audit");
    return { ok: true, message: `${entryIds.length} رکورد تأیید شد.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

const budgetSchema = z.object({
  name: z.string().min(2, "نام بودجه را وارد کنید"),
  accountId: z.string().uuid("حساب هزینه را انتخاب کنید"),
  amountBase: z.string().min(1, "مبلغ بودجه را وارد کنید"),
  periodStart: z.string().min(8),
  periodEnd: z.string().min(8),
});

export async function createBudgetAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let user: any = null;
  try {
    const ctx = await getAuthContext();
    if (ctx.hasAuth && !ctx.user) return { ok: false, message: loginRequiredMessage() };
    user = ctx.user;
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      return { ok: false, message: "خطای احراز هویت/پایگاه داده: دسترسی رد شد" };
    }
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
    return { ok: false, message: "خطای احراز هویت: دسترسی رد شد" };
  }

  try {
    const v = budgetSchema.parse(Object.fromEntries(fd) as Record<string, string>);
    if (v.periodEnd < v.periodStart) throw new Error("پایان دوره باید بعد از شروع آن باشد");
    // SECURITY: client-provided account reference must belong to the user.
    if (user) await validateAccountOwnership(v.accountId, user.id);
    await db.insert(budgets).values({
      name: v.name,
      accountId: v.accountId,
      amountBase: D(v.amountBase).toString(),
      periodStart: v.periodStart,
      periodEnd: v.periodEnd,
      userId: user?.id ?? null,
    } as any);
    refreshAll();
    return { ok: true, message: "بودجه ایجاد شد." };
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : "خطا";
    return { ok: false, message: msg };
  }
}

async function latestPrice(assetId: string): Promise<string> {
  const row = await db
    .select({ p: prices.priceBase })
    .from(prices)
    .where(eq(prices.assetId, assetId))
    .orderBy(desc(prices.asOf))
    .limit(1);
  return row[0]?.p ?? "1";
}

async function accountAsset(accountId: string): Promise<string> {
  const row = await db.select({ a: accounts.assetId }).from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!row[0]?.a) throw new Error("حساب انتخاب‌شده به هیچ دارایی متصل نیست");
  return row[0].a;
}

const txSchema = z.object({
  type: z.enum(["transfer", "buy", "sell", "income", "expense", "debt_repayment"]),
  entryDate: z.string().min(8),
  description: z.string().min(2, "شرح را وارد کنید"),
  // Optional at the schema level — each transaction type enforces the exact
  // accounts it needs below (e.g. non-cash expenses and debt repayments with
  // a ledger-backed liability do not need all account fields).
  primaryAccountId: z.string().optional(),
  counterAccountId: z.string().optional(),
  /** leaf of the hierarchical expense category tree (expense entries) */
  categoryId: z.string().optional(),
  amount: z.string().min(1).optional(),
  irtAmount: z.string().optional(),
  fxRate: z.string().optional(),
  fxRateDate: z.string().optional(),
  debtId: z.string().optional(),
  installmentId: z.string().optional(),
  quantity: z.string().optional(),
  fee: z.string().optional(),
});

function isUuid(v: string | undefined): v is string {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export async function createTransactionAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  // Auth guard — FAIL-CLOSED: DB/auth errors DENY, never anonymous
  try {
    const ctx = await getAuthContext();
    if (ctx.hasAuth && !ctx.user) return { ok: false, message: loginRequiredMessage() };
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      return { ok: false, message: "خطای احراز هویت/پایگاه داده: دسترسی رد شد" };
    }
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
    return { ok: false, message: "خطای احراز هویت: دسترسی رد شد" };
  }

  try {
    const raw = Object.fromEntries(fd) as Record<string, string>;
    const idempotencyKey = String(raw.idempotencyKey || fd.get("idempotencyKey") || "").trim() || undefined;
    // Support both legacy 'amount' (USD) and new 'irtAmount' (IRT) — IRT is reference, USD is computed via server rate (freeze)
    const input = txSchema.parse(raw);
    // Auth check for ledger writes — FAIL-CLOSED
    let authUser: any = null;
    try {
      const ctx2 = await getAuthContext();
      if (ctx2.hasAuth && !ctx2.user) throw new Error("برای ثبت تراکنش ابتدا وارد شوید.");
      authUser = ctx2.user;
    } catch (e: any) {
      if (e?.message?.includes("Authentication/Database error")) throw e;
      throw e;
    }

    // SECURITY (Authorization boundary): validate ownership of EVERY
    // client-provided account / reference id BEFORE the accounting service is
    // invoked. System-derived accounts (fee 5040 / PnL 4100 / reserve 3200
    // looked up by code server-side) are shared chart-of-accounts records and
    // never come from the client. On violation we throw (403 semantics) and
    // NO journal entry, posting, FIFO lot or balance is created or mutated.
    if (authUser) {
      if (isUuid(input.primaryAccountId)) await validateAccountOwnership(input.primaryAccountId, authUser.id);
      if (isUuid(input.counterAccountId)) await validateAccountOwnership(input.counterAccountId, authUser.id);
      if (input.installmentId) {
        await assertInstallmentOwnership(input.installmentId, authUser);
      } else if (input.debtId) {
        await assertDebtOwnership(input.debtId, authUser);
      }
    }
    // Fetch server-side frozen rate — per-user if logged in, single source of truth, not trusting client
    const fxSnap = authUser ? await getLatestUsdIrtRateForUser(authUser.id) : await getLatestUsdIrtRate();
    const serverRate = D(fxSnap.rate);
    if (serverRate.lte(0)) throw new Error("نرخ دلار ثبت نشده است. ابتدا نرخ را در تنظیمات ثبت کنید.");

    let usdAmount: any;
    let irtAmountStr: string;
    if (input.irtAmount && D(input.irtAmount).gt(0)) {
      irtAmountStr = D(input.irtAmount).toFixed(0);
      usdAmount = D(irtAmountStr).div(serverRate);
    } else if (input.amount && D(input.amount).gt(0)) {
      // legacy USD path — compute IRT for snapshot as USD * rate
      usdAmount = D(input.amount);
      irtAmountStr = usdAmount.mul(serverRate).toFixed(0);
    } else {
      throw new Error("مبلغ باید بزرگ‌تر از صفر باشد");
    }
    if (usdAmount.lte(0)) throw new Error("مبلغ باید بزرگ‌تر از صفر باشد");
    const amount = usdAmount; // keep variable name for downstream logic
    // Fee is entered in IRT (toman) — convert to USD for ledger
    let feeUsd = "0";
    if (input.fee && D(input.fee).gt(0)) {
      // fee field from form is IRT
      feeUsd = D(input.fee).div(serverRate).toString();
    }
    const fee = feeUsd;
    // Debt/Installment linkage — validate before ledger write (prevent duplicate, exceed outstanding, already paid)
    let linkedDebt: any = null;
    let linkedInst: any = null;
    if (input.installmentId) {
      const [row] = await db.select().from(installments).where(eq(installments.id, input.installmentId)).limit(1);
      if (!row) throw new Error("قسط انتخاب‌شده یافت نشد");
      if (row.status === "paid") throw new Error("این قسط قبلاً به‌طور کامل پرداخت شده است — جلوگیری از ثبت تکراری");
      linkedInst = row;
      const [debtRow] = await db.select().from(debts).where(eq(debts.id, row.debtId)).limit(1);
      if (debtRow) linkedDebt = debtRow;
      // Check amount not exceed installment amount (allow small tolerance)
      const instAmt = D(row.amountBase);
      if (amount.gt(instAmt.mul("1.05"))) throw new Error("مبلغ واردشده بیشتر از مبلغ قسط است");
    } else if (input.debtId) {
      const [debtRow] = await db.select().from(debts).where(eq(debts.id, input.debtId)).limit(1);
      if (!debtRow) throw new Error("بدهی انتخاب‌شده یافت نشد");
      if (debtRow.status === "settled") throw new Error("این بدهی قبلاً تسویه شده است");
      linkedDebt = debtRow;
    }
    if (input.type === "debt_repayment" && !linkedDebt) {
      throw new Error("برای بازپرداخت بدهی، ابتدا یک بدهی یا قسط را انتخاب کنید");
    }

    // Expense category resolution (reporting dimension, never touches the
    // double-entry balance). Missing category falls back to «متفرقه» — the
    // designated last-resort category — so legacy callers keep working.
    let category: { id: string; nature: string } | null = null;
    if (input.type === "expense") {
      await ensureCategoryCatalog();
      if (input.categoryId && isUuid(input.categoryId)) {
        const found = await getCategoryById(input.categoryId, authUser?.id);
        if (!found) throw new Error("دسته هزینه انتخاب‌شده معتبر یا فعال نیست");
        if (found.level !== 1) throw new Error("دسته هزینه باید یک زیردسته (برگ) باشد، نه دسته اصلی");
        category = found;
      } else {
        category = await getMiscCategory();
      }
    }

    // Wrap ledger write + FX snapshot + debt linkage in one atomic transaction
    const entryId = await db.transaction(async (tx) => {
      let entry: { id: string } | null = null;

      if (input.type === "income" || input.type === "expense") {
        if (!isUuid(input.counterAccountId)) throw new Error("حساب مقابل را انتخاب کنید");
        const categoryId = category?.id ?? null;

        if (category?.nature === "non_cash") {
          // Non-cash expense (depreciation / reserve): an expense in reports
          // but NEVER a cash outflow — the counter leg is the system reserve
          // (equity) account, so no wallet/account balance moves.
          const reserve = await ensureReserveAccount(authUser?.id ?? null, tx);
          if (!reserve.assetId) throw new Error("حساب ذخیره استهلاک به دارایی پایه متصل نیست");
          const price = await latestPrice(reserve.assetId);
          const qty = amount.div(price).toString();
          entry = await postEntry(
            {
              entryDate: input.entryDate,
              type: "expense",
              description: input.description,
              categoryId,
              userId: authUser?.id ?? undefined,
              idempotencyKey,
              postings: [
                {
                  accountId: reserve.id,
                  assetId: reserve.assetId,
                  quantity: D(qty).neg().toString(),
                  baseValue: amount.neg().toString(),
                  memo: "ثبت غیرنقدی (استهلاک/ذخیره)",
                },
                {
                  accountId: input.counterAccountId,
                  assetId: reserve.assetId,
                  quantity: qty,
                  baseValue: amount.toString(),
                },
              ],
            },
            tx,
          );
        } else {
          if (!isUuid(input.primaryAccountId)) throw new Error("حساب مبدأ را انتخاب کنید");
          const cashAsset = await accountAsset(input.primaryAccountId);
          const price = await latestPrice(cashAsset);
          const qty = amount.div(price).toString();
          const cmd = {
            entryDate: input.entryDate,
            description: input.description,
            cashAccountId: input.primaryAccountId,
            categoryAccountId: input.counterAccountId,
            assetId: cashAsset,
            quantity: qty,
            baseValue: amount.toString(),
            categoryId,
            userId: authUser?.id ?? undefined,
            idempotencyKey,
          };
          if (input.type === "income") entry = await recordIncome(cmd, tx);
          else entry = await recordExpense(cmd, tx);
        }
      } else if (input.type === "debt_repayment") {
        // Debt principal repayment — by design NOT an expense:
        //  - debt WITH a liability account: cash ↓ / liability ↓ (net worth
        //    effect only, excluded from every expense report);
        //  - planning-only debt (no liability account yet): the outflow is
        //    booked against the chosen expense account so money stays
        //    tracked, but the entry type remains 'debt_repayment' and is
        //    excluded from expense/cash-flow aggregations.
        if (!isUuid(input.primaryAccountId)) throw new Error("حساب مبدأ را انتخاب کنید");
        const cashAsset = await accountAsset(input.primaryAccountId);
        const price = await latestPrice(cashAsset);
        const qty = amount.div(price).toString();
        const lines = [
          {
            accountId: input.primaryAccountId,
            assetId: cashAsset,
            quantity: D(qty).neg().toString(),
            baseValue: amount.neg().toString(),
          },
        ];
        if (linkedDebt?.accountId) {
          const debtAsset = await accountAsset(linkedDebt.accountId);
          const debtPrice = await latestPrice(debtAsset);
          lines.push({
            accountId: linkedDebt.accountId,
            assetId: debtAsset,
            quantity: amount.div(debtPrice).toString(),
            baseValue: amount.toString(),
          } as any);
          entry = await postEntry(
            {
              entryDate: input.entryDate,
              type: "debt_repayment",
              description: input.description,
              postings: lines as any,
              userId: authUser?.id ?? undefined,
              idempotencyKey,
            },
            tx,
          );
        } else {
          if (!isUuid(input.counterAccountId)) {
            throw new Error("این بدهی حساب بدهی جداگانه ندارد؛ حساب هزینه مقابل را انتخاب کنید");
          }
          lines.push({
            accountId: input.counterAccountId,
            assetId: cashAsset,
            quantity: qty,
            baseValue: amount.toString(),
          } as any);
          entry = await postEntry(
            {
              entryDate: input.entryDate,
              type: "debt_repayment",
              description: input.description,
              postings: lines as any,
              userId: authUser?.id ?? undefined,
              idempotencyKey,
            },
            tx,
          );
        }
      } else if (input.type === "transfer") {
        if (!isUuid(input.primaryAccountId)) throw new Error("حساب مبدأ را انتخاب کنید");
        if (!isUuid(input.counterAccountId)) throw new Error("حساب مقابل را انتخاب کنید");
        const assetId = await accountAsset(input.primaryAccountId);
        const price = await latestPrice(assetId);
        const qty = input.quantity && D(input.quantity).gt(0) ? input.quantity : amount.div(price).toString();
        entry = await recordTransfer(
          {
            entryDate: input.entryDate,
            description: input.description,
            fromAccountId: input.primaryAccountId,
            toAccountId: input.counterAccountId,
            assetId,
            quantity: qty,
            unitPrice: price,
            feeBase: fee,
            feeAccountId: (await tx.select().from(accounts).where(eq(accounts.code, "5040")).limit(1))[0]?.id,
            userId: authUser?.id ?? undefined,
            idempotencyKey,
          },
          tx,
        );
      } else {
        if (!isUuid(input.primaryAccountId)) throw new Error("حساب مبدأ را انتخاب کنید");
        if (!isUuid(input.counterAccountId)) throw new Error("حساب مقابل را انتخاب کنید");
        const assetId = await accountAsset(input.primaryAccountId);
        const cashAssetId = await accountAsset(input.counterAccountId);
        const cashPrice = await latestPrice(cashAssetId);
        const qty = input.quantity && D(input.quantity).gt(0) ? input.quantity : "0";
        if (D(qty).lte(0)) throw new Error("مقدار دارایی را وارد کنید");
        const cashQuantity = amount.div(cashPrice).toString();
        const feeAccountId = (await tx.select().from(accounts).where(eq(accounts.code, "5040")).limit(1))[0]?.id ?? null;
        const common = {
          entryDate: input.entryDate,
          description: input.description,
          assetAccountId: input.primaryAccountId,
          cashAccountId: input.counterAccountId,
          assetId,
          quantity: qty,
          cashAssetId,
          cashQuantity,
          baseValue: amount.toString(),
          feeBase: fee,
          feeAccountId,
          userId: authUser?.id ?? undefined,
          idempotencyKey,
        };
        if (input.type === "buy") entry = await recordBuy(common, tx);
        else {
          const pnl = (await tx.select().from(accounts).where(eq(accounts.code, "4100")).limit(1))[0];
          if (!pnl) throw new Error("حساب سود سرمایه‌ای تعریف نشده است");
          entry = await recordSell({ ...common, pnlAccountId: pnl.id }, tx);
        }
      }

      if (!entry?.id) throw new Error("خطا در ایجاد سند حسابداری");

      // Historical immutability: freeze IRT, USD, rate at commit time
      await tx.insert(entryFxSnapshots).values({
        entryId: entry.id,
        irtAmount: D(irtAmountStr).toString(),
        usdAmount: amount.toString(),
        fxRate: serverRate.toString(),
        rateSource: fxSnap.source,
        rateDate: fxSnap.effectiveDate,
      });

      // Manual entries are reviewed by construction — a human just made them.
      await tx.insert(entryReviews).values({ entryId: entry.id }).onConflictDoNothing();

      // Debt / Installment linkage — update status within same transaction (Transactional Integrity)
      if (linkedInst) {
        await tx
          .update(installments)
          .set({ status: "paid", paidAt: input.entryDate, paidEntryId: entry.id })
          .where(eq(installments.id, linkedInst.id));
        // Check if debt settled
        const pending = await tx
          .select({ c: sql<number>`count(*)::int` })
          .from(installments)
          .where(and(eq(installments.debtId, linkedInst.debtId), eq(installments.status, "pending")));
        if ((pending[0]?.c ?? 0) === 0) {
          await tx.update(debts).set({ status: "settled" }).where(eq(debts.id, linkedInst.debtId));
        }
      } else if (linkedDebt && input.type === "expense") {
        // For direct debt payment (not installment), if amount covers outstanding, mark settled?
        // Outstanding is derived from ledger, but we can mark settled if no pending installments left
        const pending = await tx
          .select({ c: sql<number>`count(*)::int` })
          .from(installments)
          .where(and(eq(installments.debtId, linkedDebt.id), eq(installments.status, "pending")));
        if ((pending[0]?.c ?? 0) === 0) {
          // If no installments, check if payment amount >= principal? For simplicity, if user explicitly paid debt via explorer and it has no installments, mark settled when they pay
          // We don't auto-settle based on amount; rely on installments
        }
      }

      return entry.id;
    });

    refreshAll();
    return { ok: true, message: "سند با موفقیت در دفترکل ثبت شد. نرخ دلار و مبالغ تاریخی منجمد شدند." + (linkedInst || linkedDebt ? " وضعیت بدهی/قسط به‌روزرسانی شد." : "") };
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : "خطای ناشناخته";
    return { ok: false, message: msg };
  }
}

/**
 * Extensibility of the category tree: users can add their own sub-category
 * under any active top-level group. Overlap prevention (duplicate sibling
 * names) is enforced by the category service.
 */
export async function createCategoryAction(input: {
  name: string;
  parentId: string;
}): Promise<ActionResult & { id?: string }> {
  let user: any = null;
  try {
    const ctx = await getAuthContext();
    if (ctx.hasAuth && !ctx.user) return { ok: false, message: loginRequiredMessage() };
    user = ctx.user;
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      return { ok: false, message: "خطای احراز هویت/پایگاه داده: دسترسی رد شد" };
    }
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
    return { ok: false, message: "خطای احراز هویت: دسترسی رد شد" };
  }

  try {
    const created = await addCustomCategory(user?.id ?? null, input);
    revalidatePath("/new");
    revalidatePath("/transactions");
    revalidatePath("/cash-flow");
    return { ok: true, message: "زیردسته جدید با موفقیت ایجاد شد.", id: created.id };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

export async function reverseEntryAction(entryId: string): Promise<ActionResult> {
  // Auth guard — FAIL-CLOSED
  let user: any = null;
  try {
    const ctx = await getAuthContext();
    if (ctx.hasAuth && !ctx.user) return { ok: false, message: loginRequiredMessage() };
    user = ctx.user;
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      return { ok: false, message: "خطای احراز هویت/پایگاه داده: دسترسی رد شد" };
    }
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
    return { ok: false, message: "خطای احراز هویت: دسترسی رد شد" };
  }

  try {
    if (user) {
      // SECURITY: strict ownership for sensitive financial operations.
      // `userId === currentUser.id` is a hard condition — an entry owned by
      // someone else OR an entry with no owner (NULL) is DENIED, never
      // allowed. The accounting core (reverseEntry) is invoked unchanged and
      // only after this check passes.
      try {
        await assertJournalEntryOwnership(entryId, user);
      } catch (e: any) {
        return { ok: false, message: e?.message || "دسترسی غیرمجاز." };
      }
    }
    await reverseEntry(entryId);
    refreshAll();
    return { ok: true, message: "سند معکوس ثبت و سند اصلی ابطال شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

export async function executePlanAction(id: string): Promise<ActionResult> {
  // Auth guard — FAIL-CLOSED
  let user: any = null;
  try {
    const ctx = await getAuthContext();
    if (ctx.hasAuth && !ctx.user) return { ok: false, message: loginRequiredMessage() };
    user = ctx.user;
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      return { ok: false, message: "خطای احراز هویت/پایگاه داده: دسترسی رد شد" };
    }
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
    return { ok: false, message: "خطای احراز هویت: دسترسی رد شد" };
  }

  try {
    if (user) {
      const [plan] = await db.select().from(plannedTransactions).where(eq(plannedTransactions.id, id)).limit(1);
      if (plan?.userId && plan.userId !== user.id) {
        return { ok: false, message: "دسترسی غیرمجاز: این برنامه متعلق به شما نیست." };
      }
      // SECURITY: executing a plan posts to the ledger using the plan's
      // accounts — validate ownership of those accounts before the
      // accounting service runs.
      if (plan?.fromAccountId) await validateAccountOwnership(plan.fromAccountId, user.id);
      if (plan?.toAccountId) await validateAccountOwnership(plan.toAccountId, user.id);
    }
    await executePlanned(id);
    refreshAll();
    return { ok: true, message: "برنامه اجرا شد و به دفترکل رفت." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

export async function payInstallmentAction(id: string, cashAccountId: string): Promise<ActionResult> {
  // Auth guard — FAIL-CLOSED
  let user: any = null;
  try {
    const ctx = await getAuthContext();
    if (ctx.hasAuth && !ctx.user) return { ok: false, message: loginRequiredMessage() };
    user = ctx.user;
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      return { ok: false, message: "خطای احراز هویت/پایگاه داده: دسترسی رد شد" };
    }
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
    return { ok: false, message: "خطای احراز هویت: دسترسی رد شد" };
  }

  try {
    if (user) {
      const [instRow] = await db
        .select({ inst: installments, debt: debts })
        .from(installments)
        .innerJoin(debts, eq(debts.id, installments.debtId))
        .where(eq(installments.id, id))
        .limit(1);
      if (instRow?.debt?.userId && instRow.debt.userId !== user.id) {
        return { ok: false, message: "دسترسی غیرمجاز: این بدهی متعلق به شما نیست." };
      }
      // SECURITY: the cash account comes from the client — it must belong to
      // the current user before the installment payment posts to the ledger.
      await validateAccountOwnership(cashAccountId, user.id);
    }
    // SECURITY (M-03): tenant id flows into the service so ownership is also
    // verified at the DB query level inside the atomic payment transaction.
    await payInstallment(id, cashAccountId, user?.id ?? undefined);
    refreshAll();
    return { ok: true, message: "قسط پرداخت و مانده بدهی به‌روزرسانی شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

const debtSchema = z.object({
  title: z.string().trim().min(2, "عنوان بدهی را وارد کنید").max(160),
  creditor: z.string().trim().min(2, "نام بستانکار را وارد کنید").max(160),
  principalIrt: z.string().min(1, "اصل بدهی را وارد کنید"),
  interestRate: z.string().optional().default("0"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ شروع را انتخاب کنید"),
  installmentCount: z.string().optional().default("0"),
  installmentIrt: z.string().optional().default(""),
  firstDueDate: z.string().optional().default(""),
});

/**
 * Defines a debt and its repayment schedule in the planning layer.
 *
 * Deliberately does not call postEntry(): defining a future obligation is not
 * a cash movement. The immutable ledger changes only when the user records an
 * actual financial transaction or pays an installment through its existing
 * accounting path.
 */
export async function createDebtAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const { users: usersTable } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const user = await getCurrentUser();
    const [hasAuth] = await db.select().from(usersTable).where(isNotNull(usersTable.username)).limit(1);
    if (hasAuth && !user) return { ok: false, message: "برای تعریف بدهی ابتدا وارد شوید." };

    const raw = Object.fromEntries(fd) as Record<string, string>;
    const value = debtSchema.parse({
      title: raw.title ?? "",
      creditor: raw.creditor ?? "",
      principalIrt: raw.principalIrt ?? "",
      interestRate: raw.interestRate ?? "0",
      startDate: raw.startDate ?? "",
      installmentCount: raw.installmentCount ?? "0",
      installmentIrt: raw.installmentIrt ?? "",
      firstDueDate: raw.firstDueDate ?? "",
    });

    const principalIrt = D(value.principalIrt);
    const interestRate = D(value.interestRate || "0");
    const count = Number(value.installmentCount || "0");
    if (!principalIrt.gt(0)) throw new Error("اصل بدهی باید بزرگ‌تر از صفر باشد.");
    if (interestRate.isNegative() || interestRate.gt(100)) throw new Error("نرخ سود باید بین صفر تا ۱۰۰ درصد باشد.");
    if (!Number.isInteger(count) || count < 0 || count > 360) throw new Error("تعداد اقساط باید بین صفر تا ۳۶۰ باشد.");
    if (count > 0 && !value.firstDueDate) throw new Error("برای بدهی قسطی، تاریخ اولین سررسید را انتخاب کنید.");
    if (count > 0 && value.firstDueDate < value.startDate) throw new Error("اولین سررسید نمی‌تواند قبل از تاریخ شروع بدهی باشد.");
    if (count > 0 && value.installmentIrt && !D(value.installmentIrt).gt(0)) throw new Error("مبلغ هر قسط باید بزرگ‌تر از صفر باشد.");

    const installmentIrt = count > 0
      ? value.installmentIrt && D(value.installmentIrt).gt(0)
        ? D(value.installmentIrt)
        : principalIrt.div(String(count))
      : D("0");
    if (count > 0 && !installmentIrt.gt(0)) throw new Error("مبلغ هر قسط باید بزرگ‌تر از صفر باشد.");

    const fx = user ? await getLatestUsdIrtRateForUser(user.id) : await getLatestUsdIrtRate();
    const rate = D(fx.rate);
    if (!rate.gt(0)) throw new Error("نرخ تبدیل دلار به تومان برای ثبت این بدهی موجود نیست.");
    const principalBase = principalIrt.div(rate).toString();
    const installmentBase = installmentIrt.div(rate).toString();

    const debt = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(debts)
        .values({
          userId: user?.id ?? null,
          creditor: value.creditor,
          title: value.title,
          principalBase,
          interestRate: interestRate.toString(),
          startDate: value.startDate,
          // A planning-only debt has no ledger account by design. This keeps
          // the accounting core untouched until a real movement is recorded.
          accountId: null,
          status: "active",
        } as any)
        .returning();

      if (count > 0 && value.firstDueDate) {
        await tx.insert(installments).values(
          Array.from({ length: count }, (_, index) => ({
            debtId: created.id,
            seq: index + 1,
            dueDate: addMonthsIso(value.firstDueDate, index),
            amountBase: installmentBase,
            status: "pending",
          })),
        );
      }
      return created;
    });

    await recordAuditEvent({
      action: "CREATE_DEBT",
      entityType: "debt",
      entityId: debt.id,
      userId: user?.id ?? null,
      result: "SUCCESS",
      payload: {
        title: value.title,
        creditor: value.creditor,
        installmentCount: count,
        rateSource: fx.source,
        rateDate: fx.effectiveDate,
        ledgerMutation: false,
      },
    });

    refreshAll();
    return {
      ok: true,
      message: count > 0
        ? `بدهی و برنامه ${count} قسط با موفقیت ثبت شد؛ دفترکل و حسابداری تغییری نکرد.`
        : "بدهی با موفقیت ثبت شد؛ دفترکل و حسابداری تغییری نکرد.",
    };
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message : e instanceof Error ? e.message : "خطا در ثبت بدهی";
    return { ok: false, message: msg };
  }
}

const goalSchema = z.object({
  name: z.string().min(2),
  targetBase: z.string().min(1),
  targetDate: z.string().optional(),
  fundAccountId: z.string().optional(),
  priority: z.string().optional(),
});

export async function createGoalAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let user: any = null;
  try {
    const ctx = await getAuthContext();
    if (ctx.hasAuth && !ctx.user) return { ok: false, message: loginRequiredMessage() };
    user = ctx.user;
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      return { ok: false, message: "خطای احراز هویت/پایگاه داده: دسترسی رد شد" };
    }
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
    return { ok: false, message: "خطای احراز هویت: دسترسی رد شد" };
  }

  try {
    const v = goalSchema.parse(Object.fromEntries(fd) as Record<string, string>);
    // SECURITY: client-provided fund account reference must belong to the user.
    if (user && v.fundAccountId) await validateAccountOwnership(v.fundAccountId, user.id);
    await db.insert(goals).values({
      name: v.name,
      targetBase: D(v.targetBase).toString(),
      targetDate: v.targetDate || null,
      fundAccountId: v.fundAccountId || null,
      priority: Number(v.priority ?? 2),
      userId: user?.id ?? null,
    } as any);
    refreshAll();
    return { ok: true, message: "هدف مالی ایجاد شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

const eventSchema = z.object({
  name: z.string().min(2),
  eventDate: z.string().min(8),
  budgetBase: z.string().min(1),
  category: z.string().default("other"),
});

export async function createEventAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let user: any = null;
  try {
    const ctx = await getAuthContext();
    if (ctx.hasAuth && !ctx.user) return { ok: false, message: loginRequiredMessage() };
    user = ctx.user;
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      return { ok: false, message: "خطای احراز هویت/پایگاه داده: دسترسی رد شد" };
    }
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
    return { ok: false, message: "خطای احراز هویت: دسترسی رد شد" };
  }

  try {
    const v = eventSchema.parse(Object.fromEntries(fd) as Record<string, string>);
    await db.insert(events).values({
      name: v.name,
      eventDate: v.eventDate,
      budgetBase: D(v.budgetBase).toString(),
      category: v.category,
      userId: user?.id ?? null,
    } as any);
    refreshAll();
    return { ok: true, message: "رویداد ثبت شد (بدون اثر روی دفترکل)." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

const planSchema = z.object({
  title: z.string().min(2),
  plannedDate: z.string().min(8),
  direction: z.enum(["inflow", "outflow"]),
  amountBase: z.string().min(1),
  fromAccountId: z.string().optional(),
  toAccountId: z.string().optional(),
  recurrence: z.enum(["none", "monthly", "yearly"]).default("none"),
});

export async function createPlannedAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let user: any = null;
  try {
    const ctx = await getAuthContext();
    if (ctx.hasAuth && !ctx.user) return { ok: false, message: loginRequiredMessage() };
    user = ctx.user;
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      return { ok: false, message: "خطای احراز هویت/پایگاه داده: دسترسی رد شد" };
    }
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
    return { ok: false, message: "خطای احراز هویت: دسترسی رد شد" };
  }

  try {
    const v = planSchema.parse(Object.fromEntries(fd) as Record<string, string>);
    // SECURITY: client-provided account references must belong to the user.
    if (user && v.fromAccountId) await validateAccountOwnership(v.fromAccountId, user.id);
    if (user && v.toAccountId) await validateAccountOwnership(v.toAccountId, user.id);
    await db.insert(plannedTransactions).values({
      title: v.title,
      plannedDate: v.plannedDate,
      direction: v.direction,
      amountBase: D(v.amountBase).toString(),
      fromAccountId: v.fromAccountId || null,
      toAccountId: v.toAccountId || null,
      recurrence: v.recurrence,
      userId: user?.id ?? null,
    } as any);
    refreshAll();
    return { ok: true, message: "تراکنش برنامه‌ریزی‌شده ثبت شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

/** Snapshot engine — freezes today's valuation for historical reporting. */
export async function takeSnapshotAction(): Promise<ActionResult> {
  let user: any = null;
  try {
    const ctx = await getAuthContext();
    if (ctx.hasAuth && !ctx.user) return { ok: false, message: loginRequiredMessage() };
    user = ctx.user;
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      return { ok: false, message: "خطای احراز هویت/پایگاه داده: دسترسی رد شد" };
    }
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
    return { ok: false, message: "خطای احراز هویت: دسترسی رد شد" };
  }

  try {
    const nw = await getCurrentNetWorth(user?.id);
    const holdings = nw.valuation.assetValuations;
    const asOf = todayIso();
    const [snap] = await db
      .insert(snapshots)
      .values({
        asOf,
        baseCurrency: "USD",
        totalAssets: D(nw.totalAssets).toFixed(6),
        totalLiabilities: D(nw.totalLiabilities).toFixed(6),
        netWorth: D(nw.netWorth).toFixed(6),
        userId: user?.id ?? null,
      } as any)
      .onConflictDoUpdate({
        target: [snapshots.userId, snapshots.asOf],
        set: {
          totalAssets: D(nw.totalAssets).toFixed(6),
          totalLiabilities: D(nw.totalLiabilities).toFixed(6),
          netWorth: D(nw.netWorth).toFixed(6),
        },
      })
      .returning();
    await db.delete(snapshotLines).where(eq(snapshotLines.snapshotId, snap.id));
    const lines = holdings.filter((h) => !D(h.quantity).isZero());
    if (lines.length) {
      await db.insert(snapshotLines).values(
        lines.map((h) => ({
          snapshotId: snap.id,
          assetId: h.assetId,
          quantity: D(h.quantity).toString(),
          priceBase: D(h.marketPrice).toString(),
          valueBase: D(h.currentValue).toString(),
        })),
      );
    }
    refreshAll();
    return { ok: true, message: "عکس لحظه‌ای ثروت امروز ثبت شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

export async function integrityCheckAction(): Promise<ActionResult> {
  // SECURITY: ledger diagnostics require a session once auth is enabled.
  const { user, hasAuth } = await getAuthContext();
  if (hasAuth && !user) return { ok: false, message: loginRequiredMessage() };

  const bad = await db.execute(sql`
    select je.id, sum(p.base_value)::text as delta
    from journal_entries je join postings p on p.entry_id = je.id
    group by je.id having abs(sum(p.base_value)) > 0.000000001
  `);
  const count = bad.rows.length;
  return count === 0
    ? { ok: true, message: "بررسی یکپارچگی: همه اسناد دفترکل تراز هستند." }
    : { ok: false, message: `${count} سند نامتوازن یافت شد!` };
}

export async function overviewCounts(_userId?: string) {
  // SECURITY: the session is the ONLY source of tenant identity — a
  // caller-provided userId is never trusted (it could name another tenant).
  // Fail-closed in multi-user mode; legacy single-tenant installs (no auth
  // users) keep the global view because there is exactly one tenant.
  const { user, hasAuth } = await getAuthContext();
  if (hasAuth && !user) {
    throw new Error("Unauthorized: login required");
  }
  const u = hasAuth ? (user as { id: string }).id : undefined;
  const [a, d, i, g] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(assets),
    db.select({ c: sql<number>`count(*)::int` }).from(debts).where(u ? eq(debts.userId, u) : sql`1=1`),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(installments)
      .innerJoin(debts, eq(debts.id, installments.debtId))
      .where(u ? eq(debts.userId, u) : sql`1=1`),
    db.select({ c: sql<number>`count(*)::int` }).from(goals).where(u ? eq(goals.userId, u) : sql`1=1`),
  ]);
  return { assets: a[0].c, debts: d[0].c, installments: i[0].c, goals: g[0].c };
}

export async function sumDecimal(values: string[]) {
  return Decimal.sum(values).toString();
}

const setupSchema = z.object({
  userName: z.string().default("مالک خانواده"),
  baseCurrency: z.string().default("USD"),
  displayCurrency: z.string().default("IRT"),
  dateCalendar: z.enum(["jalali", "gregorian"]).default("jalali"),
  digitStyle: z.enum(["fa", "en"]).default("fa"),
  bankAccountName: z.string().optional(),
  cashWalletName: z.string().optional(),
  bankOpeningBalance: z.string().optional(),
  cashOpeningBalance: z.string().optional(),
  cryptoOpeningQty: z.string().optional(),
  cryptoUnitPrice: z.string().optional(),
  goldOpeningQty: z.string().optional(),
  goldUnitPrice: z.string().optional(),
});

export async function completeSetupAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  // Auth guard — FAIL-CLOSED
  try {
    const ctx = await getAuthContext();
    if (ctx.hasAuth && !ctx.user) return { ok: false, message: loginRequiredMessage() };
    if (ctx.hasAuth && ctx.user && !isAdminOrOwner(ctx.user)) {
      return { ok: false, message: "دسترسی غیرمجاز: راه‌اندازی اولیه فقط برای مدیر امکان‌پذیر است." };
    }
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      return { ok: false, message: "خطای احراز هویت/پایگاه داده: دسترسی رد شد" };
    }
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
    return { ok: false, message: "خطای احراز هویت: دسترسی رد شد" };
  }

  try {
    const raw = Object.fromEntries(fd) as Record<string, string>;
    const input = setupSchema.parse(raw);
    await completeSetup(input);
    refreshAll();
    return { ok: true, message: "راه‌اندازی اولیه با موفقیت انجام شد." };
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : "خطای راه‌اندازی";
    return { ok: false, message: msg };
  }
}

export async function fetchSetupStateAction() {
  // SECURITY: require a session once auth is enabled — never serve state to
  // an anonymous caller in multi-user mode.
  const { user, hasAuth } = await getAuthContext();
  if (hasAuth && !user) throw new Error("Unauthorized: login required");
  return getSetupState();
}


export async function createPortfolioSnapshotAction(): Promise<ActionResult> {
  // Auth guard — FAIL-CLOSED
  let user: any = null;
  try {
    const ctx = await getAuthContext();
    if (ctx.hasAuth && !ctx.user) return { ok: false, message: loginRequiredMessage() };
    user = ctx.user;
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      return { ok: false, message: "خطای احراز هویت/پایگاه داده: دسترسی رد شد" };
    }
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
    return { ok: false, message: "خطای احراز هویت: دسترسی رد شد" };
  }

  try {
    // SECURITY: scope the valuation snapshot to the session user.
    const res = await createPortfolioSnapshot(undefined, user?.id);
    refreshAll();
    return { ok: true, message: "اسنپ‌شات ثروت با موفقیت ثبت شد (بدون تغییر در دفترکل)." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطای ثبت اسنپ‌شات" };
  }
}

export async function fetchPortfolioValuationAction() {
  // SECURITY: user-specific data — require authentication and scope the
  // valuation to the session user. Calculation logic stays untouched; only
  // the data scope is enforced. Legacy single-tenant mode keeps global view.
  const { user, hasAuth } = await getAuthContext();
  if (hasAuth && !user) throw new Error("Unauthorized: login required");
  return getPortfolioValuation(undefined, user?.id);
}

export async function fetchAnalyticsSummaryAction() {
  // SECURITY: user-specific data — require authentication and scope the
  // analytics run to the session user (no global data for authenticated
  // requests). Calculation logic stays untouched.
  const { user, hasAuth } = await getAuthContext();
  if (hasAuth && !user) throw new Error("Unauthorized: login required");
  return getAnalyticsSummary(user?.id);
}
