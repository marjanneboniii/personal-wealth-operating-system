import { formatDate, formatNumber, formatSignedPct, toFaDigits } from "@/lib/format";

/** «۱۱.۴ میلیارد تومان» — a market estimate is never shown to the last Toman. */
export function compactToman(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const [div, unit] = n >= 1e9 ? [1e9, "میلیارد"] : n >= 1e6 ? [1e6, "میلیون"] : n >= 1e3 ? [1e3, "هزار"] : [1, ""];
  const scaled = Math.round((n / div) * 10) / 10;
  const digits = toFaDigits(formatNumber(scaled, { decimals: Number.isInteger(scaled) ? 0 : 1, isolate: false }));
  return unit ? `${digits} ${unit} تومان` : `${digits} تومان`;
}

export function compactUsd(value: number | null | undefined): string {
  if (!value || !(value > 0)) return "—";
  return `${toFaDigits(formatNumber(Math.round(value), { decimals: 0, isolate: false }))} دلار`;
}

export function signedPct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : formatSignedPct(value, 1);
}

/** 1 → «۱ ماه», 12 → «۱ سال», 36 → «۳ سال». */
export function horizonLabel(months: number): string {
  return months % 12 === 0 ? `${toFaDigits(String(months / 12))} سال` : `${toFaDigits(String(months))} ماه`;
}

export function jalaliDate(iso: string): string {
  return formatDate(iso);
}

export function faInt(n: number): string {
  return toFaDigits(formatNumber(n, { decimals: 0, isolate: false }));
}
