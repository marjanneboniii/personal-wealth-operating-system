"use server";
import { getSetupReadyUser } from "@/lib/authGuard";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { accounts, assets, bankSmsIdentifiers, users } from "@/db/schema";
import { normalizeBankIdentifier } from "@/features/accounts/bankDetails";
import { encryptSensitive, decryptSensitive } from "@/lib/fieldEncryption";
import { isSmsBankAccount } from "@/features/bankImport/identifiers";
import { normalizeBankName } from "@/features/bankImport/matching";
import { normalizeBankText } from "@/features/bankImport/parser";

export async function addBankIdentifierAction(input: unknown) {
 try {
  const user = await getSetupReadyUser();
  if (!user) return { ok: false, message: "ابتدا وارد شوید." };
  const parsed = z.object({ accountId: z.uuid(), bankName: z.string().transform(normalizeBankName).pipe(z.string().min(2).max(60).regex(/^[آ-یءئؤأإۀةa-zA-Z ]+$/)), kind: z.enum(["card", "account", "iban"]), suffix: z.string().transform(normalizeBankText).pipe(z.string().regex(/^\d{4,8}$/)).optional(), number: z.string().max(64).optional() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, message: "بانک، حساب و شماره معتبر یا ۴ تا ۸ رقم پایانی شناسه را وارد کنید." };
  const {number,...v} = parsed.data;
  const fullNumber = number ? normalizeBankIdentifier(v.kind,number) : null;
  const suffix = fullNumber ? fullNumber.slice(-4) : v.suffix;
  if (!suffix) return {ok:false,message:"شماره یا چند رقم پایانی شناسه را وارد کنید."};
  await db.transaction(async (tx) => {
   await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update");
   // Only a Toman account held at a bank receives bank messages.
   if (!(await isSmsBankAccount(user.id, v.accountId, tx))) throw new Error("Invalid account");
   const rows = await tx.select({ id: bankSmsIdentifiers.id }).from(bankSmsIdentifiers).where(eq(bankSmsIdentifiers.userId, user.id));
   if (rows.length >= 100) throw new Error("Limit");
   if (fullNumber) {
     const [account] = await tx.select({details:accounts.bankDetailsEncrypted}).from(accounts).where(and(eq(accounts.id,v.accountId),eq(accounts.userId,user.id))).for("update");
     if (!account) throw new Error("Invalid account");
     const context=`bank-account:${user.id}:${v.accountId}`;
     const details=account.details ? JSON.parse(decryptSensitive(account.details,context)!) : {};
     details[v.kind]=fullNumber;
     await tx.update(accounts).set({bankDetailsEncrypted:encryptSensitive(JSON.stringify(details),context)}).where(and(eq(accounts.id,v.accountId),eq(accounts.userId,user.id)));
   }
   await tx.insert(bankSmsIdentifiers).values({ ...v, suffix, userId: user.id }).onConflictDoNothing();
  });
  revalidatePath("/accounts");
  revalidatePath("/transactions/import");
  revalidatePath("/setup/messages");
  return { ok: true, message: "شناسه به حساب وصل شد؛ موجودی حساب تغییر نکرد." };
 } catch { return { ok: false, message: "ثبت شناسه انجام نشد؛ حساب فعال و سقف ۱۰۰ شناسه را بررسی کنید." }; }
}
export async function removeBankIdentifierAction(id: string) {
 try {
  const user = await getSetupReadyUser();
  if (!user || !z.uuid().safeParse(id).success) return { ok: false, message: "دسترسی مجاز نیست." };
  const rows=await db.transaction(async tx=>{
    const removed=await tx.delete(bankSmsIdentifiers).where(and(eq(bankSmsIdentifiers.userId,user.id),eq(bankSmsIdentifiers.id,id))).returning({id:bankSmsIdentifiers.id,accountId:bankSmsIdentifiers.accountId,kind:bankSmsIdentifiers.kind,suffix:bankSmsIdentifiers.suffix});
    const mapping=removed[0];
    if(mapping) {
      const [account]=await tx.select({details:accounts.bankDetailsEncrypted}).from(accounts).where(and(eq(accounts.id,mapping.accountId),eq(accounts.userId,user.id))).for("update");
      if(account?.details) {
        const context=`bank-account:${user.id}:${mapping.accountId}`;
        const details=JSON.parse(decryptSensitive(account.details,context)!);
        if(typeof details[mapping.kind] === "string" && details[mapping.kind].endsWith(mapping.suffix)) {
          delete details[mapping.kind];
          await tx.update(accounts).set({bankDetailsEncrypted:Object.keys(details).length ? encryptSensitive(JSON.stringify(details),context) : null}).where(and(eq(accounts.id,mapping.accountId),eq(accounts.userId,user.id)));
        }
      }
    }
    return removed;
  });
  revalidatePath("/accounts");
  revalidatePath("/transactions/import");
  revalidatePath("/setup/messages");
  return { ok: !!rows.length, message: rows.length ? "اتصال شناسه حذف شد؛ حساب و تراکنش‌ها باقی هستند." : "شناسه پیدا نشد." };
 } catch { return { ok: false, message: "حذف انجام نشد." }; }
}
