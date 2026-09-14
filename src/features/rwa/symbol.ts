/**
 * Canonical identity for real-world assets (RWA).
 *
 * Storage stays ASCII and compact (`001`, `002`, …) so database lookups,
 * uniqueness and integrations remain predictable. Persian digits are a UI
 * concern and are rendered with `toFaDigits` at the presentation boundary.
 *
 * The sequence is shared by every RWA subtype. Active `assets.symbol` values
 * are globally unique, so separate property/vehicle counters would both try to
 * claim `001`.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import { toFaDigits } from "@/lib/format";

export const RWA_SYMBOL_MIN_WIDTH = 3;

/**
 * USER-FACING identity of a real asset: «ملک ۱», «خودرو ۲».
 *
 * `assets.symbol` stays the internal, globally unique key (asset rows are
 * shared infrastructure without a tenant column, and symbol lookups rely on
 * that uniqueness). What a user sees is a per-user, per-kind counter stored on
 * the tenant-owned row (`real_estate_properties.user_seq`,
 * `vehicle_assets.user_seq`), so every account starts at 1 for properties and
 * independently at 1 for vehicles, regardless of what other users register.
 */
export type RwaKind = "property" | "vehicle";

const RWA_KIND_LABEL: Record<RwaKind, string> = { property: "ملک", vehicle: "خودرو" };

export function buildRwaLabel(kind: RwaKind, userSeq: number | null | undefined): string {
  if (!userSeq || !Number.isSafeInteger(userSeq) || userSeq < 1) return RWA_KIND_LABEL[kind];
  return `${RWA_KIND_LABEL[kind]} ${toFaDigits(String(userSeq))}`;
}

const RWA_KIND_TABLE: Record<RwaKind, string> = {
  property: "real_estate_properties",
  vehicle: "vehicle_assets",
};

/**
 * Lowest free per-user counter for one kind of real asset.
 *
 * Must run inside the write transaction that inserts the row. A transaction-
 * scoped advisory lock keyed on (kind, user) serialises concurrent creates of
 * the SAME user only — different users never wait on each other — and the
 * unique index (user_id, user_seq) is the database backstop.
 *
 * Numbers freed by deleting a property are reused (the row is removed), which
 * mirrors the previous behaviour of the compact symbol. A sold vehicle keeps
 * its row and therefore its number.
 */
export async function nextUserRwaSeq(
  tx: any,
  kind: RwaKind,
  userId: string | null | undefined,
  options: { lock?: boolean } = {},
): Promise<number> {
  const table = sql.raw(RWA_KIND_TABLE[kind]);
  const owner = userId ?? null;
  // Previews pass `lock: false`: they are advisory, and the final write resolves again under the lock.
  if (options.lock !== false) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rwa-user-seq:${kind}:${owner ?? "none"}`}))`);
  }
  const result = await tx.execute(
    owner
      ? sql`select user_seq from ${table} where user_id = ${owner} and user_seq is not null`
      : sql`select user_seq from ${table} where user_id is null and user_seq is not null`,
  );
  const rows = ((result as { rows?: unknown[] }).rows ?? result) as Array<{ user_seq: number | string }>;
  const taken = new Set(rows.map((row) => Number(row.user_seq)));
  let seq = 1;
  while (taken.has(seq)) seq++;
  return seq;
}

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
 * IDENTIFIER REUSE: only rows with deleted_at IS NULL occupy identifiers.
 * Soft-deleted assets (deleted_at IS NOT NULL) release their identifier so the
 * next asset reclaims the lowest free number (e.g. 001 after deleting the only
 * property). Orphaned-but-not-yet-soft-deleted rows still occupy their symbol
 * until the explicit repair mutation marks them deleted, matching the partial
 * unique index in the database.
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

  // Rows with deleted_at IS NULL occupy identifiers; soft-deleted rows release theirs.
  // Width grows naturally after 999 (`1000`).
  for (let sequence = 1; sequence <= Number.MAX_SAFE_INTEGER; sequence++) {
    const candidate = buildRwaSymbol(sequence);
    if (!occupied.has(candidate)) return candidate;
  }

  throw new Error("شناسه عددی آزاد برای دارایی واقعی یافت نشد.");
}
