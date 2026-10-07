import { normalizeBankName } from "@/features/bankImport/matching";
import { normalizeBankText } from "@/features/bankImport/parser";

export type SetupBankOption = { name: string; value: string; logo: string };

// The institutions in the supplied reference, in display order. Bitcoin is
// intentionally excluded: it belongs to the separate crypto holdings step.
const entries = [
  ["آبانک", "abank"],
  ["آمریکن اکسپرس", "american-express"],
  ["بانک آینده", "ayandeh"],
  ["بانک اقتصاد نوین", "eghtesad-novin"],
  ["بانک ایران زمین", "iran-zamin"],
  ["بانک ایران ونزوئلا", "iran-venezuela"],
  ["بانک پارسیان", "parsian"],
  ["بانک پاسارگاد", "pasargad"],
  ["بانک تجارت", "tejarat"],
  ["بانک توسعه تعاون", "tosee-taavon"],
  ["بانک توسعه صادرات ایران", "tosee-saderat"],
  ["بانک خاورمیانه", "khavar-mianeh"],
  ["بانک دی", "dey"],
  ["بانک رفاه کارگران", "refah"],
  ["بانک سامان", "saman"],
  ["بانک سپه", "sepah"],
  ["بانک سرمایه", "sarmayeh"],
  ["بانک سینا", "sina"],
  ["بانک شهر", "shahr"],
  ["بانک صادرات ایران", "saderat"],
  ["بانک صنعت و معدن", "sanat-madan"],
  ["بانک قرض‌الحسنه رسالت", "resalat"],
  ["بانک قرض‌الحسنه مهر ایران", "mehr-iran"],
  ["بانک کارآفرین", "karafarin"],
  ["بانک کشاورزی", "keshavarzi"],
  ["بانک گردشگری", "gardeshgari"],
  ["بانک مسکن", "maskan"],
  ["بانک ملت", "mellat"],
  ["بانک ملی ایران", "melli"],
  ["بانکینو", "bankino"],
  ["بلوبانک", "blubank"],
  ["پست بانک ایران", "postbank"],
  ["پی پال", "paypal"],
  ["تو بانک", "tobank"],
  ["زرین پال", "zarrinpal"],
  ["فردا بانک", "farda"],
  ["مستر کارت", "mastercard"],
  ["موسسه اعتباری کاسپین", "caspian"],
] as const;

const referenceLogos = new Set(["abank", "american-express", "paypal", "tobank", "farda", "mastercard"]);
export const SETUP_BANKS: readonly SetupBankOption[] = entries.map(([name, slug]) => ({
  name,
  value: normalizeBankName(name),
  logo: referenceLogos.has(slug) ? `/icons/banks/${slug}.png`
    : slug === "zarrinpal" ? `/ir-icons/payment-gateways/${slug}.svg`
    : `/ir-icons/banks/${slug}.svg`,
}));

export function searchSetupBanks(query: string) {
  const normalized = normalizeBankText(query).replace(/\s/g, "").toLowerCase();
  return SETUP_BANKS.filter((bank) => normalizeBankText(bank.name).replace(/\s/g, "").toLowerCase().includes(normalized));
}

export function suggestedBankAccountName(bank: SetupBankOption, otherNames: string[]) {
  let name = bank.name;
  let suffix = 2;
  const used = new Set(otherNames.map(normalizeBankText));
  while (used.has(normalizeBankText(name))) name = `${bank.name} ${suffix++}`;
  return name;
}

export function isSuggestedBankAccountName(name: string, bank?: SetupBankOption) {
  if (!name.trim()) return true;
  if (!bank) return false;
  const normalized = normalizeBankText(name);
  return normalized === bank.name || (normalized.startsWith(`${bank.name} `) && /^\d+$/.test(normalized.slice(bank.name.length + 1)));
}
