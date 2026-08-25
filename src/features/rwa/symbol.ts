/**
 * Canonical identity for real-world assets (RWA).
 *
 * Storage stays ASCII and as SHORT as possible (`1`, `2`, …) so database
 * lookups, uniqueness and integrations remain predictable. No zero-padding and
 * no Persian digits are stored or rendered: the ID is shown exactly as stored.
 *
 * The sequence is shared by every RWA subtype. `assets.symbol` is globally
 * unique, so separate property/vehicle counters would both try to claim `1`.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";

export const RWA_SYMBOL_MIN_WIDTH = 1;

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
 */
export async function nextRwaSymbol(tx: any = db, rwaClassId?: string): Promise<string> {
  if (rwaClassId) {
    await tx.execute(sql`select id from asset_classes where id = ${rwaClassId} for update`);
  }

  const rows = await tx
    .select({ symbol: assets.symbol })
    .from(assets)
    .where(sql`${assets.symbol} ~ '^[0-9]+$'`);
  const occupied = new Set(rows.map((row: { symbol: string }) => row.symbol));

  // Deleted/legacy rows remain reserved in `assets`; identifiers are therefore
  // never silently reused. Width grows naturally after 9 (`10`).
  for (let sequence = 1; sequence <= Number.MAX_SAFE_INTEGER; sequence++) {
    const candidate = buildRwaSymbol(sequence);
    if (!occupied.has(candidate)) return candidate;
  }

  throw new Error("شناسه عددی آزاد برای دارایی واقعی یافت نشد.");
}
