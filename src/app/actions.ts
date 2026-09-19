"use server";

import { setupBankAccountSchema } from "@/features/setup/bankAccounts";
import { setupBankIdentifierSchema } from "@/features/setup/bankConnection";

import { normalizeNumericInput } from "@/lib/numericInput";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  accounts,
  assetClasses,
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
  postings,
  snapshotLines,
  snapshots,
  vehicleAssets,
  wallets,
  wallexAssetCatalog,
} from "@/db/schema";
import {
  isTomanOnlyInstrument,
  registrySaleError,
  settlementUnitOf,
  tradePairError,
  tradeRouteFor,
  type TradeSide,
} from "@/features/trade/rules";
import { sameWallet, transferDestinationError, venueTradeError } from "@/features/trade/venues";
import { networksForHolding } from "@/features/trade/networks";
import { getCryptoNetworksOf } from "@/features/trade/networkSync";
import { canonicalWalletName, holdingAccountName, knownWalletOf, walletKindOf } from "@/features/setup/holdingWallets";
import { sellRealEstateAsset } from "@/features/rwa/realEstate/service";
import { sellVehicle } from "@/features/rwa/vehicle/service";
import { buildRwaLabel } from "@/features/rwa/symbol";
import { nativeUnitPriceUsd } from "@/features/fx/unitPrice";
import { getLatestUsdIrtRateForUser, getLatestUsdIrtRate } from "@/lib/fx";
import { getCurrentUser } from "@/lib/auth";
import { authUsersExistCached } from "@/lib/tenantState";
import { validateAccountOwnership } from "@/lib/validation";
import {
  ensureFeeExpenseAccount,
  ensureInstallmentPaymentAccount,
  ensureReceivableCollectionAccount,
  ensureRealizedPnlAccount,
  resolveExpenseCounterAccount,
  resolveIncomeCounterAccount,
} from "@/features/accounts/systemAccounts";
import { closeIncomeOccurrence, scheduleNextIncome } from "@/features/income/service";
import { jalaliDayOf } from "@/features/income/recurring";
import { setUserOccupations } from "@/features/preferences/service";
import {
  assertDebtOwnership,
  assertInstallmentOwnership,
  assertJournalEntryOwnership,
} from "@/lib/accessControl";
import { recordAuditEvent } from "@/lib/audit";
import {
  createDebtRecord,
  resolveScheduleInput,
  validateDebtInput,
  type CreateDebtInput,
} from "@/features/planning/createDebt";
import {
  applyPartialPayment,
  generateDueDates,
  isReceivable,
  settlementSign,
} from "@/features/planning/obligations";
import { D, Decimal } from "@/domain/decimal";
import {
  postEntry,
  recordBuy,
  recordExpense,
  recordFx,
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
  getIncomeMiscCategory,
  getMiscCategory,
} from "@/features/categories/service";
import { executePlanned, payInstallment } from "@/features/planning/service";
import { calculateInstallmentPayment } from "@/features/planning/installmentFx";
import { completeSetup, getSetupState } from "@/features/setup/service";
import { rootCauseOf } from "@/db/init-schema";
import { registerMoneyAccount } from "@/features/accounts/service";
import { createPortfolioSnapshot, getCurrentNetWorth, getPortfolioValuation } from "@/features/portfolio/service";
import { getAnalyticsSummary, recordAnalyticsRun } from "@/features/analytics/service";
import { formatMoney, todayIso } from "@/lib/format";

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
    // Cached "any username-bearing user exists" probe (60 s TTL) so a burst of
    // server actions does not fire `users WHERE username IS NOT NULL LIMIT 1`
    // against the database on every single call. Registration invalidates the
    // cache on write, so the anonymous → authenticated transition is immediate.
    hasAuth = await authUsersExistCached();
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
  kind: z.enum(["bank", "cash", "exchange", "broker", "hot", "cold", "fund"]),
  assetId: z.string().min(1, "ارز حساب را انتخاب کنید"),
  /** The exchange, brokerage or wallet picked from the catalogue. */
  placeName: z.string().trim().max(80).optional().default(""),
  openingQty: z.string().optional().default(""),
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
      placeName: v.placeName || undefined,
      openingQty: v.openingQty || undefined,
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

/** A destination account created from the transfer form — the fields the form lists accounts by. */
export type QuickTransferAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  symbol: string | null;
  decimals: number;
  logoUrl: string | null;
  coingeckoId: string | null;
  classCode: string | null;
  className: string | null;
  walletKind: string | null;
  walletName: string | null;
};

/**
 * «+ افزودن» in «به حساب»: the SAME asset as the source, at another exchange or
 * wallet from the catalogue, with a zero balance — «یو اس دی سی - متامسک» for
 * USDC leaving Rabby. The place must pass the transfer rules (the coin's
 * network, Toman only at an Iranian exchange or a brokerage) and an existing
 * account there is returned instead of a second one.
 */
export async function createTransferDestinationAction(
  input: unknown,
): Promise<ActionResult & { account?: QuickTransferAccount }> {
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
    const v = z.object({ sourceAccountId: z.string(), placeName: z.string().min(1) }).parse(input);
    if (!isUuid(v.sourceAccountId)) throw new Error("حساب مبدأ را انتخاب کنید");
    if (user) await validateAccountOwnership(v.sourceAccountId, user.id);
    const place = knownWalletOf(v.placeName);
    if (!place) throw new Error("صرافی یا کیف پول را از فهرست انتخاب کنید.");

    const row = await db.transaction(async (tx) => {
      const [source] = await tx
        .select({
          type: accounts.type,
          name: accounts.name,
          assetId: accounts.assetId,
          symbol: assets.symbol,
          assetName: assets.name,
          classCode: assetClasses.code,
          walletName: wallets.name,
          walletKind: wallets.kind,
        })
        .from(accounts)
        .leftJoin(assets, eq(assets.id, accounts.assetId))
        .leftJoin(assetClasses, eq(assetClasses.id, assets.classId))
        .leftJoin(wallets, eq(wallets.id, accounts.walletId))
        .where(eq(accounts.id, v.sourceAccountId))
        .limit(1);
      if (!source || source.type !== "asset" || !source.assetId) throw new Error("حساب مبدأ انتقال نامعتبر است");
      if (sameWallet(source, { walletName: place.name })) throw new Error("مقصد باید جایی غیر از حساب مبدأ باشد.");
      const destination = { symbol: source.symbol, walletKind: place.kind, walletName: place.name };
      const networks = networksForHolding(source.symbol, source.classCode, await getCryptoNetworksOf(source.symbol, tx));
      const refusal = transferDestinationError(source, destination, networks);
      if (refusal) throw new Error(refusal);

      // «یو اس دی سی - ربی والت» → «یو اس دی سی»: the coin keeps the name the user already sees.
      const coinName = source.walletName && source.name.includes(" - ") ? source.name.split(" - ")[0] : source.assetName || source.symbol || "";
      const accountId = await placedHoldingAccount(
        tx,
        user?.id ?? null,
        { assetId: source.assetId, symbol: source.symbol, assetName: coinName },
        place.name,
      );
      const [created] = await tx
        .select({
          id: accounts.id,
          code: accounts.code,
          name: accounts.name,
          type: accounts.type,
          symbol: assets.symbol,
          decimals: assets.decimals,
          logoUrl: assets.logoUrl,
          coingeckoId: assets.coingeckoId,
          classCode: assetClasses.code,
          className: assetClasses.name,
          walletKind: wallets.kind,
          walletName: wallets.name,
        })
        .from(accounts)
        .leftJoin(assets, eq(assets.id, accounts.assetId))
        .leftJoin(assetClasses, eq(assetClasses.id, assets.classId))
        .leftJoin(wallets, eq(wallets.id, accounts.walletId))
        .where(eq(accounts.id, accountId))
        .limit(1);
      return created;
    });
    if (!row) throw new Error("ایجاد حساب ناموفق بود.");
    refreshAll();
    return {
      ok: true,
      message: `«${row.name}» اضافه شد.`,
      account: { ...row, decimals: row.decimals ?? 2 },
    };
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

// Inside a ledger transaction pass `tx`: a read on the shared `db` would wait
// for a second connection the open transaction may be holding (a pool of one,
// or the embedded database) and the save would never finish.
async function latestPrice(assetId: string, userId?: string | null, client: any = db): Promise<string> {
  // Single authoritative unit-price rule (per-user FX for IRT, market data
  // otherwise). prices.IRT is never an FX authority.
  return nativeUnitPriceUsd(assetId, userId ?? null, client);
}

async function accountAsset(accountId: string, client: Pick<typeof db, "select"> = db): Promise<string> {
  const row = await client.select({ a: accounts.assetId }).from(accounts).where(eq(accounts.id, accountId)).limit(1);
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
  /**
   * Buy / sell: what leaves (buy) or reaches (sell) the settlement account, in
   * that account's unit — Toman for a Toman account, Tether for a USDT wallet.
   * The form computes it from quantity × unit price; the server books it
   * exactly, so «۱۰۰ تتر» leaves the wallet as 100 USDT, not a rate-derived
   * approximation.
   */
  settleQuantity: z.string().optional(),
  /** unit price the user traded at (market or limit), in the settlement unit */
  unitPrice: z.string().optional(),
  priceMode: z.enum(["market", "limit"]).optional(),
  /** A Toman buy: the Iranian exchange the asset is bought at (and held in). */
  placeName: z.string().optional(),
  /** «فروش دارایی» of a registry asset: which property or vehicle is sold */
  registryKind: z.enum(["property", "vehicle"]).optional(),
  registryId: z.string().optional(),
  /** Income: the amount in the RECEIVING account's own unit (Toman, Tether, dollar). */
  nativeAmount: z.string().optional(),
  /** Income: repeat monthly — a reminder on `recurringDay` (Jalali), never an automatic posting. */
  recurring: z.enum(["monthly"]).optional(),
  recurringDay: z.string().optional(),
  /** Income recorded from a reminder: closes that occurrence and schedules the next. */
  planId: z.string().optional(),
  fee: z.string().optional(),
  /**
   * Unit of the `fee` field. `irt` (default, historical) reads it as Toman;
   * `native` reads it in the DENOMINATION OF THE PAYING ACCOUNT — Toman for an
   * IRT bank, USDT for a stablecoin wallet, USD for a dollar account. Without
   * this a "5 USDT" commission on a USDT-funded purchase was converted as if it
   * were 5 Toman, i.e. the fee leg was ~190 000× too small.
   */
  feeMode: z.enum(["irt", "native"]).optional(),
});

/**
 * The account a bought asset is held in AT THE PLACE it was bought — «اتریوم -
 * بیت‌پین». The place's wallet row and the account are created on first use.
 */
async function placedHoldingAccount(
  tx: any,
  userId: string | null,
  holding: { assetId: string; symbol: string | null; assetName: string | null },
  placeName: string,
): Promise<string> {
  const walletName = canonicalWalletName(placeName);
  const walletOwner = userId ? eq(wallets.userId, userId) : sql`${wallets.userId} is null`;
  const owned = await tx.select().from(wallets).where(and(walletOwner, isNull(wallets.deletedAt)));
  const wallet =
    owned.find((w: { name: string }) => canonicalWalletName(w.name) === walletName) ??
    (await tx.insert(wallets).values({ userId, name: walletName, kind: walletKindOf(walletName) }).returning())[0];
  const accountOwner = userId ? eq(accounts.userId, userId) : sql`${accounts.userId} is null`;
  const [existing] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(accountOwner, eq(accounts.assetId, holding.assetId), eq(accounts.walletId, wallet.id), isNull(accounts.deletedAt)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await tx
    .insert(accounts)
    .values({
      userId,
      code: `H-${(holding.symbol ?? "ASSET").toUpperCase()}-${String(wallet.id).slice(0, 8)}`,
      name: holdingAccountName(holding.assetName || holding.symbol || "", walletName),
      type: "asset",
      assetId: holding.assetId,
      walletId: wallet.id,
    })
    .returning();
  return created.id;
}

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
    if (raw.bankImport === "confirmed") {
      const bankUser = await getCurrentUser();
      if (!bankUser || !(await getSetupState(bankUser.id)).completed) return { ok: false, message: "ابتدا راه‌اندازی اولیه توازن را کامل کنید." };
    }
    // Safety net: every amount field is posted canonical by AmountInput, but a
    // Persian or Arabic digit that reaches here any other way must still mean
    // the same number — never a Decimal parse error, never a different value.
    for (const key of ["irtAmount", "amount", "quantity", "fee", "fxRate"]) {
      if (typeof raw[key] === "string") raw[key] = normalizeNumericInput(raw[key], { decimal: true });
    }
    for (const key of ["settleQuantity", "unitPrice", "nativeAmount"]) {
      if (typeof raw[key] === "string") raw[key] = normalizeNumericInput(raw[key], { decimal: true });
    }
    // An empty hidden field (e.g. priceMode on a non-trade form) means "not
    // set" — never an invalid enum value that blocks every expense/transfer.
    for (const key of ["priceMode", "registryKind", "recurring", "feeMode"]) {
      if (raw[key] === "") delete raw[key];
    }
    const idempotencyKey = String(raw.idempotencyKey || fd.get("idempotencyKey") || "").trim() || undefined;
    // Support both legacy 'amount' (USD) and new 'irtAmount' (IRT) — IRT is reference, USD is computed via server rate (freeze)
    const input = txSchema.parse(raw);
    const importProvenance = raw.bankImport === "confirmed" && idempotencyKey?.match(/^bank-import:[0-9a-f]{64}$/)
      ? { source: "import" as const, reference: idempotencyKey }
      : {};
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
    // invoked. On violation we throw (403 semantics) and NO journal entry,
    // posting, FIFO lot or balance is created or mutated.
    //
    // System-derived counters (fee 5040 / realized P&L 4100 / expense bucket /
    // reserve 3200) never come from the client — but they are NOT implicitly
    // "shared" rows either: each one is resolved for THIS tenant (own row
    // first, shared global row only as a legacy fallback) by
    // `@/features/accounts/systemAccounts`, so a counter-leg can never be
    // posted into another user's chart of accounts.
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
    if (importProvenance.source && (!raw.expectedBankRate || serverRate.cmp(D(raw.expectedBankRate)) !== 0)) {
      throw new Error("نرخ ارز از زمان بازبینی تغییر کرده است؛ صفحه را تازه کنید و نرخ جدید را بررسی کنید.");
    }

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
    // A buy / sell re-derives both from the exact settlement quantity below.
    let amount: Decimal = usdAmount;
    // Commission → USD for the ledger. `feeMode: "native"` reads the field in
    // the paying account's own denomination (Toman for a bank, USDT for a
    // stablecoin wallet, USD for a dollar account); the default `irt` keeps the
    // historical behaviour. Both paths use the SAME authoritative unit price as
    // every quantity in this handler, so a fee can never be converted twice.
    let feeUsd = "0";
    if (input.fee && D(input.fee).gt(0)) {
      const rawFee = D(input.fee);
      const payAccountId =
        input.type === "buy" || input.type === "sell" ? input.counterAccountId : input.primaryAccountId;
      const payAssetId =
        input.feeMode === "native" && payAccountId && isUuid(payAccountId)
          ? ((await db.select({ a: accounts.assetId }).from(accounts).where(eq(accounts.id, payAccountId)).limit(1))[0]
              ?.a ?? null)
          : null;
      const unitUsd = payAssetId ? D(await nativeUnitPriceUsd(payAssetId, authUser?.id ?? null)) : null;
      feeUsd = unitUsd && unitUsd.gt(0) ? rawFee.mul(unitUsd).toString() : rawFee.div(serverRate).toString();
    }
    const fee = feeUsd;

    // «فروش دارایی» of a property or vehicle: Toman only, into a bank account,
    // through the registry's own sale services (they post the ledger entry and
    // remove the asset from holdings atomically).
    if (input.type === "sell" && input.registryKind) {
      if (!isUuid(input.registryId)) throw new Error("دارایی انتخاب‌شده معتبر نیست");
      if (!isUuid(input.counterAccountId)) throw new Error("حساب بانکی واریز را انتخاب کنید");
      const [bank] = await db
        .select({ symbol: assets.symbol, walletKind: wallets.kind, name: accounts.name, code: accounts.code })
        .from(accounts)
        .leftJoin(assets, eq(assets.id, accounts.assetId))
        .leftJoin(wallets, eq(wallets.id, accounts.walletId))
        .where(eq(accounts.id, input.counterAccountId))
        .limit(1);
      const settleError = registrySaleError(bank ?? null);
      if (settleError) throw new Error(settleError);

      const salePriceToman = D(irtAmountStr).toFixed(0);
      const saleRateOverride = { saleFxRate: serverRate.toString(), saleUsdRate: serverRate.toString() };
      let ledgerEntryId: string | null;
      let label: string;
      if (input.registryKind === "property") {
        const sold = await sellRealEstateAsset({
          propertyId: input.registryId,
          saleDate: input.entryDate,
          salePriceToman,
          saleAccountId: input.counterAccountId,
          userId: authUser?.id ?? null,
          // Toman in, Toman out: the proceeds reach the bank through USD, so
          // they must go both ways at the ledger's own rate — never at a
          // historical close of the sale day.
          ...saleRateOverride,
        });
        ledgerEntryId = sold.ledgerEntryId;
        label = sold.label;
      } else {
        const [vehicle] = await db
          .select({ userSeq: vehicleAssets.userSeq, status: vehicleAssets.status })
          .from(vehicleAssets)
          .where(eq(vehicleAssets.id, input.registryId))
          .limit(1);
        if (!vehicle) throw new Error("خودرو یافت نشد.");
        if (vehicle.status === "sold") throw new Error("این خودرو قبلاً فروخته شده است.");
        const sold = await sellVehicle({
          vehicleId: input.registryId,
          saleDate: input.entryDate,
          salePriceToman,
          saleAccountId: input.counterAccountId,
          userId: authUser?.id ?? null,
          // Toman in, Toman out: the proceeds reach the bank through USD, so
          // they must go both ways at the ledger's own rate — never at a
          // historical close of the sale day.
          ...saleRateOverride,
        });
        ledgerEntryId = sold.ledgerEntryId;
        label = buildRwaLabel("vehicle", vehicle.userSeq);
      }

      if (ledgerEntryId) {
        const [usdtQuote] = await db
          .select({ priceTmn: wallexAssetCatalog.priceTmn })
          .from(wallexAssetCatalog)
          .where(eq(wallexAssetCatalog.symbol, "USDT"))
          .limit(1);
        const usdtToman = usdtQuote?.priceTmn && D(usdtQuote.priceTmn).gt(0) ? D(usdtQuote.priceTmn) : serverRate;
        const saleFreeze = {
          tradeSymbol: label,
          tradeQuantity: "1",
          settleSymbol: bank?.symbol ?? "IRT",
          settleQuantity: salePriceToman,
          unitPriceIrt: salePriceToman,
          unitPriceUsdt: D(salePriceToman).div(usdtToman).toString(),
          usdtRateIrt: usdtToman.toString(),
          priceMode: "registry",
        };
        await db
          .insert(entryFxSnapshots)
          .values({
            entryId: ledgerEntryId,
            irtAmount: salePriceToman,
            usdAmount: D(salePriceToman).div(serverRate).toString(),
            fxRate: serverRate.toString(),
            rateSource: fxSnap.source,
            rateDate: fxSnap.effectiveDate,
            ...saleFreeze,
          })
          .onConflictDoUpdate({ target: entryFxSnapshots.entryId, set: saleFreeze });
        await db.insert(entryReviews).values({ entryId: ledgerEntryId }).onConflictDoNothing();
      }

      refreshAll();
      return { ok: true, message: `${label} فروخته شد و ${formatMoney(salePriceToman, "IRT")} به حساب بانکی واریز شد.` };
    }

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
      // Check amount not exceed installment amount (allow small tolerance).
      // New records (contractual Toman present) compare Toman amounts so an FX
      // change can never make the correct Toman payment look over/under-sized.
      if (row.amountToman != null) {
        const instToman = D(row.amountToman);
        if (D(irtAmountStr).gt(instToman.mul("1.05"))) throw new Error("مبلغ واردشده بیشتر از مبلغ قسط است");
      } else {
        const instAmt = D(row.amountBase);
        if (amount.gt(instAmt.mul("1.05"))) throw new Error("مبلغ واردشده بیشتر از مبلغ قسط است");
      }
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
        if (!found || found.kind !== "expense") throw new Error("دسته هزینه انتخاب‌شده معتبر یا فعال نیست");
        if (found.level !== 1) throw new Error("دسته هزینه باید یک زیردسته (برگ) باشد، نه دسته اصلی");
        category = found;
      } else {
        category = await getMiscCategory();
      }
    } else if (input.type === "income") {
      // The SOURCE of an income is a category (salary, bank interest, rent…) —
      // the user never picks a ledger account.
      await ensureCategoryCatalog();
      if (input.categoryId && isUuid(input.categoryId)) {
        const found = await getCategoryById(input.categoryId, authUser?.id);
        if (!found || found.kind !== "income") throw new Error("منبع درآمد انتخاب‌شده معتبر نیست");
        if (found.level !== 1) throw new Error("منبع درآمد باید یک زیردسته باشد، نه گروه اصلی");
        category = found;
      } else if (!isUuid(input.counterAccountId)) {
        category = await getIncomeMiscCategory();
      }
    }

    // Expenses are classified exclusively by category. The ledger counterpart is
    // resolved server-side to the system expense bucket and is never selected,
    // submitted, or exposed in the UI.
    let resolvedExpenseAccountId: string | null = null;
    if (input.type === "expense") {
      // TENANT-SCOPED (F-03): the bucket is this tenant's own 5900 «متفرقه»
      // when it exists, else the first expense row of their chart — never an
      // arbitrary `type='expense' limit 1` across the whole database, which
      // posted one user's expenses into another user's account.
      const expenseAccount = await resolveExpenseCounterAccount(authUser?.id ?? null);
      if (!expenseAccount) throw new Error("حساب سیستمی هزینه در دسترس نیست");
      resolvedExpenseAccountId = expenseAccount.id;
    }

    // A categorised income posts against this tenant's income account (4010).
    // A legacy API caller that names an income account itself is still honoured.
    let resolvedIncomeAccountId: string | null = null;
    if (input.type === "income" && category) {
      const incomeAccount = await resolveIncomeCounterAccount(authUser?.id ?? null);
      if (!incomeAccount) throw new Error("حساب سیستمی درآمد در دسترس نیست");
      resolvedIncomeAccountId = incomeAccount.id;
    }

    // Wrap ledger write + FX snapshot + debt linkage in one atomic transaction
    const entryId = await db.transaction(async (tx) => {
      let entry: { id: string } | null = null;
      // Buy / sell / swap: what was traded, frozen next to the FX snapshot.
      let tradeFreeze: Partial<typeof entryFxSnapshots.$inferInsert> = {};

      if (input.type === "income" || input.type === "expense") {
        const ledgerCategoryAccountId =
          input.type === "expense" ? resolvedExpenseAccountId : (resolvedIncomeAccountId ?? input.counterAccountId);
        if (!ledgerCategoryAccountId) throw new Error(input.type === "expense" ? "حساب سیستمی هزینه در دسترس نیست" : "حساب مقابل را انتخاب کنید");
        const categoryId = category?.id ?? null;

        if (category?.nature === "non_cash") {
          // Non-cash expense (depreciation / reserve): an expense in reports
          // but NEVER a cash outflow — the counter leg is the system reserve
          // (equity) account, so no wallet/account balance moves.
          const reserve = await ensureReserveAccount(authUser?.id ?? null, tx);
          if (!reserve.assetId) throw new Error("حساب ذخیره استهلاک به دارایی پایه متصل نیست");
          const price = await latestPrice(reserve.assetId, authUser?.id ?? null, tx);
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
                  accountId: ledgerCategoryAccountId,
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
          // Reads inside the write transaction go through `tx` — a single-connection driver deadlocks on `db`.
          const [cashAccountRow] = await tx
            .select({ assetId: accounts.assetId })
            .from(accounts)
            .where(eq(accounts.id, input.primaryAccountId))
            .limit(1);
          if (!cashAccountRow?.assetId) throw new Error("حساب انتخاب‌شده به هیچ دارایی متصل نیست");
          const cashAsset = cashAccountRow.assetId;
          let qty: string;
          if (input.type === "income" && input.nativeAmount && D(input.nativeAmount).gt(0)) {
            // Income is typed in the RECEIVING account's own unit — Toman into a
            // bank, Tether into a USDT wallet, dollars into a dollar account —
            // and booked exactly; the Toman value is frozen alongside.
            const [cashUnit] = await tx.select({ symbol: assets.symbol }).from(assets).where(eq(assets.id, cashAsset)).limit(1);
            const unit = (cashUnit?.symbol ?? "").toUpperCase();
            const native = D(input.nativeAmount);
            qty = native.toString();
            if (unit === "IRT" || unit === "IRR") {
              irtAmountStr = (unit === "IRR" ? native.div(10) : native).toFixed(0);
              amount = D(irtAmountStr).div(serverRate);
            } else {
              amount = native.mul(D(await nativeUnitPriceUsd(cashAsset, authUser?.id ?? null, tx)));
              let tomanPerUsd = serverRate;
              if (unit === "USDT") {
                const [usdtQuote] = await tx
                  .select({ priceTmn: wallexAssetCatalog.priceTmn })
                  .from(wallexAssetCatalog)
                  .where(eq(wallexAssetCatalog.symbol, "USDT"))
                  .limit(1);
                if (usdtQuote?.priceTmn && D(usdtQuote.priceTmn).gt(0)) tomanPerUsd = D(usdtQuote.priceTmn);
              }
              irtAmountStr = amount.mul(tomanPerUsd).toFixed(0);
            }
            if (amount.lte(0)) throw new Error("مبلغ درآمد باید بزرگ‌تر از صفر باشد");
          } else {
            const price = await nativeUnitPriceUsd(cashAsset, authUser?.id ?? null, tx);
            qty = amount.div(price).toString();
          }
          const cmd = {
            ...importProvenance,
            entryDate: input.entryDate,
            description: input.description,
            cashAccountId: input.primaryAccountId,
            categoryAccountId: ledgerCategoryAccountId,
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
        // Settlement of an obligation — by design NOT an expense, and NOT
        // income:
        //  - payable WITH a liability account: cash ↓ / liability ↓ (net worth
        //    effect only, excluded from every expense report);
        //  - planning-only payable (no liability account yet): the outflow is
        //    booked against the dedicated «پرداخت اقساط» bucket (5960) so the
        //    money stays tracked, and the entry type remains 'debt_repayment',
        //    which keeps it out of expense / cash-flow / budget aggregations;
        //  - RECEIVABLE («طلب من»): every sign above is mirrored — cash ↑ and
        //    the credit lands on the income-typed «دریافت مطالبات» bucket
        //    (4960). The same excluded entry type covers it, because the
        //    exclusion was already symmetric (`acc_type = 'income' and
        //    entry_type not in ('debt_repayment')`), so collecting a
        //    receivable is never reported as earnings.
        //
        // DIRECTION IS READ FROM THE OBLIGATION ROW (`linkedDebt`), never from
        // the client. A caller that could name the direction could post a
        // receipt against a debt and invert the cash leg.
        if (!isUuid(input.primaryAccountId)) throw new Error("حساب مبدأ را انتخاب کنید");
        const collecting = isReceivable(linkedDebt?.direction);
        const sign = settlementSign(linkedDebt?.direction);
        const cashAsset = await accountAsset(input.primaryAccountId, tx);
        const price = await latestPrice(cashAsset, authUser?.id ?? null, tx);
        const qty = amount.div(price).toString();
        const lines = [
          {
            accountId: input.primaryAccountId,
            assetId: cashAsset,
            quantity: D(qty).mul(String(sign)).toString(),
            baseValue: amount.mul(String(sign)).toString(),
          },
        ];
        if (linkedDebt?.accountId) {
          const debtAsset = await accountAsset(linkedDebt.accountId, tx);
          const debtPrice = await latestPrice(debtAsset, authUser?.id ?? null, tx);
          lines.push({
            accountId: linkedDebt.accountId,
            assetId: debtAsset,
            quantity: amount.div(debtPrice).mul(String(-sign)).toString(),
            baseValue: amount.mul(String(-sign)).toString(),
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
          // WHICH account receives the outflow is plumbing, not a user
          // decision, and it must never be 5900 «هزینه متفرقه» (audit F-3):
          // the Payment Form prefills the tenant's «پرداخت اقساط» bucket and
          // whatever it sent is honoured (ownership was validated above). If
          // nothing usable came from the client — e.g. an API caller that only
          // knows the debt — the bucket is resolved and provisioned
          // server-side, exactly like the Quick Pay path, so the two entry
          // points can never classify the same movement differently.
          //
          // A COLLECTION always resolves its own 4960 bucket server-side and
          // ignores any client-supplied counter account: the form only ever
          // prefills expense rows for this entry type, and an expense leg on
          // an inflow would post the wrong side of the chart.
          const contraAccountId = collecting
            ? ((await ensureReceivableCollectionAccount(authUser?.id ?? null, tx))?.id ?? null)
            : isUuid(input.counterAccountId)
              ? input.counterAccountId
              : ((await ensureInstallmentPaymentAccount(authUser?.id ?? null, tx))?.id ?? null);
          if (!contraAccountId) {
            throw new Error(
              collecting
                ? "این طلب حساب دریافتنی جداگانه ندارد و سرفصل «دریافت مطالبات» هم ساخته نشد؛ در «تنظیمات ← حساب‌ها» یک حساب درآمد بسازید."
                : "این بدهی حساب بدهی جداگانه ندارد و سرفصل «پرداخت اقساط» هم ساخته نشد؛ در «تنظیمات ← حساب‌ها» یک حساب هزینه بسازید.",
            );
          }
          lines.push({
            accountId: contraAccountId,
            assetId: cashAsset,
            quantity: D(qty).mul(String(-sign)).toString(),
            baseValue: amount.mul(String(-sign)).toString(),
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
        const [fromRow] = await tx.select({ id: accounts.id, type: accounts.type }).from(accounts).where(eq(accounts.id, input.primaryAccountId)).limit(1);
        const [toRow] = await tx.select({ id: accounts.id, type: accounts.type }).from(accounts).where(eq(accounts.id, input.counterAccountId)).limit(1);
        if (!fromRow || fromRow.type !== "asset") throw new Error("حساب مبدأ انتقال نامعتبر است (باید حساب دارایی باشد)");
        if (!toRow || toRow.type !== "asset") throw new Error("حساب مقصد انتقال نامعتبر است (باید حساب دارایی باشد)");
        // Toman moves between banks, exchange Toman and brokerage Toman; a coin or
        // a tokenised asset only to the same asset at an exchange or a wallet
        // that supports its network (no Bitcoin to Rabby).
        const loadPlace = (id: string) =>
          tx
            .select({
              symbol: assets.symbol,
              classCode: assetClasses.code,
              walletName: wallets.name,
              walletKind: wallets.kind,
              name: accounts.name,
              code: accounts.code,
            })
            .from(accounts)
            .leftJoin(assets, eq(assets.id, accounts.assetId))
            .leftJoin(assetClasses, eq(assetClasses.id, assets.classId))
            .leftJoin(wallets, eq(wallets.id, accounts.walletId))
            .where(eq(accounts.id, id))
            .limit(1);
        const [source] = await loadPlace(input.primaryAccountId);
        const [destination] = await loadPlace(input.counterAccountId);
        const transferError = transferDestinationError(
          source ?? {},
          destination ?? {},
          networksForHolding(destination?.symbol, destination?.classCode, await getCryptoNetworksOf(destination?.symbol, tx)),
        );
        if (transferError) throw new Error(transferError);

        const assetId = await accountAsset(input.primaryAccountId, tx);
        const destAssetId = await accountAsset(input.counterAccountId, tx);
        if (assetId !== destAssetId) {
          const [fromAst] = await tx.select({ symbol: assets.symbol }).from(assets).where(eq(assets.id, assetId)).limit(1);
          const [toAst] = await tx.select({ symbol: assets.symbol }).from(assets).where(eq(assets.id, destAssetId)).limit(1);
          const { resolveFxBookLegs } = await import("@/features/ledger/service");
          const legs = resolveFxBookLegs({
            fromSymbol: fromAst?.symbol ?? "",
            toSymbol: toAst?.symbol ?? "",
            rateIrtPerUsd: serverRate.toString(),
            irtAmount: irtAmountStr,
          });
          entry = await recordFx(
            {
              entryDate: input.entryDate,
              description: input.description,
              fromAccountId: input.primaryAccountId,
              toAccountId: input.counterAccountId,
              fromAssetId: assetId,
              toAssetId: destAssetId,
              fromQuantity: legs.fromQuantity,
              toQuantity: legs.toQuantity,
              bookValue: legs.bookValue,
              rateIrtPerUsd: serverRate.toString(),
              feeBase: fee,
              feeAccountId: (await ensureFeeExpenseAccount(authUser?.id ?? null, tx))?.id,
              userId: authUser?.id ?? undefined,
              idempotencyKey,
              preventOverdraft: true,
            },
            tx,
          );
        } else {
          const price = await latestPrice(assetId, authUser?.id ?? null, tx);
          // Toman moves by exactly the Toman typed — never re-derived through dollars,
          // which rounds and leaves «همه» a dust balance (or an overdraft) behind.
          const sourceUnit = (source?.symbol ?? "").toUpperCase();
          const qty =
            sourceUnit === "IRT" || sourceUnit === "IRR"
              ? sourceUnit === "IRR" ? D(irtAmountStr).mul(10).toString() : irtAmountStr
              : input.quantity && D(input.quantity).gt(0)
                ? input.quantity
                : amount.div(price).toString();
          // A transfer moves money at its BOOK cost; it never revalues it. Valuing
          // it at today's rate made a brokerage balance opened when the dollar was
          // dearer worth more dollars than it ever booked, and «همه» was refused
          // as an overdraft. So: enough QUANTITY is required, and the dollar
          // value leaving is the source's average book cost per unit.
          const feeQty = D(fee).gt(0) ? D(fee).div(price) : D("0");
          const tenantScope = authUser?.id ? sql`and (je.user_id = ${authUser.id} or je.user_id is null)` : sql``;
          const balanceRes = await tx.execute(sql`
            select coalesce(sum(p.quantity), 0)::text as q, coalesce(sum(p.base_value), 0)::text as b
            from postings p join journal_entries je on je.id = p.entry_id
            where p.account_id = ${input.primaryAccountId} and je.status = 'posted' ${tenantScope}
          `);
          const held = D((balanceRes.rows[0] as { q?: string })?.q ?? "0");
          const heldBase = D((balanceRes.rows[0] as { b?: string })?.b ?? "0");
          if (D(qty).add(feeQty).gt(held)) {
            throw new Error(feeQty.gt(0) ? "موجودی حساب مبدأ برای این مبلغ و کارمزد کافی نیست." : "موجودی حساب مبدأ کافی نیست.");
          }
          const bookUnit = held.gt(0) && heldBase.gt(0) ? heldBase.div(held).toString() : price;
          entry = await recordTransfer(
            {
              ...importProvenance,
              entryDate: input.entryDate,
              description: input.description,
              fromAccountId: input.primaryAccountId,
              toAccountId: input.counterAccountId,
              assetId,
              quantity: qty,
              unitPrice: bookUnit,
              feeBase: feeQty.mul(bookUnit).toString(),
              feeAccountId: (await ensureFeeExpenseAccount(authUser?.id ?? null, tx))?.id,
              userId: authUser?.id ?? undefined,
              idempotencyKey,
              preventOverdraft: true,
            },
            tx,
          );
        }
      } else {
        if (!isUuid(input.primaryAccountId)) throw new Error("دارایی را انتخاب کنید");
        if (!isUuid(input.counterAccountId)) throw new Error("حساب پرداخت یا دریافت را انتخاب کنید");
        const loadTradeAccount = async (id: string) =>
          (
            await tx
              .select({
                id: accounts.id,
                type: accounts.type,
                name: accounts.name,
                assetId: accounts.assetId,
                symbol: assets.symbol,
                classCode: assetClasses.code,
                className: assetClasses.name,
                assetName: assets.name,
                walletKind: wallets.kind,
                walletName: wallets.name,
              })
              .from(accounts)
              .leftJoin(assets, eq(assets.id, accounts.assetId))
              .leftJoin(assetClasses, eq(assetClasses.id, assets.classId))
              .leftJoin(wallets, eq(wallets.id, accounts.walletId))
              .where(eq(accounts.id, id))
              .limit(1)
          )[0];
        let assetRow = await loadTradeAccount(input.primaryAccountId);
        const cashRow = await loadTradeAccount(input.counterAccountId);
        if (!assetRow || assetRow.type !== "asset" || !assetRow.assetId) throw new Error("حساب دارایی نامعتبر است (باید حساب دارایی باشد)");
        if (!cashRow || cashRow.type !== "asset" || !cashRow.assetId) throw new Error("حساب واریز/پرداخت نقدی نامعتبر است (باید حساب نقد/بانک باشد)");

        // The trade rules are enforced HERE, not only in the form: Toman or a
        // stablecoin settles every trade, and Iranian-market assets settle
        // through a Toman bank account only.
        const side = input.type as TradeSide;
        const pairError = tradePairError(side, assetRow, cashRow);
        if (pairError) throw new Error(pairError);

        // WHERE the trade happens: an Iranian exchange (the Toman or Tether held
        // there), a foreign exchange (USDT / USDC), or a self-custody wallet
        // (stablecoin swap, only on networks it supports). Money pays only where
        // it is held, so a buy is held at the paying account's place.
        // Iranian-market assets are already bound to brokerage Toman above.
        if (!isTomanOnlyInstrument(assetRow)) {
          const assetPlace = { walletName: assetRow.walletName, walletKind: assetRow.walletKind };
          const targetPlace =
            side === "sell" ? assetPlace : { walletName: cashRow.walletName, walletKind: cashRow.walletKind };
          const assetNetworks = await getCryptoNetworksOf(assetRow.symbol, tx);
          const venueError = venueTradeError(
            side,
            { ...assetRow, place: assetPlace, networks: assetNetworks },
            { symbol: cashRow.symbol, walletKind: cashRow.walletKind, walletName: cashRow.walletName, name: cashRow.name },
            targetPlace,
          );
          if (venueError) throw new Error(venueError);
          // A coin bought at a place is held at that place.
          if (side === "buy" && targetPlace.walletName && !sameWallet(targetPlace, assetPlace)) {
            const placedId = await placedHoldingAccount(
              tx,
              authUser?.id ?? null,
              { assetId: assetRow.assetId, symbol: assetRow.symbol, assetName: assetRow.assetName },
              targetPlace.walletName,
            );
            const placed = await loadTradeAccount(placedId);
            if (!placed?.assetId) throw new Error("حساب دارایی در محل خرید ایجاد نشد");
            assetRow = placed;
          }
        }

        const qty = input.quantity && D(input.quantity).gt(0) ? D(input.quantity) : null;
        if (!qty) throw new Error("مقدار دارایی را وارد کنید");
        const assetId = assetRow.assetId as string;
        const cashAssetId = cashRow.assetId;
        const cashSymbol = (cashRow.symbol ?? "").toUpperCase();
        const settleUnit = settlementUnitOf(cashSymbol);

        // Toman per Tether at this moment — the market quote when there is one,
        // otherwise the user's own dollar rate. Frozen below, never re-derived.
        const [usdtQuote] = await tx
          .select({ priceTmn: wallexAssetCatalog.priceTmn })
          .from(wallexAssetCatalog)
          .where(eq(wallexAssetCatalog.symbol, "USDT"))
          .limit(1);
        const usdtToman = usdtQuote?.priceTmn && D(usdtQuote.priceTmn).gt(0) ? D(usdtQuote.priceTmn) : serverRate;

        // What leaves (buy) or reaches (sell) the settlement account. A Toman
        // settlement is typed in Toman; a Rial account carries ten times that.
        const settleQty =
          input.settleQuantity && D(input.settleQuantity).gt(0)
            ? D(input.settleQuantity)
            : settleUnit === "toman"
              ? D(irtAmountStr)
              : amount.div(D(await nativeUnitPriceUsd(cashAssetId, authUser?.id ?? null, tx)));
        if (settleQty.lte(0)) throw new Error("مبلغ معامله باید بزرگ‌تر از صفر باشد");
        const settleNative = cashSymbol === "IRR" ? settleQty.mul(10) : settleQty;
        if (settleUnit === "toman") {
          irtAmountStr = settleQty.toFixed(0);
          amount = D(irtAmountStr).div(serverRate);
        } else {
          // Reads inside the write transaction use `tx` — a single-connection driver would deadlock on `db`.
          amount = settleQty.mul(D(await nativeUnitPriceUsd(cashAssetId, authUser?.id ?? null, tx)));
          irtAmountStr = settleQty.mul(usdtToman).toFixed(0);
        }

        // Selling more than is held would leave a negative position.
        if (side === "sell") {
          const [held] = await tx
            .select({ quantity: sql<string>`coalesce(sum(${postings.quantity}), 0)::text` })
            .from(postings)
            .innerJoin(journalEntries, eq(journalEntries.id, postings.entryId))
            .where(and(eq(postings.accountId, assetRow.id), eq(journalEntries.status, "posted")));
          if (D(held?.quantity ?? "0").lt(qty)) {
            throw new Error(`مقدار فروش از موجودی شما بیشتر است (موجودی: ${D(held?.quantity ?? "0").toString()}).`);
          }
        }

        // F-02/F-03: the commission counter is resolved for THIS tenant and
        // provisioned when the chart lacks it — a buy with a fee and no 5040
        // row used to produce an unbalanced entry («سند تراز نیست»).
        const feeAccountId = (await ensureFeeExpenseAccount(authUser?.id ?? null, tx))?.id ?? null;

        if (tradeRouteFor(assetRow) === "conversion") {
          // سواپ: a stablecoin (or dollar) against Toman or another stablecoin.
          // Money changes form — no FIFO lot is opened or consumed. Book value
          // is the dollar face of the stablecoin leg.
          amount = qty.mul(D(await nativeUnitPriceUsd(assetId, authUser?.id ?? null, tx)));
          entry = await recordFx(
            {
              entryDate: input.entryDate,
              description: input.description,
              fromAccountId: side === "sell" ? assetRow.id : cashRow.id,
              toAccountId: side === "sell" ? cashRow.id : assetRow.id,
              fromAssetId: side === "sell" ? assetId : cashAssetId,
              toAssetId: side === "sell" ? cashAssetId : assetId,
              fromQuantity: (side === "sell" ? qty : settleNative).toString(),
              toQuantity: (side === "sell" ? settleNative : qty).toString(),
              bookValue: amount.toString(),
              feeBase: fee,
              feeAccountId,
              userId: authUser?.id ?? undefined,
              idempotencyKey,
              preventOverdraft: true,
            },
            tx,
          );
        } else {
          const common = {
            entryDate: input.entryDate,
            description: input.description,
            assetAccountId: assetRow.id,
            cashAccountId: cashRow.id,
            assetId,
            quantity: qty.toString(),
            cashAssetId,
            cashQuantity: settleNative.toString(),
            baseValue: amount.toString(),
            feeBase: fee,
            feeAccountId,
            userId: authUser?.id ?? undefined,
            idempotencyKey,
          };
          // A purchase must never push the paying wallet below zero: the guard is
          // evaluated SERVER-SIDE inside the same transaction (the client can
          // always edit the form), scoped to this tenant's own postings.
          if (side === "buy") entry = await recordBuy({ ...common, preventOverdraft: true }, tx);
          else {
            const pnl = await ensureRealizedPnlAccount(authUser?.id ?? null, tx);
            if (!pnl) throw new Error("حساب سود سرمایه‌ای (۴۱۰۰) تعریف نشده است");
            entry = await recordSell({ ...common, pnlAccountId: pnl.id, preventOverdraft: false }, tx);
          }
        }

        const unitPriceIrt = D(irtAmountStr).div(qty);
        tradeFreeze = {
          tradeSymbol: assetRow.symbol,
          tradeQuantity: qty.toString(),
          settleSymbol: cashRow.symbol,
          settleQuantity: settleNative.toString(),
          unitPriceIrt: unitPriceIrt.toString(),
          unitPriceUsdt: (settleUnit === "toman" ? unitPriceIrt.div(usdtToman) : settleQty.div(qty)).toString(),
          usdtRateIrt: usdtToman.toString(),
          priceMode: input.priceMode ?? "market",
        };
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
        ...tradeFreeze,
      });

      // Manual entries are reviewed by construction — a human just made them.
      await tx.insert(entryReviews).values({ entryId: entry.id }).onConflictDoNothing();

      // Recurring income: close the reminder this entry came from, or schedule
      // next month's reminder. A reminder is never posted without a tap.
      if (input.type === "income" && authUser?.id && category && isUuid(input.primaryAccountId)) {
        const nativeForPlan =
          input.nativeAmount && D(input.nativeAmount).gt(0) ? D(input.nativeAmount).toString() : D(irtAmountStr).toString();
        if (input.planId && isUuid(input.planId)) {
          await closeIncomeOccurrence(
            { planId: input.planId, userId: authUser.id, entryId: entry.id, amountNative: nativeForPlan, amountBase: amount.toString() },
            tx,
          );
        } else if (input.recurring === "monthly") {
          const [cashRow] = await tx
            .select({ assetId: accounts.assetId })
            .from(accounts)
            .where(eq(accounts.id, input.primaryAccountId))
            .limit(1);
          await scheduleNextIncome(
            {
              userId: authUser.id,
              title: input.description,
              fromDate: input.entryDate,
              dayOfMonth: Number(input.recurringDay) || jalaliDayOf(input.entryDate),
              categoryId: category.id,
              accountId: input.primaryAccountId,
              assetId: cashRow?.assetId ?? null,
              amountNative: nativeForPlan,
              amountBase: amount.toString(),
            },
            tx,
          );
        }
      }

      // Debt / Installment linkage — update status within same transaction (Transactional Integrity)
      if (linkedInst) {
        // Freeze the payment: amount actually paid + the FX rate valid at this
        // moment + the USD equivalent it produces. Written in the SAME
        // transaction as the status flip, so a `paid` row can never exist
        // without its historical USD snapshot. A later FX change is irrelevant
        // to these three columns — nothing recomputes them.
        const paymentSnapshot = calculateInstallmentPayment({
          amountToman: irtAmountStr,
          fxRate: serverRate.toString(),
        });
        // PARTIAL SETTLEMENT. The form lets the user type ANY amount, so this
        // path could previously flip a row to `paid` after a payment that
        // covered a fraction of it — the balance then vanished from every
        // total while the user still owed it. The shared helper decides the
        // resulting state from what was actually settled (and refuses an
        // over-payment), so the form and Quick Pay can never disagree about
        // what an amount means.
        const contractualToman =
          linkedInst.amountToman != null
            ? D(linkedInst.amountToman).toFixed(0)
            : serverRate.gt(0)
              ? D(linkedInst.amountBase).mul(serverRate).toFixed(0)
              : null;
        if (!contractualToman) {
          throw new Error("نرخ تبدیل دلار به تومان برای ثبت پرداخت این قسط موجود نیست.");
        }
        const nextState = applyPartialPayment(
          {
            status: linkedInst.status,
            amountToman: contractualToman,
            paidToman: linkedInst.paidToman,
          },
          paymentSnapshot.paidToman,
        );
        await tx
          .update(installments)
          .set({
            status: nextState.status,
            paidAt: input.entryDate,
            paidEntryId: entry.id,
            // A RUNNING TOTAL, not this payment alone.
            paidToman: nextState.paidToman,
            paidFxRate: paymentSnapshot.paidFxRate,
            paidUsd: paymentSnapshot.paidUsd,
          })
          .where(eq(installments.id, linkedInst.id));
        // Settle the obligation only when NOTHING is outstanding. `partial`
        // counts as outstanding, so a part-paid schedule can never mark its
        // parent settled.
        const pending = await tx
          .select({ c: sql<number>`count(*)::int` })
          .from(installments)
          .where(and(eq(installments.debtId, linkedInst.debtId), sql`${installments.status} <> 'paid'`));
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
      // A recurring income is recorded through the income path (its category,
      // its native amount, its next reminder) — never the generic plan posting.
      if (plan?.categoryId && plan.direction === "inflow") {
        const { recordPlannedIncomeAction } = await import("@/app/actions/income");
        return recordPlannedIncomeAction(id);
      }
    }
    await executePlanned(id);
    refreshAll();
    return { ok: true, message: "برنامه اجرا شد و به دفترکل رفت." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

/**
 * Settle an installment — «پرداخت قسط» for a debt, «ثبت دریافت» for a
 * receivable. The direction is read from the OBLIGATION inside the transaction,
 * never from the caller: a client that could name the direction could post a
 * receipt against a debt and invert the cash leg.
 *
 * `payToman` settles part of the row; omitted, it settles the whole remaining
 * balance (the historical behaviour).
 */
export async function payInstallmentAction(
  id: string,
  cashAccountId: string,
  payToman?: string,
): Promise<ActionResult> {
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
    const paid = (await payInstallment(id, cashAccountId, user?.id ?? undefined, payToman)) as {
      id?: string;
      alreadyPaid?: boolean;
      contra?: "expense" | "liability" | null;
      /** name of the chart row that received the outflow, when it was not a
       *  liability account (the message must name it, not a hardcoded label). */
      contraName?: string | null;
      direction?: string;
      status?: string;
      remainingToman?: string;
    };
    refreshAll();
    // The message follows the ACCOUNTING FACT, not a generic success string:
    // a planning-only debt has no liability account, so the outflow landed on
    // the expense bucket — the user must be told, because they never chose it.
    if (paid?.alreadyPaid) {
      return { ok: true, message: "این قسط پیش‌تر تسویه شده بود؛ ثبت تکراری انجام نشد." };
    }

    const receivable = paid?.direction === "receivable";
    const verb = receivable ? "دریافت" : "پرداخت";
    // A part settlement must say what is LEFT. «پرداخت شد» on a row that still
    // owes 20 million is the single most misleading thing this screen could say.
    if (paid?.status === "partial") {
      const left = paid.remainingToman ? formatMoney(paid.remainingToman, "IRT") : "";
      return {
        ok: true,
        message: `${verb} بخشی از قسط ثبت شد${left ? ` · باقی‌مانده این قسط: ${left}` : ""}.`,
      };
    }
    if (receivable) {
      return {
        ok: true,
        message:
          paid?.contra === "expense"
            ? `دریافت ثبت و به حساب اضافه شد. این طلب حساب دریافتنی جداگانه ندارد، پس ورود وجه در سرفصل «${paid.contraName ?? "دریافت مطالبات"}» بایگانی شد — وصول مطالبات است، نه درآمد؛ در گزارش درآمد شمارش نمی‌شود.`
            : "دریافت ثبت و مانده مطالبات به‌روزرسانی شد.",
      };
    }
    return {
      ok: true,
      message:
        paid?.contra === "expense"
          ? `قسط پرداخت و از حساب کم شد. این بدهی حساب بدهی جداگانه ندارد، پس خروج وجه در سرفصل «${paid.contraName ?? "پرداخت اقساط"}» بایگانی شد — بازپرداخت بدهی است، نه هزینه؛ در گزارش هزینه‌ها و در سقف بودجه‌ها شمارش نمی‌شود.`
          : "قسط پرداخت و مانده بدهی به‌روزرسانی شد.",
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

const debtSchema = z.object({
  title: z.string().trim().min(2, "عنوان را وارد کنید").max(160),
  creditor: z.string().trim().min(2, "نام طرف مقابل را وارد کنید").max(160),
  principalIrt: z.string().min(1, "مبلغ را وارد کنید"),
  interestRate: z.string().optional().default("0"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ شروع را انتخاب کنید"),
  /** «بدهی من» یا «طلب من» — سمت تعهد، نه صرفاً برچسب. */
  direction: z.enum(["payable", "receivable"]).optional().default("payable"),
  installmentCount: z.string().optional().default("0"),
  /** فاصله اقساط به ماه: ۱ (ماهانه) تا ۶. */
  intervalMonths: z.string().optional().default("1"),
  installmentIrt: z.string().optional().default(""),
  firstDueDate: z.string().optional().default(""),
  /**
   * زمان‌بندی سفارشی — تاریخ مستقل هر قسط، جدا شده با کاما.
   * هیچ فاصله ثابتی از آن استنتاج نمی‌شود؛ همان تاریخ‌ها ذخیره می‌شوند.
   */
  customDueDates: z.string().optional().default(""),
});

/**
 * Defines a financial obligation — «بدهی من» or «طلب من» — and its repayment
 * schedule in the planning layer.
 *
 * Deliberately does not call postEntry(): recording a future obligation is not
 * a cash movement, in EITHER direction. The immutable ledger changes only when
 * the user records an actual transaction or settles an installment through its
 * existing accounting path.
 *
 * The write itself is delegated to `createDebtRecord` — the same core the
 * setup wizard uses. This action previously carried its own copy of the Toman
 * truth, the USD snapshot, the FX freeze and the schedule generator; the two
 * copies were already drifting (only one of them learned about custom
 * schedules), so there is now exactly one.
 */
export async function createDebtAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const user = await getCurrentUser();
    const hasAuth = await authUsersExistCached();
    if (hasAuth && !user) return { ok: false, message: "برای ثبت تعهد ابتدا وارد شوید." };

    const raw = Object.fromEntries(fd) as Record<string, string>;
    const value = debtSchema.parse({
      title: raw.title ?? "",
      creditor: raw.creditor ?? "",
      principalIrt: raw.principalIrt ?? "",
      interestRate: raw.interestRate ?? "0",
      startDate: raw.startDate ?? "",
      direction: raw.direction === "receivable" ? "receivable" : "payable",
      installmentCount: raw.installmentCount ?? "0",
      intervalMonths: raw.intervalMonths ?? "1",
      installmentIrt: raw.installmentIrt ?? "",
      firstDueDate: raw.firstDueDate ?? "",
      customDueDates: raw.customDueDates ?? "",
    });

    const customDueDates = value.customDueDates
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);

    const input: CreateDebtInput = {
      userId: user?.id ?? null,
      title: value.title,
      creditor: value.creditor,
      principalIrt: value.principalIrt,
      interestRate: value.interestRate || "0",
      startDate: value.startDate,
      direction: value.direction,
      installmentCount: Number(value.installmentCount || "0"),
      intervalMonths: Number(value.intervalMonths || "1"),
      installmentIrt: value.installmentIrt,
      firstDueDate: value.firstDueDate,
      customDueDates,
    };

    // Validate BEFORE touching FX or the database, so a malformed schedule
    // costs neither a rate lookup nor a rolled-back transaction.
    const invalid = validateDebtInput(input);
    if (invalid) throw new Error(invalid);

    const fx = user ? await getLatestUsdIrtRateForUser(user.id) : await getLatestUsdIrtRate();

    const schedule = resolveScheduleInput(input);
    const count = schedule ? generateDueDates(schedule).length : 0;
    const receivable = value.direction === "receivable";
    const noun = receivable ? "طلب" : "بدهی";

    const debtId = await db.transaction(async (tx) =>
      createDebtRecord(input, { usdIrtRate: fx.rate, tx: tx as unknown as typeof db }),
    );

    await recordAuditEvent({
      action: "CREATE_DEBT",
      entityType: "debt",
      entityId: debtId,
      userId: user?.id ?? null,
      result: "SUCCESS",
      payload: {
        title: value.title,
        creditor: value.creditor,
        direction: value.direction,
        scheduleKind: schedule?.kind ?? null,
        scheduleIntervalMonths: schedule?.kind === "recurring" ? schedule.intervalMonths : null,
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
        ? `${noun} و برنامه ${count} قسط با موفقیت ثبت شد؛ دفترکل و حسابداری تغییری نکرد.`
        : `${noun} با موفقیت ثبت شد؛ دفترکل و حسابداری تغییری نکرد.`,
    };
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message : e instanceof Error ? e.message : "خطا در ثبت تعهد";
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
    ? { ok: true, message: "همه‌چیز درست است؛ مشکلی در اعداد شما پیدا نشد." }
    : { ok: false, message: `${count} تراکنش نیاز به بررسی دارد.` };
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
  bankName: z.string().optional(),
  bankIdentifiers: z.string().max(16000).optional(),
  bankAccounts: z.string().max(16000).optional(),
  cashWalletName: z.string().optional(),
  bankAssetSymbol: z.enum(["IRT", "USD", "USDT"]).optional(),
  cashAssetSymbol: z.enum(["IRT", "USD", "USDT"]).optional(),
  bankOpeningBalance: z.string().optional(),
  cashOpeningBalance: z.string().optional(),
  /** Toman held at Iranian exchanges and brokerages, as a JSON array. */
  tomanPlaces: z.string().optional(),
  /** Symbol of the coin the user picked; validated against the registry in
   *  the service, where an unknown value simply means "no crypto wallet". */
  cryptoSymbol: z.string().optional(),
  cryptoOpeningQty: z.string().optional(),
  cryptoUnitPrice: z.string().optional(),
  goldOpeningQty: z.string().optional(),
  goldUnitPrice: z.string().optional(),
  /** Currency each opening PRICE was typed in. Absent = USD (original contract). */
  goldPriceCurrency: z.enum(["USD", "USDT", "IRT"]).optional(),
  cryptoPriceCurrency: z.enum(["USD", "USDT", "IRT"]).optional(),
  /** Every coin the user holds, as a JSON array (same FormData reason as instruments). */
  cryptoHoldings: z.string().optional(),
  /** USD→IRT rate confirmed on the wizard; the service range-checks it. */
  fxRate: z.string().optional(),
  /**
   * صندوق‌ها و سهام, as a JSON array in one form field.
   *
   * A FormData field cannot carry a list of objects, and the wizard is a plain
   * <form> (deliberately — it must submit without JavaScript state juggling),
   * so the rows travel as JSON and are validated here before the service sees
   * them. The debts step uses the same shape for the same reason.
   */
  instruments: z.string().optional(),
  /** خودرو و ملک, as JSON arrays, for the same FormData reason. */
  vehicles: z.string().optional(),
  properties: z.string().optional(),
});

/** One صندوق/سهم row from the wizard, after JSON parsing. */
const setupInstrumentSchema = z.object({
  kind: z.enum(["fund", "stock", "wallex"]),
  symbol: z.string().trim().min(1).max(40),
  name: z.string().trim().max(160).optional(),
  quantity: z.string().optional(),
  unitPrice: z.string().optional(),
  priceCurrency: z.enum(["USD", "USDT", "IRT"]).optional(),
});

/** One coin the user holds — price in the currency it was bought with. */
const setupCryptoSchema = z.object({
  symbol: z.string().trim().min(1).max(20),
  quantity: z.string().optional(),
  unitPrice: z.string().optional(),
  priceCurrency: z.enum(["USD", "USDT", "IRT"]).optional(),
  /** Where the coin is held (exchange or wallet). Same name ⇒ same wallet. */
  walletName: z.string().trim().max(80).optional(),
});

/** Toman at one Iranian exchange or brokerage — «تومان - نوبیتکس». */
const setupTomanPlaceSchema = z.object({
  walletName: z.string().trim().min(1).max(80),
  balance: z.string().optional(),
});

/**
 * One خودرو row. `catalogId` is a catalogue UUID, never a free-text model —
 * `createUserVehicle` refuses anything that is not in the catalogue, so
 * accepting free text here would only defer the failure.
 */
const setupVehicleSchema = z.object({
  catalogId: z.string().uuid(),
  manufacturingYear: z.string().trim().min(1),
  ownershipDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ تملک خودرو نامعتبر است"),
  purchasePriceToman: z.string().trim().min(1),
  currentValueToman: z.string().optional(),
});

/** One ملک row. All three master-data references are catalogue UUIDs. */
const setupPropertySchema = z.object({
  cityId: z.string().uuid(),
  neighborhoodId: z.string().uuid(),
  propertyTypeId: z.string().uuid(),
  acquisitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ خرید ملک نامعتبر است"),
  purchasePriceToman: z.string().trim().min(1),
  /** Blank → the purchase price, as the valuation of the purchase day. */
  currentValueToman: z.string().optional(),
  sizeSqm: z.string().optional(),
});

/** Parse one JSON list field, failing loudly rather than dropping user input. */
function parseSetupList<T>(json: string | undefined, schema: z.ZodType<T>, label: string): T[] {
  if (!json || !json.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`${label} نامعتبر است.`);
  }
  return z.array(schema).max(100).parse(parsed);
}

export async function completeSetupAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  // Auth guard — FAIL-CLOSED and LOGIN-GATED: the setup wizard initializes
  // the authenticated user's own tenant-scoped chart. Anonymous visitors are
  // never bootstrapped into a legacy open dashboard — they must log in or
  // register first (Global System Directive §0).
  let setupUser: any = null;
  try {
    const ctx = await getAuthContext();
    if (!ctx.user) return { ok: false, message: loginRequiredMessage() };
    setupUser = ctx.user;
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      return { ok: false, message: "خطای احراز هویت/پایگاه داده: دسترسی رد شد" };
    }
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
    return { ok: false, message: "خطای احراز هویت: دسترسی رد شد" };
  }

  try {
    const raw = Object.fromEntries(fd) as Record<string, string>;
    const {
      bankAccounts: bankAccountsJson,
      bankIdentifiers: bankIdentifiersJson,
      instruments: instrumentsJson,
      vehicles: vehiclesJson,
      properties: propertiesJson,
      cryptoHoldings: cryptoJson,
      tomanPlaces: tomanPlacesJson,
      ...rest
    } = setupSchema.parse(raw);

    // Malformed JSON must fail the wizard loudly rather than silently dropping
    // what a user just spent time entering.
    const bankAccounts = bankAccountsJson === undefined ? undefined : parseSetupList(bankAccountsJson, setupBankAccountSchema, "حساب‌های بانکی");
    const bankIdentifiers = parseSetupList(bankIdentifiersJson, setupBankIdentifierSchema, "اتصال بانک‌ها");
    const instruments = parseSetupList(instrumentsJson, setupInstrumentSchema, "فهرست صندوق و سهام");
    const cryptoHoldings = parseSetupList(cryptoJson, setupCryptoSchema, "فهرست رمزارزها");
    const vehicles = parseSetupList(vehiclesJson, setupVehicleSchema, "فهرست خودرو");
    const properties = parseSetupList(propertiesJson, setupPropertySchema, "فهرست ملک");
    const tomanPlaces = parseSetupList(tomanPlacesJson, setupTomanPlaceSchema, "فهرست تومان صرافی و کارگزاری");

    const result = await completeSetup(
      { ...rest, bankAccounts, bankIdentifiers, instruments, cryptoHoldings, tomanPlaces, vehicles, properties },
      setupUser?.id,
    );
    // Occupations are an optional profile field: a malformed value never fails the setup.
    if (setupUser?.id && typeof raw.occupations === "string" && raw.occupations) {
      try {
        await setUserOccupations(setupUser.id, JSON.parse(raw.occupations));
      } catch {
        /* profile only */
      }
    }
    refreshAll();
    // The service's own message is passed through, not replaced: when a
    // خودرو/ملک row fails to register it names which one and says the accounts
    // are already safe. Swallowing that behind a generic success string would
    // leave the user believing everything was recorded.
    return { ok: true, message: result?.message ?? "راه‌اندازی اولیه با موفقیت انجام شد." };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, message: e.issues[0].message };
    const root = rootCauseOf(e);
    return { ok: false, message: root.message || (e instanceof Error ? e.message : "خطای راه‌اندازی") };
  }
}

export async function fetchSetupStateAction() {
  // SECURITY: LOGIN-GATED — never serve setup state to an anonymous caller;
  // the wizard is part of the app (Global System Directive §0). The client
  // redirects the visitor to /login on the loginRequired marker.
  const { user } = await getAuthContext();
  if (!user) return { completed: false, loginRequired: true, usdIrtRate: "", rateSource: "" };
  const state = await getSetupState(user.id);
  // The wizard converts every Toman opening amount at this rate, so it tries
  // the live Toman/Tether market first. `source` lets the wizard ask the user
  // to confirm a rate when only the built-in fallback is available.
  let fx: { rate: string; source: string };
  if (state.completed) {
    fx = await getLatestUsdIrtRateForUser(user.id);
  } else {
    try {
      const { refreshUserFxRateFromMarket } = await import("@/features/fx/userRate");
      fx = await refreshUserFxRateFromMarket(user.id);
    } catch {
      fx = await getLatestUsdIrtRateForUser(user.id);
    }
  }
  return { ...state, usdIrtRate: fx.rate, rateSource: fx.source };
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
  const summary = await getAnalyticsSummary(user?.id);
  // Tracking is an explicit mutation on this action, never on page render.
  try {
    await recordAnalyticsRun({
      userId: user?.id ?? null,
      periodStart: summary.growth.periodStart,
      periodEnd: summary.growth.periodEnd,
    });
  } catch {
    // Tracking must never fail the read.
  }
  return summary;
}
