import { normalizeBankText } from "./parser";

export type BankIdentifier = { id: string; accountId: string; bankName: string; kind: string; suffix: string };
export const normalizeBankName = (value: string) => normalizeBankText(value).replace(/^بانک\s+/, "").trim();

/** A sender supplied by a Shortcut is not proof of bank or account ownership. */
export function matchBankAccount(source: string, identifiers: BankIdentifier[]) {
  const text = normalizeBankText(source);
  const banks = [...new Set(identifiers.map((i) => normalizeBankName(i.bankName)))].filter((name) => name && new RegExp(`بانک\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s:،؛—-])`).test(text));
  if (banks.length !== 1) return { accountId: undefined, message: "بانک در متن مشخص نیست یا مبهم است؛ حساب را خودتان انتخاب کنید." };
  // Only explicitly labelled identifiers; destination, tracking and balance numbers are excluded.
  const found: { kind: string; value: string }[] = [];
  for (const match of text.matchAll(/(?:^|[\s،؛—])(?:شماره\s+)?(کارت|حساب|شبا)\s*[:：]?\s*((?:IR)?[0-9*Xx•.-]{4,34})(?=$|[\s،؛—])/g)) {
    const before = text.slice(Math.max(0, match.index! - 25), match.index).trim();
    if (/(?:مقصد|به|گیرنده|واریز به|انتقال به)$/.test(before)) continue;
    found.push({ kind: match[1] === "کارت" ? "card" : match[1] === "حساب" ? "account" : "iban", value: match[2] });
  }
  const matches = identifiers.filter((i) => normalizeBankName(i.bankName) === banks[0] && found.some((f) => f.kind === i.kind && f.value.endsWith(i.suffix)));
  const ids = [...new Set(matches.map((i) => i.accountId))];
  if (ids.length !== 1) return { accountId: undefined, message: "شناسهٔ حساب پیدا نشد یا به چند حساب می‌خورد؛ حساب را خودتان انتخاب کنید." };
  // Conflicting labelled identifiers must not silently select one of the accounts.
  if (found.length !== 1) return { accountId: undefined, message: "پیام چند شناسه دارد؛ حساب را از متن بررسی کنید." };
  return { accountId: ids[0], message: `پیشنهاد حساب از بانک ${banks[0]} و شناسهٔ ثبت‌شدهٔ شما؛ قبل از ثبت بررسی کنید.` };
}
