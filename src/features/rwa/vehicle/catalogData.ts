/**
 * Vehicle Catalog — default dataset (Brand → Models).
 *
 * IMPORTANT: this is only the *initial* content of a fully dynamic catalog.
 * Brands and models live in the database (`vehicle_brands`, `vehicle_catalog`)
 * and can be extended at runtime by an admin without any schema or code change.
 *
 * `allowsCustomModel` brands have a very large model space; for them the user
 * may type the model name, which is then persisted into the catalog so the
 * next registration can simply pick it from the list (no duplicates).
 */

export type CatalogBrandSeed = {
  /** Display name (Persian first — the app is RTL) */
  name: string;
  /** Latin alias, used for search and standardisation */
  nameEn: string;
  origin: "domestic" | "imported";
  /** Assembler / importer company, when meaningful */
  manufacturer?: string;
  allowsCustomModel?: boolean;
  models: string[];
};

/** خودروهای مونتاژی / تولید داخل — brand = شرکت سازنده / مونتاژکننده */
export const DOMESTIC_BRANDS: CatalogBrandSeed[] = [
  {
    name: "ایران‌خودرو",
    nameEn: "Iran Khodro",
    origin: "domestic",
    manufacturer: "ایران‌خودرو",
    models: [
      "هایما S7 پرو",
      "هایما X7",
      "هایما 8S",
      "هایما S5 پرو",
      "پژو 207 اتوماتیک TU5p سقف فلزی",
      "پژو 207 اتوماتیک TU5p پانوراما",
      "آریسان",
      "بستیون نات",
      "تارا V1",
      "تارا اتوماتیک V4",
      "تارا توربو",
      "دنا پلاس MT6 دنده‌ای",
      "دنا پلاس اتوماتیک آپشنال",
      "رانا پلاس ارتقا یافته TU5P",
      "ری‌را",
      "سورن دوگانه‌سوز پلاس",
      "فوتون بنزینی اتوماتیک",
      "لونا برقی",
    ],
  },
  {
    name: "بهمن موتور",
    nameEn: "Bahman Motor",
    origin: "domestic",
    manufacturer: "بهمن موتور",
    models: [
      "اینوی هیبرید",
      "دیگنیتی پرایم",
      "ریسپکت",
      "شوال H6",
      "فیدلیتی الیت 5 نفره",
      "فیدلیتی الیت 7 نفره",
      "ون اینرودز",
      "هاوال H6",
      "هونگچی H5",
    ],
  },
  {
    name: "تیگارد",
    nameEn: "Tiggard",
    origin: "domestic",
    manufacturer: "تیگارد",
    models: ["تیگارد X05"],
  },
  {
    name: "صنایع خودروسازی ایلیا",
    nameEn: "Ilia Khodro",
    origin: "domestic",
    manufacturer: "صنایع خودروسازی ایلیا",
    models: ["موسو گرند خان سیگنیچر"],
  },
  {
    name: "زامیاد",
    nameEn: "Zamyad",
    origin: "domestic",
    manufacturer: "زامیاد",
    models: ["زامیاد EX"],
  },
  {
    name: "سایپا",
    nameEn: "SAIPA",
    origin: "domestic",
    manufacturer: "سایپا",
    models: [
      "اطلس E اتوماتیک",
      "اطلس G",
      "اطلس S",
      "ساینا GXL دوگانه‌سوز",
      "ساینا S",
      "ساینا اتومات",
      "سهند E اتوماتیک",
      "سهند S",
      "سیتروئن C3-XR",
      "شاهین G اتومات",
      "شاهین GL",
      "شاهین پلاس",
      "پارس نوآ",
      "پراید وانت لاینر GX",
      "کوییک GXL",
      "کوییک GXRL",
      "کوییک RS",
    ],
  },
  {
    name: "فردا موتور",
    nameEn: "FMC",
    origin: "domestic",
    manufacturer: "فردا موتور FMC",
    models: ["اف ام سی 511", "اف ام سی SX5", "اف ام سی T5"],
  },
  {
    name: "آرین موتور",
    nameEn: "Arian Motor",
    origin: "domestic",
    manufacturer: "آرین موتور",
    models: ["لاماری لاماکو فلو"],
  },
  {
    name: "ماموت خودرو",
    nameEn: "Mammut Khodro",
    origin: "domestic",
    manufacturer: "ماموت خودرو",
    models: ["لوکانو L7", "لوکانو L8"],
  },
  {
    name: "آرتابان خودرو",
    nameEn: "Artaban Khodro",
    origin: "domestic",
    manufacturer: "آرتابان خودرو",
    models: ["آرتابان توکا پلاس", "اینفینیت اکسپلورر (چانگان هانتر)"],
  },
  {
    name: "مدیران خودرو",
    nameEn: "MVM / Modiran Khodro",
    origin: "domestic",
    manufacturer: "مدیران خودرو",
    models: [
      "آریزو 6 پرو",
      "آریزو 8",
      "ام وی ام X22 پرو",
      "ام وی ام X33 کراس",
      "ام وی ام X55 پرو",
      "ام وی ام X77",
      "اکستریم QX",
      "اکستریم SX",
      "اکستریم TX",
      "تیگو 7 پرومکس",
      "تیگو 8 پرومکس F8",
      "فونیکس FX",
      "فونیکس اف ایکس برقی",
      "فونیکس تیگو 8 هیبریدی F8 ای پلاس",
    ],
  },
  {
    name: "کرمان موتور",
    nameEn: "Kerman Motor",
    origin: "domestic",
    manufacturer: "کرمان موتور",
    models: [
      "BAC X3 Pro",
      "JAC EJ7+",
      "JAC J4",
      "KMC A5",
      "KMC Eegle",
      "KMC J7",
      "KMC SR3",
      "KMC SR6",
      "KMC T8",
      "KMC T9",
    ],
  },
];

/** خودروهای وارداتی — brand = برند / سازنده */
export const IMPORTED_BRANDS: CatalogBrandSeed[] = [
  { name: "بی‌ام‌و", nameEn: "BMW", origin: "imported", models: ["BMW iX3"] },
  { name: "بی وای دی", nameEn: "BYD", origin: "imported", models: ["بی وای دی سانگ پلاس", "بی وای دی Qin L"] },
  { name: "ام جی", nameEn: "MG", origin: "imported", models: ["MG 5", "MG GT", "MG ZS کراس‌اور"] },
  { name: "آئودی", nameEn: "Audi", origin: "imported", models: ["آئودی A3 سدان", "آئودی Q4 e-tron", "آئودی Q5 e-tron"] },
  { name: "اشکودا", nameEn: "Skoda", origin: "imported", models: ["اشکودا کاروک"] },
  { name: "بیجینگ", nameEn: "Beijing", origin: "imported", models: ["سابرینا بیجینگ U5 پلاس"] },
  { name: "گریت وال / تانک", nameEn: "GWM / Tank", origin: "imported", models: ["تانک 500", "گریت وال تانک 300"] },
  { name: "مکسوس", nameEn: "Maxus", origin: "imported", models: ["پیکاپ مکسوس"] },
  { name: "فولکس واگن", nameEn: "Volkswagen", origin: "imported", models: ["فولکس ID.4"] },
  { name: "وویا", nameEn: "Voyah", origin: "imported", models: ["وویا فری"] },
  { name: "مزدا", nameEn: "Mazda", origin: "imported", models: ["مزدا EZ6", "مزدا EZ60"] },
  { name: "میتسوبیشی", nameEn: "Mitsubishi", origin: "imported", models: ["میتسوبیشی اکلیپس کراس"] },
  { name: "نیسان", nameEn: "Nissan", origin: "imported", models: ["نیسان قشقایی آنر", "نیسان کیکس"] },
  { name: "هیوندای", nameEn: "Hyundai", origin: "imported", models: ["هیوندای النترا 1.6", "هیوندای توسان"] },
  { name: "چانگان", nameEn: "Changan", origin: "imported", models: ["چانگان CS55 پلاس"] },
  { name: "کیا", nameEn: "Kia", origin: "imported", models: ["کیا اسپورتیج 1.5 توربو"] },
  { name: "گک", nameEn: "GAC", origin: "imported", models: ["گک امپو هیبریدی"] },
];

/**
 * برندهای وارداتی با فهرست مدل بسیار گسترده.
 * برای این برندها کاربر می‌تواند نام مدل را وارد کند و مدل واردشده
 * بلافاصله به کاتالوگ اضافه می‌شود تا دفعه بعد از لیست انتخاب شود.
 */
export const FREE_ENTRY_BRANDS: CatalogBrandSeed[] = [
  { name: "تویوتا", nameEn: "Toyota", origin: "imported", allowsCustomModel: true, models: [] },
  { name: "رنو", nameEn: "Renault", origin: "imported", allowsCustomModel: true, models: [] },
  { name: "رووی", nameEn: "Roewe", origin: "imported", allowsCustomModel: true, models: [] },
  { name: "سوزوکی", nameEn: "Suzuki", origin: "imported", allowsCustomModel: true, models: [] },
  { name: "مرسدس بنز", nameEn: "Mercedes-Benz", origin: "imported", allowsCustomModel: true, models: [] },
  { name: "هوندا", nameEn: "Honda", origin: "imported", allowsCustomModel: true, models: [] },
];

export const VEHICLE_CATALOG_SEED: CatalogBrandSeed[] = [
  ...DOMESTIC_BRANDS,
  ...IMPORTED_BRANDS,
  ...FREE_ENTRY_BRANDS,
];

/** Rough category inference for catalog entries (display/filter only). */
export function inferCategory(modelName: string): string | null {
  const n = modelName.toLowerCase();
  if (/هیبرید|hybrid/.test(n)) return "hybrid";
  if (/برقی|e-tron|ev|id\.4|ej7|ix3|qin|فری/.test(n)) return "ev";
  if (/وانت|پیکاپ|pickup/.test(n)) return "pickup";
  if (/ون |ون$|van/.test(n)) return "van";
  if (/کراس|cross|x\d|tiggo|تیگو|هاوال|تانک|توسان|اسپورتیج/.test(n)) return "suv";
  return null;
}
