/**
 * Standard Expense Category Taxonomy (Hierarchical — Parent/Child).
 *
 * Design rules (see docs/EXPENSE_CATEGORIES.md):
 *
 *  1. Every leaf sub-category has EXACTLY ONE canonical home in the tree —
 *     overlapping/duplicate categories are not allowed. Where a concept
 *     belongs to two domains by nature, an explicit assignment rule picks
 *     the canonical home (documented in the node's `description`).
 *  2. The tree is extensible: new sub-categories can be added under any
 *     top-level group at runtime (user categories) without schema changes.
 *  3. `nature: "non_cash"` marks depreciation / reserve categories — an
 *     expense in reports but never a cash outflow (e.g. vehicle
 *     depreciation reserve). Cash-flow analytics exclude them.
 *  4. The "متفرقه" (miscellaneous) group is a last resort: only when no
 *     other category fits. Reports expose miscellaneous entries so that a
 *     repeating cost can be promoted into its own category.
 */

export type CategoryNature = "cash" | "non_cash";

export type CatalogNode = {
  code: string;
  name: string;
  nameEn: string;
  nature?: CategoryNature;
  description?: string;
  children?: CatalogNode[];
};

export const EXPENSE_CATEGORY_CATALOG: CatalogNode[] = [
  {
    code: "HSG",
    name: "مسکن و ساختمان",
    nameEn: "Housing & Building",
    description: "هزینه‌های مربوط به محل سکونت: اجاره، شارژ، نگهداری و انشعابات منزل.",
    children: [
      { code: "HSG-RENT", name: "اجاره یا اقساط مسکن", nameEn: "Rent / Mortgage" },
      { code: "HSG-CHARGE", name: "شارژ ساختمان", nameEn: "Building Charge" },
      { code: "HSG-MAINT", name: "تعمیرات و نگهداری منزل", nameEn: "Home Maintenance" },
      { code: "HSG-EQUIP", name: "لوازم و تجهیزات منزل", nameEn: "Home Equipment" },
      { code: "HSG-CLEAN", name: "نظافت و خدمات منزل", nameEn: "Cleaning & Home Services" },
      { code: "HSG-WATER", name: "آب", nameEn: "Water" },
      { code: "HSG-ELEC", name: "برق", nameEn: "Electricity" },
      { code: "HSG-GAS", name: "گاز", nameEn: "Gas" },
      {
        code: "HSG-PHONE",
        name: "تلفن ثابت",
        nameEn: "Landline Phone",
        description: "قبض تلفن ثابت منزل؛ تلفن همراه و اینترنت موبایل در دسته «ارتباطات و اشتراک‌ها» ثبت می‌شود.",
      },
      {
        code: "HSG-INT",
        name: "اینترنت منزل",
        nameEn: "Home Internet",
        description: "اینترنت ثابت منزل (ADSL/فیبر/وایرلس ثابت)؛ اینترنت موبایل در دسته «ارتباطات و اشتراک‌ها» ثبت می‌شود.",
      },
      { code: "HSG-OTHER", name: "سایر هزینه‌های مسکن", nameEn: "Other Housing" },
    ],
  },
  {
    code: "TRN",
    name: "خودرو و حمل‌ونقل",
    nameEn: "Vehicle & Transportation",
    description: "تمام هزینه‌های خودرو شخصی و جابه‌جایی؛ بیمه‌های خودرو نیز به‌طور اختصاصی همین‌جا ثبت می‌شوند.",
    children: [
      { code: "TRN-FUEL", name: "سوخت خودرو", nameEn: "Fuel" },
      {
        code: "TRN-INS-TP",
        name: "بیمه شخص ثالث خودرو",
        nameEn: "Third-party Insurance",
        description: "بیمه‌های خودرو (شخص ثالث و بدنه) به‌جای دسته «بیمه»، در همین دامنه ثبت می‌شوند تا هزینه کامل خودرو یک‌جا دیده شود.",
      },
      { code: "TRN-INS-BODY", name: "بیمه بدنه خودرو", nameEn: "Body Insurance" },
      { code: "TRN-REPAIR", name: "سرویس و تعمیرات خودرو", nameEn: "Service & Repairs" },
      { code: "TRN-OIL", name: "تعویض روغن و سرویس‌های دوره‌ای", nameEn: "Oil & Periodic Service" },
      { code: "TRN-TIRE", name: "لاستیک و لوازم مصرفی خودرو", nameEn: "Tires & Consumables" },
      { code: "TRN-TOLL", name: "عوارض و جرائم خودرو", nameEn: "Tolls & Fines" },
      { code: "TRN-INSPECT", name: "معاینه فنی", nameEn: "Technical Inspection" },
      { code: "TRN-PARK", name: "پارکینگ", nameEn: "Parking" },
      { code: "TRN-WASH", name: "کارواش", nameEn: "Car Wash" },
      { code: "TRN-PUBLIC", name: "حمل‌ونقل عمومی", nameEn: "Public Transport" },
      { code: "TRN-TAXI", name: "تاکسی و تاکسی اینترنتی", nameEn: "Taxi & Ride-hailing" },
      {
        code: "TRN-DEPR",
        name: "استهلاک خودرو / ذخیره تعویض و تعمیرات آینده",
        nameEn: "Vehicle Depreciation Reserve",
        nature: "non_cash",
        description:
          "ثبت غیرنقدی: استهلاک یا ذخیرهٔ تعویض و تعمیرات آینده لزوماً خروج وجه نیست؛ در گزارش هزینه منظور می‌شود ولی از جریان نقدی خارج می‌ماند.",
      },
      { code: "TRN-OTHER", name: "سایر هزینه‌های حمل‌ونقل", nameEn: "Other Transportation" },
    ],
  },
  {
    code: "FOD",
    name: "خوراک و مواد غذایی",
    nameEn: "Food & Groceries",
    description: "خوراک روزانه به نیت تغذیه؛ کافه/رستوران با نیت تفریح و دورهمی در دسته «تفریح و سرگرمی» ثبت می‌شود.",
    children: [
      { code: "FOD-GROCERY-HOME", name: "خرید مواد غذایی منزل", nameEn: "Home Groceries" },
      { code: "FOD-GROCERY-DAILY", name: "خرید روزانه مواد غذایی", nameEn: "Daily Groceries" },
      { code: "FOD-REST", name: "رستوران", nameEn: "Restaurant" },
      { code: "FOD-CAFE", name: "کافه", nameEn: "Café" },
      { code: "FOD-DELIVERY", name: "سفارش غذا", nameEn: "Food Delivery" },
      { code: "FOD-FASTFOOD", name: "فست‌فود", nameEn: "Fast Food" },
      { code: "FOD-SNACK", name: "تنقلات و خوراکی", nameEn: "Snacks" },
      { code: "FOD-DRINK", name: "نوشیدنی", nameEn: "Drinks" },
      { code: "FOD-OTHER", name: "سایر هزینه‌های خوراک", nameEn: "Other Food" },
    ],
  },
  {
    code: "HLT",
    name: "سلامت و درمان",
    nameEn: "Health & Medical",
    description:
      "هزینه‌های مستقیم درمان؛ حق بیمهٔ درمان تکمیلی در دسته «بیمه و تعهدات مالی» ثبت می‌شود تا جمع حق بیمه‌ها یک‌جا گزارش شود.",
    children: [
      { code: "HLT-DOCTOR", name: "هزینه پزشک", nameEn: "Doctor Visit" },
      { code: "HLT-LAB", name: "آزمایش و تصویربرداری", nameEn: "Lab & Imaging" },
      { code: "HLT-PHARM", name: "دارو", nameEn: "Medicine" },
      { code: "HLT-DENTAL", name: "دندانپزشکی", nameEn: "Dental" },
      { code: "HLT-SERVICES", name: "خدمات درمانی", nameEn: "Medical Services" },
      { code: "HLT-SUPPLEMENT", name: "مکمل‌ها و محصولات مرتبط با سلامت", nameEn: "Supplements" },
      { code: "HLT-OTHER", name: "سایر هزینه‌های سلامت و درمان", nameEn: "Other Health" },
    ],
  },
  {
    code: "HYG",
    name: "بهداشت و مراقبت شخصی",
    nameEn: "Hygiene & Personal Care",
    description: "محصولات بهداشتی و خدمات مراقبت شخصی.",
    children: [
      { code: "HYG-SHAMPOO", name: "شامپو، شوینده و محصولات مصرفی شخصی", nameEn: "Shampoo & Detergents" },
      { code: "HYG-PRODUCTS", name: "محصولات بهداشتی", nameEn: "Hygiene Products" },
      { code: "HYG-HAIR", name: "اصلاح و پیرایش", nameEn: "Haircut & Grooming" },
      { code: "HYG-NAIL", name: "ترمیم ناخن", nameEn: "Nail Care" },
      { code: "HYG-EYEBROW", name: "اصلاح ابرو", nameEn: "Eyebrow Grooming" },
      { code: "HYG-LASER-FACE", name: "لیزر صورت", nameEn: "Face Laser" },
      { code: "HYG-LASER-BODY", name: "لیزر توتال بادی", nameEn: "Full Body Laser" },
      { code: "HYG-PEDICURE", name: "ژلیش پا", nameEn: "Foot Gelish" },
      { code: "HYG-OTHER", name: "سایر خدمات مراقبت شخصی", nameEn: "Other Personal Care" },
    ],
  },
  {
    code: "CLT",
    name: "پوشاک و اکسسوری",
    nameEn: "Clothing & Accessories",
    children: [
      { code: "CLT-CLOTHES", name: "لباس", nameEn: "Clothes" },
      { code: "CLT-SHOES", name: "کفش", nameEn: "Shoes" },
      { code: "CLT-BAG", name: "کیف", nameEn: "Bags" },
      { code: "CLT-WATCH", name: "ساعت و اکسسوری", nameEn: "Watches & Accessories" },
      { code: "CLT-SPOUSE", name: "پوشاک همسر", nameEn: "Spouse Clothing" },
      { code: "CLT-PERSONAL", name: "پوشاک شخصی", nameEn: "Personal Clothing" },
      { code: "CLT-OTHER", name: "سایر هزینه‌های پوشاک", nameEn: "Other Clothing" },
    ],
  },
  {
    code: "ENT",
    name: "تفریح و سرگرمی",
    nameEn: "Entertainment & Leisure",
    description: "سرگرمی به نیت تفریح؛ کافه/رستورانِ صرفاً تغذیه‌ای در دسته «خوراک» ثبت می‌شود.",
    children: [
      {
        code: "ENT-DINING",
        name: "کافه و رستوران تفریحی",
        nameEn: "Leisure Dining",
        description: "فقط کافه/رستورانی که با نیت تفریح و دورهمی انجام می‌شود؛ خوراک روزانه در دسته «خوراک و مواد غذایی» است.",
      },
      { code: "ENT-CINEMA", name: "سینما و تئاتر", nameEn: "Cinema & Theater" },
      { code: "ENT-FUN", name: "سرگرمی", nameEn: "Entertainment" },
      { code: "ENT-TRIP-SHORT", name: "سفر کوتاه", nameEn: "Short Trip" },
      { code: "ENT-TRAVEL", name: "سفر و اقامت", nameEn: "Travel & Accommodation" },
      { code: "ENT-ACTIVITY", name: "فعالیت‌های تفریحی", nameEn: "Leisure Activities" },
      {
        code: "ENT-GIFT",
        name: "هدیه و مناسبت‌های تفریحی",
        nameEn: "Leisure Gifts & Occasions",
        description: "هدایا و مناسبت‌های مرتبط با فعالیت تفریحی؛ هدایای عمومی در دسته «کمک، هدیه و امور اجتماعی» ثبت می‌شوند.",
      },
      { code: "ENT-OTHER", name: "سایر هزینه‌های تفریح و سرگرمی", nameEn: "Other Entertainment" },
    ],
  },
  {
    code: "COM",
    name: "ارتباطات و اشتراک‌ها",
    nameEn: "Communications & Subscriptions",
    description: "اینترنت ثابت منزل در دسته «مسکن» ثبت می‌شود؛ این دسته برای موبایل، شارژ و اشتراک‌های دیجیتال است.",
    children: [
      {
        code: "COM-INTERNET",
        name: "اینترنت موبایل و همراه",
        nameEn: "Mobile Internet",
        description: "اینترنت موبایل/همراه؛ اینترنت ثابت منزل در دسته «مسکن و ساختمان» ثبت می‌شود.",
      },
      { code: "COM-MOBILE", name: "تلفن همراه", nameEn: "Mobile Phone" },
      { code: "COM-CHARGE", name: "شارژ و خدمات ارتباطی", nameEn: "Top-up & Telecom Services" },
      { code: "COM-SUB", name: "اشتراک‌های دیجیتال", nameEn: "Digital Subscriptions" },
      { code: "COM-ONLINE", name: "سرویس‌های آنلاین", nameEn: "Online Services" },
      { code: "COM-SOFTWARE", name: "نرم‌افزارها و خدمات اشتراکی", nameEn: "Software & Subscriptions" },
      { code: "COM-OTHER", name: "سایر هزینه‌های ارتباطات و اشتراک‌ها", nameEn: "Other Communications" },
    ],
  },
  {
    code: "PUR",
    name: "خریدهای شخصی و خانوادگی",
    nameEn: "Personal & Family Purchases",
    children: [
      { code: "PUR-PERSONAL", name: "لوازم شخصی", nameEn: "Personal Items" },
      { code: "PUR-HOME", name: "لوازم خانگی", nameEn: "Household Items" },
      { code: "PUR-CONSUMABLE", name: "وسایل مصرفی منزل", nameEn: "Home Consumables" },
      { code: "PUR-FAMILY", name: "خریدهای خانوادگی", nameEn: "Family Purchases" },
      { code: "PUR-SPOUSE", name: "خرید برای همسر", nameEn: "Spouse Purchases" },
      { code: "PUR-MISC", name: "خریدهای متفرقه", nameEn: "Miscellaneous Purchases" },
      { code: "PUR-OTHER", name: "سایر خریدهای شخصی و خانوادگی", nameEn: "Other Purchases" },
    ],
  },
  {
    code: "FAM",
    name: "هزینه‌های خانوادگی",
    nameEn: "Family Expenses",
    description: "پرداخت‌ها و هزینه‌های داخل خانواده؛ هدایای بیرون از خانواده در دسته «کمک، هدیه و امور اجتماعی» ثبت می‌شود.",
    children: [
      { code: "FAM-SPOUSE-ALLOWANCE", name: "کمک یا پرداخت ماهانه به همسر", nameEn: "Spouse Allowance" },
      { code: "FAM-SHARED", name: "هزینه‌های مشترک خانوادگی", nameEn: "Shared Family Expenses" },
      { code: "FAM-MEMBERS", name: "هزینه‌های مربوط به اعضای خانواده", nameEn: "Family Members Expenses" },
      {
        code: "FAM-GIFTS",
        name: "هدایا (خانواده)",
        nameEn: "Family Gifts",
        description: "هدایای داخل خانواده؛ هدیه به دیگران در دسته «کمک، هدیه و امور اجتماعی» ثبت می‌شود.",
      },
      { code: "FAM-HOST", name: "مهمانی و پذیرایی", nameEn: "Hosting & Catering" },
      { code: "FAM-EVENTS", name: "مناسبت‌ها و جشن‌ها", nameEn: "Family Occasions & Ceremonies" },
      { code: "FAM-OTHER", name: "سایر هزینه‌های خانوادگی", nameEn: "Other Family" },
    ],
  },
  {
    code: "INS",
    name: "بیمه و تعهدات مالی",
    nameEn: "Insurance & Financial Commitments",
    description:
      "حق بیمه‌ها و کارمزدهای مالی؛ بیمه‌های خودرو در دسته «خودرو و حمل‌ونقل» ثبت می‌شوند. بازپرداخت اصل بدهی/انتقال بین حساب‌ها اصلاً «هزینه» نیست و با نوع تراکنش جداگانه ثبت می‌شود.",
    children: [
      { code: "INS-SOCIAL", name: "بیمه تأمین اجتماعی", nameEn: "Social Security Insurance" },
      {
        code: "INS-HEALTH",
        name: "بیمه درمان تکمیلی",
        nameEn: "Supplementary Health Insurance",
        description: "حق بیمهٔ درمان تکمیلی؛ هزینه‌های مستقیم درمان در دسته «سلامت و درمان» ثبت می‌شوند.",
      },
      {
        code: "INS-OTHER",
        name: "سایر بیمه‌ها",
        nameEn: "Other Insurance",
        description: "بیمه عمر، مسئولیت و سایر بیمه‌های غیر خودرو (بیمه خودرو در دسته «خودرو و حمل‌ونقل» است).",
      },
      { code: "INS-BANK-FEE", name: "کارمزد بانکی", nameEn: "Bank Fees" },
      { code: "INS-FIN-FEE", name: "کارمزد خدمات مالی", nameEn: "Financial Service Fees" },
      { code: "INS-OTHER-FIN", name: "سایر هزینه‌های مالی", nameEn: "Other Financial Costs" },
    ],
  },
  {
    code: "EDU",
    name: "آموزش و توسعه فردی",
    nameEn: "Education & Personal Development",
    children: [
      { code: "EDU-BOOK", name: "کتاب", nameEn: "Books" },
      { code: "EDU-COURSE", name: "دوره آموزشی", nameEn: "Courses" },
      { code: "EDU-ONLINE", name: "آموزش آنلاین", nameEn: "Online Learning" },
      { code: "EDU-CLASS", name: "کلاس و آموزش حضوری", nameEn: "In-person Classes" },
      { code: "EDU-TOOLS", name: "نرم‌افزار و ابزار آموزشی", nameEn: "Learning Tools" },
      { code: "EDU-OTHER", name: "سایر هزینه‌های آموزش", nameEn: "Other Education" },
    ],
  },
  {
    code: "WRK",
    name: "هزینه‌های شغلی و حرفه‌ای",
    nameEn: "Work & Professional Expenses",
    children: [
      { code: "WRK-TOOLS", name: "ابزار و تجهیزات کاری", nameEn: "Work Tools & Equipment" },
      { code: "WRK-SOFTWARE", name: "نرم‌افزارهای کاری", nameEn: "Work Software" },
      { code: "WRK-SERVICES", name: "خدمات حرفه‌ای", nameEn: "Professional Services" },
      { code: "WRK-COMMUTE", name: "هزینه رفت‌وآمد کاری", nameEn: "Work Commute" },
      { code: "WRK-TRAINING", name: "آموزش حرفه‌ای", nameEn: "Professional Training" },
      { code: "WRK-OTHER", name: "سایر هزینه‌های شغلی", nameEn: "Other Work" },
    ],
  },
  {
    code: "TAX",
    name: "مالیات، قانونی و اداری",
    nameEn: "Tax, Legal & Administrative",
    children: [
      { code: "TAX-TAX", name: "مالیات", nameEn: "Taxes" },
      { code: "TAX-LEGAL", name: "هزینه‌های قانونی", nameEn: "Legal Costs" },
      { code: "TAX-ADMIN", name: "هزینه‌های اداری", nameEn: "Administrative Costs" },
      { code: "TAX-COUNSEL", name: "هزینه مشاوره حقوقی", nameEn: "Legal Counsel" },
      { code: "TAX-DOCS", name: "هزینه اسناد و مدارک", nameEn: "Documents & Notary" },
      { code: "TAX-OTHER", name: "سایر هزینه‌های قانونی و اداری", nameEn: "Other Legal" },
    ],
  },
  {
    code: "SOC",
    name: "کمک، هدیه و امور اجتماعی",
    nameEn: "Charity, Gifts & Social",
    description: "هدیه و کمک بیرون از خانواده؛ هدایای داخل خانواده در دسته «هزینه‌های خانوادگی» ثبت می‌شوند.",
    children: [
      {
        code: "SOC-GIFT",
        name: "هدیه",
        nameEn: "Gifts",
        description: "هدیه به دیگران (بیرون از خانواده)؛ هدایای داخل خانواده در دسته «هزینه‌های خانوادگی» ثبت می‌شوند.",
      },
      { code: "SOC-FAMILY-HELP", name: "کمک به خانواده", nameEn: "Family Support" },
      { code: "SOC-CHARITY", name: "کمک‌های خیریه", nameEn: "Charity" },
      { code: "SOC-SOCIAL", name: "کمک‌های اجتماعی", nameEn: "Social Support" },
      { code: "SOC-EVENTS", name: "مناسبت‌ها", nameEn: "Social Occasions" },
      { code: "SOC-OTHER", name: "سایر هزینه‌های اجتماعی", nameEn: "Other Social" },
    ],
  },
  {
    code: "MSC",
    name: "هزینه‌های متفرقه",
    nameEn: "Miscellaneous",
    description:
      "آخرین راه‌حل: فقط زمانی استفاده شود که هیچ دستهٔ مناسب دیگری وجود ندارد. تراکنش‌های این دسته در گزارش‌ها قابل بررسی‌اند تا در صورت تکرار، دستهٔ مستقل ساخته شود.",
    children: [
      { code: "MSC-MISC", name: "هزینه متفرقه", nameEn: "Miscellaneous" },
      { code: "MSC-EMERGENCY", name: "هزینه اضطراری", nameEn: "Emergency" },
      { code: "MSC-OTHER", name: "سایر هزینه‌ها", nameEn: "Other Expenses" },
    ],
  },
];

/** Code of the fallback "miscellaneous" leaf used when no category is supplied. */
export const MISC_CATEGORY_CODE = "MSC-MISC";
export const MISC_PARENT_CODE = "MSC";

/** Flat list of every leaf (level-1) node of the standard catalog. */
export const EXPENSE_CATEGORY_LEAVES: CatalogNode[] = EXPENSE_CATEGORY_CATALOG.flatMap(
  (parent) => parent.children ?? [],
);

/** Total node count (parents + leaves) of the standard catalog. */
export const EXPENSE_CATEGORY_NODE_COUNT =
  EXPENSE_CATEGORY_CATALOG.length + EXPENSE_CATEGORY_LEAVES.length;

/**
 * Legacy chart-of-accounts expense codes → canonical category codes.
 * Used once, non-destructively, to classify ledger entries created before
 * the category system existed (only entries without a category are touched).
 */
export const LEGACY_ACCOUNT_CATEGORY_MAP: Record<string, string> = {
  "5010": "FOD-GROCERY-HOME", // خوراک و خانه
  "5020": "HSG-RENT", // مسکن و اجاره
  "5030": "TRN-OTHER", // حمل‌ونقل
  "5040": "INS-BANK-FEE", // کارمزد و بانک
  "5050": "ENT-TRAVEL", // سفر و رویداد
  "5900": "MSC-MISC", // هزینه متفرقه
};
