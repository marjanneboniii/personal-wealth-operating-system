/**
 * Hashtag normalization — pure, no DB. One spelling per tag, so «#سفر»,
 * «سفر» and «#سفر » (typed on an Arabic keyboard) all land on the same tag.
 *
 * Rules:
 *  - a leading «#» is optional and never stored;
 *  - Arabic ي/ك become Persian ی/ک, every digit becomes a Persian digit;
 *  - inner spaces become «_» — a tag is one token, as on every hashtag UI;
 *  - only letters, marks, digits, «_», «-» and ZWNJ survive; Latin is lowercased;
 *  - 1 to MAX_TAG_LENGTH characters.
 */

export const MAX_TAG_LENGTH = 32;
export const MAX_TAGS_PER_ENTRY = 10;

const ZWNJ = "‌";

function persianDigits(s: string): string {
  return s
    .replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d)))
    .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 0x06f0));
}

/** The stored form of one tag, or null when nothing usable remains. */
export function normalizeTag(raw: string): string | null {
  let s = raw.normalize("NFC").replace(/^[#＃\s]+/, "");
  s = s.replace(/ي/g, "ی").replace(/ى/g, "ی").replace(/ك/g, "ک");
  s = persianDigits(s).toLowerCase();
  s = s.replace(/\s+/g, "_");
  s = s.replace(new RegExp(`[^\\p{L}\\p{M}\\p{N}_\\-${ZWNJ}]`, "gu"), "");
  s = s.replace(/_+/g, "_").replace(new RegExp(`^[_\\-${ZWNJ}]+|[_\\-${ZWNJ}]+$`, "g"), "");
  const chars = Array.from(s);
  if (chars.length === 0) return null;
  return chars.slice(0, MAX_TAG_LENGTH).join("").replace(new RegExp(`[_\\-${ZWNJ}]+$`), "");
}

/**
 * Split free input into distinct normalized tags: «#سفر #شمال، خانواده»
 * → [سفر, شمال, خانواده]. Separators are whitespace, «#», «,» and «،».
 */
export function parseTags(input: string | string[]): string[] {
  const parts = Array.isArray(input) ? input : input.split(/[\s,،#＃]+/);
  const out: string[] = [];
  for (const p of parts) {
    const t = normalizeTag(p);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}
