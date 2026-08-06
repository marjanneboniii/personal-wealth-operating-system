import { D } from "@/domain/decimal";

export type DigitStyle = "fa" | "en";

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function toFaDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

export function groupThousands(fixed: string): string {
  const neg = fixed.startsWith("-");
  const body = neg ? fixed.slice(1) : fixed;
  const [int, frac] = body.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "٬");
  return `${neg ? "−" : ""}${grouped}${frac ? "٫" + frac : ""}`;
}

/** Decimal places that make sense per asset kind. */
export function smartDecimals(value: string | number, assetDecimals = 2): number {
  const abs = Math.abs(Number(value));
  if (assetDecimals <= 2) return 2;
  if (abs === 0) return 2;
  if (abs >= 1000) return 2;
  if (abs >= 1) return Math.min(assetDecimals, 4);
  return Math.min(assetDecimals, 8);
}

export function formatNumber(
  value: string | number,
  opts: { decimals?: number; digits?: DigitStyle } = {},
): string {
  const dp = opts.decimals ?? 2;
  const out = groupThousands(D(value ?? 0).toFixed(dp));
  return opts.digits === "en" ? out.replace(/٬/g, ",").replace(/٫/g, ".") : toFaDigits(out);
}

export function formatQty(
  value: string | number,
  assetDecimals = 8,
  digits: DigitStyle = "fa",
): string {
  const dp = smartDecimals(value, assetDecimals);
  const raw = D(value ?? 0).toFixed(dp).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  const out = groupThousands(raw);
  return digits === "en" ? out.replace(/٬/g, ",").replace(/٫/g, ".") : toFaDigits(out);
}

export function formatMoney(
  value: string | number,
  currency = "USD",
  digits?: DigitStyle,
): string {
  // Presentation convention: USD always uses Latin digits; IRT/IRR use Persian digits.
  const resolvedDigits = digits ?? (currency === "USD" ? "en" : (currency === "IRT" || currency === "IRR" ? "fa" : "fa"));
  const symbols: Record<string, string> = {
    USD: "$",
    USDT: "₮",
    IRT: "تومان",
    IRR: "ریال",
    EUR: "€",
  };
  const dp = currency === "IRT" || currency === "IRR" ? 0 : 2;
  const n = formatNumber(value, { decimals: dp, digits: resolvedDigits });
  const sym = symbols[currency] ?? currency;
  return currency === "IRT" || currency === "IRR" ? `${n} ${sym}` : `${sym}${n}`;
}

export function formatPercent(value: string | number, digits: DigitStyle = "fa"): string {
  const n = formatNumber(value, { decimals: 2, digits });
  const sign = Number(value) > 0 ? "+" : "";
  return `${sign}${n}٪`;
}

const FA_MONTHS = [
  "فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور",
  "مهر","آبان","آذر","دی","بهمن","اسفند",
];

/** Gregorian ISO date -> Persian (Jalali) label, computed locally, no deps. */
export function toJalali(iso: string): { y: number; m: number; d: number } {
  const [gy, gm, gd] = iso.slice(0, 10).split("-").map(Number);
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  const gy2 = gy <= 1600 ? gy - 621 : gy - 1600;
  const gm2 = gm - 1;
  let days =
    365 * gy2 +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) -
    80 +
    gd +
    g_d_m[gm2] +
    ((gy2 % 4 === 0 && gy2 % 100 !== 0) || gy2 % 400 === 0 ? (gm2 > 1 ? 1 : 0) : 0);
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { y: jy, m: jm, d: jd };
}

export function formatDate(iso: string, digits: DigitStyle = "fa"): string {
  if (!iso) return "—";
  const { y, m, d } = toJalali(iso);
  const s = `${d} ${FA_MONTHS[m - 1]} ${y}`;
  return digits === "fa" ? toFaDigits(s) : s;
}

export function formatShortDate(iso: string): string {
  if (!iso) return "—";
  const { m, d } = toJalali(iso);
  return toFaDigits(`${d} ${FA_MONTHS[m - 1]}`);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/* ════════════════════════════════════════════════════════════════════
   Shared Calendar Engine — Single Source of Truth (Gregorian ↔ Jalali)
   Used by ALL date inputs & displays: TransactionForm, Planning, Debts,
   Ledger, Reports, etc. No duplicate conversion logic elsewhere.
   ════════════════════════════════════════════════════════════════════ */

/** Jalali → Gregorian (reverse of toJalali). No external deps. */
export function fromJalali(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number } {
  let gy = jy <= 979 ? 621 : 1600;
  jy -= jy <= 979 ? 0 : 979;
  let days =
    365 * jy +
    Math.floor(jy / 33) * 8 +
    Math.floor(((jy % 33) + 3) / 4) +
    78 +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  gy += 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const sal_a = [0, 31, ((gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm: number;
  for (gm = 0; gm < 13; gm++) {
    const v = sal_a[gm];
    if (gd <= v) break;
    gd -= v;
  }
  return { gy, gm, gd };
}

export function jalaliToIso(jy: number, jm: number, jd: number): string {
  const { gy, gm, gd } = fromJalali(jy, jm, jd);
  return `${String(gy).padStart(4, "0")}-${String(gm).padStart(2, "0")}-${String(gd).padStart(2, "0")}`;
}

/** Parse Jalali string "YYYY/MM/DD" or "YYYY-MM-DD" → {y,m,d} | null */
export function parseJalaliString(input: string): { y: number; m: number; d: number } | null {
  if (!input) return null;
  const parts = input.trim().replace(/-/g, "/").split("/").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  if (y < 1200 || y > 1600 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

export function formatJalaliIso(iso: string, digits: DigitStyle = "fa"): string {
  if (!iso) return "—";
  const { y, m, d } = toJalali(iso);
  const s = `${String(y).padStart(4, "0")}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}`;
  return digits === "fa" ? toFaDigits(s) : s;
}

export function formatGregorianIso(iso: string): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

/** Returns both representations for dual display */
export function getDualDate(iso: string): { iso: string; jalali: string; gregorian: string; jalaliDigits: string } {
  if (!iso) return { iso: "", jalali: "—", gregorian: "—", jalaliDigits: "—" };
  return {
    iso: iso.slice(0, 10),
    jalali: formatJalaliIso(iso, "fa"),
    gregorian: formatGregorianIso(iso),
    jalaliDigits: formatJalaliIso(iso, "en"),
  };
}

/* ════════════════════════════════════════════════════════════════════
   FX Preview Helpers — Single Source of Truth for IRT ↔ USD
   Uses latest USD→IRT rate from exchange_rates / settings.irt_rate
   Pure functions, no side effects, no ledger writes.
   ════════════════════════════════════════════════════════════════════ */

export function irtToUsd(irtAmount: string | number, usdToIrtRate: string | number): string {
  const rate = D(usdToIrtRate);
  if (rate.lte(0)) return "0";
  return D(irtAmount).div(rate).toFixed(2);
}

export function usdToIrt(usdAmount: string | number, usdToIrtRate: string | number): string {
  return D(usdAmount).mul(usdToIrtRate).toFixed(0);
}

export function formatDualMoneyFromIrt(irtAmount: string | number, usdToIrtRate: string | number | null, digits: DigitStyle = "fa"): { irt: string; usd: string; rateLabel: string } {
  const irtStr = D(irtAmount).toFixed(0);
  if (!usdToIrtRate || D(usdToIrtRate).lte(0)) {
    return {
      irt: formatMoney(irtStr, "IRT", digits),
      usd: "—",
      rateLabel: "نرخ ثبت نشده",
    };
  }
  const usd = irtToUsd(irtStr, usdToIrtRate);
  return {
    irt: formatMoney(irtStr, "IRT", digits),
    usd: formatMoney(usd, "USD", "en"),
    rateLabel: `نرخ: ${formatMoney(usdToIrtRate, "IRT", digits)} ≈ $1`,
  };
}

export function formatDualMoneyFromUsd(usdAmount: string | number, usdToIrtRate: string | number | null, digits: DigitStyle = "fa"): { irt: string; usd: string; rateLabel: string } {
  const usdStr = D(usdAmount).toFixed(2);
  if (!usdToIrtRate || D(usdToIrtRate).lte(0)) {
    return {
      irt: "—",
      usd: formatMoney(usdStr, "USD", "en"),
      rateLabel: "نرخ ثبت نشده",
    };
  }
  const irt = usdToIrt(usdStr, usdToIrtRate);
  return {
    irt: formatMoney(irt, "IRT", digits),
    usd: formatMoney(usdStr, "USD", "en"),
    rateLabel: `نرخ: ${formatMoney(usdToIrtRate, "IRT", digits)} ≈ $1`,
  };
}

/** Group ISO dates by Jalali month key "YYYY/MM" */
export function jalaliMonthKey(iso: string): string {
  const { y, m } = toJalali(iso);
  return `${String(y).padStart(4, "0")}/${String(m).padStart(2, "0")}`;
}

export function jalaliMonthLabel(key: string, digits: DigitStyle = "fa"): string {
  const [y, m] = key.split("/").map(Number);
  if (!y || !m) return key;
  const s = `${FA_MONTHS[m - 1]} ${y}`;
  return digits === "fa" ? toFaDigits(s) : s;
}
