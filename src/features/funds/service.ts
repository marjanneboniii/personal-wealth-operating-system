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
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assetClasses, assets } from "@/db/schema";
import { FUND_BY_SYMBOL, FUND_KIND_LABELS, type FundKind } from "./catalogData";
import { STOCK_BY_SYMBOL } from "./stockCatalogData";

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

export async function ensureInstrumentClassId(
  kind: InstrumentKind,
  conn: typeof db = db,
): Promise<string> {
  const seed = CLASS_SEED[kind];
  let [row] = await conn.select().from(assetClasses).where(eq(assetClasses.code, seed.code)).limit(1);
  if (!row) {
    [row] = await conn
      .insert(assetClasses)
      .values(seed)
      .onConflictDoNothing({ target: assetClasses.code })
      .returning();
    if (!row) {
      [row] = await conn.select().from(assetClasses).where(eq(assetClasses.code, seed.code)).limit(1);
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
  /** Owner of the asset ACCOUNT created alongside the identity. */
  userId?: string | null;
  /**
   * Transaction handle, so a caller can enrol registration in ITS transaction.
   *
   * The setup wizard needs this: it registers several instruments inside the
   * one transaction that also posts the opening entry, so a wizard that fails
   * half-way leaves neither stray asset rows nor an unbalanced ledger. Without
   * it these writes would commit outside that transaction — and on a
   * single-connection driver they would deadlock against it.
   */
  tx?: typeof db;
};

export type RegisteredInstrument = {
  assetId: string;
  symbol: string;
  name: string;
  /** True when this call created the identity rather than finding it. */
  created: boolean;
  /**
   * The tenant-owned asset ACCOUNT this instrument can be bought into.
   *
   * Without it a registration was a DEAD END: the purchase form lists asset
   * accounts (plus the CoinGecko crypto catalogue), so a registered fund with
   * no account could never be selected, could never receive a buy, could never
   * become a holding — and was therefore invisible forever. Registering the
   * identity and leaving it unbuyable is not a partial feature, it is a
   * broken one.
   */
  accountId: string | null;
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

  // Resolve the display name from whichever catalogue the kind belongs to, so a
  // user who picked «فولاد» gets «فولاد مبارکه اصفهان» rather than the bare
  // symbol. A symbol that is in NEITHER catalogue is still registerable — the
  // registrar keeps its manual-entry path — and simply names itself.
  const catalogued =
    input.kind === "fund" ? FUND_BY_SYMBOL.get(symbol) : STOCK_BY_SYMBOL.get(symbol);
  const name = input.name?.trim() || catalogued?.name || symbol;

  const conn = input.tx ?? db;

  const [existing] = await conn.select().from(assets).where(eq(assets.symbol, symbol)).limit(1);
  if (existing) {
    // Reactivate rather than duplicate — a previously removed fund keeps its
    // asset id, and therefore its lots, transactions and history.
    const [revived] = await conn
      .update(assets)
      .set({ isActive: true, deletedAt: null, updatedAt: new Date() })
      .where(eq(assets.id, existing.id))
      .returning();
    const row = revived ?? existing;
    // Idempotent here too: an identity registered before this account existed
    // (or by another tenant) still gets THIS tenant its own account, which is
    // what makes an old registration buyable instead of permanently stranded.
    const accountId = await ensureInstrumentAccount(row.id, row.name, row.symbol, input.userId ?? null, conn);
    return { assetId: row.id, symbol: row.symbol, name: row.name, created: false, accountId };
  }

  const classId = await ensureInstrumentClassId(input.kind, conn);
  const [created] = await conn
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
  const accountId = await ensureInstrumentAccount(created.id, created.name, created.symbol, input.userId ?? null, conn);
  return {
    assetId: created.id,
    symbol: created.symbol,
    name: created.name,
    created: true,
    accountId,
  };
}

/**
 * The tenant-owned asset account an instrument is bought into.
 *
 * Mirrors the crypto path (`registerMarketAssetAction`), which has always
 * created one — the fund/stock path simply never did, which is exactly why a
 * registered fund could not be selected in the purchase form.
 *
 * ACCOUNTING-NEUTRAL. Creating a chart row moves no money: no journal entry,
 * no posting, no FIFO lot, no balance. The account opens at zero and only a
 * real purchase through the existing transaction flow ever changes that.
 *
 * Idempotent and conflict-tolerant, because the registrar is explicitly
 * designed to be re-entered («افزودن مورد دیگر») and a double-tap must not
 * split one instrument across two accounts.
 */
async function ensureInstrumentAccount(
  assetId: string,
  name: string,
  symbol: string,
  userId: string | null,
  conn: typeof db = db,
): Promise<string | null> {
  const ownership = userId ? eq(accounts.userId, userId) : sql`${accounts.userId} is null`;
  const [existing] = await conn
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.assetId, assetId), eq(accounts.type, "asset"), ownership))
    .limit(1);
  if (existing) return existing.id;

  // The symbol is Persian, and account codes are ASCII by convention across the
  // chart, so the code is derived from the asset id rather than transliterated.
  const code = `INS-${assetId.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const [created] = await conn
    .insert(accounts)
    .values({
      userId,
      code,
      name: `${name} (${symbol})`,
      type: "asset",
      assetId,
      isActive: true,
    })
    .onConflictDoNothing({ target: [accounts.userId, accounts.code] })
    .returning({ id: accounts.id });
  if (created) return created.id;

  const [after] = await conn
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.assetId, assetId), eq(accounts.type, "asset"), ownership))
    .limit(1);
  return after?.id ?? null;
}

export { FUND_KIND_LABELS };
export type { FundKind };
