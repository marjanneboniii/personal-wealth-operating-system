/**
 * سهام بورس تهران — starting catalogue.
 *
 * WHY THIS FILE EXISTS AT ALL
 * `InstrumentKind` already had `"stock"`, `ensureInstrumentClassId` already
 * seeded a «سهام» asset class, and the onboarding checklist already sent
 * «سهام بورسی» to /funds. The ONLY missing piece was a catalogue to pick from,
 * so the registrar could offer nothing and the route was a dead end for the
 * one category it was advertised for. This is that missing piece — not a new
 * subsystem.
 *
 * PROVENANCE, STATED HONESTLY
 * These are well-known Tehran-exchange symbols written from market knowledge,
 * exactly like FUND_CATALOG, and they are NOT machine-verified against TSETMC
 * or fipiran: neither host resolves from the environment this was built in, so
 * a symbol here could be misspelled, renamed or delisted and nothing would have
 * caught it.
 *
 * Two consequences follow, and both are deliberate:
 *   1. The list is a plain array, not a closed enum. A user may register a
 *      symbol that is not here — the registrar keeps its manual-entry path for
 *      exactly that, the same way the vehicle catalogue works.
 *   2. When TSETMC/fipiran becomes reachable this list should be REPLACED by
 *      the live one, never merged into it.
 *
 * Data-only: no database, HTTP or valuation imports.
 */

/**
 * Sector groups — the picker's filter tabs.
 *
 * Deliberately BROAD (eight groups, not the exchange's ~40 industry codes):
 * the tabs exist so someone who half-remembers «یک بانکی بود» can narrow the
 * list, not to reproduce the exchange's taxonomy. Forty tabs on a phone is
 * worse than none.
 */
export type StockSector =
  | "banking"
  | "metals"
  | "refining"
  | "auto"
  | "tech"
  | "pharma"
  | "holding"
  | "other";

export const STOCK_SECTOR_LABELS: Record<StockSector, string> = {
  banking: "بانک و بیمه",
  metals: "فلزات و معدن",
  refining: "پالایشی و پتروشیمی",
  auto: "خودرو و قطعات",
  tech: "فناوری و پرداخت",
  pharma: "دارویی",
  holding: "سرمایه‌گذاری و هلدینگ",
  other: "سایر",
};

export type StockSeed = {
  /** Tehran-exchange trading symbol, in Persian, e.g. «فولاد». */
  symbol: string;
  /** Full Persian company name. */
  name: string;
  sector: StockSector;
};

export const STOCK_CATALOG: readonly StockSeed[] = [
  /* ── فلزات و معدن ── */
  { symbol: "فولاد", name: "فولاد مبارکه اصفهان", sector: "metals" },
  { symbol: "فملی", name: "ملی صنایع مس ایران", sector: "metals" },
  { symbol: "فخوز", name: "فولاد خوزستان", sector: "metals" },
  { symbol: "کگل", name: "معدنی و صنعتی گل گهر", sector: "metals" },
  { symbol: "کچاد", name: "معدنی و صنعتی چادرملو", sector: "metals" },
  { symbol: "ارفع", name: "آهن و فولاد ارفع", sector: "metals" },
  { symbol: "کاوه", name: "فولاد کاوه جنوب کیش", sector: "metals" },
  { symbol: "هرمز", name: "فولاد هرمزگان جنوب", sector: "metals" },
  { symbol: "فایرا", name: "آلومینیوم ایران", sector: "metals" },
  { symbol: "فاسمین", name: "کالسیمین", sector: "metals" },
  { symbol: "کروی", name: "توسعه معادن روی ایران", sector: "metals" },
  { symbol: "ومعادن", name: "توسعه معادن و فلزات", sector: "metals" },
  { symbol: "فغدیر", name: "آهن و فولاد غدیر ایرانیان", sector: "metals" },
  { symbol: "فزرین", name: "زرین معدن آسیا", sector: "metals" },

  /* ── پالایشی و پتروشیمی ── */
  { symbol: "شپنا", name: "پالایش نفت اصفهان", sector: "refining" },
  { symbol: "شتران", name: "پالایش نفت تهران", sector: "refining" },
  { symbol: "شبندر", name: "پالایش نفت بندرعباس", sector: "refining" },
  { symbol: "شبریز", name: "پالایش نفت تبریز", sector: "refining" },
  { symbol: "شاوان", name: "پالایش نفت لاوان", sector: "refining" },
  { symbol: "فارس", name: "صنایع پتروشیمی خلیج فارس", sector: "refining" },
  { symbol: "نوری", name: "پتروشیمی نوری", sector: "refining" },
  { symbol: "پارس", name: "پتروشیمی پارس", sector: "refining" },
  { symbol: "زاگرس", name: "پتروشیمی زاگرس", sector: "refining" },
  { symbol: "مارون", name: "پتروشیمی مارون", sector: "refining" },
  { symbol: "جم", name: "پتروشیمی جم", sector: "refining" },
  { symbol: "شخارک", name: "پتروشیمی خارک", sector: "refining" },
  { symbol: "شفن", name: "پتروشیمی فناوران", sector: "refining" },
  { symbol: "آریا", name: "پلیمر آریا ساسول", sector: "refining" },
  { symbol: "شیراز", name: "پتروشیمی شیراز", sector: "refining" },
  { symbol: "خراسان", name: "پتروشیمی خراسان", sector: "refining" },
  { symbol: "کرماشا", name: "صنایع پتروشیمی کرمانشاه", sector: "refining" },
  { symbol: "شغدیر", name: "پتروشیمی غدیر", sector: "refining" },

  /* ── بانک و بیمه ── */
  { symbol: "وبملت", name: "بانک ملت", sector: "banking" },
  { symbol: "وتجارت", name: "بانک تجارت", sector: "banking" },
  { symbol: "وبصادر", name: "بانک صادرات ایران", sector: "banking" },
  { symbol: "وپاسار", name: "بانک پاسارگاد", sector: "banking" },
  { symbol: "وپارس", name: "بانک پارسیان", sector: "banking" },
  { symbol: "ونوین", name: "بانک اقتصاد نوین", sector: "banking" },
  { symbol: "وسینا", name: "بانک سینا", sector: "banking" },
  { symbol: "وکار", name: "بانک کارآفرین", sector: "banking" },
  { symbol: "وخاور", name: "بانک خاورمیانه", sector: "banking" },
  { symbol: "وپست", name: "پست بانک ایران", sector: "banking" },
  { symbol: "دی", name: "بانک دی", sector: "banking" },
  { symbol: "البرز", name: "بیمه البرز", sector: "banking" },
  { symbol: "آسیا", name: "بیمه آسیا", sector: "banking" },
  { symbol: "پارسیان", name: "بیمه پارسیان", sector: "banking" },
  { symbol: "ملت", name: "بیمه ملت", sector: "banking" },
  { symbol: "دانا", name: "بیمه دانا", sector: "banking" },

  /* ── خودرو و قطعات ── */
  { symbol: "خودرو", name: "ایران خودرو", sector: "auto" },
  { symbol: "خساپا", name: "سایپا", sector: "auto" },
  { symbol: "خگستر", name: "گسترش سرمایه‌گذاری ایران خودرو", sector: "auto" },
  { symbol: "خپارس", name: "پارس خودرو", sector: "auto" },
  { symbol: "خزامیا", name: "زامیاد", sector: "auto" },
  { symbol: "ختوقا", name: "قطعات اتومبیل ایران", sector: "auto" },
  { symbol: "خمحرکه", name: "نیرو محرکه", sector: "auto" },
  { symbol: "ورنا", name: "سرمایه‌گذاری رنا", sector: "auto" },
  { symbol: "پکرمان", name: "گروه صنعتی بارز", sector: "auto" },

  /* ── فناوری و پرداخت ── */
  { symbol: "اخابر", name: "مخابرات ایران", sector: "tech" },
  { symbol: "همراه", name: "ارتباطات سیار ایران", sector: "tech" },
  { symbol: "های‌وب", name: "داده گستر عصر نوین", sector: "tech" },
  { symbol: "رانفور", name: "خدمات انفورماتیک", sector: "tech" },
  { symbol: "آپ", name: "آسان پرداخت پرشین", sector: "tech" },
  { symbol: "پرداخت", name: "به پرداخت ملت", sector: "tech" },
  { symbol: "رتاپ", name: "تجارت الکترونیکی پارسیان", sector: "tech" },
  { symbol: "سپ", name: "پرداخت الکترونیک سامان", sector: "tech" },
  { symbol: "مرقام", name: "ایران ارقام", sector: "tech" },

  /* ── دارویی ── */
  { symbol: "برکت", name: "گروه دارویی برکت", sector: "pharma" },
  { symbol: "دارو", name: "کارخانجات داروپخش", sector: "pharma" },
  { symbol: "دعبید", name: "داروسازی دکتر عبیدی", sector: "pharma" },
  { symbol: "دجابر", name: "داروسازی جابر ابن حیان", sector: "pharma" },
  { symbol: "دفرا", name: "فرآورده‌های تزریقی ایران", sector: "pharma" },
  { symbol: "دکپسول", name: "تولید ژلاتین کپسول ایران", sector: "pharma" },

  /* ── سرمایه‌گذاری و هلدینگ ── */
  { symbol: "شستا", name: "سرمایه‌گذاری تامین اجتماعی", sector: "holding" },
  { symbol: "وغدیر", name: "سرمایه‌گذاری غدیر", sector: "holding" },
  { symbol: "تاپیکو", name: "سرمایه‌گذاری نفت و گاز و پتروشیمی تامین", sector: "holding" },
  { symbol: "پارسان", name: "گسترش نفت و گاز پارسیان", sector: "holding" },
  { symbol: "وامید", name: "مدیریت سرمایه‌گذاری امید", sector: "holding" },
  { symbol: "وصندوق", name: "سرمایه‌گذاری صندوق بازنشستگی کشوری", sector: "holding" },
  { symbol: "وبانک", name: "سرمایه‌گذاری گروه توسعه ملی", sector: "holding" },
  { symbol: "تاصیکو", name: "سرمایه‌گذاری صدر تامین", sector: "holding" },
  { symbol: "واتی", name: "سرمایه‌گذاری آتیه دماوند", sector: "holding" },

  /* ── سایر ── */
  { symbol: "رمپنا", name: "گروه مپنا", sector: "other" },
  { symbol: "بمپنا", name: "تولید برق عسلویه مپنا", sector: "other" },
  { symbol: "وهور", name: "مدیریت انرژی امید تابان هور", sector: "other" },
  { symbol: "مبین", name: "پتروشیمی مبین", sector: "other" },
  { symbol: "غبشهر", name: "صنعتی بهشهر", sector: "other" },
  { symbol: "غپینو", name: "پارس مینو", sector: "other" },
  { symbol: "سفارس", name: "سیمان فارس و خوزستان", sector: "other" },
  { symbol: "سشرق", name: "سیمان شرق", sector: "other" },
  { symbol: "سیدکو", name: "سرمایه‌گذاری توسعه صنایع سیمان", sector: "other" },
];

/** Symbol → seed, for O(1) name resolution at registration time. */
export const STOCK_BY_SYMBOL: ReadonlyMap<string, StockSeed> = new Map(
  STOCK_CATALOG.map((s) => [s.symbol, s]),
);
