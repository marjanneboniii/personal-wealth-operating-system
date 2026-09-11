/**
 * Registering a صندوق سرمایه‌گذاری or a سهام بورسی.
 *
 * This creates the ASSET IDENTITY only — the thing a holding can later point
 * at. It deliberately posts no journal entry and creates no position: a buy is
 * a ledger transaction with a date, a price and a cost basis, and inventing one
 * from a registration form would put a fabricated lot into FIFO. The user
 * records the purchase through the normal transaction flow afterwards, exactly
 * as they do for a crypto asset.
 *
 * PRICING IS MANUAL, AND THAT IS A DECISION NOT AN OMISSION
 * The brief's own fallback (بخش ۳) applies here: fipiran and TSETMC do not
 * resolve from this environment, so there is no verified live NAV feed to wire
 * up. Rather than ship an adapter written against a guessed response shape,
 * these assets are registered with `pricingMethod: "manual"`, which the
 * valuation path already understands. When a verified feed exists, flipping
 * these rows to it is a metadata update — no re-registration, no lost history.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assetClasses, assets } from "@/db/schema";
import { FUND_BY_SYMBOL, FUND_KIND_LABELS, type FundKind } from "./catalogData";

/** Instrument families this module can register. */
export type InstrumentKind = "fund" | "stock";

/**
 * Asset classes for the two families. They did not exist before — the seed
 * only created cash/stable/crypto/gold — which is why a fund could not be
 * classified at all, and why the onboarding checklist could never count one.
 */
const CLASS_SEED: Record<InstrumentKind, { code: string; name: string; color: string; sortOrder: number }> = {
  fund: { code: "fund", name: "صندوق سرمایه‌گذاری", color: "#7c8cf8", sortOrder: 5 },
  stock: { code: "stock", name: "سهام", color: "#5b6ee0", sortOrder: 6 },
};

/** Fund and stock units are quoted in whole Rial/Toman steps; 2 dp is ample. */
const DECIMALS = 2;

export async function ensureInstrumentClassId(kind: InstrumentKind): Promise<string> {
  const seed = CLASS_SEED[kind];
  let [row] = await db.select().from(assetClasses).where(eq(assetClasses.code, seed.code)).limit(1);
  if (!row) {
    [row] = await db
      .insert(assetClasses)
      .values(seed)
      .onConflictDoNothing({ target: assetClasses.code })
      .returning();
    if (!row) {
      [row] = await db.select().from(assetClasses).where(eq(assetClasses.code, seed.code)).limit(1);
    }
  }
  if (!row) throw new Error(`کلاس دارایی «${seed.name}» ایجاد نشد.`);
  return row.id;
}

export type RegisterInstrumentInput = {
  kind: InstrumentKind;
  /** Tehran-exchange symbol in Persian, e.g. «عیار» or «فولاد». */
  symbol: string;
  /** Full Persian name. Falls back to the catalogue, then to the symbol. */
  name?: string;
};

export type RegisteredInstrument = {
  assetId: string;
  symbol: string;
  name: string;
  /** True when this call created the identity rather than finding it. */
  created: boolean;
};

/**
 * Idempotent: registering the same symbol twice returns the existing identity
 * instead of creating a duplicate. That matters because the checklist sends
 * users back into this flow to «افزودن مورد دیگر», and a double-tap must not
 * split one fund across two asset rows.
 */
export async function registerInstrument(
  input: RegisterInstrumentInput,
): Promise<RegisteredInstrument> {
  const symbol = input.symbol.trim();
  if (!symbol) throw new Error("نماد الزامی است.");

  const catalogued = input.kind === "fund" ? FUND_BY_SYMBOL.get(symbol) : undefined;
  const name = input.name?.trim() || catalogued?.name || symbol;

  const [existing] = await db.select().from(assets).where(eq(assets.symbol, symbol)).limit(1);
  if (existing) {
    // Reactivate rather than duplicate — a previously removed fund keeps its
    // asset id, and therefore its lots, transactions and history.
    const [revived] = await db
      .update(assets)
      .set({ isActive: true, deletedAt: null, updatedAt: new Date() })
      .where(eq(assets.id, existing.id))
      .returning();
    const row = revived ?? existing;
    return { assetId: row.id, symbol: row.symbol, name: row.name, created: false };
  }

  const classId = await ensureInstrumentClassId(input.kind);
  const [created] = await db
    .insert(assets)
    .values({
      symbol,
      name,
      classId,
      decimals: DECIMALS,
      pricingMethod: "manual",
      priceSource: "manual",
    })
    .returning();
  if (!created) throw new Error("ثبت دارایی ناموفق بود.");
  return { assetId: created.id, symbol: created.symbol, name: created.name, created: true };
}

export { FUND_KIND_LABELS };
export type { FundKind };
