/**
 * Real Estate Display Mapping — فارسی‌سازی Symbol
 *
 * Technical Symbol (e.g. RE-AHZ-SDU-APT-000) remains immutable in DB and logic.
 * UI displays Persian name (e.g. "شهرک دانشگاه") as Display Name.
 *
 * This mapping is generic, data-driven, and never hardcodes user financial values.
 * It only maps known master-data codes to their Persian labels, which already
 * exist in the master-data seed. For unknown symbols, it falls back to the
 * Persian asset name or neighborhood name already resolved from DB.
 */

import { NEIGHBORHOODS_SEED, CITIES_SEED, PROPERTY_TYPES_SEED } from "./masterData";

// Build lookup maps from seed (which is the source of truth for Persian names)
const neighborhoodByCode = new Map(NEIGHBORHOODS_SEED.map((n) => [n.code.toUpperCase(), n.nameFa]));
const cityByCode = new Map(CITIES_SEED.map((c) => [c.code.toUpperCase(), c.nameFa]));
const typeByCode = new Map(PROPERTY_TYPES_SEED.map((t) => [t.code.toUpperCase(), t.nameFa]));

/**
 * Parse a technical real-estate symbol: RE-{CITY}-{NEIGHBORHOOD}-{TYPE}-{SEQ}
 * Returns parts if parseable, otherwise null.
 */
export function parseRealEstateSymbol(symbol: string): { city: string; neighborhood: string; type: string; seq: string } | null {
  if (!symbol) return null;
  const parts = symbol.trim().toUpperCase().split("-");
  // Expected at least 5 parts: RE, CITY, NEIGHBORHOOD, TYPE, SEQ
  if (parts.length < 5) return null;
  if (parts[0] !== "RE") return null;
  return {
    city: parts[1],
    neighborhood: parts[2],
    type: parts[3],
    seq: parts.slice(4).join("-"),
  };
}

/**
 * Returns Persian display name for a symbol, using master-data.
 * Example: RE-AHZ-SDU-APT-000 => "شهرک دانشگاه"
 * If neighborhood not found, tries city, then type, then null.
 */
export function getRealEstateDisplayNameFromSymbol(symbol: string): string | null {
  const parsed = parseRealEstateSymbol(symbol);
  if (!parsed) return null;
  // Priority: neighborhood (most specific, e.g. SDU => شهرک دانشگاه)
  const hood = neighborhoodByCode.get(parsed.neighborhood);
  if (hood) return hood;
  const city = cityByCode.get(parsed.city);
  if (city) return city;
  const type = typeByCode.get(parsed.type);
  if (type) return type;
  return null;
}

/**
 * Generic display label for a real-estate asset:
 * 1. If DB already resolved Persian neighborhoodNameFa, use it (most accurate, user-scoped).
 * 2. Else, try to derive from technical symbol via seed mapping.
 * 3. Else, fallback to assetName (which is already Persian, e.g. "آپارتمان — اهواز — شهرک دانشگاه").
 * 4. Else, raw symbol.
 *
 * Technical symbol itself is never mutated.
 */
export function getRealEstateDisplayLabel(input: {
  symbol?: string | null;
  assetName?: string | null;
  neighborhoodNameFa?: string | null;
  cityNameFa?: string | null;
}): string {
  if (input.neighborhoodNameFa) return input.neighborhoodNameFa;
  if (input.symbol) {
    const fromSymbol = getRealEstateDisplayNameFromSymbol(input.symbol);
    if (fromSymbol) return fromSymbol;
  }
  if (input.assetName) return input.assetName;
  if (input.cityNameFa) return input.cityNameFa;
  return input.symbol ?? "—";
}
