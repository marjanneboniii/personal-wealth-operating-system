/**
 * صندوق‌های سرمایه‌گذاری — starting catalogue (بخش ۱.۳).
 *
 * The sub-kinds the picker keeps separate:
 *   • gold          صندوق طلا
 *   • fixed_income  صندوق درآمد ثابت
 *   • etf           صندوق سهامی / قابل معامله
 *   • commodity     صندوق کالایی — زعفران و نقره, a physical good rather than
 *                   a security, so it does not belong under ETF
 *
 * PROVENANCE, STATED HONESTLY
 * These are well-known Tehran-exchange symbols, written from market knowledge.
 * They are NOT machine-verified against TSETMC or fipiran: neither host
 * resolves from the environment this was built in, so a symbol here could be
 * misspelled or renamed and nothing would have caught it. Treat this as a seed
 * that gets a user to a working registration today, not as an authority.
 *
 * That is also why the catalogue is a plain list rather than a closed enum: a
 * user may register a fund that is not here, and an admin can extend it,
 * exactly the way the vehicle catalogue works. When fipiran becomes reachable
 * it should REPLACE this list rather than be merged into it.
 *
 * Data-only: no database, HTTP or valuation imports.
 */

export type FundKind = "gold" | "fixed_income" | "etf" | "commodity";

export type FundSeed = {
  /** Tehran-exchange trading symbol, in Persian, e.g. «عیار». */
  symbol: string;
  /** Full Persian fund name. */
  name: string;
  kind: FundKind;
};

export const FUND_KIND_LABELS: Record<FundKind, string> = {
  gold: "صندوق طلا",
  fixed_income: "صندوق درآمد ثابت",
  etf: "صندوق سهامی (ETF)",
  commodity: "صندوق کالایی",
};

/** Ordered so the picker groups gold first — the brief's headline example. */
export const FUND_CATALOG: readonly FundSeed[] = [
  // ── صندوق‌های طلا — every name the brief lists, plus the common others ──
  { symbol: "عیار", name: "صندوق طلای عیار مفید", kind: "gold" },
  { symbol: "کهربا", name: "صندوق طلای کهربای کیان", kind: "gold" },
  { symbol: "زر", name: "صندوق طلای زرافشان امید ایرانیان", kind: "gold" },
  { symbol: "گوهر", name: "صندوق طلای گوهر شایگان", kind: "gold" },
  { symbol: "گنج", name: "صندوق طلای گنج آسمان", kind: "gold" },
  { symbol: "مثقال", name: "صندوق طلای مثقال", kind: "gold" },
  { symbol: "نفیس", name: "صندوق طلای نفیس", kind: "gold" },
  { symbol: "طلا", name: "صندوق طلای لوتوس پارسیان", kind: "gold" },
  { symbol: "تابش", name: "صندوق طلای تابش", kind: "gold" },
  { symbol: "آلتون", name: "صندوق طلای آلتون", kind: "gold" },
  { symbol: "جواهر", name: "صندوق طلای جواهر", kind: "gold" },
  { symbol: "زرفام", name: "صندوق طلای زرفام آشنا", kind: "gold" },
  { symbol: "ناب", name: "صندوق طلای ناب زرین", kind: "gold" },
  { symbol: "زروان", name: "صندوق طلای زروان", kind: "gold" },
  { symbol: "سیمرغ", name: "صندوق طلای سیمرغ", kind: "gold" },

  // ── صندوق‌های درآمد ثابت ──
  { symbol: "اعتماد", name: "صندوق اعتماد آفرین پارسیان", kind: "fixed_income" },
  { symbol: "کمند", name: "صندوق کمند کاریزما", kind: "fixed_income" },
  { symbol: "افران", name: "صندوق افران مفید", kind: "fixed_income" },
  { symbol: "پارند", name: "صندوق پارند پایدار سپهر", kind: "fixed_income" },
  { symbol: "کیان", name: "صندوق با درآمد ثابت کیان", kind: "fixed_income" },
  { symbol: "سپر", name: "صندوق سپر سرمایه بیدار", kind: "fixed_income" },
  { symbol: "همای", name: "صندوق همای آگاه", kind: "fixed_income" },
  { symbol: "یاقوت", name: "صندوق یاقوت آگاه", kind: "fixed_income" },
  { symbol: "لبخند", name: "صندوق لبخند فارابی", kind: "fixed_income" },
  { symbol: "فردا", name: "صندوق فردای اکسیر", kind: "fixed_income" },
  { symbol: "گنجینه", name: "صندوق گنجینه آینده روشن", kind: "fixed_income" },
  { symbol: "آوند", name: "صندوق آوند مفید", kind: "fixed_income" },
  { symbol: "خاتم", name: "صندوق خاتم ایساتیس پویا", kind: "fixed_income" },
  { symbol: "سپیدما", name: "صندوق سپید دماوند", kind: "fixed_income" },
  { symbol: "مانی", name: "صندوق مانی", kind: "fixed_income" },
  { symbol: "نوین", name: "صندوق نوین نگر آسیا", kind: "fixed_income" },
  { symbol: "ثبات", name: "صندوق ثبات ویستا", kind: "fixed_income" },
  { symbol: "کارا", name: "صندوق کارای کاردان", kind: "fixed_income" },
  { symbol: "امین‌یکم", name: "صندوق امین یکم فردا", kind: "fixed_income" },
  { symbol: "دارا", name: "صندوق دارا الگوریتم", kind: "fixed_income" },
  { symbol: "صایند", name: "صندوق گنجینه آینده درخشان", kind: "fixed_income" },

  // ── صندوق‌های سهامی و قابل معامله ──
  { symbol: "اهرم", name: "صندوق اهرم کاریزما", kind: "etf" },
  { symbol: "توان", name: "صندوق توان مفید", kind: "etf" },
  { symbol: "شتاب", name: "صندوق شتاب آگاه", kind: "etf" },
  { symbol: "بیدار", name: "صندوق بیدار سرمایه", kind: "etf" },
  { symbol: "پالایش", name: "صندوق پالایشی یکم", kind: "etf" },
  { symbol: "دارا یکم", name: "صندوق واسطه‌گری مالی یکم", kind: "etf" },
  { symbol: "آگاس", name: "صندوق هستی بخش آگاه", kind: "etf" },
  { symbol: "الماس", name: "صندوق الماس کاردان", kind: "etf" },
  { symbol: "کاریس", name: "صندوق کاریس کاریزما", kind: "etf" },
  { symbol: "فیروزه", name: "صندوق فیروزه موفقیت", kind: "etf" },
  { symbol: "سرو", name: "صندوق سرو سودمند مدبران", kind: "etf" },
  { symbol: "ارزش", name: "صندوق ارزش‌آفرین بیدار", kind: "etf" },
  { symbol: "آساس", name: "صندوق آسمان آرمانی سهام", kind: "etf" },
  { symbol: "صنوین", name: "صندوق صنوین نوین", kind: "etf" },
  { symbol: "ثروتم", name: "صندوق ثروت آفرین تمدن", kind: "etf" },
  { symbol: "ویستا", name: "صندوق ویستا", kind: "etf" },
  { symbol: "هامرز", name: "صندوق هامرز", kind: "etf" },
  { symbol: "تجارت", name: "صندوق تجارت شاخصی کاردان", kind: "etf" },
  { symbol: "آرام", name: "صندوق آرام مفید", kind: "etf" },

  /*
   * ── صندوق‌های کالایی ──
   * Commodity funds trade a physical good rather than a security. زعفران is
   * the one with a real retail following in this market, which is why the
   * brief asked for it by name; the family is kept open because صندوق نقره and
   * others list on the same exchange.
   */
  { symbol: "سحرخیز", name: "صندوق کالایی زعفران سحرخیز", kind: "commodity" },
  { symbol: "نهال", name: "صندوق کالایی زعفران نهال سرمایه", kind: "commodity" },
  { symbol: "نقره", name: "صندوق کالایی نقره", kind: "commodity" },
];

/** Symbol → seed, for a fast exact-symbol lookup. */
export const FUND_BY_SYMBOL: ReadonlyMap<string, FundSeed> = new Map(
  FUND_CATALOG.map((fund) => [fund.symbol, fund]),
);
