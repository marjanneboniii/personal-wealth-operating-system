/**
 * Persian Icons — Iranian bank, payment-gateway, automobile, insurance and
 * brand logo mapping.
 *
 * Maps institution/brand names (Persian + English keys) → public SVG paths
 * restored from `persianlabs/icons` (https://github.com/persianlabs/icons,
 * MIT). The files live under `public/ir-icons/**` and are served locally, so
 * logo resolution never depends on a third-party CDN being reachable.
 *
 * PRESENTATION ONLY. Nothing in this module reads or writes the ledger,
 * journal entries, lots, FIFO state, cost basis or valuations.
 *
 * Usage:
 *   getBankLogo("بانک ملت")          // → "/ir-icons/banks/mellat.svg"
 *   getAutomobileLogo("iran-khodro") // → "/ir-icons/automobiles/iran-khodro.svg"
 *   resolveBrandLogo(name, "bank")   // → category-scoped lookup
 */

import { SUPPORTED_CRYPTO_ASSETS } from "@/features/pricing/supportedAssets";

const BASE = "/ir-icons";

/* ─────────────────────── Normalisation ─────────────────────── */

/**
 * Canonical comparison key: Persian/Arabic letter unification, digit
 * unification, ZWNJ removal, separator collapse, lower-casing.
 * «بانك ملت» and «بانک  ملت» must resolve to the same slug.
 */
export function normalizeBrandKey(input: string | null | undefined): string {
  if (!input) return "";
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  return input
    .toString()
    .replace(/[\u064A\u0649]/g, "\u06CC") // ي/ى → ی
    .replace(/\u0643/g, "\u06A9") // ك → ک
    .replace(/[\u200c\u200f\u200e\u200b]/g, "") // ZWNJ / direction marks
    .replace(/[٠-٩]/g, (d) => String(arabicDigits.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(persianDigits.indexOf(d)))
    .replace(/[\u064B-\u0652]/g, "") // harakat
    .replace(/[-_/\\.،,()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Persian words that carry no brand identity and only add noise to matching. */
const BANK_STOPWORDS = ["بانک", "موسسه", "مؤسسه", "اعتباری", "قرض الحسنه", "bank"];

function stripStopwords(value: string, stopwords: string[]): string {
  let out = value;
  for (const word of stopwords) {
    out = out.replace(new RegExp(`(^|\\s)${word}(\\s|$)`, "g"), " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Deterministic lookup over a slug map.
 *
 * Resolution is intentionally ordered so the same input ALWAYS produces the
 * same slug regardless of object key order:
 *   1. exact normalised key,
 *   2. exact normalised key after stripping category stopwords,
 *   3. longest matching key that appears as a whole token sequence.
 * A short alias can therefore never shadow a longer, more specific brand.
 */
function lookupSlug(
  map: Record<string, string>,
  rawName: string | null | undefined,
  stopwords: string[] = [],
): string | null {
  const normalized = normalizeBrandKey(rawName);
  if (!normalized) return null;

  const direct = map[normalized];
  if (direct) return direct;

  const stripped = stripStopwords(normalized, stopwords.map((w) => normalizeBrandKey(w)));
  if (stripped && stripped !== normalized) {
    const viaStripped = map[stripped];
    if (viaStripped) return viaStripped;
  }

  // Longest-key-first containment match on token boundaries — deterministic.
  const haystack = ` ${stripped || normalized} `;
  const candidates = Object.keys(map)
    .filter((key) => key.length >= 3)
    .sort((a, b) => (b.length - a.length) || (a < b ? -1 : 1));
  for (const key of candidates) {
    if (haystack.includes(` ${key} `)) return map[key];
  }
  return null;
}

/* ─────────────────────── Banks ─────────────────────── */

/**
 * Persian bank / credit-institution name → SVG slug under
 * `public/ir-icons/banks`. Every slug below has a matching file on disk.
 */
const BANK_MAP: Record<string, string> = {
  // ── Persian names ──
  "بانک ملت": "mellat",
  "ملت": "mellat",
  "بانک شهر": "shahr",
  "شهر": "shahr",
  "بانک تجارت": "tejarat",
  "تجارت": "tejarat",
  "بانک ملی": "melli",
  "بانک ملی ایران": "melli",
  "ملی": "melli",
  "بانک سامان": "saman",
  "سامان": "saman",
  "بانک پاسارگاد": "pasargad",
  "پاسارگاد": "pasargad",
  "بانک پارسیان": "parsian",
  "پارسیان": "parsian",
  "بانک صادرات": "saderat",
  "بانک صادرات ایران": "saderat",
  "صادرات": "saderat",
  "بانک سپه": "sepah",
  "سپه": "sepah",
  "بانک اقتصاد نوین": "eghtesad-novin",
  "اقتصاد نوین": "eghtesad-novin",
  "بانک کشاورزی": "keshavarzi",
  "کشاورزی": "keshavarzi",
  "پست بانک": "postbank",
  "پست بانک ایران": "postbank",
  "بلوبانک": "blubank",
  "بلو بانک": "blubank",
  "بانکینو": "bankino",
  "بانک انصار": "ansar",
  "انصار": "ansar",
  "بانک قوامین": "ghavamin",
  "قوامین": "ghavamin",
  "بانک کارآفرین": "karafarin",
  "کارآفرین": "karafarin",
  "بانک رفاه": "refah",
  "بانک رفاه کارگران": "refah",
  "رفاه": "refah",
  "بانک مهر ایران": "mehr-iran",
  "مهر ایران": "mehr-iran",
  "بانک مهر اقتصاد": "mehr-eghtesad",
  "مهر اقتصاد": "mehr-eghtesad",
  "بانک آینده": "ayandeh",
  "آینده": "ayandeh",
  "بانک دی": "dey",
  "دی": "dey",
  "بانک رسالت": "resalat",
  "رسالت": "resalat",
  "بانک مسکن": "maskan",
  "مسکن": "maskan",
  "بانک مرکزی": "bank-markazi",
  "بانک مرکزی ایران": "bank-markazi",
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
  "بانک حکمت ایرانیان": "hekmat",
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
  "بانک کوثر": "kosar",
  "کوثر": "kosar",
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

  // ── English slugs / aliases ──
  mellat: "mellat",
  shahr: "shahr",
  tejarat: "tejarat",
  melli: "melli",
  "bank melli": "melli",
  "bank mellat": "mellat",
  "bank saman": "saman",
  saman: "saman",
  pasargad: "pasargad",
  parsian: "parsian",
  saderat: "saderat",
  sepah: "sepah",
  "eghtesad novin": "eghtesad-novin",
  "eghtesad-novin": "eghtesad-novin",
  keshavarzi: "keshavarzi",
  postbank: "postbank",
  blubank: "blubank",
  bankino: "bankino",
  ansar: "ansar",
  ghavamin: "ghavamin",
  karafarin: "karafarin",
  refah: "refah",
  "mehr iran": "mehr-iran",
  "mehr-iran": "mehr-iran",
  "mehr eghtesad": "mehr-eghtesad",
  "mehr-eghtesad": "mehr-eghtesad",
  ayandeh: "ayandeh",
  dey: "dey",
  resalat: "resalat",
  maskan: "maskan",
  "bank markazi": "bank-markazi",
  "bank-markazi": "bank-markazi",
  "khavar mianeh": "khavar-mianeh",
  "khavar-mianeh": "khavar-mianeh",
  gardeshgari: "gardeshgari",
  "iran zamin": "iran-zamin",
  "iran-zamin": "iran-zamin",
  sina: "sina",
  hekmat: "hekmat",
  tosee: "tosee",
  "tosee saderat": "tosee-saderat",
  "tosee-saderat": "tosee-saderat",
  "tosee taavon": "tosee-taavon",
  "tosee-taavon": "tosee-taavon",
  "taavon eslami": "taavon-eslami",
  "taavon-eslami": "taavon-eslami",
  "sanat madan": "sanat-madan",
  "sanat-madan": "sanat-madan",
  sarmayeh: "sarmayeh",
  caspian: "caspian",
  kosar: "kosar",
  futurebank: "futurebank",
  "iran venezuela": "iran-venezuela",
  "iran-venezuela": "iran-venezuela",
  "iran europe": "iran-europe",
  "iran-europe": "iran-europe",
  melall: "melall",
  noor: "noor",
  "standard chartered": "standard-chartered",
  "standard-chartered": "standard-chartered",
};

export function getBankLogo(name: string | null | undefined): string | null {
  const slug = lookupSlug(BANK_MAP, name, BANK_STOPWORDS);
  return slug ? `${BASE}/banks/${slug}.svg` : null;
}

/* ─────────────────────── Automobiles ─────────────────────── */

/**
 * Iranian automakers/assemblers that PersianLabs ships a brand mark for.
 * Imported marques (Toyota, BMW, Mercedes, …) have no PersianLabs logo; they
 * deliberately fall back to the VEHICLE icon — never to a stock or crypto one.
 */
const AUTO_MAP: Record<string, string> = {
  "ایران خودرو": "iran-khodro",
  "ایرانخودرو": "iran-khodro",
  "iran khodro": "iran-khodro",
  "iran-khodro": "iran-khodro",
  ikco: "iran-khodro",
  "سایپا": "saipa",
  saipa: "saipa",
  "پارس خودرو": "pars-khodro",
  "pars khodro": "pars-khodro",
  "pars-khodro": "pars-khodro",
  "بهمن": "bahman",
  "بهمن موتور": "bahman",
  bahman: "bahman",
  "bahman motor": "bahman",
  "کرمان موتور": "kerman-motor",
  "kerman motor": "kerman-motor",
  "kerman-motor": "kerman-motor",
  kmc: "kerman-motor",
  "کویر": "kavir",
  "کویر موتور": "kavir",
  kavir: "kavir",
  "نیرومحرکه": "niromotor",
  "نیرو محرکه": "niromotor",
  "نیروموتور": "niromotor",
  niromotor: "niromotor",
  "زامیاد": "zamyad",
  zamyad: "zamyad",
};

export function getAutomobileLogo(name: string | null | undefined): string | null {
  const slug = lookupSlug(AUTO_MAP, name, ["خودرو", "موتور", "شرکت", "صنایع", "خودروسازی"]);
  return slug ? `${BASE}/automobiles/${slug}.svg` : null;
}

/* ────────────────────── Payment gateways ─────────────────────── */

const PAYMENT_MAP: Record<string, string> = {
  "زرین پال": "zarrinpal",
  "زرینپال": "zarrinpal",
  zarinpal: "zarrinpal",
  zarrinpal: "zarrinpal",
  "آیدی پی": "idpay",
  idpay: "idpay",
  "آسان پرداخت": "asan-pardakht",
  "asan pardakht": "asan-pardakht",
  "asan-pardakht": "asan-pardakht",
  "دیجی پی": "digipay",
  digipay: "digipay",
  "پی پینگ": "payping",
  payping: "payping",
  "وندار": "vandar",
  vandar: "vandar",
  "زیبال": "zibal",
  zibal: "zibal",
  "پی فا": "payfa",
  payfa: "payfa",
  "سداد": "sedad",
  sedad: "sedad",
  "شاپرک": "shaparak",
  shaparak: "shaparak",
  "نکست پی": "nextpay",
  nextpay: "nextpay",
  "پاسارگاد پپ": "pasargad-pep",
  "pasargad pep": "pasargad-pep",
  "pasargad-pep": "pasargad-pep",
  "سامان کیش": "saman-kish",
  "saman kish": "saman-kish",
  "saman-kish": "saman-kish",
  "حسابیت": "hesabit",
  hesabit: "hesabit",
  "پی آی آر": "pay-ir",
  "pay ir": "pay-ir",
  "pay-ir": "pay-ir",
  "سپ": "sep",
  sep: "sep",
  "اسنپ پی": "snap-pay",
  "snap pay": "snap-pay",
  "snap-pay": "snap-pay",
};

export function getPaymentGatewayLogo(name: string | null | undefined): string | null {
  const slug = lookupSlug(PAYMENT_MAP, name, ["درگاه", "پرداخت"]);
  return slug ? `${BASE}/payment-gateways/${slug}.svg` : null;
}

/* ────────────────────── Insurance companies ─────────────────────── */

const INSURANCE_MAP: Record<string, string> = {
  "البرز": "alborz",
  alborz: "alborz",
  "آرمان": "arman",
  arman: "arman",
  "آسیا": "asia",
  asia: "asia",
  "دانا": "dana",
  dana: "dana",
  "دی": "dey",
  "ایران": "iran",
  iran: "iran",
  "کارآفرین": "karafarin",
  "کوثر": "kosar",
  "ما": "ma",
  "مرکزی": "markazi",
  markazi: "markazi",
  "ملت": "mellat",
  "معلم": "moalem",
  moalem: "moalem",
  "نوین": "novin",
  novin: "novin",
  "پارسیان": "parsian",
  "پاسارگاد": "pasargad",
  "رازی": "raazi",
  raazi: "raazi",
  "سامان": "saman",
  "سینا": "sina",
  "تعاون": "taavon",
  taavon: "taavon",
  "توسعه": "toseei",
  toseei: "toseei",
};

export function getInsuranceLogo(name: string | null | undefined): string | null {
  const slug = lookupSlug(INSURANCE_MAP, name, ["بیمه", "شرکت", "insurance"]);
  return slug ? `${BASE}/insurance/${slug}.svg` : null;
}

/* ────────────────────── Iranian companies & brands ─────────────────────── */

/**
 * Iranian companies, marketplaces, exchanges and service brands. Used for
 * company/organisation assets and for wallets held at a local exchange
 * (e.g. نوبیتکس) so their card shows the real brand mark.
 */
const BRAND_MAP: Record<string, string> = {
  "نوبیتکس": "nobitex",
  nobitex: "nobitex",
  "دیجی کالا": "digikala",
  digikala: "digikala",
  "دیجی کالا جت": "digikala-jet",
  "digikala jet": "digikala-jet",
  "اسنپ": "snap",
  snap: "snap",
  snapp: "snap",
  "اسنپ فود": "snapp-food",
  "snapp food": "snapp-food",
  "اسنپ تریپ": "snapp-trip",
  "snapp trip": "snapp-trip",
  "اسنپ دکتر": "snapp-doctor",
  "snapp doctor": "snapp-doctor",
  "تپسی": "tapsi",
  tapsi: "tapsi",
  "دیوار": "divar",
  divar: "divar",
  "شیپور": "sheypoor",
  sheypoor: "sheypoor",
  "باسلام": "basalam",
  basalam: "basalam",
  "ترب": "torob",
  torob: "torob",
  "علی بابا": "alibaba",
  alibaba: "alibaba",
  "فلایتیو": "flightio",
  flightio: "flightio",
  "فلای تودی": "flytoday",
  flytoday: "flytoday",
  "جاباما": "jabama",
  jabama: "jabama",
  "اتاقک": "otaghak",
  otaghak: "otaghak",
  "شب": "shab",
  "طاقچه": "taghche",
  taghche: "taghche",
  "فیدیبو": "fidibo",
  fidibo: "fidibo",
  "مکتب خونه": "maktabkhoone",
  maktabkhoone: "maktabkhoone",
  "جاب ویژن": "jobvision",
  jobvision: "jobvision",
  "کارنامه": "karname",
  karname: "karname",
  "پونیشا": "ponisha",
  ponisha: "ponisha",
  "ژاکت": "zhaket",
  zhaket: "zhaket",
  "تیپاکس": "tipax",
  tipax: "tipax",
  "نشان": "neshan",
  neshan: "neshan",
  "بلد": "balad",
  balad: "balad",
  "آچاره": "achareh",
  achareh: "achareh",
  "الوپیک": "alopeik",
  alopeik: "alopeik",
  "میاره": "miare",
  miare: "miare",
  "ایرانی کارت": "iranicard",
  iranicard: "iranicard",
  "همراه کارت": "hamrahcard",
  hamrahcard: "hamrahcard",
  "ازکی": "azki",
  azki: "azki",
  "بیمه بازار": "bime-bazar",
  "bime bazar": "bime-bazar",
  "بیمه دات کام": "bimeh-com",
  "bimeh com": "bimeh-com",
  "بادصبا": "badesaba",
  badesaba: "badesaba",
  "باکس": "banimode",
  "بانی مد": "banimode",
  banimode: "banimode",
  "خانومی": "khanoumi",
  khanoumi: "khanoumi",
  "تخفیفان": "takhfifan",
  takhfifan: "takhfifan",
  "هفت هشتاد": "hafhashtad",
  hafhashtad: "hafhashtad",
  "میلی": "mili",
  "مستر بلیط": "mr-bilit",
  "mr bilit": "mr-bilit",
  "سفر ۷۲۴": "safar-724",
  "سفر 724": "safar-724",
  "safar 724": "safar-724",
  "ای سمینار": "e-seminar",
  "e seminar": "e-seminar",
  "هاست ایران": "host-iran",
  "host iran": "host-iran",
  "ری چت": "raychat",
  raychat: "raychat",
  "تکنولایف": "tec-nolife",
  "tecno life": "tec-nolife",

  // ── ISPs / mobile operators ──
  "همراه اول": "hamrah-avval",
  "hamrah avval": "hamrah-avval",
  mci: "hamrah-avval",
  "ایرانسل": "irancell",
  irancell: "irancell",
  "رایتل": "rightel",
  rightel: "rightel",
  "شاتل": "shatel",
  shatel: "shatel",
  "آسیاتک": "asiatech",
  asiatech: "asiatech",
  "های وب": "hi-web",
  "hi web": "hi-web",
  "مبین نت": "mobin-net",
  "mobin net": "mobin-net",
  "پارس آنلاین": "pars-online",
  "pars online": "pars-online",
  "پیشگامان": "pishgaman",
  pishgaman: "pishgaman",
  "صبانت": "sabanet",
  sabanet: "sabanet",
  "زیتل": "zitel",
  zitel: "zitel",
};

export function getIranianBrandLogo(name: string | null | undefined): string | null {
  const slug = lookupSlug(BRAND_MAP, name, ["شرکت", "صرافی", "فروشگاه", "گروه"]);
  return slug ? `${BASE}/brands/${slug}.svg` : null;
}

/* ─────────────────────── Real estate ─────────────────────── */

/** Real estate has no brand logo — a generic building mark is used. */
export const REAL_ESTATE_LOGO = `${BASE}/realestate/building.svg`;

/* ─────────────────────── Crypto (CoinGecko) ─────────────────────── */

/**
 * Crypto logos come from CoinGecko — the authoritative source for token
 * identity — and NEVER from a hand-maintained local mapping. Both indexes are
 * built from the single supported-asset registry, so Tether (USDT) always
 * resolves to the official Tether artwork and never to a network, exchange or
 * wrapped-token mark.
 */
export const CRYPTO_LOGOS: Record<string, string> = Object.freeze(
  Object.fromEntries(SUPPORTED_CRYPTO_ASSETS.map((asset) => [asset.symbol, asset.logoUrl])),
);

/** CoinGecko id → official logo, used when a symbol is ambiguous. */
export const CRYPTO_LOGOS_BY_COINGECKO_ID: Record<string, string> = Object.freeze(
  Object.fromEntries(SUPPORTED_CRYPTO_ASSETS.map((asset) => [asset.coingeckoId, asset.logoUrl])),
);

/** Official CoinGecko logo for a crypto symbol (e.g. "USDT" → Tether). */
export function getCryptoLogo(symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  return CRYPTO_LOGOS[symbol.trim().toUpperCase()] ?? null;
}

/** Official CoinGecko logo for a CoinGecko id (e.g. "tether"). */
export function getCryptoLogoByCoinGeckoId(coingeckoId: string | null | undefined): string | null {
  if (!coingeckoId) return null;
  return CRYPTO_LOGOS_BY_COINGECKO_ID[coingeckoId.trim().toLowerCase()] ?? null;
}

/* ─────────────────────── Defaults ─────────────────────── */

export const DEFAULT_INSTITUTION_LOGO = `${BASE}/defaults/bank.svg`;
export const DEFAULT_AUTO_LOGO = `${BASE}/defaults/automobile.svg`;
export const TOMAN_LOGO = `${BASE}/defaults/toman.png`;
export const USD_LOGO = `${BASE}/defaults/usd.svg`;
/** Neutral placeholder — the last resort of every resolution chain. */
export const DEFAULT_ASSET_LOGO = `${BASE}/defaults/asset.svg`;

export type LogoCategory =
  | "bank"
  | "automobile"
  | "payment"
  | "insurance"
  | "brand"
  | "realestate"
  | "crypto"
  | "default";

/**
 * Resolve a brand logo by category. Returns null when the category has no
 * matching brand mark, so callers can apply their own fallback policy.
 */
export function resolveBrandLogo(
  name: string | null | undefined,
  category: LogoCategory = "default",
): string | null {
  if (category === "realestate") return REAL_ESTATE_LOGO;
  if (!name) return null;
  switch (category) {
    case "bank":
      return getBankLogo(name) ?? getIranianBrandLogo(name);
    case "automobile":
      return getAutomobileLogo(name);
    case "payment":
      return getPaymentGatewayLogo(name);
    case "insurance":
      return getInsuranceLogo(name);
    case "brand":
      return getIranianBrandLogo(name) ?? getBankLogo(name);
    case "crypto":
      return getCryptoLogo(name);
    default:
      return null;
  }
}

const CATEGORY_FALLBACK: Record<LogoCategory, string> = {
  bank: DEFAULT_INSTITUTION_LOGO,
  automobile: DEFAULT_AUTO_LOGO,
  payment: DEFAULT_INSTITUTION_LOGO,
  insurance: DEFAULT_INSTITUTION_LOGO,
  brand: DEFAULT_ASSET_LOGO,
  realestate: REAL_ESTATE_LOGO,
  // A crypto asset with no CoinGecko identity gets the neutral placeholder —
  // never another coin's artwork (previously it fell back to the Tether mark).
  crypto: DEFAULT_ASSET_LOGO,
  default: DEFAULT_ASSET_LOGO,
};

export function categoryFallback(category: string): string {
  return CATEGORY_FALLBACK[category as LogoCategory] ?? DEFAULT_ASSET_LOGO;
}
