import { D } from "@/domain/decimal";

export type DigitStyle = "fa" | "en";

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function toFaDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/**
 * Persian-digit rendering for UI counts & durations shown to the user
 * (e.g. «۳ قسط»، «۵ روز دیگر»، «۱۲ از ۲۰») — same numeric standard as money.
 */
export function faCount(n: number | string): string {
  return toFaDigits(String(n));
}

export function groupThousands(fixed: string): string {
  const neg = fixed.startsWith("-");
  const body = neg ? fixed.slice(1) : fixed;
  const [int, frac] = body.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "٬");
  // Display decimal separator is ASCII "." (never Persian ٫ which looks like /).
  return `${neg ? "−" : ""}${grouped}${frac ? "." + frac : ""}`;
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
  return opts.digits === "en" ? out.replace(/٬/g, ",") : toFaDigits(out);
}

export function formatQty(
  value: string | number,
  assetDecimals = 8,
  digits: DigitStyle = "fa",
): string {
  const dp = smartDecimals(value, assetDecimals);
  const raw = D(value ?? 0).toFixed(dp).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  const out = groupThousands(raw);
  return digits === "en" ? out.replace(/٬/g, ",") : toFaDigits(out);
}

/**
 * Persian display label for currency/asset codes. Money rendered for the user
 * NEVER shows a Latin ticker or a currency sign ($ / € / ₮) — it uses the
 * Persian word instead. Unknown codes (e.g. crypto tickers) pass through.
 *
 * `ETH` is deliberately NOT left as the Latin ticker: in every table, card and
 * asset list that renders through this map the user reads «اتریوم», matching
 * the asset's own Persian name (assets.name) instead of showing a code only a
 * developer recognises.
 */
export const CURRENCY_LABELS: Record<string, string> = {
  USD: "دلار",
  USDT: "تتر",
  IRT: "تومان",
  IRR: "تومان",
  EUR: "یورو",
  ETH: "اتریوم",
};

export function currencyLabel(currency: string | null | undefined): string {
  if (!currency) return "";
  const code = String(currency).trim().toUpperCase();
  return CURRENCY_LABELS[code] ?? String(currency);
}

/**
 * True when a code has a Persian display word (so a Latin ticker shown
 * alongside it would be a duplicate, e.g. «اتریوم (ETH)»).
 */
export function hasPersianCurrencyLabel(currency: string | null | undefined): boolean {
  if (!currency) return false;
  return CURRENCY_LABELS[String(currency).trim().toUpperCase()] !== undefined;
}


/*
 * Unicode bidi isolates (RLI … PDI). Every money string produced by
 * formatMoney is wrapped in them so its visual order is ALWAYS
 * «عدد فارسی → فاصله → نام فارسی ارز» — number first, currency word after —
 * no matter the direction (dir="ltr"/dir="rtl") of the surrounding container.
 * This is the single source of truth for money display in the whole UI.
 */
const RLI = "\u2067"; // RIGHT-TO-LEFT ISOLATE (invisible)
const PDI = "\u2069"; // POP DIRECTIONAL ISOLATE (invisible)
const NBSP = "\u00A0"; // non-breaking space — keeps number+unit on same line on mobile

export function formatMoney(
  value: string | number,
  currency = "USD",
  _digits?: DigitStyle,
): string {
  const label = currencyLabel(currency);
  const isZeroDecimals = label === "تومان" || label === "ریال";
  const dp = isZeroDecimals ? 0 : 2;
  // All financial amounts are rendered for the user in Persian digits with a
  // Persian thousand separator. Trailing zeros are trimmed so whole amounts
  // read naturally (۱۵٬۹۵۷ دلار instead of ۱۵٬۹۵۷.۰۰ دلار).
  const raw = D(value ?? 0)
    .toFixed(dp)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
  const n = toFaDigits(groupThousands(raw));
  // Order is ALWAYS: number → NBSP → Persian currency word (IRT→تومان,
  // USD→دلار, USDT→تتر). NBSP prevents «تومان» wrapping under number on mobile PWA.
  return `${RLI}${n}${NBSP}${label}${PDI}`;
}

/**
 * Signed money inside a single bidi isolate so the minus/plus NEVER trails
 * the currency word in RTL (e.g. «−۸۹۳٬۷۴۶٬۱۷۱ تومان», never «تومان+ … تومان»).
 * Zero is unsigned and must be paired with trendTone() = neutral.
 */
export function formatSignedMoney(
  value: string | number,
  currency = "USD",
): string {
  const dec = D(value ?? 0);
  if (dec.isZero()) return formatMoney("0", currency);
  const abs = formatMoney(dec.abs().toString(), currency);
  const inner = abs.replace(/^\u2067/, "").replace(/\u2069$/, "");
  const sign = dec.isNegative() ? "−" : "+";
  return `${RLI}${sign}${inner}${PDI}`;
}

export function formatPercent(value: string | number, digits: DigitStyle = "fa"): string {
  const n = formatNumber(value, { decimals: 2, digits });
  const num = Number(value);
  const sign = num > 0 ? "+" : num < 0 ? "" : "";
  return `${sign}${n}٪`;
}

/**
 * Plain Persian percent — no forced sign, adjustable decimals.
 * e.g. formatPct("12.5", 1) → "۱۲.۵٪". Used by tables, charts and KPIs so
 * every percent in the UI follows the same Persian-digit standard.
 */
export function formatPct(value: string | number, decimals = 1): string {
  return `${formatNumber(value, { decimals })}٪`;
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

/** Persian/Arabic digits → Latin digits. */
export function toLatinDigits(input: string): string {
  return (input ?? "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

/** Parse Jalali string "YYYY/MM/DD" or "YYYY-MM-DD" → {y,m,d} | null */
export function parseJalaliString(input: string): { y: number; m: number; d: number } | null {
  if (!input) return null;
  const parts = toLatinDigits(input).trim().replace(/-/g, "/").split("/").map(Number);
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

/**
 * Standard dual-date text: Jalali primary (Persian digits) followed by the
 * Gregorian date in a fully standard, Latin ISO "YYYY-MM-DD" form. The Latin
 * segment is wrapped in Unicode first-strong-isolate marks so it always
 * renders left-to-right, even inside plain RTL strings.
 */
export function formatDualDate(iso: string): string {
  if (!iso) return "—";
  return `${formatJalaliIso(iso)} (\u2068${formatGregorianIso(iso)}\u2069)`;
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

/*
 * ──────────────────────────────────────────────────────────────────────────
 * SINGLE SOURCE OF TRUTH for the dynamic Toman equivalent of a base-currency
 * (USD) amount — Global System Directive §1 + §4 (Rounding Service Fix).
 *
 * Rules enforced here for the WHOLE app:
 *   • EXACT decimal arithmetic (src/domain/decimal) — never JS floats, never
 *     `Math.round(Number(a) * Number(b))` (float drift on IRT-scale values).
 *   • ONE rounding step only, half-up, at the final display digit (whole
 *     Toman). No intermediate 2-digit rounding that could turn ۹۰۹٬۰۹۰ into
 *     ۹۰۸٬۲۰۰/۹۱۰٬۱۰۰.
 *   • This is the one-way DYNAMIC equivalent only (مانده تومانی ÷ نرخ روز).
 *     It can NEVER mutate a stored Toman balance — those are rendered from
 *     the ledger/snapshot value directly.
 *   • Missing/invalid rate → null (the caller shows «—»), never a silent 1:1.
 * ────────────────────────────────────────────────────────────────────────── */
export function toIrtMoney(
  usdAmount: string | number,
  usdToIrtRate: string | number | null | undefined,
): string | null {
  if (usdToIrtRate == null || D(usdToIrtRate).lte(0)) return null;
  return formatMoney(usdToIrt(usdAmount, usdToIrtRate), "IRT");
}

/* ──────────────────────────────────────────────────────────────────────────
 * Trend tone & arrow — Global System Directive §4 (منطق رنگ صفر):
 * ZERO IS ALWAYS NEUTRAL. It is never painted green (var(--positive)) nor
 * red (var(--negative)), and gets no up/down arrow. Every chart, KPI and
 * delta in the app resolves its colour through these helpers.
 * ────────────────────────────────────────────────────────────────────────── */
export type TrendTone = "up" | "down" | "neutral";

export function trendTone(value: string | number): TrendTone {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n === 0) return "neutral";
  return n > 0 ? "up" : "down";
}

export function trendArrow(value: string | number): "↑" | "↓" | "—" {
  const tone = trendTone(value);
  return tone === "up" ? "↑" : tone === "down" ? "↓" : "—";
}

export function trendColor(value: string | number): string {
  return toneColor(trendTone(value));
}

/** Resolve an already-computed tone to its CSS colour (zero → neutral grey). */
export function toneColor(tone: TrendTone): string {
  return tone === "up" ? "var(--positive)" : tone === "down" ? "var(--negative)" : "var(--text-2)";
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 * Directional KPI tones — SSOT for income/expense metric colouring.
 *
 * A KPI that measured NOTHING (۰ تومان) is ALWAYS neutral (Directive §3:
 * «رنگ‌بندی هزینه صفر از قرمز به رنگ خنثی تغییر یابد»). Only money that
 * actually moved gets a semantic colour. Pages must never hard-wire
 * tone="down"/tone="up" on a value that can be zero.
 * ────────────────────────────────────────────────────────────────────────── */
export function inflowTone(value: string | number): TrendTone {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || Math.abs(n) === 0) return "neutral";
  return "up";
}

/** Any real outflow (spend) reads as "down"; a zero outflow is neutral. */
export function outflowTone(value: string | number): TrendTone {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || Math.abs(n) === 0) return "neutral";
  return "down";
}

/*
 * SSOT for SIGNED dynamic Toman equivalents of a USD amount — used by every
 * KPI delta («خالص این ماه»، «سود تحقق‌یافته»، …). The sign ALWAYS lives
 * inside the single bidi isolate produced by formatSignedMoney, so a page
 * can never again glue a manual "+/−" onto a formatted money string and
 * reproduce the «تومان+ ۸۹۳٬۷۴۶٬۱۷۱ تومان» / trailing-minus class of bug.
 * Conversion uses the FULL-PRECISION amount and one half-up rounding step
 * (same rules as usdToIrt). Zero → unsigned, paired with a neutral tone.
 */
export function formatSignedMoneyFromUsd(
  usdAmount: string | number,
  usdToIrtRate: string | number | null | undefined,
): string {
  if (usdToIrtRate == null || D(usdToIrtRate).lte(0)) {
    return formatSignedMoney(usdAmount, "USD");
  }
  return formatSignedMoney(usdToIrt(usdAmount, usdToIrtRate), "IRT");
}

export function formatDualMoneyFromIrt(irtAmount: string | number, usdToIrtRate: string | number | null, _digits: DigitStyle = "fa"): { irt: string; usd: string; rateLabel: string } {
  const irtStr = D(irtAmount).toFixed(0);
  if (!usdToIrtRate || D(usdToIrtRate).lte(0)) {
    return {
      irt: formatMoney(irtStr, "IRT"),
      usd: "—",
      rateLabel: "نرخ ثبت نشده",
    };
  }
  const usd = irtToUsd(irtStr, usdToIrtRate);
  return {
    irt: formatMoney(irtStr, "IRT"),
    usd: formatMoney(usd, "USD"),
    rateLabel: `نرخ: ${formatMoney(usdToIrtRate, "IRT")} ≈ ۱ دلار`,
  };
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 * Debt + Planning modules — Toman is AUTHORITATIVE, USD is display-only.
 *
 * Hard invariants (never violate):
 *   • Contractual amounts (debt principal, installment, obligation, goal
 *     target, fund target, budget ceiling, planned txn, event budget) are
 *     stored and rendered in Toman. An FX-rate change MUST NOT rewrite or
 *     recompute those Toman figures.
 *   • The USD line is always `toman ÷ currentRate` (preview only).
 *   • Never call toIrtMoney / usd→irt on these amounts: that path treats the
 *     stored figure as USD and multiplies by the live rate, so raising the
 *     dollar rate inflates the Toman label — the exact bug users reported.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Resolve the authoritative Toman figure for a debt/planning row.
 * Prefers an explicit Toman field; only falls back to a legacy USD×rate
 * conversion when no Toman was ever stored (pre-Phase-3 rows).
 */
export function resolveTomanAmount(
  toman: string | number | null | undefined,
  usdFallback: string | number | null | undefined,
  usdToIrtRate: string | number | null | undefined,
): string | null {
  if (toman != null && toman !== "") {
    try {
      return D(toman).toFixed(0);
    } catch {
      return null;
    }
  }
  if (usdFallback == null || usdFallback === "" || usdToIrtRate == null || D(usdToIrtRate).lte(0)) {
    return null;
  }
  try {
    return usdToIrt(usdFallback, usdToIrtRate);
  } catch {
    return null;
  }
}

/** Primary Toman label + optional USD-equivalent hint (display only). */
export function formatTomanPrimary(
  tomanAmount: string | number | null | undefined,
  usdToIrtRate: string | number | null | undefined,
): { primary: string; usdHint: string | null; toman: string | null; usd: string | null } {
  if (tomanAmount == null || tomanAmount === "") {
    return { primary: "—", usdHint: null, toman: null, usd: null };
  }
  const tomanStr = D(tomanAmount).toFixed(0);
  const primary = formatMoney(tomanStr, "IRT");
  if (usdToIrtRate == null || D(usdToIrtRate).lte(0)) {
    return { primary, usdHint: null, toman: tomanStr, usd: null };
  }
  const usd = irtToUsd(tomanStr, usdToIrtRate);
  return {
    primary,
    usdHint: formatMoney(usd, "USD"),
    toman: tomanStr,
    usd,
  };
}

/** Sum a list of Toman amounts with exact decimal arithmetic. */
export function sumToman(values: Array<string | number | null | undefined>): string {
  let total = D("0");
  for (const v of values) {
    if (v == null || v === "") continue;
    try {
      total = total.add(D(v));
    } catch {
      /* skip unparseable */
    }
  }
  return total.toFixed(0);
}

export function formatDualMoneyFromUsd(usdAmount: string | number, usdToIrtRate: string | number | null, _digits: DigitStyle = "fa"): { irt: string; usd: string; rateLabel: string } {
  const usdExact = D(usdAmount);
  const usdStr = usdExact.toFixed(2);
  if (!usdToIrtRate || D(usdToIrtRate).lte(0)) {
    return {
      irt: "—",
      usd: formatMoney(usdStr, "USD"),
      rateLabel: "نرخ ثبت نشده",
    };
  }
  // Convert the exact USD figure — never the 2-dp display string — so
  // ۹۰۹٬۰۹۰ cannot collapse to ۹۰۸٬۲۰۰ via float/2-dp pre-rounding.
  const irt = usdToIrt(usdExact.toString(), usdToIrtRate);
  return {
    irt: formatMoney(irt, "IRT"),
    usd: formatMoney(usdStr, "USD"),
    rateLabel: `نرخ: ${formatMoney(usdToIrtRate, "IRT")} ≈ ۱ دلار`,
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
