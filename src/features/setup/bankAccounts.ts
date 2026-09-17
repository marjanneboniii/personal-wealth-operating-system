import { z } from "zod";
import { normalizeBankText } from "@/features/bankImport/parser";
import { normalizeBankName } from "@/features/bankImport/matching";
export const setupBankAccountSchema = z.object({
 name: z.string().transform(normalizeBankText).pipe(z.string().min(1).max(200)),
 bankName: z.string().transform(normalizeBankName).pipe(z.string().min(2).max(60).regex(/^[آ-یءئؤأإۀةa-zA-Z ]+$/)),
 balance: z.string().transform(normalizeBankText).pipe(z.string().regex(/^\d{1,18}$/)),
}).strict();
export type SetupBankAccount = z.infer<typeof setupBankAccountSchema>;
export function validateSetupBankAccounts(value: unknown) {
 const rows = z.array(setupBankAccountSchema).min(1).max(10).parse(value);
 if (new Set(rows.map((row) => row.name)).size !== rows.length) throw new Error("نام حساب‌های بانکی باید متفاوت باشد؛ برای هر حساب نام مشخصی بنویسید.");
 return rows;
}
