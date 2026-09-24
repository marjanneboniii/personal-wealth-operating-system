import { sql, type SQL } from "drizzle-orm";
import { toLatinDigits } from "@/lib/format";

/**
 * One definition of "the same text" for every search: Arabic ي/ك, hamza-alef
 * forms and the zero-width non-joiner are the same word typed on two
 * keyboards, and a Persian digit is the same number as a Latin one.
 * `normalizeSearch` is the JS side, `normalizedColumn` its SQL twin.
 */
export function normalizeSearch(input: string): string {
  return toLatinDigits(input)
    .toLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[أإآ]/g, "ا")
    .replace(/[‌\u200E\u200F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizedColumn(col: SQL): SQL {
  return sql`regexp_replace(translate(lower(coalesce(${col}, '')), 'يكأإآ', 'یکااا'), '[‌\u200E\u200F]', ' ', 'g')`;
}

/** `%query%` for LIKE, with the pattern characters of the query escaped. */
export function containsPattern(query: string): string {
  return `%${normalizeSearch(query).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** A typed amount («۲۵۰٬۰۰۰», «250,000») as a plain integer string, else null. */
export function searchAmount(input: string): string | null {
  const plain = toLatinDigits(input).replace(/[,٬\s]/g, "");
  return /^\d{3,18}$/.test(plain) ? plain : null;
}
