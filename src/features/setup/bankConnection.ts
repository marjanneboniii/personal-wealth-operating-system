import { z } from "zod";
import { normalizeBankName } from "@/features/bankImport/matching";
import { normalizeBankText } from "@/features/bankImport/parser";

export const setupBankIdentifierSchema = z.object({
 accountName: z.string().trim().min(1).max(200),
 bankName: z.string().transform(normalizeBankName).pipe(z.string().min(2).max(60).regex(/^[آ-یءئؤأإۀةa-zA-Z ]+$/)),
 kind: z.enum(["card", "account", "iban"]),
 suffix: z.string().transform(normalizeBankText).pipe(z.string().regex(/^\d{4,8}$/)),
 ownershipConfirmed: z.literal(true),
}).strict();
export type SetupBankIdentifier = Omit<z.infer<typeof setupBankIdentifierSchema>, "ownershipConfirmed"> & { ownershipConfirmed: boolean };
export function validateSetupBankIdentifiers(value: unknown, accountName: string, bankName: string, symbol: string) {
 const rows = z.array(setupBankIdentifierSchema).max(20).parse(value ?? []);
 if (rows.length && (symbol !== "IRT" || !bankName.trim())) throw new Error("برای اتصال پیامک، بانک حساب تومانی را در مرحلهٔ حساب‌ها معرفی کنید.");
 for (const row of rows) {
  if (normalizeBankText(row.accountName) !== normalizeBankText(accountName) || row.bankName !== normalizeBankName(bankName)) throw new Error("حساب یا بانک اتصال با حساب معرفی‌شده یکسان نیست؛ مرحلهٔ اتصال را دوباره بررسی کنید.");
 }
 return rows;
}
