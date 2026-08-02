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
  digits: DigitStyle = "fa",
): string {
  const symbols: Record<string, string> = {
    USD: "$",
    USDT: "₮",
    IRT: "تومان",
    IRR: "ریال",
    EUR: "€",
  };
  const dp = currency === "IRT" || currency === "IRR" ? 0 : 2;
  const n = formatNumber(value, { decimals: dp, digits });
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
