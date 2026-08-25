/**
 * Persian Icons — Iranian Bank, Payment Gateway, Automobile & RWA Logo Mapping
 *
 * Maps institution/brand names (Persian + English keys) → public SVG paths
 * from `persianlabs/icons` (https://github.com/persianlabs/icons).
 *
 * Usage:
 *   const logo = getBankLogo("بانک ملت");        // → "/ir-icons/banks/mellat.svg"
 *   const logo = getAutomobileLogo("iran-khodro"); // → "/ir-icons/automobiles/iran-khodro.svg"
 *   const logo = resolveBrandLogo(name, "bank");   // → auto-detect category
 */

const BASE = "/ir-icons";

/* ─────────────────────── Banks ─────────────────────── */

/** Map every known Persian bank name → SVG slug */
const BANK_MAP: Record<string, string> = {
  // Persian names
  "بانک ملت": "mellat",
  "ملت": "mellat",
  "بانک شهر": "shahr",
  "شهر": "shahr",
  "بانک تجارت": "tejarat",
  "تجارت": "tejarat",
  "بانک ملی": "melli",
  "ملی": "melli",
  "بانک سامان": "saman",
  "سامان": "saman",
  "بانک پاسارگاد": "pasargad",
  "پاسارگاد": "pasargad",
  "بانک پارسیان": "parsian",
  "پارسیان": "parsian",
  "بانک صادرات": "saderat",
  "صادرات": "saderat",
  "بانک سپه": "sepah",
  "سپه": "sepah",
  "بانک اقتصاد نوین": "eghtesad-novin",
  "اقتصاد نوین": "eghtesad-novin",
  "بانک کشاورزی": "keshavarzi",
  "کشاورزی": "keshavarzi",
  "پست بانک": "postbank",
  "پست": "postbank",
  "بلوبانک": "blubank",
  "بانکینو": "bankino",
  "بانک انصار": "ansar",
  "انصار": "ansar",
  "بانک قوامین": "ghavamin",
  "قوامین": "ghavamin",
  "بانک کارآفرین": "karafarin",
  "کارآفرین": "karafarin",
  "بانک رفاه": "refah",
  "رفاه": "refah",
  "بانک مهر ایران": "mehr-iran",
  "مهر ایران": "mehr-iran",
  "بانک آینده": "ayandeh",
  "آینده": "ayandeh",
  "بانک دِی": "dey",
  "دِی": "dey",
  "دی": "dey",
  "بانک رسالت": "resalat",
  "رسالت": "resalat",
  "بانک مسکن": "maskan",
  "مسکن": "maskan",
  "بانک مرکزی": "bank-markazi",
  "مرکزی": "bank-markazi",
  "بانک خاورمیانه": "khavar-mianeh",
  "خاورمیانه": "khavar-mianeh",
  "بانک گردشگری": "gardeshgari",
  "گردشگری": "gardeshgari",
  "بانک ایران زمین": "iran-zamin",
  "ایران زمین": "iran-zamin",
  "بانک سینا": "sina",
  "سینا": "sina",
  "بانک حکمت": "hekmat",
  "حکمت": "hekmat",
  "بانک توسعه": "tosee",
  "توسعه": "tosee",
  "بانک توسعه صادرات": "tosee-saderat",
  "توسعه صادرات": "tosee-saderat",
  "بانک توسعه تعاون": "tosee-taavon",
  "توسعه تعاون": "tosee-taavon",
  "بانک تعاون اسلامی": "taavon-eslami",
  "تعاون اسلامی": "taavon-eslami",
  "بانک صنعت و معدن": "sanat-madan",
  "صنعت و معدن": "sanat-madan",
  "بانک سرمایه": "sarmayeh",
  "سرمایه": "sarmayeh",
  "بانک کاسپین": "caspian",
  "کاسپین": "caspian",
  "بانک فیوچر": "futurebank",
  "فیوچر": "futurebank",
  "بانک ایران و ونزوئلا": "iran-venezuela",
  "ایران و ونزوئلا": "iran-venezuela",
  "بانک ایران و اروپا": "iran-europe",
  "ایران و اروپا": "iran-europe",
  "بانک ملل": "melall",
  "ملل": "melall",
  "بانک نور": "noor",
  "نور": "noor",
  "استاندارد چارترد": "standard-chartered",
  // English slugs
  "mellat": "mellat",
  "shahr": "shahr",
  "tejarat": "tejarat",
  "melli": "melli",
  "saman": "saman",
  "pasargad": "pasargad",
  "parsian": "parsian",
  "saderat": "saderat",
  "sepah": "sepah",
  "eghtesad-novin": "eghtesad-novin",
  "keshavarzi": "keshavarzi",
  "postbank": "postbank",
  "blubank": "blubank",
  "bankino": "bankino",
};

export function getBankLogo(name: string | null | undefined): string | null {
  if (!name) return null;
  const normalized = name.trim();
  const slug = BANK_MAP[normalized] ?? BANK_MAP[normalized.toLowerCase()] ?? null;
  if (!slug) return null;
  return `${BASE}/banks/${slug}.svg`;
}

/* ─────────────────────── Automobiles ─────────────────────── */

const AUTO_MAP: Record<string, string> = {
  "ایران‌خودرو": "iran-khodro",
  "ایران خودرو": "iran-khodro",
  "iran-khodro": "iran-khodro",
  "سایپا": "saipa",
  "saipa": "saipa",
  "پارس‌خودرو": "pars-khodro",
  "پارس خودرو": "pars-khodro",
  "pars-khodro": "pars-khodro",
  "بهمن": "bahman",
  "bahman": "bahman",
  "کرمان موتور": "kerman-motor",
  "kerman-motor": "kerman-motor",
  "کویر": "kavir",
  "kavir": "kavir",
  "نیرومحرکه": "niromotor",
  "نیروموتور": "niromotor",
  "niromotor": "niromotor",
  "زامیاد": "zamyad",
  "zamyad": "zamyad",
};

export function getAutomobileLogo(name: string | null | undefined): string | null {
  if (!name) return null;
  const normalized = name.trim();
  const slug = AUTO_MAP[normalized] ?? AUTO_MAP[normalized.toLowerCase()] ?? null;
  if (!slug) return null;
  return `${BASE}/automobiles/${slug}.svg`;
}

/* ────────────────────── Payment Gateways ─────────────────────── */

const PAYMENT_MAP: Record<string, string> = {
  "زرین‌پال": "zarrinpal",
  "زرین پال": "zarrinpal",
  "zarinpal": "zarrinpal",
  "آیدی‌پی": "idpay",
  "idpay": "idpay",
  "آسان پرداخت": "asan-pardakht",
  "asan-pardakht": "asan-pardakht",
  "دیجی‌پی": "digipay",
  "digipay": "digipay",
  "پی‌پینگ": "payping",
  "payping": "payping",
  "وندار": "vandar",
  "vandar": "vandar",
  "زیبال": "zibal",
  "zibal": "zibal",
  "پی‌فا": "payfa",
  "payfa": "payfa",
  "سداد": "sedad",
  "sedad": "sedad",
  "شاپرک": "shaparak",
  "shaparak": "shaparak",
  "نکست‌پی": "nextpay",
  "nextpay": "nextpay",
  "پاسارگاد پپ": "pasargad-pep",
  "pasargad-pep": "pasargad-pep",
  "سامان کیش": "saman-kish",
  "saman-kish": "saman-kish",
  "حسابیت": "hesabit",
  "hesabit": "hesabit",
};

export function getPaymentGatewayLogo(name: string | null | undefined): string | null {
  if (!name) return null;
  const normalized = name.trim();
  const slug = PAYMENT_MAP[normalized] ?? PAYMENT_MAP[normalized.toLowerCase()] ?? null;
  if (!slug) return null;
  return `${BASE}/payment-gateways/${slug}.svg`;
}

/* ─────────────────────── Real Estate ─────────────────────── */

/** Real estate doesn't have brand logos — use a generic building icon */
export const REAL_ESTATE_LOGO = `${BASE}/realestate/building.svg`;

/* ─────────────────────── Crypto ─────────────────────── */

export const CRYPTO_LOGOS: Record<string, string> = {
  BTC: `${BASE}/crypto/btc.svg`,
  ETH: `${BASE}/crypto/eth.svg`,
  USDT: `${BASE}/crypto/usdt.svg`,
  USDC: `${BASE}/crypto/usdc.svg`,
  BNB: `${BASE}/crypto/bnb.svg`,
};

/* ─────────────────────── Universal Resolver ─────────────────────── */

/**
 * Resolve a brand logo by category. Falls back to a generic default.
 * Category: bank | automobile | payment | realestate | crypto | default
 */
export function resolveBrandLogo(
  name: string | null | undefined,
  category: "bank" | "automobile" | "payment" | "realestate" | "crypto" | "default" = "default",
): string | null {
  if (!name) return null;
  switch (category) {
    case "bank":
      return getBankLogo(name);
    case "automobile":
      return getAutomobileLogo(name);
    case "payment":
      return getPaymentGatewayLogo(name);
    case "realestate":
      return REAL_ESTATE_LOGO;
    case "crypto":
      return CRYPTO_LOGOS[name.toUpperCase()] ?? null;
    default:
      return null;
  }
}

/** Default institution icon for when no specific logo matches. */
export const DEFAULT_INSTITUTION_LOGO = `${BASE}/defaults/bank.svg`;
export const DEFAULT_AUTO_LOGO = `${BASE}/defaults/automobile.svg`;
