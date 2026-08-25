/**
 * Real Estate display mapping.
 *
 * Real estate assets use short, unique numeric identifiers (`001`, `002`, ...).
 * Location and property type come from relational master data shown in separate
 * columns/rows.
 */

import { toFaDigits } from "@/lib/format";
import { NEIGHBORHOODS_SEED, CITIES_SEED, PROPERTY_TYPES_SEED } from "./seedData";

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
 * Returns Persian display name for a legacy symbol, using master-data.
 */
export function getRealEstateDisplayNameFromSymbol(symbol: string): string | null {
  const parsed = parseRealEstateSymbol(symbol);
  if (!parsed) return null;
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
 * Always returns the short, unique, numeric property identifier.
 */
export function getRealEstateDisplayLabel(input: {
  symbol?: string | null;
  assetName?: string | null;
  neighborhoodNameFa?: string | null;
  cityNameFa?: string | null;
}): string {
  if (input.symbol) return toFaDigits(input.symbol);
  if (input.assetName && /^\d+$/.test(input.assetName.trim())) return toFaDigits(input.assetName.trim());
  return input.symbol ?? "—";
}
