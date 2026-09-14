import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { entryFxSnapshots } from "@/db/schema";

/** What a buy / sell / swap was at commit time — frozen, never recomputed. */
export type EntryTradeSnapshot = {
  tradeSymbol: string;
  tradeQuantity: string;
  settleSymbol: string | null;
  settleQuantity: string | null;
  unitPriceIrt: string | null;
  unitPriceUsdt: string | null;
  usdtRateIrt: string | null;
  priceMode: string | null;
};

export type EntryFxSnapshot = {
  irtAmount: string;
  usdAmount: string;
  fxRate: string;
  rateSource: string;
  rateDate: string;
  trade: EntryTradeSnapshot | null;
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
        trade:
          r.tradeSymbol && r.tradeQuantity
            ? {
                tradeSymbol: r.tradeSymbol,
                tradeQuantity: r.tradeQuantity,
                settleSymbol: r.settleSymbol ?? null,
                settleQuantity: r.settleQuantity ?? null,
                unitPriceIrt: r.unitPriceIrt ?? null,
                unitPriceUsdt: r.unitPriceUsdt ?? null,
                usdtRateIrt: r.usdtRateIrt ?? null,
                priceMode: r.priceMode ?? null,
              }
            : null,
      },
    ]),
  );
}
