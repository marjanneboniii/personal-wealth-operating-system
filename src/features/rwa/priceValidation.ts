/**
 * اعتبارسنجی قیمت ملک و خودرو — PURE، مشترک بین فرم‌ها و سرور.
 *
 * لایه‌ها (قوی‌ترین اول):
 *  ۱. منطق: متراژ ممکن، تاریخ خرید بعد از ساخت، کارکرد ممکن.
 *  ۲. سازگاری: نسبت دلاریِ ارزش فعلی به قیمت خرید (هر کدام با نرخ روز خودش).
 *  ۳. پیشنهاد اصلاح صفر: ×۱۰ / ÷۱۰ / ×۱۰۰۰ / ÷۱۰۰۰ اگر مبلغ را عادی کند.
 *  ۴. قیمت بازار ثبت‌شده (مدل خودرو / منطقهٔ ملک) برای ارزش فعلی.
 *  ۵. بازهٔ داخلی `priceBands.config.ts` وقتی قیمت بازاری نیست.
 *
 * پیام‌ها هیچ عدد بازه یا رده‌ای را فاش نمی‌کنند.
 */
import { PRICE_BANDS, type UsdBand } from "./priceBands.config";

export type PriceField = "purchase" | "current" | "size" | "mileage" | "date";
export type PriceLevel = "ok" | "warn" | "block";
export type PriceIssue = { field: PriceField; level: Exclude<PriceLevel, "ok">; message: string; suggestion?: number };
export type PriceVerdict = { level: PriceLevel; issues: PriceIssue[] };

export const PRICE_FIELD_LABELS: Record<PriceField, string> = {
  purchase: "قیمت خرید",
  current: "ارزش فعلی",
  size: "متراژ",
  mileage: "کارکرد",
  date: "تاریخ خرید",
};

const WARN_AMOUNT = "این مبلغ غیرعادی به نظر می‌رسد؛ اگر درست است، تأیید کنید.";
const BLOCK_AMOUNT = "این مبلغ درست به نظر نمی‌رسد؛ رقم و تعداد صفرها را بررسی کنید.";
const WARN_PAIR = "ارزش فعلی و قیمت خرید با هم نمی‌خوانند؛ اگر درست است، تأیید کنید.";
const BLOCK_PAIR = "ارزش فعلی و قیمت خرید با هم نمی‌خوانند؛ یکی از دو مبلغ را بررسی کنید.";

/** Normal band, optional block band (absent = only warn) and an absolute fence, all in USD. */
type Spec = { band: UsdBand; blockBand: UsdBand | null; fence: UsdBand };

const num = (value: unknown) => {
  const n = Number(String(value ?? "").replace(/[,٬\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const inside = (v: number, b: UsdBand) => v >= b.min && v <= b.max;
const times = (b: UsdBand, k: number): UsdBand => ({ min: b.min * k, max: b.max * k });
const widen = (b: UsdBand, t: number): UsdBand => ({ min: b.min / t, max: b.max * t });

function judgeUsd(usd: number, spec: Spec): PriceLevel {
  if (!inside(usd, spec.fence)) return "block";
  if (inside(usd, spec.band)) return "ok";
  if (!spec.blockBand || inside(usd, spec.blockBand)) return "warn";
  return "block";
}

const SLIPS = [10, 0.1, 1000, 0.001];

function amountIssue(field: PriceField, toman: number, rate: number, spec: Spec | null): PriceIssue | null {
  if (!spec || !(toman > 0) || !(rate > 0)) return null;
  const level = judgeUsd(toman / rate, spec);
  if (level === "ok") return null;
  const factor = SLIPS.find((k) => judgeUsd((toman * k) / rate, spec) === "ok");
  return { field, level, message: level === "block" ? BLOCK_AMOUNT : WARN_AMOUNT, suggestion: factor ? Math.round(toman * factor) : undefined };
}

/** Layer 2: a ×10 slip in either amount shows up as an absurd dollar ratio. */
function pairIssue(
  purchase: number, purchaseRate: number, current: number, currentRate: number,
  ok: (field: "purchase" | "current", toman: number) => boolean,
): PriceIssue | null {
  if (!(purchase > 0 && purchaseRate > 0 && current > 0 && currentRate > 0)) return null;
  const { warn, block } = PRICE_BANDS.consistency;
  const ratio = (c: number, p: number) => c / currentRate / (p / purchaseRate);
  const r = ratio(current, purchase);
  if (r >= 1 / warn && r <= warn) return null;
  const level = r < 1 / block || r > block ? "block" : "warn";
  let suggestion: number | undefined;
  for (const k of SLIPS) {
    const fixed = current * k;
    const fr = ratio(fixed, purchase);
    if (fr >= 1 / warn && fr <= warn && ok("current", fixed)) { suggestion = Math.round(fixed); break; }
  }
  return { field: "current", level, message: level === "block" ? BLOCK_PAIR : WARN_PAIR, suggestion };
}

function verdictOf(issues: Array<PriceIssue | null>): PriceVerdict {
  const list = issues.filter((i): i is PriceIssue => !!i);
  return { level: list.some((i) => i.level === "block") ? "block" : list.length ? "warn" : "ok", issues: list };
}

/* ─────────────────────────── ملک ─────────────────────────── */

export type PropertyPriceInput = {
  cityCode?: string | null;
  neighborhoodCode?: string | null;
  typeCode?: string | null;
  sizeSqm: unknown;
  purchaseToman: unknown;
  /** Toman per USD on the acquisition date. */
  purchaseRate: unknown;
  currentToman: unknown;
  /** Toman per USD on the valuation date. */
  currentRate: unknown;
  /** Market price per m² (USD) the user recorded for this area and type. */
  referencePpsqmUsd?: number | null;
  /** Inheritance / gift: the purchase price is not a market price. */
  skipPurchase?: boolean;
};

export function validatePropertyPrices(input: PropertyPriceInput): PriceVerdict {
  const p = PRICE_BANDS.property;
  const sqm = num(input.sizeSqm);
  const issues: Array<PriceIssue | null> = [];
  if (sqm > 0 && !inside(sqm, p.sizeSqm)) return verdictOf([{ field: "size", level: "block", message: "متراژ درست به نظر نمی‌رسد؛ عدد را بررسی کنید." }]);
  if (sqm > p.apartmentWarnSqm && input.typeCode === "APT") issues.push({ field: "size", level: "warn", message: "متراژ برای آپارتمان غیرعادی به نظر می‌رسد؛ اگر درست است، تأیید کنید." });
  if (!(sqm > 0)) return verdictOf(issues);

  const tier = input.cityCode ? p.cityTier[input.cityCode] : undefined;
  const factor = (input.typeCode && p.typeFactor[input.typeCode]) || { min: 1, max: 1 };
  const perSqm = tier ? p.perSqmUsdByTier[tier] : p.perSqmUsdUnknown;
  const band = times({ min: perSqm.min * factor.min, max: perSqm.max * factor.max }, sqm);
  const perSqmFence = times(p.perSqmUsdFence, sqm);
  const minTotal = (input.typeCode && p.minTotalUsd[input.typeCode]) || 0;
  const fence = { min: Math.max(perSqmFence.min, minTotal), max: perSqmFence.max };
  const tierSpec: Spec = { band, blockBand: tier ? widen(band, PRICE_BANDS.tolerance) : null, fence };
  const purchaseSpec: Spec = { ...tierSpec, blockBand: tier ? widen(band, PRICE_BANDS.purchaseTolerance) : null };
  const ref = input.referencePpsqmUsd && input.referencePpsqmUsd > 0 ? input.referencePpsqmUsd * sqm : null;
  const currentSpec: Spec = ref
    ? { band: { min: ref * (1 - PRICE_BANDS.referenceWarn), max: ref * (1 + PRICE_BANDS.referenceWarn) }, blockBand: widen({ min: ref, max: ref }, PRICE_BANDS.tolerance), fence }
    : tierSpec;

  const purchase = num(input.purchaseToman), purchaseRate = num(input.purchaseRate);
  const current = num(input.currentToman), currentRate = num(input.currentRate);
  const purchaseIssue = input.skipPurchase ? null : amountIssue("purchase", purchase, purchaseRate, purchaseSpec);
  const currentIssue = amountIssue("current", current, currentRate, currentSpec);
  issues.push(purchaseIssue, currentIssue);
  if (!input.skipPurchase && purchaseIssue?.level !== "block" && currentIssue?.level !== "block") {
    issues.push(pairIssue(purchase, purchaseRate, current, currentRate, (_f, t) => judgeUsd(t / currentRate, currentSpec) !== "block"));
  }
  return verdictOf(issues);
}

/* ─────────────────────────── خودرو ─────────────────────────── */

/** A manufacturing year (Jalali or Gregorian) as a Gregorian year. */
export const gregorianYearOf = (year: number) => (year > 0 && year < 1700 ? year + 621 : year);

export type VehiclePriceInput = {
  brandNameEn?: string | null;
  modelName: string;
  origin: "domestic" | "imported";
  manufacturingYear: unknown;
  /** ISO purchase date. */
  ownershipDate: string;
  /** ISO date of the current value (today when entered now). */
  valuationDate: string;
  mileage?: unknown;
  purchaseToman: unknown;
  purchaseRate: unknown;
  currentToman: unknown;
  currentRate: unknown;
  /** Latest recorded market value of this model, in USD. */
  referenceUsd?: number | null;
};

function vehicleBandAt(input: VehiclePriceInput, mfg: number, atYear: number): UsdBand {
  const v = PRICE_BANDS.vehicle;
  const brand = input.brandNameEn ?? "";
  const fresh = v.newByModelUsd[`${brand}|${input.modelName}`] || v.newByBrandUsd[brand] || v.newByOriginUsd[input.origin];
  const residual = Math.max(v.minResidual, 1 - v.yearlyDepreciation * Math.max(0, atYear - mfg));
  // The floor depreciates; the ceiling does not (a well-kept car can hold its dollar value).
  return { min: fresh.min * residual, max: fresh.max };
}

export function validateVehiclePrices(input: VehiclePriceInput): PriceVerdict {
  const v = PRICE_BANDS.vehicle;
  const mfg = gregorianYearOf(num(input.manufacturingYear));
  const issues: Array<PriceIssue | null> = [];
  if (!(mfg > 0)) return verdictOf([]);
  const boughtYear = input.ownershipDate ? Number(input.ownershipDate.slice(0, 4)) : 0;
  const valuedYear = Number((input.valuationDate || "").slice(0, 4)) || boughtYear;
  // A car sold before its model year is normal; two years before is not.
  if (boughtYear && boughtYear < mfg - 1) return verdictOf([{ field: "date", level: "block", message: "تاریخ خرید قبل از سال ساخت خودرو است؛ سال ساخت یا تاریخ خرید را بررسی کنید." }]);

  const km = num(input.mileage);
  if (String(input.mileage ?? "").trim() !== "") {
    const age = Math.max(0, valuedYear - mfg);
    if (km > v.maxMileageKm) issues.push({ field: "mileage", level: "block", message: "کارکرد درست به نظر نمی‌رسد؛ عدد را به کیلومتر وارد کنید." });
    else if (age >= 3 && km > 0 && km < 1000) issues.push({ field: "mileage", level: "warn", message: "کارکرد برای این خودرو غیرعادی به نظر می‌رسد؛ کارکرد را به کیلومتر وارد کنید.", suggestion: km * 1000 });
    else if (km / Math.max(1, age) > v.warnKmPerYear) issues.push({ field: "mileage", level: "warn", message: "کارکرد غیرعادی به نظر می‌رسد؛ اگر درست است، تأیید کنید." });
  }

  const purchaseSpec: Spec = (() => {
    const band = vehicleBandAt(input, mfg, boughtYear || mfg);
    return { band, blockBand: widen(band, PRICE_BANDS.purchaseTolerance), fence: v.fenceUsd };
  })();
  const currentSpec: Spec = (() => {
    const ref = input.referenceUsd && input.referenceUsd > 0 ? input.referenceUsd : null;
    if (ref) return { band: { min: ref * (1 - PRICE_BANDS.referenceWarn), max: ref * (1 + PRICE_BANDS.referenceWarn) }, blockBand: widen({ min: ref, max: ref }, PRICE_BANDS.tolerance), fence: v.fenceUsd };
    const band = vehicleBandAt(input, mfg, valuedYear || mfg);
    return { band, blockBand: widen(band, PRICE_BANDS.tolerance), fence: v.fenceUsd };
  })();

  const purchase = num(input.purchaseToman), purchaseRate = num(input.purchaseRate);
  const current = num(input.currentToman), currentRate = num(input.currentRate);
  const purchaseIssue = amountIssue("purchase", purchase, purchaseRate, purchaseSpec);
  const currentIssue = amountIssue("current", current, currentRate, currentSpec);
  issues.push(purchaseIssue, currentIssue);
  if (purchaseIssue?.level !== "block" && currentIssue?.level !== "block") {
    issues.push(pairIssue(purchase, purchaseRate, current, currentRate, (_f, t) => judgeUsd(t / currentRate, currentSpec) !== "block"));
  }
  return verdictOf(issues);
}

/** The first blocking issue as one sentence, for a server-side refusal. */
export function blockingMessage(verdict: PriceVerdict, subject: "ملک" | "خودرو"): string | null {
  const issue = verdict.issues.find((i) => i.level === "block");
  return issue ? `${subject} — ${PRICE_FIELD_LABELS[issue.field]}: ${issue.message}` : null;
}
