/** Persian (RTL) text helpers. Deterministic: no Intl, so every render matches. */

const DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export const faDigits = (value: string | number) => String(value).replace(/\d/g, (d) => DIGITS[Number(d)]);

/** 125000000 → «۱۲۵٬۰۰۰٬۰۰۰» */
export function faNumber(value: number, decimals = 0) {
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole, fraction] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, "٬");
  return (value < 0 ? "−" : "") + faDigits(fraction ? `${grouped}٫${fraction}` : grouped);
}

/** «۴۱٪» — the percent sign follows the number in Persian. */
export const faPercent = (value: number) => `${faDigits(Math.round(value))}٪`;

/**
 * Inline emphasis markup for headlines: wrap words in *asterisks* to colour
 * them with the accent. Returns words so they can be revealed one by one.
 */
export function parseEmphasis(text: string) {
  const words: { text: string; accent: boolean }[] = [];
  let accent = false;
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const opens = raw.startsWith("*");
    const closes = raw.endsWith("*") && (raw.length > 1 || !opens);
    if (opens) accent = true;
    const text = raw.replace(/\*/g, "");
    const prev = words.at(-1);
    // An accented phrase stays one unit, so it never breaks across lines.
    if (accent && !opens && prev?.accent) prev.text += ` ${text}`;
    else words.push({ text, accent });
    if (closes) accent = false;
  }
  return words;
}
