/**
 * Canonical identity for real-world assets (RWA).
 *
 * Storage stays ASCII and compact (`001`, `002`, …) so database lookups,
 * uniqueness and integrations remain predictable. Persian digits are a UI
 * concern and are rendered with `toFaDigits` at the presentation boundary.
 *
 * The sequence is shared by every RWA subtype. `assets.symbol` is globally
 * unique, so separate property/vehicle counters would both try to claim `001`.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";

export const RWA_SYMBOL_MIN_WIDTH = 3;

export function buildRwaSymbol(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Real-asset symbol sequence must be a positive integer.");
  }
  return String(sequence).padStart(RWA_SYMBOL_MIN_WIDTH, "0");
}

/**
 * Return the first free compact numeric symbol.
 *
 * When called from a write transaction, pass the RWA class id. Locking that
 * shared row serialises property/vehicle creation and closes the race between
 * choosing a symbol and inserting it. Preview calls intentionally omit the
 * lock; a preview is advisory and the final write always resolves again.
 *
 * IDENTIFIER REUSE: Only ACTIVE (non-deleted) assets occupy identifiers.
 * Soft-deleted assets (deleted_at IS NOT NULL) release their identifier so
 * that after a full cleanup the next asset reclaims the lowest free number.
 * This prevents the counter from drifting (e.g. always producing 002 after
 * deleting 001 when no other RWA exists).
 */
export async function nextRwaSymbol(tx: any = db, rwaClassId?: string): Promise<string> {
  if (rwaClassId) {
    await tx.execute(sql`select id from asset_classes where id = ${rwaClassId} for update`);
  }

  const rows = await tx
    .select({ symbol: assets.symbol })
    .from(assets)
    .where(sql`${assets.symbol} ~ '^[0-9]+$' AND ${assets.deletedAt} IS NULL`);
  const occupied = new Set(rows.map((row: { symbol: string }) => row.symbol));

  // Active rows occupy identifiers; soft-deleted rows release theirs.
  // Width grows naturally after 999 (`1000`).
  for (let sequence = 1; sequence <= Number.MAX_SAFE_INTEGER; sequence++) {
    const candidate = buildRwaSymbol(sequence);
    if (!occupied.has(candidate)) return candidate;
  }

  throw new Error("شناسه عددی آزاد برای دارایی واقعی یافت نشد.");
}
