"use server";

import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accounts, assets, journalEntries, bankSmsInbox } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { normalizeNumericInput } from "@/lib/numericInput";
import { todayIso } from "@/lib/format";
import { getCategoryById } from "@/features/categories/service";
import { normalizeBankText } from "@/features/bankImport/parser";
import { getSmsInboxItem, requireSmsSetup } from "@/features/bankImport/sms";
import { createTransactionAction } from "@/app/actions";

export type BankImportResult = {
  ok: boolean;
  message: string;
  entryId?: string;
  duplicate?: boolean;
};

const schema = z.object({
  inboxId: z.uuid().optional(),
  openingConfirmed: z.string().optional(),
  source: z.string().trim().min(1).max(8000),
  type: z.enum(["expense", "income", "transfer"]),
  accountId: z.uuid(),
  destinationId: z.string().optional(),
  categoryId: z.string().optional(),
  amountToman: z.string().regex(/^\d{1,18}$/).refine((v) => BigInt(v) > 0n, "مبلغ باید مثبت باشد."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(2).max(200),
  confirmed: z.literal("yes"),
  rateConfirmed: z.literal("yes"),
  expectedRate: z.string().regex(/^\d+(?:\.\d+)?$/).max(40),
  allowSimilar: z.string().optional(),
});

/** No write occurs until an authenticated user explicitly confirms the review. */
export async function confirmBankImportAction(fd: FormData): Promise<BankImportResult> {
  let claimed: { id: string; userId: string; at: Date } | null = null;
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, message: "برای ثبت ابتدا وارد شوید." };
    await requireSmsSetup(user.id);
    const fields = Object.fromEntries(fd);
    fields.amountToman = normalizeNumericInput(fields.amountToman, { decimal: true });
    const parsed = schema.safeParse(fields);
    if (!parsed.success) return { ok: false, message: "مبلغ صحیح به تومان، تاریخ، شرح و تأییدهای لازم را بررسی کنید." };
    const v = parsed.data;
    const inbox = v.inboxId ? await getSmsInboxItem(user.id, v.inboxId) : null;
    if (v.inboxId && (!inbox || inbox.status === "rejected")) return { ok: false, message: "پیام قابل ثبت نیست." };
    if (v.inboxId && v.openingConfirmed !== "yes") return { ok: false, message: "تأیید کنید این مبلغ در موجودی افتتاحیه منظور نشده است." };
    const time = new Date(`${v.date}T00:00:00Z`);
    if (!Number.isFinite(time.getTime()) || time.toISOString().slice(0, 10) !== v.date || v.date > todayIso() || v.date < "1900-01-01") {
      return { ok: false, message: "تاریخ واقعی و معتبر تراکنش را انتخاب کنید؛ تاریخ آینده مجاز نیست." };
    }
    const ids = [v.accountId];
    if (v.type === "transfer") {
      if (!z.uuid().safeParse(v.destinationId).success || v.destinationId === v.accountId) return { ok: false, message: "حساب مقصد متفاوت را انتخاب کنید." };
      ids.push(v.destinationId!);
    }
    const owned = await db.select({ id: accounts.id, symbol: assets.symbol }).from(accounts)
      .innerJoin(assets, eq(accounts.assetId, assets.id))
      .where(and(inArray(accounts.id, ids), eq(accounts.userId, user.id), eq(accounts.type, "asset"), eq(accounts.isActive, true), isNull(accounts.deletedAt), isNull(assets.deletedAt)));
    // Keep this first version entirely in native Toman; investment/crypto accounts cannot be posted here.
    if (owned.length !== ids.length || owned.some((a) => a.symbol !== "IRT")) return { ok: false, message: "فقط حساب‌های پول فعال و تومانی متعلق به شما قابل انتخاب هستند." };
    if (v.type !== "transfer") {
      if (!v.categoryId || !z.uuid().safeParse(v.categoryId).success) return { ok: false, message: "دسته یا منبع تراکنش را انتخاب و تأیید کنید." };
      const category = await getCategoryById(v.categoryId, user.id);
      if (!category || !category.isActive || category.kind !== v.type || category.level !== 1 || category.nature === "non_cash") return { ok: false, message: "یک زیردستهٔ نقدی و فعال متناسب با نوع تراکنش انتخاب کنید." };
    }

    const fingerprint = inbox?.fingerprint ?? createHash("sha256").update(normalizeBankText(v.source)).digest("hex");
    const key = `bank-import:${fingerprint}`;
    const existing = async () => (await db.select({ id: journalEntries.id }).from(journalEntries)
      .where(and(eq(journalEntries.userId, user.id), eq(journalEntries.idempotencyKey, key))).limit(1))[0];
    const replay = await existing();
    if (replay && inbox) await db.update(bankSmsInbox).set({ status: "confirmed", entryId: replay.id, encryptedPayload: null }).where(and(eq(bankSmsInbox.id, inbox.id), eq(bankSmsInbox.userId, user.id)));
    if (replay) return { ok: true, message: "این مورد قبلاً ثبت شده؛ سند جدیدی ساخته نشد.", entryId: replay.id };

    // Also catch manual postings and the other side of an already-recorded transfer.
    const similar = await db.execute(sql`
      select distinct je.id from journal_entries je
      join postings p on p.entry_id = je.id
      where je.user_id = ${user.id} and je.status = 'posted'
        and je.entry_date = ${v.date}::date
        and p.account_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
        and abs(abs(p.quantity) - ${v.amountToman}::numeric) <= 0.000001
      limit 1
    `);
    if (similar.rows.length && v.allowSimilar !== "yes") return { ok: false, duplicate: true, message: "در این تاریخ، جابه‌جایی با همین مبلغ در حساب انتخاب‌شده وجود دارد. احتمال ثبت تکراری را بررسی کنید." };

    if (inbox) {
      const at = new Date();
      const rows = await db.update(bankSmsInbox).set({ status: "processing", processingAt: at }).where(and(eq(bankSmsInbox.id, inbox.id), eq(bankSmsInbox.userId, user.id), sql`(status = 'pending' or (status = 'processing' and processing_at < now() - interval '5 minutes'))`)).returning({ id: bankSmsInbox.id });
      if (!rows.length) return { ok: false, message: "این پیام در حال ثبت است؛ چند لحظه بعد تازه‌سازی کنید." };
      claimed = { id: inbox.id, userId: user.id, at };
    }
    // Whitelist the existing form contract. Raw SMS/account identifiers are never persisted.
    const transaction = new FormData();
    transaction.set("type", v.type);
    transaction.set("primaryAccountId", v.accountId);
    if (v.type === "transfer") transaction.set("counterAccountId", v.destinationId!);
    else transaction.set("categoryId", v.categoryId!);
    transaction.set("irtAmount", v.amountToman);
    if (v.type === "income") transaction.set("nativeAmount", v.amountToman);
    transaction.set("entryDate", v.date);
    transaction.set("description", v.description);
    transaction.set("idempotencyKey", key);
    transaction.set("bankImport", "confirmed");
    transaction.set("expectedBankRate", v.expectedRate);
    const result = await createTransactionAction(null, transaction);
    const entry = await existing();
    // A concurrent replay may have reached the unique constraint; the committed entry wins.
    if (entry && inbox) await db.update(bankSmsInbox).set({ status: "confirmed", entryId: entry.id, encryptedPayload: null, processingAt: null }).where(and(eq(bankSmsInbox.id, inbox.id), eq(bankSmsInbox.userId, user.id)));
    if (entry) return { ok: true, message: "تراکنش تأیید و ثبت شد.", entryId: entry.id };
    return result;
  } catch {
    return { ok: false, message: "ثبت انجام نشد؛ راه‌اندازی اولیه، اتصال و دسترسی حساب را بررسی کنید." };
  } finally {
    if (claimed) await db.update(bankSmsInbox).set({ status: "pending", processingAt: null }).where(and(eq(bankSmsInbox.id, claimed.id), eq(bankSmsInbox.userId, claimed.userId), eq(bankSmsInbox.status, "processing"), eq(bankSmsInbox.processingAt, claimed.at))).catch(() => {});
  }
}
