/**
 * بازه‌های داخلی قیمت ملک و خودرو — فایل تنظیمات قابل به‌روزرسانی.
 *
 * داخلی است: هیچ عدد یا رده‌ای از این فایل به کاربر نمایش داده نمی‌شود؛ کاربر
 * فقط «غیرعادی به نظر می‌رسد» یا «درست به نظر نمی‌رسد» را می‌بیند.
 *
 * همهٔ مبالغ به دلار آزاد است و با نرخ دلارِ همان تاریخ به تومان تبدیل می‌شود
 * (قیمت خرید با نرخ روز خرید، ارزش فعلی با نرخ روز ارزش‌گذاری)، پس با تورم کهنه
 * نمی‌شود و خریدِ ارزانِ سال‌های قبل پرت حساب نمی‌شود.
 *
 * اولویت: قیمت بازار ثبت‌شده (مدل خودرو / منطقهٔ ملک) ← بازهٔ ردهٔ شهر ← بازهٔ عمومی.
 * کلیدها کد کاتالوگ‌اند (city.code، neighborhood.code، propertyType.code، brand.nameEn).
 */

export type UsdBand = { min: number; max: number };
export type CityTier = "A" | "B" | "C";

export const PRICE_BANDS = {
  /** خارج از بازهٔ شناخته‌شده تا این ضریب → هشدار؛ دورتر → مسدود. */
  tolerance: 3,
  /**
   * قیمت خرید شل‌تر سنجیده می‌شود: قیمت دلاری ملک در ایران پیش از ۱۳۹۷ حدوداً
   * دو برابر امروز بوده و خرید قدیمی نباید مسدود شود. صفرِ جاافتاده در قیمت خرید
   * را بررسی «ارزش فعلی ↔ قیمت خرید» می‌گیرد.
   */
  purchaseTolerance: 10,
  /** فاصلهٔ مجاز از قیمت بازار ثبت‌شده پیش از هشدار (۰٫۵ = ±۵۰٪). */
  referenceWarn: 0.5,
  /** نسبت دلاریِ ارزش فعلی به قیمت خرید: بیرون از [1/warn, warn] هشدار، بیرون از [1/block, block] مسدود. */
  consistency: { warn: 3, block: 10 },

  property: {
    /** ردهٔ داخلی هر شهر (کد شهر). شهر بدون رده → بازهٔ عمومی، فقط هشدار. */
    cityTier: {
      THR: "A",
      KRJ: "B", MHD: "B", ISF: "B", SYZ: "B", TBZ: "B", QOM: "B", RST: "B", AHZ: "B", URM: "B", KSH: "B",
      KRN: "B", HMD: "B", YZD: "B", ARK: "B", ADU: "B", QZV: "B", ZNJ: "B", SRY: "B", GRG: "B", SDG: "B",
      BND: "B", BUZ: "B", SNX: "B",
      KHD: "C", ZAH: "C", XBJ: "C", BJB: "C", IIL: "C", YES: "C", CQD: "C",
    } as Record<string, CityTier>,
    /** دلار هر متر مربع آپارتمان به تفکیک رده. */
    perSqmUsdByTier: {
      A: { min: 250, max: 4500 },
      B: { min: 200, max: 1500 },
      C: { min: 80, max: 600 },
    } as Record<CityTier, UsdBand>,
    /** شهر بدون رده: بازهٔ عمومی (بیرون از آن فقط هشدار می‌دهد). */
    perSqmUsdUnknown: { min: 80, max: 5000 } as UsdBand,
    /** حصار مطلق دلار هر متر؛ بیرون از آن همیشه مسدود. */
    perSqmUsdFence: { min: 20, max: 15000 } as UsdBand,
    /** ضریب بازه به تفکیک کد نوع ملک (پیش‌فرض ۱). */
    typeFactor: {
      SHO: { min: 0.8, max: 4 },
      OFF: { min: 0.8, max: 2 },
      LND: { min: 0.2, max: 2 },
      GAR: { min: 0.02, max: 0.6 },
      VIL: { min: 0.3, max: 2 },
      IND: { min: 0.1, max: 1 },
      WAR: { min: 0.1, max: 1 },
      PRK: { min: 0.3, max: 1.5 },
      OTH: { min: 0.05, max: 4 },
    } as Record<string, UsdBand>,
    /**
     * کمترین ارزش کل (دلار) به تفکیک نوع ملک؛ کمتر از آن همیشه مسدود.
     * ۴٬۰۰۰ دلار ≈ ۱ میلیارد تومان در ۱۴۰۵ — هیچ آپارتمان یا خانه‌ای امروز کمتر از این نیست.
     * به دلار است، پس خرید ارزانِ سال‌های قبل (مثلاً ۱۳۹۰) را مسدود نمی‌کند.
     */
    minTotalUsd: { APT: 4000, HOU: 4000, VIL: 4000, OFF: 4000, SHO: 4000 } as Record<string, number>,
    /** متراژ ممکن (متر مربع)؛ بیرون از آن مسدود. */
    sizeSqm: { min: 5, max: 100000 },
    /** متراژ آپارتمان بیش از این → هشدار. */
    apartmentWarnSqm: 2000,
  },

  vehicle: {
    /** قیمت خودروی صفر به دلار، به تفکیک داخلی/وارداتی. */
    newByOriginUsd: {
      domestic: { min: 4000, max: 40000 },
      imported: { min: 12000, max: 400000 },
    } as Record<"domestic" | "imported", UsdBand>,
    /** بازهٔ اختصاصی برند (کلید: brand.nameEn). */
    newByBrandUsd: {} as Record<string, UsdBand>,
    /** بازهٔ اختصاصی مدل (کلید: «brand.nameEn|modelName»)؛ بر برند مقدم است. */
    newByModelUsd: {} as Record<string, UsdBand>,
    /** افت سالانهٔ کفِ بازه و حداقل باقی‌مانده نسبت به صفر. */
    yearlyDepreciation: 0.06,
    minResidual: 0.25,
    /** حصار مطلق دلار؛ بیرون از آن همیشه مسدود. */
    fenceUsd: { min: 300, max: 1500000 } as UsdBand,
    /** کارکرد: سقف ممکن و حدِ هشدار کیلومتر در سال. */
    maxMileageKm: 2000000,
    warnKmPerYear: 100000,
  },
} as const;
