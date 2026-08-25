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
  const trimmed = name.trim();
  const slug = BANK_MAP[trimmed] ?? BANK_MAP[trimmed.toLowerCase()] ?? null;
  if (slug) return `${BASE}/banks/${slug}.svg`;
  const normalized = trimmed.replace(/^بانک\s+/, "").trim();
  const nested = BANK_MAP[normalized] ?? BANK_MAP[normalized.toLowerCase()] ?? null;
  if (nested) return `${BASE}/banks/${nested}.svg`;
  for (const [key, value] of Object.entries(BANK_MAP)) {
    if (key.length >= 3 && (trimmed.includes(key) || key.includes(normalized))) {
      return `${BASE}/banks/${value}.svg`;
    }
  }
  return null;
}

/* ─────────────────────── Automobiles ─────────────────────── */

const AUTO_MAP: Record<string, string> = {
  "ایران‌خودرو": "iran-khodro",
  "ایران خودرو": "iran-khodro",
  "ایرانخودرو": "iran-khodro",
  "iran khodro": "iran-khodro",
  "iran-khodro": "iran-khodro",
  ikco: "iran-khodro",
  "سایپا": "saipa",
  saipa: "saipa",
  "پارس‌خودرو": "pars-khodro",
  "پارس خودرو": "pars-khodro",
  "pars-khodro": "pars-khodro",
  "بهمن": "bahman",
  "بهمن موتور": "bahman",
  bahman: "bahman",
  "کرمان موتور": "kerman-motor",
  "kerman motor": "kerman-motor",
  "kerman-motor": "kerman-motor",
  "کویر": "kavir",
  kavir: "kavir",
  "نیرومحرکه": "niromotor",
  "نیروموتور": "niromotor",
  niromotor: "niromotor",
  "زامیاد": "zamyad",
  zamyad: "zamyad",
};

function normalizeBrand(input: string): string {
  return input
    .replace(/[\u200c\u200f\u200e]/g, "")
    .replace(/‌/g, "")
    .replace(/[-_/\\.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function getAutomobileLogo(name: string | null | undefined): string | null {
  if (!name) return null;
  const normalized = normalizeBrand(name);
  const direct = AUTO_MAP[name.trim()] ?? AUTO_MAP[normalized] ?? null;
  if (direct) return `${BASE}/automobiles/${direct}.svg`;
  for (const [key, slug] of Object.entries(AUTO_MAP)) {
    const k = normalizeBrand(key);
    if (k.length >= 3 && (normalized.includes(k) || k.includes(normalized))) {
      return `${BASE}/automobiles/${slug}.svg`;
    }
  }
  return null;
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
  if (category === "realestate") return REAL_ESTATE_LOGO;
  if (!name) return null;
  switch (category) {
    case "bank":
      return getBankLogo(name);
    case "automobile":
      return getAutomobileLogo(name);
    case "payment":
      return getPaymentGatewayLogo(name);
    case "crypto":
      return CRYPTO_LOGOS[name.toUpperCase()] ?? null;
    default:
      return null;
  }
}

/** Default institution icon for when no specific logo matches. */
export const DEFAULT_INSTITUTION_LOGO = `${BASE}/defaults/bank.svg`;
export const DEFAULT_AUTO_LOGO = `${BASE}/defaults/automobile.svg`;
export const TOMAN_LOGO = `${BASE}/defaults/toman.svg`;
export const USD_LOGO = `${BASE}/defaults/usd.svg`;

const CATEGORY_FALLBACK: Record<string, string> = {
  bank: DEFAULT_INSTITUTION_LOGO,
  automobile: DEFAULT_AUTO_LOGO,
  payment: DEFAULT_INSTITUTION_LOGO,
  realestate: REAL_ESTATE_LOGO,
  crypto: `${BASE}/crypto/usdt.svg`,
  default: DEFAULT_INSTITUTION_LOGO,
};

export function categoryFallback(category: string): string {
  return CATEGORY_FALLBACK[category] ?? DEFAULT_INSTITUTION_LOGO;
}

/** Resolve a display logo for a holding / account row (presentation only). */
export function resolveHoldingLogo(input: {
  symbol?: string | null;
  name?: string | null;
  className?: string | null;
  logoUrl?: string | null;
  brandName?: string | null;
}): string {
  if (input.logoUrl) return input.logoUrl;
  const symbol = (input.symbol ?? "").toUpperCase();
  const className = input.className ?? "";
  if (symbol === "IRT" || symbol === "IRR") return TOMAN_LOGO;
  if (symbol === "USD") return USD_LOGO;
  const crypto = CRYPTO_LOGOS[symbol];
  if (crypto) return crypto;
  const auto = getAutomobileLogo(input.brandName) ?? getAutomobileLogo(input.name);
  if (auto) return auto;
  if (/خودرو|vehicle|automobile/i.test(className) || input.brandName) {
    return DEFAULT_AUTO_LOGO;
  }
  if (/املاک|مستغلات|real.?estate|دارایی واقعی/i.test(className) || /ملک|آپارتمان|خانه/.test(input.name ?? "")) {
    return REAL_ESTATE_LOGO;
  }
  const bank = getBankLogo(input.brandName) ?? getBankLogo(input.name);
  if (bank) return bank;
  if (/نقد|بانک|cash|bank/i.test(className)) return DEFAULT_INSTITUTION_LOGO;
  return DEFAULT_INSTITUTION_LOGO;
}
