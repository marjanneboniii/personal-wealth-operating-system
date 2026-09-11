/**
 * صندوق‌های سرمایه‌گذاری — starting catalogue (بخش ۱.۳).
 *
 * The three sub-kinds the brief asks to keep separate in the picker:
 *   • gold          صندوق طلا
 *   • fixed_income  صندوق درآمد ثابت
 *   • etf           صندوق سهامی / قابل معامله
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

export type FundKind = "gold" | "fixed_income" | "etf";

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

  // ── صندوق‌های سهامی و قابل معامله ──
  { symbol: "اهرم", name: "صندوق اهرم کاریزما", kind: "etf" },
  { symbol: "توان", name: "صندوق توان مفید", kind: "etf" },
  { symbol: "شتاب", name: "صندوق شتاب آگاه", kind: "etf" },
  { symbol: "بیدار", name: "صندوق بیدار سرمایه", kind: "etf" },
  { symbol: "پالایش", name: "صندوق پالایشی یکم", kind: "etf" },
  { symbol: "دارا یکم", name: "صندوق واسطه‌گری مالی یکم", kind: "etf" },
  { symbol: "آگاس", name: "صندوق هستی بخش آگاه", kind: "etf" },
  { symbol: "الماس", name: "صندوق الماس کاردان", kind: "etf" },
];

/** Symbol → seed, for a fast exact-symbol lookup. */
export const FUND_BY_SYMBOL: ReadonlyMap<string, FundSeed> = new Map(
  FUND_CATALOG.map((fund) => [fund.symbol, fund]),
);
