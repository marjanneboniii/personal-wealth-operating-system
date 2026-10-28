/**
 * Which bank a card or IBAN belongs to — from its first six digits (BIN) or the
 * three-digit bank code after «IRkk». Used only to pre-select the bank while
 * the user types; they can always pick another. The list follows the
 * published Shaparak prefixes and may lag a new card range, so an unknown
 * prefix simply detects nothing. Merged banks (انصار، قوامین، حکمت، کوثر، مهر
 * اقتصاد → سپه) are left out: their old cards now belong to a bank the user
 * picks by hand.
 *
 * PURE: shared by the identifier form (client) and tests.
 */
import { SETUP_BANKS, type SetupBankOption } from "@/features/setup/bankCatalog";
import { toLatinDigits } from "@/lib/format";

/** Catalogue name → card BINs. Names match `bankCatalog` entries exactly. */
const CARD_BINS: Record<string, readonly string[]> = {
  "بانک ملی ایران": ["603799"],
  "بانک سپه": ["589210"],
  "بانک توسعه صادرات ایران": ["627648", "207177"],
  "بانک صنعت و معدن": ["627961"],
  "بانک کشاورزی": ["603770", "639217"],
  "بانک مسکن": ["628023"],
  "پست بانک ایران": ["627760"],
  "بانک توسعه تعاون": ["502908"],
  "بانک اقتصاد نوین": ["627412"],
  "بانک پارسیان": ["622106", "639194", "627884"],
  "بانک پاسارگاد": ["502229", "639347"],
  "بانک کارآفرین": ["627488", "502910"],
  "بانک سامان": ["621986"],
  "بانک سینا": ["639346"],
  "بانک سرمایه": ["639607"],
  "بانک آینده": ["636214"],
  "بانک شهر": ["502806", "504706"],
  "بانک دی": ["502938"],
  "بانک صادرات ایران": ["603769"],
  "بانک ملت": ["610433", "991975"],
  "بانک تجارت": ["627353", "585983"],
  "بانک رفاه کارگران": ["589463"],
  "بانک قرض‌الحسنه رسالت": ["504172"],
  "بانک قرض‌الحسنه مهر ایران": ["606373"],
  "بانک ایران زمین": ["505785"],
  "بانک گردشگری": ["505416"],
  "بانک خاورمیانه": ["585947"],
  "بانک ایران ونزوئلا": ["581874"],
};

/** Catalogue name → the bank code in an IBAN (IRkk·BBB·…). */
const IBAN_CODES: Record<string, string> = {
  "بانک صنعت و معدن": "011",
  "بانک ملت": "012",
  "بانک رفاه کارگران": "013",
  "بانک مسکن": "014",
  "بانک سپه": "015",
  "بانک کشاورزی": "016",
  "بانک ملی ایران": "017",
  "بانک تجارت": "018",
  "بانک صادرات ایران": "019",
  "بانک توسعه صادرات ایران": "020",
  "پست بانک ایران": "021",
  "بانک توسعه تعاون": "022",
  "بانک کارآفرین": "053",
  "بانک پارسیان": "054",
  "بانک اقتصاد نوین": "055",
  "بانک سامان": "056",
  "بانک پاسارگاد": "057",
  "بانک سرمایه": "058",
  "بانک سینا": "059",
  "بانک قرض‌الحسنه مهر ایران": "060",
  "بانک شهر": "061",
  "بانک آینده": "062",
  "بانک گردشگری": "064",
  "بانک دی": "066",
  "بانک ایران زمین": "069",
  "بانک قرض‌الحسنه رسالت": "070",
  "بانک خاورمیانه": "078",
};

const BY_NAME = new Map(SETUP_BANKS.map((b) => [b.name, b]));
const BIN_INDEX = new Map<string, SetupBankOption>();
for (const [name, bins] of Object.entries(CARD_BINS)) {
  const bank = BY_NAME.get(name);
  if (bank) for (const bin of bins) BIN_INDEX.set(bin, bank);
}
const IBAN_INDEX = new Map<string, SetupBankOption>();
for (const [name, code] of Object.entries(IBAN_CODES)) {
  const bank = BY_NAME.get(name);
  if (bank) IBAN_INDEX.set(code, bank);
}

/** «۶۰۳۷ ۹۹۱۲…» → the bank, once six digits are known; null otherwise. */
export function bankOfCard(raw: string): SetupBankOption | null {
  const digits = toLatinDigits(raw).replace(/\D/g, "");
  return digits.length >= 6 ? BIN_INDEX.get(digits.slice(0, 6)) ?? null : null;
}

/** «IR06 0170 …» (IR optional) → the bank, once the bank code is known; null otherwise. */
export function bankOfIban(raw: string): SetupBankOption | null {
  const compact = toLatinDigits(raw).replace(/[\s-]/g, "").toUpperCase();
  const digits = compact.startsWith("IR") ? compact.slice(2) : compact;
  if (!/^\d{5,}/.test(digits)) return null;
  // IR · 2 check digits · 3-digit bank code: IR06 017 0… is بانک ملی.
  return IBAN_INDEX.get(digits.slice(2, 5)) ?? null;
}
