import { normalizeBankText } from "@/features/bankImport/parser";
export type BankIdentifierKind = "card" | "iban" | "account";
/** Local format/checksum validation; never claims ownership or bank verification. */
export function normalizeBankIdentifier(kind: BankIdentifierKind, raw: string): string {
  const value = normalizeBankText(raw).replace(/[\s-]/g, "").toUpperCase();
  if (kind === "account") {
    if (!/^\d{5,24}$/.test(value) || /^0+$/.test(value)) throw new Error("شماره حساب باید ۵ تا ۲۴ رقم باشد.");
    return value;
  }
  if (kind === "card") {
    if (!/^\d{16}$/.test(value) || /^(\d)\1+$/.test(value)) throw new Error("شماره کارت باید ۱۶ رقم معتبر باشد.");
    const sum = [...value].reduce((n,d,i) => { const v=Number(d)*(i%2===0?2:1);return n+(v>9?v-9:v);},0);
    if(sum%10!==0) throw new Error("رقم کنترلی شماره کارت معتبر نیست.");
    return value;
  }
  const iban = value.startsWith("IR") ? value : `IR${value}`;
  if(!/^IR\d{24}$/.test(iban)) throw new Error("شبا باید IR و ۲۴ رقم باشد.");
  const rotated=iban.slice(4)+"1827"+iban.slice(2,4);
  if(BigInt(rotated)%97n!==1n) throw new Error("رقم کنترلی شبا معتبر نیست.");
  return iban;
}
