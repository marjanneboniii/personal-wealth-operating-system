"use server";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { accounts, assets, bankSmsIdentifiers, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { requireSmsSetup } from "@/features/bankImport/sms";
import { normalizeBankName } from "@/features/bankImport/matching";
import { normalizeBankText } from "@/features/bankImport/parser";

export async function addBankIdentifierAction(input: unknown) {
 try {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "ابتدا وارد شوید." };
  await requireSmsSetup(user.id);
  const parsed = z.object({ accountId: z.uuid(), bankName: z.string().transform(normalizeBankName).pipe(z.string().min(2).max(60).regex(/^[آ-یءئؤأإۀةa-zA-Z ]+$/)), kind: z.enum(["card", "account", "iban"]), suffix: z.string().transform(normalizeBankText).pipe(z.string().regex(/^\d{4,8}$/)) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, message: "بانک، حساب و فقط ۴ تا ۸ رقم پایانی شناسه را وارد کنید." };
  const v = parsed.data;
  await db.transaction(async (tx) => {
   await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update");
   const [account] = await tx.select({ id: accounts.id }).from(accounts).innerJoin(assets, eq(assets.id, accounts.assetId)).where(and(eq(accounts.id, v.accountId), eq(accounts.userId, user.id), eq(accounts.type, "asset"), eq(accounts.isActive, true), eq(assets.symbol, "IRT"), isNull(accounts.deletedAt), isNull(assets.deletedAt)));
   if (!account) throw new Error("Invalid account");
   const rows = await tx.select({ id: bankSmsIdentifiers.id }).from(bankSmsIdentifiers).where(eq(bankSmsIdentifiers.userId, user.id));
   if (rows.length >= 100) throw new Error("Limit");
   await tx.insert(bankSmsIdentifiers).values({ ...v, userId: user.id }).onConflictDoNothing();
  });
  revalidatePath("/transactions/import");
  return { ok: true, message: "شناسه به حساب وصل شد؛ موجودی حساب تغییر نکرد." };
 } catch { return { ok: false, message: "ثبت شناسه انجام نشد؛ حساب فعال و سقف ۱۰۰ شناسه را بررسی کنید." }; }
}
export async function removeBankIdentifierAction(id: string) {
 try {
  const user = await getCurrentUser();
  if (!user || !z.uuid().safeParse(id).success) return { ok: false, message: "دسترسی مجاز نیست." };
  await requireSmsSetup(user.id);
  const rows = await db.delete(bankSmsIdentifiers).where(and(eq(bankSmsIdentifiers.userId, user.id), eq(bankSmsIdentifiers.id, id))).returning({ id: bankSmsIdentifiers.id });
  revalidatePath("/transactions/import");
  return { ok: !!rows.length, message: rows.length ? "اتصال شناسه حذف شد؛ حساب و تراکنش‌ها باقی هستند." : "شناسه پیدا نشد." };
 } catch { return { ok: false, message: "حذف انجام نشد." }; }
}
