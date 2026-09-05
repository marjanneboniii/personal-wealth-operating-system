/**
 * Personal-Inflation Tracker — UI suggestions (NOT database enums).
 *
 * The commodity tables stay fully dynamic (no CHECK constraint, no Postgres
 * enum): a user may track any product with any unit string. These lists only
 * feed `<datalist>` suggestions and the quick-pick chips of the «ثبت قیمت
 * جدید کالا» form, plus the idempotent shared-catalog seed
 * (`ensureInflationModuleReady`). Adding a label here never requires a
 * migration.
 */

/** Suggested categories for «دسته‌بندی» — also seeded as shared rows. */
export const INFLATION_CATEGORY_SUGGESTIONS = [
  "مواد غذایی",
  "پروتئین",
  "لبنیات",
  "حبوبات",
  "نان و غلات",
  "روغن",
  "شوینده و بهداشتی",
  "سایر",
] as const;

/** Suggested units for «واحد اندازه‌گیری». */
export const INFLATION_UNIT_SUGGESTIONS = [
  "کیلوگرم",
  "گرم",
  "لیتر",
  "عدد",
  "بسته",
] as const;

/** Fallback unit stored when the user leaves the field empty. */
export const INFLATION_DEFAULT_UNIT = "عدد";

/** Fallback category label shown when an item has none. */
export const INFLATION_NO_CATEGORY_LABEL = "بدون دسته";

/** Comparison windows of the «مقایسه رشد کالاها» table (label → days). */
export const INFLATION_COMPARISON_WINDOWS = [
  { key: "1m", label: "یک ماه قبل", days: 30 },
  { key: "3m", label: "سه ماه قبل", days: 90 },
  { key: "6m", label: "شش ماه قبل", days: 180 },
  { key: "12m", label: "یک سال قبل", days: 365 },
] as const;

export type InflationComparisonWindowKey = (typeof INFLATION_COMPARISON_WINDOWS)[number]["key"];
