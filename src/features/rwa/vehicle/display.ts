/**
 * Vehicle display naming.
 *
 * A vehicle's `assets.name` is written once, at registration, as
 * `«{brandName} {modelName} ({year})»` — e.g.
 * «ایران‌خودرو پژو ۲۰۷ اتوماتیک TU5p سقف فلزی (۱۴۰۲)». That is the right thing
 * to STORE (it is unambiguous and it is what the vehicle's own page shows), but
 * it is far too long for a list: in the holdings table it is clipped mid-word
 * by `truncate`, so the part that actually distinguishes two cars is the part
 * that disappears.
 *
 * This module produces the SHORT label for list and portfolio surfaces. It
 * never touches the stored name, and the vehicle's dedicated page keeps the
 * full identity including the year.
 *
 * Two reductions, both data-driven rather than guessed:
 *
 *   1. The year is dropped. It is the MANUFACTURING year (`vehicle_assets.year`,
 *      from `manufacturingYear` — the purchase date is `ownershipDate`, a
 *      different field), and it is shown on the vehicle's own page where it
 *      belongs.
 *
 *   2. The manufacturer prefix is dropped for DOMESTIC brands only. The
 *      domestic catalogue entries are assembler companies whose model names
 *      already carry their own marque — «ایران‌خودرو پژو ۲۰۷» and «سایپا ساینا
 *      GXL» say the maker twice, and the brand logo beside the row says it a
 *      third time. Imported entries ARE the marque («تویوتا کرولا»), so for
 *      those the brand stays.
 *
 * PRESENTATION ONLY — pure, no I/O, no financial data.
 */

import { DOMESTIC_BRANDS, VEHICLE_CATALOG_SEED } from "./catalogData";

/** Longest-first so «بهمن موتور» is matched before a hypothetical «بهمن». */
const CATALOG_BRANDS: string[] = VEHICLE_CATALOG_SEED.map((b) => b.name).sort(
  (a, b) => b.length - a.length,
);

const DOMESTIC_BRAND_SET = new Set(DOMESTIC_BRANDS.map((b) => b.name));

/**
 * A trailing «(۱۴۰۲)» / «(2023)» — Latin or Persian digits, with or without a
 * space before the bracket. Anchored at the end so a year inside a model name
 * can never be eaten.
 */
const TRAILING_YEAR = /\s*\((?:[0-9]{3,4}|[۰-۹]{3,4})\)\s*$/;

/**
 * Normalise for comparison only. Persian text arrives with either a real ZWNJ
 * or a plain space between «ایران» and «خودرو» depending on where it was typed,
 * and Arabic ی/ك are routinely substituted for Persian ی/ک.
 */
function fold(value: string): string {
  return value
    .replace(/‌/g, " ")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Matches a brand at the START of the original, unfolded string. Word gaps
 * accept either a space or a ZWNJ, and ی/ک accept their Arabic lookalikes —
 * the same tolerances `fold` uses for matching, expressed as a pattern so the
 * text that survives is the user's own, untouched.
 */
function brandPrefixRe(brand: string): RegExp {
  const pattern = brand
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[\s‌]+/g, "[\\s\\u200c]+")
    .replace(/[یي]/g, "[یي]")
    .replace(/[کك]/g, "[کك]");
  return new RegExp(`^${pattern}[\\s\\u200c]+`);
}

/**
 * The short label for a vehicle in a list. Anything that is not shaped like a
 * stored vehicle name is returned untouched, so a caller can apply this to
 * every row of a mixed asset table without having to know which rows are cars.
 *
 *   «ایران‌خودرو پژو ۲۰۷ اتوماتیک (۱۴۰۲)» → «پژو ۲۰۷ اتوماتیک»
 *   «تویوتا کرولا (۲۰۲۰)»                 → «تویوتا کرولا»
 *   «اتریوم»                               → «اتریوم»   (untouched)
 */
export function vehicleDisplayLabel(assetName: string | null | undefined): string {
  const name = (assetName ?? "").trim();
  if (!name) return "";

  const folded = fold(name);
  const brand = CATALOG_BRANDS.find((b) => {
    const f = fold(b);
    return folded === f || folded.startsWith(`${f} `);
  });
  // Not a catalogue vehicle name — leave it exactly as it is.
  if (!brand) return name;

  const withoutYear = name.replace(TRAILING_YEAR, "").trim();
  if (!DOMESTIC_BRAND_SET.has(brand)) return withoutYear;

  // Strip the prefix from the ORIGINAL string, never from the folded one:
  // folding turns a ZWNJ into a space, and slicing the folded text would ship
  // «دنده ای» in place of «دنده‌ای». Folding is for MATCHING only.
  const rest = withoutYear.replace(brandPrefixRe(brand), "").trim();
  // Never return an empty label: if the model name is missing, the brand is
  // all the identity the row has.
  return rest.length > 0 ? rest : withoutYear;
}
