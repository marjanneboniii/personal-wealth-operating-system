import type { AssetValuation } from "@/features/portfolio/types";

/**
 * Asset FAMILY split — presentation grouping only.
 *
 * «دارایی‌های مالی» vs «دارایی‌های واقعی» is a product grouping over the
 * accounting asset classes of the read model. It used to be re-declared inside
 * every page that needed it, which meant the «واقعی» bucket of one view could
 * silently stop being the «واقعی» bucket of another. Single source of truth
 * here, so all asset views agree about which row belongs to which family —
 * and so «همه دارایی‌ها» is always exactly مالی + واقعی.
 *
 * This module reads nothing and writes nothing: it only classifies rows the
 * valuation read model already produced.
 */
export const REAL_ASSET_CLASSES: ReadonlySet<string> = new Set([
  "دارایی واقعی",
  "املاک",
  "خودرو",
  "طلا",
  "کالا",
  "RWA",
]);

export function isRealAssetClassName(className: string | null | undefined): boolean {
  return REAL_ASSET_CLASSES.has(className ?? "");
}

/** Partition valuation rows into the two product families. */
export function splitAssetFamilies<T extends { className: string }>(rows: T[]): { financial: T[]; real: T[] } {
  const financial: T[] = [];
  const real: T[] = [];
  for (const row of rows) (isRealAssetClassName(row.className) ? real : financial).push(row);
  return { financial, real };
}

export type { AssetValuation };
