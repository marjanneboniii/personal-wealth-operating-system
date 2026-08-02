"use server";

import { revalidatePath } from "next/cache";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  accounts,
  assets,
  debts,
  events,
  goals,
  installments,
  plannedTransactions,
  prices,
  snapshotLines,
  snapshots,
} from "@/db/schema";
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
import { getHoldings, getNetWorth } from "@/features/ledger/queries";
import { todayIso } from "@/lib/format";

export type ActionResult = { ok: boolean; message: string };

function refreshAll() {
  for (const p of ["/", "/portfolio", "/ledger", "/planning", "/debts", "/reports", "/accounts"]) {
    revalidatePath(p);
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
  amount: z.string().min(1),
  quantity: z.string().optional(),
  fee: z.string().optional(),
});

export async function createTransactionAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const input = txSchema.parse(Object.fromEntries(fd) as Record<string, string>);
    const amount = D(input.amount);
    if (amount.lte(0)) throw new Error("مبلغ باید بزرگ‌تر از صفر باشد");
    const fee = input.fee ? D(input.fee).toString() : "0";

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
      if (input.type === "income") await recordIncome(cmd);
      else await recordExpense(cmd);
    } else if (input.type === "transfer") {
      const assetId = await accountAsset(input.primaryAccountId);
      const price = await latestPrice(assetId);
      const qty = input.quantity && D(input.quantity).gt(0) ? input.quantity : amount.div(price).toString();
      await recordTransfer({
        entryDate: input.entryDate,
        description: input.description,
        fromAccountId: input.primaryAccountId,
        toAccountId: input.counterAccountId,
        assetId,
        quantity: qty,
        unitPrice: price,
        feeBase: fee,
        feeAccountId: (await db.select().from(accounts).where(eq(accounts.code, "5040")).limit(1))[0]?.id,
      });
    } else {
      // buy / sell — primary = asset account, counter = cash account
      const assetId = await accountAsset(input.primaryAccountId);
      const cashAssetId = await accountAsset(input.counterAccountId);
      const cashPrice = await latestPrice(cashAssetId);
      const qty = input.quantity && D(input.quantity).gt(0) ? input.quantity : "0";
      if (D(qty).lte(0)) throw new Error("مقدار دارایی را وارد کنید");
      const cashQuantity = amount.div(cashPrice).toString();
      const feeAccountId = (await db.select().from(accounts).where(eq(accounts.code, "5040")).limit(1))[0]?.id ?? null;
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
      if (input.type === "buy") await recordBuy(common);
      else {
        const pnl = (await db.select().from(accounts).where(eq(accounts.code, "4100")).limit(1))[0];
        if (!pnl) throw new Error("حساب سود سرمایه‌ای تعریف نشده است");
        await recordSell({ ...common, pnlAccountId: pnl.id });
      }
    }

    refreshAll();
    return { ok: true, message: "سند با موفقیت در دفترکل ثبت شد." };
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : "خطای ناشناخته";
    return { ok: false, message: msg };
  }
}

export async function reverseEntryAction(entryId: string): Promise<ActionResult> {
  try {
    await reverseEntry(entryId);
    refreshAll();
    return { ok: true, message: "سند معکوس ثبت و سند اصلی ابطال شد." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

export async function executePlanAction(id: string): Promise<ActionResult> {
  try {
    await executePlanned(id);
    refreshAll();
    return { ok: true, message: "برنامه اجرا شد و به دفترکل رفت." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "خطا" };
  }
}

export async function payInstallmentAction(id: string, cashAccountId: string): Promise<ActionResult> {
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
    ? { ok: true, message: "بررسی یکپارچگی: همه اسناد دفترکل تراز هستند ✅" }
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
