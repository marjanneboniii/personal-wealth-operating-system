import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { entryFxSnapshots } from "@/db/schema";

export type EntryFxSnapshot = {
  irtAmount: string;
  usdAmount: string;
  fxRate: string;
  rateSource: string;
  rateDate: string;
};

/**
 * Commit-time FX snapshots of the given journal entries, keyed by entry id.
 *
 * Callers pass ids that came out of a tenant-scoped query (`getTransactions`,
 * `getRecent`), so this read can never widen what the user sees.
 */
export async function getEntryFxSnapshots(entryIds: string[]): Promise<Map<string, EntryFxSnapshot>> {
  if (entryIds.length === 0) return new Map();
  const rows = await db.select().from(entryFxSnapshots).where(inArray(entryFxSnapshots.entryId, entryIds));
  return new Map(
    rows.map((r) => [
      r.entryId,
      {
        irtAmount: r.irtAmount,
        usdAmount: r.usdAmount,
        fxRate: r.fxRate,
        rateSource: r.rateSource,
        rateDate: r.rateDate,
      },
    ]),
  );
}
