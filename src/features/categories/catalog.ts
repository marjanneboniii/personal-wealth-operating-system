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
 *  5. Names carry no amounts — a category is "what", never "how much".
 *  6. Codes are identities, not paths: a leaf keeps its code when it moves
 *     to another group or is renamed (HYG-NAIL lives under BTY), and the
 *     catalogue sync re-homes and renames the stored row to match.
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
    code: "FOD",
    name: "خوراک و خواربار",
    nameEn: "Food & Groceries",
    description: "خوراک خانه و غذای بیرون به نیت تغذیه؛ کافه و رستورانِ تفریحی در «تفریح و سفر» ثبت می‌شود.",
    children: [
      {
        code: "FOD-GROCERY-HOME",
        name: "خرید ماهانهٔ خواربار",
        nameEn: "Monthly Groceries",
        description: "برنج، روغن، حبوبات، لبنیات، کنسرو و اقلام انبار آشپزخانه.",
      },
      { code: "FOD-GROCERY-DAILY", name: "نان، میوه و سبزی", nameEn: "Bread, Fruit & Vegetables" },
      { code: "FOD-MEAT", name: "گوشت، مرغ و ماهی", nameEn: "Meat, Poultry & Fish" },
      { code: "FOD-SNACK", name: "تنقلات و نوشیدنی", nameEn: "Snacks & Drinks" },
      { code: "FOD-DELIVERY", name: "سفارش آنلاین غذا", nameEn: "Food Delivery" },
      {
        code: "FOD-REST",
        name: "غذای بیرون و فست‌فود",
        nameEn: "Eating Out",
        description: "ناهار سر کار یا غذایی که جای آشپزی خانه را می‌گیرد؛ کافه و رستوران تفریحی در «تفریح و سفر» است.",
      },
      { code: "FOD-OTHER", name: "سایر هزینه‌های خوراک", nameEn: "Other Food" },
    ],
  },
  {
    code: "HSG",
    name: "مسکن و قبوض",
    nameEn: "Housing & Utilities",
    description: "اجاره، شارژ، قبض‌ها، اینترنت منزل و نگهداری خانه.",
    children: [
      { code: "HSG-RENT", name: "اجاره یا قسط مسکن", nameEn: "Rent / Mortgage" },
      { code: "HSG-CHARGE", name: "شارژ ماهانهٔ ساختمان", nameEn: "Building Charge" },
      { code: "HSG-ELEC", name: "قبض برق", nameEn: "Electricity" },
      { code: "HSG-GAS", name: "قبض گاز", nameEn: "Gas" },
      { code: "HSG-WATER", name: "قبض آب", nameEn: "Water" },
      {
        code: "HSG-INT",
        name: "اینترنت منزل",
        nameEn: "Home Internet",
        description: "اینترنت ثابت منزل (ADSL، فیبر یا TD-LTE)؛ بستهٔ اینترنت گوشی در «موبایل، اینترنت و اشتراک‌ها» است.",
      },
      { code: "HSG-PHONE", name: "قبض تلفن ثابت", nameEn: "Landline Phone" },
      { code: "HSG-MAINT", name: "تعمیرات و نگهداری منزل", nameEn: "Home Maintenance" },
      { code: "HSG-EQUIP", name: "لوازم خانگی و مبلمان", nameEn: "Appliances & Furniture" },
      { code: "HSG-CLEAN", name: "نظافت و خدمات منزل", nameEn: "Cleaning & Home Services" },
      { code: "HSG-OTHER", name: "سایر هزینه‌های مسکن", nameEn: "Other Housing" },
    ],
  },
  {
    code: "TRN",
    name: "خودرو و حمل‌ونقل",
    nameEn: "Vehicle & Transportation",
    description: "همهٔ هزینه‌های خودرو، از جمله بیمه‌های خودرو، تا هزینهٔ کامل ماشین یک‌جا دیده شود.",
    children: [
      { code: "TRN-FUEL", name: "سوخت خودرو", nameEn: "Fuel" },
      {
        code: "TRN-INS-TP",
        name: "بیمه شخص ثالث خودرو",
        nameEn: "Third-party Insurance",
        description: "پیش‌پرداخت یا قسط بیمهٔ شخص ثالث. بیمه‌های خودرو به‌جای «بیمه» همین‌جا ثبت می‌شوند.",
      },
      { code: "TRN-INS-BODY", name: "بیمه بدنه خودرو", nameEn: "Body Insurance" },
      { code: "TRN-OIL", name: "تعویض روغن و سرویس دوره‌ای", nameEn: "Oil & Periodic Service" },
      { code: "TRN-REPAIR", name: "تعمیرات و قطعات خودرو", nameEn: "Repairs & Parts" },
      { code: "TRN-TIRE", name: "لاستیک و باتری", nameEn: "Tires & Battery" },
      { code: "TRN-WASH", name: "کارواش", nameEn: "Car Wash" },
      { code: "TRN-PARK", name: "پارکینگ", nameEn: "Parking" },
      { code: "TRN-TOLL", name: "عوارض و جریمهٔ رانندگی", nameEn: "Tolls & Fines" },
      { code: "TRN-INSPECT", name: "معاینه فنی", nameEn: "Technical Inspection" },
      { code: "TRN-TAXI", name: "تاکسی و تاکسی اینترنتی", nameEn: "Taxi & Ride-hailing" },
      { code: "TRN-PUBLIC", name: "مترو و اتوبوس", nameEn: "Public Transport" },
      {
        code: "TRN-DEPR",
        name: "استهلاک خودرو",
        nameEn: "Vehicle Depreciation Reserve",
        nature: "non_cash",
        description:
          "ثبت غیرنقدی: ذخیرهٔ استهلاک و تعمیرات آیندهٔ خودرو. در گزارش هزینه منظور می‌شود ولی پولی از حساب خارج نمی‌شود.",
      },
      { code: "TRN-OTHER", name: "سایر هزینه‌های خودرو", nameEn: "Other Transportation" },
    ],
  },
  {
    code: "HYG",
    name: "بهداشت و لوازم آرایشی",
    nameEn: "Hygiene & Cosmetics",
    description: "اقلام مصرفی بهداشتی و آرایشی؛ خدمات آرایشگاه و زیبایی در «آرایشگاه و زیبایی» ثبت می‌شود.",
    children: [
      {
        code: "HYG-SHAMPOO",
        name: "بهداشت شخصی و شوینده‌ها",
        nameEn: "Toiletries & Detergents",
        description: "شامپو، صابون، مایع دستشویی و ظرفشویی، شوینده، سفیدکننده، دستمال کاغذی، خمیردندان و مسواک.",
      },
      { code: "HYG-COSM-MEN", name: "لوازم آرایشی و بهداشتی مردانه", nameEn: "Men's Cosmetics" },
      { code: "HYG-COSM-WOMEN", name: "لوازم آرایشی و بهداشتی زنانه", nameEn: "Women's Cosmetics" },
      { code: "HYG-OTHER", name: "سایر اقلام بهداشتی", nameEn: "Other Hygiene" },
    ],
  },
  {
    code: "BTY",
    name: "آرایشگاه و زیبایی",
    nameEn: "Salon & Beauty",
    description: "خدمات آرایشگاه، مو، ناخن، پوست و لیزر.",
    children: [
      { code: "HYG-HAIR", name: "اصلاح موی مردانه", nameEn: "Men's Haircut" },
      { code: "BTY-HAIR-WOMEN", name: "اصلاح موی زنانه", nameEn: "Women's Haircut" },
      { code: "BTY-KERATIN", name: "کراتین مو", nameEn: "Hair Keratin" },
      { code: "BTY-COLOR", name: "رنگ و مش مو", nameEn: "Hair Coloring" },
      { code: "BTY-MAKEUP", name: "میکاپ", nameEn: "Makeup" },
      { code: "HYG-EYEBROW", name: "اصلاح ابرو", nameEn: "Eyebrow Grooming" },
      { code: "HYG-NAIL", name: "ترمیم ناخن", nameEn: "Nail Care" },
      { code: "HYG-PEDICURE", name: "ژلیش پا", nameEn: "Foot Gelish" },
      { code: "HYG-LASER-FACE", name: "لیزر صورت", nameEn: "Face Laser" },
      { code: "HYG-LASER-BODY", name: "لیزر توتال بادی", nameEn: "Full Body Laser" },
      { code: "BTY-SKIN", name: "پاکسازی و مراقبت پوست", nameEn: "Skin Care" },
      { code: "BTY-OTHER", name: "سایر خدمات زیبایی", nameEn: "Other Beauty" },
    ],
  },
  {
    code: "CLT",
    name: "پوشاک و اکسسوری",
    nameEn: "Clothing & Accessories",
    children: [
      { code: "CLT-PERSONAL", name: "پوشاک مردانه", nameEn: "Men's Clothing" },
      { code: "CLT-SPOUSE", name: "پوشاک زنانه", nameEn: "Women's Clothing" },
      { code: "CLT-KIDS", name: "پوشاک کودک", nameEn: "Kids' Clothing" },
      { code: "CLT-SHOES", name: "کفش", nameEn: "Shoes" },
      { code: "CLT-BAG", name: "کیف", nameEn: "Bags" },
      { code: "CLT-WATCH", name: "ساعت، عینک آفتابی و اکسسوری", nameEn: "Watches & Accessories" },
      { code: "CLT-LAUNDRY", name: "خشک‌شویی و خیاطی", nameEn: "Dry Cleaning & Tailoring" },
      { code: "CLT-OTHER", name: "سایر هزینه‌های پوشاک", nameEn: "Other Clothing" },
    ],
  },
  {
    code: "HLT",
    name: "سلامت و درمان",
    nameEn: "Health & Medical",
    description: "هزینه‌های مستقیم درمان؛ حق بیمهٔ درمان تکمیلی در دستهٔ «بیمه» ثبت می‌شود.",
    children: [
      { code: "HLT-DOCTOR", name: "ویزیت پزشک", nameEn: "Doctor Visit" },
      { code: "HLT-PHARM", name: "دارو", nameEn: "Medicine" },
      { code: "HLT-LAB", name: "آزمایش و تصویربرداری", nameEn: "Lab & Imaging" },
      { code: "HLT-DENTAL", name: "دندان‌پزشکی", nameEn: "Dental" },
      { code: "HLT-EYE", name: "چشم‌پزشکی و عینک طبی", nameEn: "Eye Care & Glasses" },
      { code: "HLT-SERVICES", name: "فیزیوتراپی و خدمات درمانی", nameEn: "Physiotherapy & Care Services" },
      { code: "HLT-HOSPITAL", name: "بستری و جراحی", nameEn: "Hospital & Surgery" },
      { code: "HLT-PSY", name: "مشاوره و روان‌درمانی", nameEn: "Counseling & Therapy" },
      { code: "HLT-SUPPLEMENT", name: "مکمل و ویتامین", nameEn: "Supplements" },
      { code: "HLT-OTHER", name: "سایر هزینه‌های درمان", nameEn: "Other Health" },
    ],
  },
  {
    code: "ENT",
    name: "تفریح و سفر",
    nameEn: "Leisure & Travel",
    description: "کافه و رستوران تفریحی، سفر، ورزش و سرگرمی.",
    children: [
      {
        code: "ENT-DINING",
        name: "کافه و رستوران",
        nameEn: "Café & Restaurant",
        description: "بیرون رفتن به نیت تفریح و دورهمی؛ ناهار سر کار در «غذای بیرون و فست‌فود» است.",
      },
      { code: "ENT-TRIP-SHORT", name: "سفر کوتاه", nameEn: "Short Trip" },
      { code: "ENT-TRAVEL", name: "سفر، بلیت و اقامت", nameEn: "Travel, Tickets & Stays" },
      { code: "ENT-CINEMA", name: "سینما، تئاتر و کنسرت", nameEn: "Cinema, Theater & Concerts" },
      { code: "ENT-SPORT", name: "باشگاه و ورزش", nameEn: "Gym & Sports" },
      { code: "ENT-ACTIVITY", name: "فعالیت‌های تفریحی", nameEn: "Leisure Activities" },
      { code: "ENT-FUN", name: "بازی و سرگرمی", nameEn: "Games & Hobbies" },
      { code: "ENT-OTHER", name: "سایر هزینه‌های تفریح", nameEn: "Other Leisure" },
    ],
  },
  {
    code: "COM",
    name: "موبایل، اینترنت و اشتراک‌ها",
    nameEn: "Mobile, Internet & Subscriptions",
    description: "تلفن همراه، اینترنت گوشی و اشتراک‌های دیجیتال؛ اینترنت ثابت منزل در «مسکن و قبوض» است.",
    children: [
      { code: "COM-MOBILE", name: "قبض و شارژ تلفن همراه", nameEn: "Mobile Bill & Top-up" },
      { code: "COM-INTERNET", name: "بستهٔ اینترنت موبایل", nameEn: "Mobile Data" },
      { code: "COM-SUB", name: "اشتراک فیلم و موسیقی", nameEn: "Streaming Subscriptions" },
      { code: "COM-SOFTWARE", name: "نرم‌افزار و سرویس آنلاین", nameEn: "Software & Online Services" },
      { code: "COM-DEVICE", name: "گوشی و لوازم دیجیتال", nameEn: "Phones & Gadgets" },
      { code: "COM-OTHER", name: "سایر هزینه‌های ارتباطی", nameEn: "Other Communications" },
    ],
  },
  {
    code: "FAM",
    name: "خانواده و فرزندان",
    nameEn: "Family & Children",
    description: "پرداخت‌ها و هزینه‌های داخل خانواده؛ هدیه در «هدیه و خیریه» ثبت می‌شود.",
    children: [
      { code: "FAM-SPOUSE-ALLOWANCE", name: "خرجی ماهانهٔ همسر", nameEn: "Spouse Allowance" },
      { code: "FAM-CHILD", name: "فرزندان", nameEn: "Children", description: "مهد کودک، اسباب‌بازی، پول توجیبی و نیازهای کودک." },
      { code: "SOC-FAMILY-HELP", name: "کمک به والدین و بستگان", nameEn: "Support for Parents & Relatives" },
      { code: "FAM-HOST", name: "مهمانی و پذیرایی", nameEn: "Hosting & Catering" },
      { code: "FAM-EVENTS", name: "جشن‌ها و مناسبت‌ها", nameEn: "Celebrations & Occasions" },
      { code: "FAM-PET", name: "حیوان خانگی", nameEn: "Pets" },
      { code: "FAM-OTHER", name: "سایر هزینه‌های خانواده", nameEn: "Other Family" },
    ],
  },
  {
    code: "INS",
    name: "بیمه",
    nameEn: "Insurance",
    description: "حق بیمه‌ها (پیش‌پرداخت یا قسط)؛ بیمه‌های خودرو در «خودرو و حمل‌ونقل» ثبت می‌شوند.",
    children: [
      { code: "INS-SOCIAL", name: "بیمه تأمین اجتماعی", nameEn: "Social Security Insurance" },
      {
        code: "INS-HEALTH",
        name: "بیمه درمان تکمیلی",
        nameEn: "Supplementary Health Insurance",
        description: "پیش‌پرداخت یا قسط حق بیمهٔ درمان تکمیلی؛ هزینهٔ خود درمان در «سلامت و درمان» است.",
      },
      { code: "INS-LIFE", name: "بیمه عمر", nameEn: "Life Insurance" },
      { code: "INS-HOME", name: "بیمه آتش‌سوزی و زلزلهٔ منزل", nameEn: "Home Insurance" },
      { code: "INS-OTHER", name: "سایر بیمه‌ها", nameEn: "Other Insurance", description: "مسافرتی، مسئولیت و بیمه‌های دیگر." },
    ],
  },
  {
    code: "FIN",
    name: "کارمزد و هزینه‌های مالی",
    nameEn: "Fees & Financial Costs",
    description:
      "کارمزدها؛ بازپرداخت اصل بدهی یا انتقال بین حساب‌ها «هزینه» نیست و با نوع تراکنش جداگانه ثبت می‌شود.",
    children: [
      { code: "INS-BANK-FEE", name: "کارمزد بانکی", nameEn: "Bank Fees" },
      { code: "INS-FIN-FEE", name: "کارمزد کارگزاری و صرافی", nameEn: "Brokerage & Exchange Fees" },
      { code: "INS-OTHER-FIN", name: "سایر هزینه‌های مالی", nameEn: "Other Financial Costs" },
    ],
  },
  {
    code: "EDU",
    name: "آموزش",
    nameEn: "Education",
    children: [
      { code: "EDU-TUITION", name: "شهریهٔ مدرسه و دانشگاه", nameEn: "School & University Tuition" },
      { code: "EDU-COURSE", name: "دوره و کلاس آموزشی", nameEn: "Courses & Classes" },
      { code: "EDU-LANG", name: "کلاس زبان", nameEn: "Language Classes" },
      { code: "EDU-BOOK", name: "کتاب و لوازم‌التحریر", nameEn: "Books & Stationery" },
      { code: "EDU-TOOLS", name: "ابزار و نرم‌افزار آموزشی", nameEn: "Learning Tools" },
      { code: "EDU-OTHER", name: "سایر هزینه‌های آموزش", nameEn: "Other Education" },
    ],
  },
  {
    code: "WRK",
    name: "هزینه‌های شغلی",
    nameEn: "Work Expenses",
    description: "هزینه‌هایی که برای کار و کسب درآمد انجام می‌شود.",
    children: [
      { code: "WRK-TOOLS", name: "ابزار و تجهیزات کاری", nameEn: "Work Tools & Equipment" },
      { code: "WRK-SOFTWARE", name: "نرم‌افزارهای کاری", nameEn: "Work Software" },
      { code: "WRK-SERVICES", name: "خدمات حرفه‌ای", nameEn: "Professional Services" },
      {
        code: "WRK-COMMUTE",
        name: "رفت‌وآمد و مأموریت کاری",
        nameEn: "Work Travel",
        description: "فقط سفر و رفت‌وآمدی که برای کار است؛ رفت‌وآمد روزمره در «خودرو و حمل‌ونقل» است.",
      },
      { code: "WRK-OTHER", name: "سایر هزینه‌های شغلی", nameEn: "Other Work" },
    ],
  },
  {
    code: "TAX",
    name: "مالیات و امور اداری",
    nameEn: "Tax & Administrative",
    children: [
      { code: "TAX-TAX", name: "مالیات", nameEn: "Taxes" },
      { code: "TAX-MUNICIPAL", name: "عوارض شهرداری و نوسازی", nameEn: "Municipal Charges" },
      { code: "TAX-DOCS", name: "دفترخانه و اسناد", nameEn: "Notary & Documents" },
      { code: "TAX-LEGAL", name: "وکیل و هزینه‌های حقوقی", nameEn: "Legal Costs" },
      { code: "TAX-ADMIN", name: "خدمات اداری و دولتی", nameEn: "Government Services", description: "گذرنامه، گواهینامه، خدمات پلیس+۱۰ و مانند آن." },
      { code: "TAX-OTHER", name: "سایر هزینه‌های اداری", nameEn: "Other Administrative" },
    ],
  },
  {
    code: "SOC",
    name: "هدیه و خیریه",
    nameEn: "Gifts & Charity",
    children: [
      { code: "SOC-GIFT", name: "هدیه", nameEn: "Gifts", description: "هدیه به خانواده، دوستان یا همکاران." },
      { code: "SOC-CHARITY", name: "خیریه و صدقه", nameEn: "Charity" },
      { code: "SOC-RELIGIOUS", name: "نذری و وجوهات شرعی", nameEn: "Religious Offerings" },
      { code: "SOC-SOCIAL", name: "کمک به دیگران", nameEn: "Helping Others" },
      { code: "SOC-OTHER", name: "سایر هدیه‌ها و کمک‌ها", nameEn: "Other Gifts & Giving" },
    ],
  },
  {
    code: "MSC",
    name: "متفرقه",
    nameEn: "Miscellaneous",
    description:
      "آخرین راه‌حل: فقط وقتی هیچ دستهٔ دیگری مناسب نیست. اگر هزینه‌ای تکرار شد، برایش زیردستهٔ مستقل بسازید.",
    children: [
      { code: "MSC-MISC", name: "هزینه متفرقه", nameEn: "Miscellaneous" },
      { code: "MSC-EMERGENCY", name: "هزینهٔ پیش‌بینی‌نشده", nameEn: "Unexpected" },
    ],
  },
];

/**
 * Codes that once belonged to the standard catalog and were merged into
 * another node. Their rows are kept — past entries still point at them and
 * reports still name them — but they are deactivated, so no new expense can
 * be filed under them. A retired group's own sub-categories (custom ones a
 * user added) move to «متفرقه».
 */
export const RETIRED_EXPENSE_CODES: string[] = [
  // خریدهای شخصی و خانوادگی — every leaf overlapped another group.
  "PUR",
  "PUR-PERSONAL",
  "PUR-HOME",
  "PUR-CONSUMABLE",
  "PUR-FAMILY",
  "PUR-SPOUSE",
  "PUR-MISC",
  "PUR-OTHER",
  "FOD-CAFE", // → ENT-DINING
  "FOD-FASTFOOD", // → FOD-REST
  "FOD-DRINK", // → FOD-SNACK
  "HYG-PRODUCTS", // → HYG-SHAMPOO
  "CLT-CLOTHES", // → CLT-PERSONAL / CLT-SPOUSE
  "ENT-GIFT", // → SOC-GIFT
  "COM-CHARGE", // → COM-MOBILE
  "COM-ONLINE", // → COM-SOFTWARE
  "FAM-SHARED",
  "FAM-MEMBERS",
  "FAM-GIFTS", // → SOC-GIFT
  "EDU-ONLINE", // → EDU-COURSE
  "EDU-CLASS", // → EDU-COURSE
  "WRK-TRAINING", // → EDU-COURSE
  "TAX-COUNSEL", // → TAX-LEGAL
  "SOC-EVENTS", // → FAM-EVENTS
  "MSC-OTHER", // → MSC-MISC
];

/**
 * Standard INCOME taxonomy — same parent → leaf rules as expenses.
 *
 *  • Amounts are what actually reached the account (net salary, after
 *    insurance and tax) — deductions are not recorded.
 *  • Profit from SELLING an asset (shares, coins, gold, property, a car) is
 *    booked automatically by «فروش دارایی» as realized gain; it is never an
 *    income source here, so it cannot be counted twice.
 *  • Money moving between one's own accounts, a loan received, or a debt
 *    collected is not income either — those have their own flows.
 */
export const INCOME_CATEGORY_CATALOG: CatalogNode[] = [
  {
    code: "INC-SAL",
    name: "حقوق و دستمزد",
    nameEn: "Salary & Wages",
    description: "خالص مبلغی که به حساب واریز می‌شود (پس از کسر بیمه و مالیات).",
    children: [
      { code: "INC-SAL-NET", name: "حقوق ماهانه", nameEn: "Monthly Salary (Net)" },
      { code: "INC-SAL-BONUS", name: "پاداش، عیدی و سنوات", nameEn: "Bonus / Eid / Severance" },
      { code: "INC-SAL-OVERTIME", name: "اضافه‌کار و کارانه", nameEn: "Overtime" },
      { code: "INC-SAL-ALLOW", name: "کمک‌هزینه و بن", nameEn: "Allowances", description: "حق مسکن، ایاب‌وذهاب، بن خواربار و مانند آن." },
      { code: "INC-SAL-ARREARS", name: "معوقات و علی‌الحساب", nameEn: "Arrears" },
      { code: "INC-SAL-PARTTIME", name: "کار پاره‌وقت یا شغل دوم", nameEn: "Part-time / Second Job" },
      { code: "INC-SAL-OTHER", name: "سایر دریافتی‌های شغلی", nameEn: "Other Employment Income" },
    ],
  },
  {
    code: "INC-BIZ",
    name: "کسب‌وکار و کار آزاد",
    nameEn: "Business & Self-Employment",
    description: "درآمد از کاری که برای خودتان انجام می‌دهید؛ مبلغی را ثبت کنید که واقعاً به دستتان رسیده است.",
    children: [
      { code: "INC-BIZ-FREELANCE", name: "پروژهٔ فریلنس", nameEn: "Freelance Project" },
      { code: "INC-BIZ-SALES", name: "فروش کالا یا خدمات", nameEn: "Sales of Goods / Services" },
      { code: "INC-BIZ-PROFIT", name: "سود کسب‌وکار یا شراکت", nameEn: "Business / Partnership Profit" },
      { code: "INC-BIZ-COMMISSION", name: "حق‌الزحمه و کمیسیون", nameEn: "Fees & Commission" },
      { code: "INC-BIZ-TEACH", name: "تدریس، مشاوره و تولید محتوا", nameEn: "Teaching / Consulting / Content" },
      { code: "INC-BIZ-GIG", name: "رانندگی اینترنتی و پیک", nameEn: "Ride-hailing / Delivery" },
      { code: "INC-BIZ-OTHER", name: "سایر درآمدهای کسب‌وکار", nameEn: "Other Business Income" },
    ],
  },
  {
    code: "INC-INV",
    name: "درآمد سرمایه‌گذاری",
    nameEn: "Investment Income",
    description: "سود دوره‌ای واریزی. سود فروش دارایی هنگام «فروش دارایی» خودکار ثبت می‌شود و اینجا وارد نمی‌شود.",
    children: [
      { code: "INC-INV-INTEREST", name: "سود سپردهٔ بانکی", nameEn: "Bank Deposit Interest" },
      { code: "INC-INV-DIVIDEND", name: "سود نقدی سهام", nameEn: "Stock Dividends" },
      { code: "INC-INV-FUND", name: "سود صندوق درآمد ثابت", nameEn: "Fixed-Income Fund Payout" },
      { code: "INC-INV-BOND", name: "سود اوراق", nameEn: "Bond Coupons" },
      { code: "INC-INV-RENT", name: "اجارهٔ ملک", nameEn: "Rental Income" },
      { code: "INC-INV-CRYPTO", name: "سود استیکینگ و سپردهٔ رمزارز", nameEn: "Staking / Crypto Earn" },
      { code: "INC-INV-LEASE", name: "اجارهٔ خودرو یا تجهیزات", nameEn: "Vehicle / Equipment Lease" },
      { code: "INC-INV-OTHER", name: "سایر درآمدهای سرمایه‌گذاری", nameEn: "Other Investment Income" },
    ],
  },
  {
    code: "INC-PEN",
    name: "بازنشستگی و مستمری",
    nameEn: "Pension",
    description: "مبلغی که هر ماه از صندوق بازنشستگی یا بیمه به حساب شما واریز می‌شود.",
    children: [
      { code: "INC-PEN-PENSION", name: "حقوق بازنشستگی", nameEn: "Retirement Pension" },
      { code: "INC-PEN-SUPPLEMENT", name: "مستمری و بیمهٔ تکمیلی", nameEn: "Annuity / Supplementary Pension" },
      { code: "INC-PEN-OTHER", name: "سایر دریافتی‌های بازنشستگی", nameEn: "Other Pension Income" },
    ],
  },
  {
    code: "INC-SUP",
    name: "یارانه، کمک و حمایت",
    nameEn: "Subsidies & Support",
    description: "پولی که بدون کار یا سرمایه‌گذاری دریافت می‌کنید. وامی که گرفته‌اید درآمد نیست.",
    children: [
      { code: "INC-SUP-SUBSIDY", name: "یارانهٔ نقدی", nameEn: "Cash Subsidy" },
      { code: "INC-SUP-FAMILY", name: "کمک خانواده", nameEn: "Family Support" },
      { code: "INC-SUP-SCHOLAR", name: "بورسیه و کمک‌هزینهٔ تحصیلی", nameEn: "Scholarship / Stipend" },
      { code: "INC-SUP-INSURANCE", name: "خسارت یا مستمری بیمه", nameEn: "Insurance Payout" },
      { code: "INC-SUP-UNEMPLOYMENT", name: "بیمهٔ بیکاری", nameEn: "Unemployment Benefit" },
      { code: "INC-SUP-OTHER", name: "سایر کمک‌ها", nameEn: "Other Support" },
    ],
  },
  {
    code: "INC-OTH",
    name: "سایر درآمدها",
    nameEn: "Other Income",
    description: "فقط وقتی دستهٔ دیگری مناسب نیست. پول برگشتی یک خرید، هزینه را کم می‌کند و درآمد نیست.",
    children: [
      { code: "INC-OTH-GIFT", name: "هدیهٔ نقدی", nameEn: "Cash Gift" },
      { code: "INC-OTH-PRIZE", name: "جایزه و قرعه‌کشی", nameEn: "Prize" },
      { code: "INC-OTH-PERSONAL-SALE", name: "فروش وسایل شخصی", nameEn: "Sale of Personal Items" },
      { code: "INC-OTH-INHERIT", name: "ارث", nameEn: "Inheritance" },
      { code: "INC-OTH-MISC", name: "درآمد متفرقه", nameEn: "Miscellaneous Income" },
    ],
  },
];

/** Fallback leaf for an income recorded without a category (legacy callers). */
export const INCOME_MISC_CATEGORY_CODE = "INC-OTH-MISC";
export const INCOME_MISC_PARENT_CODE = "INC-OTH";

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
