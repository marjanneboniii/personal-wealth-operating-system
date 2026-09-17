import { z } from "zod";
import { normalizeBankName } from "@/features/bankImport/matching";
import { normalizeBankText } from "@/features/bankImport/parser";

export const setupBankIdentifierSchema = z.object({
 accountName: z.string().transform(normalizeBankText).pipe(z.string().min(1).max(200)),
 bankName: z.string().transform(normalizeBankName).pipe(z.string().min(2).max(60).regex(/^[آ-یءئؤأإۀةa-zA-Z ]+$/)),
 kind: z.enum(["card", "account", "iban"]),
 suffix: z.string().transform(normalizeBankText).pipe(z.string().regex(/^\d{4,8}$/)),
 ownershipConfirmed: z.literal(true),
}).strict();
export type SetupBankIdentifier = Omit<z.infer<typeof setupBankIdentifierSchema>, "ownershipConfirmed"> & { ownershipConfirmed: boolean };
export function validateSetupBankIdentifiers(value: unknown, accountName: string, bankName: string, symbol: string, additional: { name: string; bankName: string }[] = []) {
 const rows = z.array(setupBankIdentifierSchema).max(20).parse(value ?? []);
 const banks = [{ name: accountName, bankName, symbol }, ...additional.map((bank) => ({ ...bank, symbol: "IRT" }))];
 for (const row of rows) {
  const matches = banks.filter((bank) => normalizeBankText(bank.name) === normalizeBankText(row.accountName) && normalizeBankName(bank.bankName) === row.bankName && bank.symbol === "IRT");
  if (matches.length !== 1) throw new Error("حساب یا بانک اتصال با حساب معرفی‌شده یکسان نیست؛ مرحلهٔ اتصال را دوباره بررسی کنید.");
 }
 return rows;
}
