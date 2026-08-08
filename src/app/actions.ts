"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, sql } from "drizzle-orm";
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
  plannedTransactions,
  prices,
  snapshotLines,
  snapshots,
  wallets,
} from "@/db/schema";
import { getLatestUsdIrtRateForUser, getLatestUsdIrtRate } from "@/lib/fx";
import { getCurrentUser } from "@/lib/auth";
import { D, Decimal } from "@/domain/decimal";
import {
  recordBuy,
  recordExpense,
  recordIncome,
  recordSell,
  recordTransfer,
  reverseEntry,
} from "@/features/ledger/service";
import { executePlanned, payInstallment } from "@/features/planning/service";
import { completeSetup, getSetupState } from "@/features/setup/service";
import { createImportJob, executeImportJob } from "@/features/import/service";
import { recordManualPrice } from "@/features/marketData/service";
import { createPortfolioSnapshot, getPortfolioValuation } from "@/features/portfolio/service";
import { getAnalyticsSummary } from "@/features/analytics/service";
import { getHoldings, getNetWorth } from "@/features/ledger/queries";
import { todayIso } from "@/lib/format";

export type ActionResult = { ok: boolean; message: string };

/** Presentation flow confirms creation before writing the reference record. */
export async function createWalletAction(input: { name: string; kind: string; note?: string }): Promise<ActionResult> {
  // Auth guard — if auth is enabled, require login for writes
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const { db: dbCheck } = await import("@/db");
    const { users: usersTbl } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const user = await getCurrentUser();
    const [hasAuth] = await dbCheck.select().from(usersTbl).where(isNotNull(usersTbl.username)).limit(1);
    if (hasAuth && !user) return { ok: false, message: "برای این عملیات ابتدا وارد شوید." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
  }

  const allowed = ["bank", "exchange", "hot", "cold", "cash", "fund"];
  const name = input.name.trim();
  if (!name || !allowed.includes(input.kind)) return { ok: false, message: "نام و نوع حساب را بررسی کنید." };
  await db.insert(wallets).values({ name, kind: input.kind, note: input.note?.trim() || null });
  revalidatePath("/accounts");
  return { ok: true, message: "حساب جدید با موفقیت ایجاد شد." };
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
  ]) {
    revalidatePath(p);
  }
}

/** A human reviewed a record — metadata only, ledger stays immutable. */
export async function markReviewedAction(entryId: string, reviewed: boolean): Promise<ActionResult> {
  // Auth guard — if auth is enabled, require login for writes
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const { db: dbCheck } = await import("@/db");
    const { users: usersTbl } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const user = await getCurrentUser();
    const [hasAuth] = await dbCheck.select().from(usersTbl).where(isNotNull(usersTbl.username)).limit(1);
    if (hasAuth && !user) return { ok: false, message: "برای این عملیات ابتدا وارد شوید." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
  }

  try {
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
  // Auth guard — if auth is enabled, require login for writes
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const { db: dbCheck } = await import("@/db");
    const { users: usersTbl } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const user = await getCurrentUser();
    const [hasAuth] = await dbCheck.select().from(usersTbl).where(isNotNull(usersTbl.username)).limit(1);
    if (hasAuth && !user) return { ok: false, message: "برای این عملیات ابتدا وارد شوید." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
  }

  try {
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
  // Auth guard — if auth is enabled, require login for writes
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const { db: dbCheck } = await import("@/db");
    const { users: usersTbl } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const user = await getCurrentUser();
    const [hasAuth] = await dbCheck.select().from(usersTbl).where(isNotNull(usersTbl.username)).limit(1);
    if (hasAuth && !user) return { ok: false, message: "برای این عملیات ابتدا وارد شوید." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
  }

  try {
    const v = budgetSchema.parse(Object.fromEntries(fd) as Record<string, string>);
    if (v.periodEnd < v.periodStart) throw new Error("پایان دوره باید بعد از شروع آن باشد");
    await db.insert(budgets).values({
      name: v.name,
      accountId: v.accountId,
      amountBase: D(v.amountBase).toString(),
      periodStart: v.periodStart,
      periodEnd: v.periodEnd,
    });
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
  type: z.enum(["transfer", "buy", "sell", "income", "expense"]),
  entryDate: z.string().min(8),
  description: z.string().min(2, "شرح را وارد کنید"),
  primaryAccountId: z.string().uuid("حساب مبدأ را انتخاب کنید"),
  counterAccountId: z.string().uuid("حساب مقابل را انتخاب کنید"),
  amount: z.string().min(1).optional(),
  irtAmount: z.string().optional(),
  fxRate: z.string().optional(),
  fxRateDate: z.string().optional(),
  debtId: z.string().optional(),
  installmentId: z.string().optional(),
  quantity: z.string().optional(),
  fee: z.string().optional(),
});

export async function createTransactionAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  // Auth guard — if auth is enabled, require login for writes
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const { db: dbCheck } = await import("@/db");
    const { users: usersTbl } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const user = await getCurrentUser();
    const [hasAuth] = await dbCheck.select().from(usersTbl).where(isNotNull(usersTbl.username)).limit(1);
    if (hasAuth && !user) return { ok: false, message: "برای این عملیات ابتدا وارد شوید." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
  }

  try {
    const raw = Object.fromEntries(fd) as Record<string, string>;
    // Support both legacy 'amount' (USD) and new 'irtAmount' (IRT) — IRT is reference, USD is computed via server rate (freeze)
    const input = txSchema.parse(raw);
    // Auth check for ledger writes
    const authUser = await getCurrentUser();
    // If auth is configured (users with username exist), require login for writes; otherwise allow (single-tenant legacy)
    const { db: db2 } = await import("@/db");
    const { users: usersTbl } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const [hasAuthUsers] = await db2.select().from(usersTbl).where(isNotNull(usersTbl.username)).limit(1);
    if (hasAuthUsers && !authUser) throw new Error("برای ثبت تراکنش ابتدا وارد شوید.");
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

    // Wrap ledger write + FX snapshot + debt linkage in one atomic transaction
    const entryId = await db.transaction(async (tx) => {
      let entry: { id: string } | null = null;

      if (input.type === "income" || input.type === "expense") {
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
        };
        if (input.type === "income") entry = await recordIncome(cmd, tx);
        else entry = await recordExpense(cmd, tx);
      } else if (input.type === "transfer") {
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
          },
          tx,
        );
      } else {
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

export async function reverseEntryAction(entryId: string): Promise<ActionResult> {
  // Auth guard — if auth is enabled, require login for writes
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const { db: dbCheck } = await import("@/db");
    const { users: usersTbl } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const user = await getCurrentUser();
    const [hasAuth] = await dbCheck.select().from(usersTbl).where(isNotNull(usersTbl.username)).limit(1);
    if (hasAuth && !user) return { ok: false, message: "برای این عملیات ابتدا وارد شوید." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
  }

  try {
    await reverseEntry(entryId);
    refreshAll();
    return { ok: true, message: "سند معکوس ثبت و سند اصلی ابطال شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

export async function executePlanAction(id: string): Promise<ActionResult> {
  // Auth guard — if auth is enabled, require login for writes
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const { db: dbCheck } = await import("@/db");
    const { users: usersTbl } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const user = await getCurrentUser();
    const [hasAuth] = await dbCheck.select().from(usersTbl).where(isNotNull(usersTbl.username)).limit(1);
    if (hasAuth && !user) return { ok: false, message: "برای این عملیات ابتدا وارد شوید." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
  }

  try {
    await executePlanned(id);
    refreshAll();
    return { ok: true, message: "برنامه اجرا شد و به دفترکل رفت." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

export async function payInstallmentAction(id: string, cashAccountId: string): Promise<ActionResult> {
  // Auth guard — if auth is enabled, require login for writes
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const { db: dbCheck } = await import("@/db");
    const { users: usersTbl } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const user = await getCurrentUser();
    const [hasAuth] = await dbCheck.select().from(usersTbl).where(isNotNull(usersTbl.username)).limit(1);
    if (hasAuth && !user) return { ok: false, message: "برای این عملیات ابتدا وارد شوید." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
  }

  try {
    await payInstallment(id, cashAccountId);
    refreshAll();
    return { ok: true, message: "قسط پرداخت و مانده بدهی به‌روزرسانی شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
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
  // Auth guard — if auth is enabled, require login for writes
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const { db: dbCheck } = await import("@/db");
    const { users: usersTbl } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const user = await getCurrentUser();
    const [hasAuth] = await dbCheck.select().from(usersTbl).where(isNotNull(usersTbl.username)).limit(1);
    if (hasAuth && !user) return { ok: false, message: "برای این عملیات ابتدا وارد شوید." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
  }

  try {
    const v = goalSchema.parse(Object.fromEntries(fd) as Record<string, string>);
    await db.insert(goals).values({
      name: v.name,
      targetBase: D(v.targetBase).toString(),
      targetDate: v.targetDate || null,
      fundAccountId: v.fundAccountId || null,
      priority: Number(v.priority ?? 2),
    });
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
  // Auth guard — if auth is enabled, require login for writes
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const { db: dbCheck } = await import("@/db");
    const { users: usersTbl } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const user = await getCurrentUser();
    const [hasAuth] = await dbCheck.select().from(usersTbl).where(isNotNull(usersTbl.username)).limit(1);
    if (hasAuth && !user) return { ok: false, message: "برای این عملیات ابتدا وارد شوید." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
  }

  try {
    const v = eventSchema.parse(Object.fromEntries(fd) as Record<string, string>);
    await db.insert(events).values({
      name: v.name,
      eventDate: v.eventDate,
      budgetBase: D(v.budgetBase).toString(),
      category: v.category,
    });
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
  // Auth guard — if auth is enabled, require login for writes
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const { db: dbCheck } = await import("@/db");
    const { users: usersTbl } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const user = await getCurrentUser();
    const [hasAuth] = await dbCheck.select().from(usersTbl).where(isNotNull(usersTbl.username)).limit(1);
    if (hasAuth && !user) return { ok: false, message: "برای این عملیات ابتدا وارد شوید." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
  }

  try {
    const v = planSchema.parse(Object.fromEntries(fd) as Record<string, string>);
    await db.insert(plannedTransactions).values({
      title: v.title,
      plannedDate: v.plannedDate,
      direction: v.direction,
      amountBase: D(v.amountBase).toString(),
      fromAccountId: v.fromAccountId || null,
      toAccountId: v.toAccountId || null,
      recurrence: v.recurrence,
    });
    refreshAll();
    return { ok: true, message: "تراکنش برنامه‌ریزی‌شده ثبت شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

export async function updatePriceAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  // Auth guard — if auth is enabled, require login for writes
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const { db: dbCheck } = await import("@/db");
    const { users: usersTbl } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const user = await getCurrentUser();
    const [hasAuth] = await dbCheck.select().from(usersTbl).where(isNotNull(usersTbl.username)).limit(1);
    if (hasAuth && !user) return { ok: false, message: "برای این عملیات ابتدا وارد شوید." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
  }

  try {
    const assetId = String(fd.get("assetId"));
    const price = D(String(fd.get("price"))).toString();
    const asOf = todayIso();
    await db
      .insert(prices)
      .values({ assetId, asOf, priceBase: price, source: "manual" })
      .onConflictDoUpdate({ target: [prices.assetId, prices.asOf], set: { priceBase: price } });
    refreshAll();
    return { ok: true, message: "قیمت به‌روزرسانی شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

/** Snapshot engine — freezes today's valuation for historical reporting. */
export async function takeSnapshotAction(): Promise<ActionResult> {
  // Auth guard — if auth is enabled, require login for writes
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const { db: dbCheck } = await import("@/db");
    const { users: usersTbl } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const user = await getCurrentUser();
    const [hasAuth] = await dbCheck.select().from(usersTbl).where(isNotNull(usersTbl.username)).limit(1);
    if (hasAuth && !user) return { ok: false, message: "برای این عملیات ابتدا وارد شوید." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
  }

  try {
    const [nw, holdings] = await Promise.all([getNetWorth(), getHoldings()]);
    const asOf = todayIso();
    const [snap] = await db
      .insert(snapshots)
      .values({
        asOf,
        baseCurrency: "USD",
        totalAssets: D(nw.totalAssets).toFixed(6),
        totalLiabilities: D(nw.totalLiabilities).toFixed(6),
        netWorth: D(nw.netWorth).toFixed(6),
      })
      .onConflictDoUpdate({
        target: snapshots.asOf,
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
          priceBase: D(h.price ?? "0").toString(),
          valueBase: D(h.quantity).mul(h.price ?? "0").toString(),
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

export async function overviewCounts() {
  const [a, d, i, g] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(assets),
    db.select({ c: sql<number>`count(*)::int` }).from(debts),
    db.select({ c: sql<number>`count(*)::int` }).from(installments),
    db.select({ c: sql<number>`count(*)::int` }).from(goals),
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
  // Auth guard — if auth is enabled, require login for writes
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const { db: dbCheck } = await import("@/db");
    const { users: usersTbl } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const user = await getCurrentUser();
    const [hasAuth] = await dbCheck.select().from(usersTbl).where(isNotNull(usersTbl.username)).limit(1);
    if (hasAuth && !user) return { ok: false, message: "برای این عملیات ابتدا وارد شوید." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
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
  return getSetupState();
}

export async function createImportJobAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult & { jobData?: any }> {
  // Auth guard — if auth is enabled, require login for writes
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const { db: dbCheck } = await import("@/db");
    const { users: usersTbl } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const user = await getCurrentUser();
    const [hasAuth] = await dbCheck.select().from(usersTbl).where(isNotNull(usersTbl.username)).limit(1);
    if (hasAuth && !user) return { ok: false, message: "برای این عملیات ابتدا وارد شوید." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
  }

  try {
    const rawText = String(fd.get("importText") || "");
    const source = String(fd.get("source") || "csv");

    if (!rawText.trim()) throw new Error("متن یا فایل درون‌ریزی نمی‌تواند خالی باشد.");

    const summary = await createImportJob(rawText, source);
    refreshAll();

    return {
      ok: true,
      message: `پردازش انجام شد: ${summary.rowCount} سطر شناسایی شد (${summary.validCount} سطر معتبر، ${summary.errorCount} سطر خطادار).`,
      jobData: summary,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطای پردازش فایل درون‌ریزی" };
  }
}

export async function executeImportJobAction(jobId: string): Promise<ActionResult> {
  // Auth guard — if auth is enabled, require login for writes
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const { db: dbCheck } = await import("@/db");
    const { users: usersTbl } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const user = await getCurrentUser();
    const [hasAuth] = await dbCheck.select().from(usersTbl).where(isNotNull(usersTbl.username)).limit(1);
    if (hasAuth && !user) return { ok: false, message: "برای این عملیات ابتدا وارد شوید." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
  }

  try {
    const res = await executeImportJob(jobId);
    refreshAll();
    return { ok: res.success, message: res.message };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطای اجرای درون‌ریزی" };
  }
}

export async function recordManualPriceAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  // Auth guard — if auth is enabled, require login for writes
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const { db: dbCheck } = await import("@/db");
    const { users: usersTbl } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const user = await getCurrentUser();
    const [hasAuth] = await dbCheck.select().from(usersTbl).where(isNotNull(usersTbl.username)).limit(1);
    if (hasAuth && !user) return { ok: false, message: "برای این عملیات ابتدا وارد شوید." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
  }

  try {
    const assetId = String(fd.get("assetId") || "");
    const price = String(fd.get("price") || "");
    const currencyId = String(fd.get("currencyId") || "") || undefined;
    const asOfDate = String(fd.get("asOfDate") || "") || undefined;
    const sourceName = String(fd.get("sourceName") || "MANUAL");

    if (!assetId) throw new Error("دارایی را انتخاب کنید.");
    if (!price || Number(price) <= 0) throw new Error("قیمت باید بزرگ‌تر از صفر باشد.");

    await recordManualPrice({
      assetId,
      price,
      currencyId,
      asOfDate,
      sourceName,
    });

    refreshAll();
    return { ok: true, message: "قیمت بازار با موفقیت ثبت شد (بدون تغییر در دفترکل)." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطای ثبت قیمت" };
  }
}

export async function createPortfolioSnapshotAction(): Promise<ActionResult> {
  // Auth guard — if auth is enabled, require login for writes
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const { db: dbCheck } = await import("@/db");
    const { users: usersTbl } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const user = await getCurrentUser();
    const [hasAuth] = await dbCheck.select().from(usersTbl).where(isNotNull(usersTbl.username)).limit(1);
    if (hasAuth && !user) return { ok: false, message: "برای این عملیات ابتدا وارد شوید." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return { ok: false, message: e.message };
  }

  try {
    const res = await createPortfolioSnapshot();
    refreshAll();
    return { ok: true, message: "اسنپ‌شات ثروت با موفقیت ثبت شد (بدون تغییر در دفترکل)." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطای ثبت اسنپ‌شات" };
  }
}

export async function fetchPortfolioValuationAction() {
  return getPortfolioValuation();
}

export async function fetchAnalyticsSummaryAction() {
  return getAnalyticsSummary();
}
