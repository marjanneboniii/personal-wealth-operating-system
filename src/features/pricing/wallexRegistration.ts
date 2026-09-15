/**
 * Registering a والکس asset — identity plus the tenant-owned asset account.
 *
 * WHY THIS LIVES HERE AND NOT ONLY IN THE SERVER ACTION
 * It used to be written inline in `registerWallexAssetAction`. The setup
 * wizard now registers Wallex assets too (سهام و کامودیتی توکنیزه), and it must
 * do so INSIDE its own transaction — the one that also posts the opening
 * entry — so a wizard that fails half-way leaves no stray asset rows. On the
 * single-connection PGlite driver a write on the global `db` from inside that
 * transaction would deadlock. So the rules live once, here, and take an
 * optional `tx`; the action and the wizard both delegate. This is the same
 * shape `registerInstrument` already has, for the same reason.
 *
 * REGISTRATION IS NOT PURCHASE. No transaction, no journal entry, no posting,
 * no FIFO lot, no balance. The account opens at zero; the purchase form stays
 * the only path that touches accounting.
 *
 * The identity is read from the PERSISTED catalogue, never from caller
 * strings: a client that could supply its own name and symbol could mis-map a
 * holding onto the wrong asset.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assetClasses, assets, wallexAssetCatalog } from "@/db/schema";

type ClassSeed = { code: string; name: string; color: string; sortOrder: number };

/**
 * Asset class per Wallex kind, so an allocation chart reads correctly the
 * moment something is bought. Codes are the ones `features/accounts/
 * classification.ts` already treats as investment positions — a US share or
 * an oil token must never be offered as a payment account.
 */
const CLASS_BY_KIND: Record<string, ClassSeed> = {
  gold: { code: "gold", name: "طلا", color: "#363850", sortOrder: 4 },
  // A meme coin is still crypto for allocation; the separate section is a
  // presentation choice, not a different asset class.
  meme: { code: "crypto", name: "رمزارز", color: "#c9cafa", sortOrder: 3 },
  stablecoin: { code: "stable", name: "استیبل‌کوین", color: "#9aa3c7", sortOrder: 2 },
  tokenized_stock: { code: "equity", name: "سهام توکنیزه", color: "#5b8def", sortOrder: 7 },
  commodity: { code: "commodity", name: "کالا", color: "#b07a3a", sortOrder: 8 },
  index: { code: "etf", name: "شاخص", color: "#6a7fd9", sortOrder: 9 },
  bond: { code: "security", name: "اوراق قرضه", color: "#44506b", sortOrder: 10 },
};
const CRYPTO_CLASS: ClassSeed = { code: "crypto", name: "رمزارز", color: "#c9cafa", sortOrder: 3 };

export function wallexClassSeed(kind: string): ClassSeed {
  return CLASS_BY_KIND[kind] ?? CRYPTO_CLASS;
}

export type RegisteredWallexAsset = {
  assetId: string;
  accountId: string;
  symbol: string;
  name: string;
  kind: string;
  account: {
    id: string;
    code: string;
    name: string;
    type: "asset";
    symbol: string;
    decimals: number;
    logoUrl: string | null;
  };
};

export async function registerWallexAsset(input: {
  symbol: string;
  userId?: string | null;
  /** Enrol in the caller's transaction (the setup wizard). */
  tx?: typeof db;
}): Promise<RegisteredWallexAsset> {
  const conn = input.tx ?? db;
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) throw new Error("نماد الزامی است.");

  const [entry] = await conn
    .select()
    .from(wallexAssetCatalog)
    .where(eq(wallexAssetCatalog.symbol, symbol))
    .limit(1);
  if (!entry) throw new Error(`«${symbol}» در کاتالوگ والکس یافت نشد.`);

  const seed = wallexClassSeed(entry.kind);
  let [assetClass] = await conn.select().from(assetClasses).where(eq(assetClasses.code, seed.code)).limit(1);
  if (!assetClass) {
    [assetClass] = await conn
      .insert(assetClasses)
      .values(seed)
      .onConflictDoNothing({ target: assetClasses.code })
      .returning();
    if (!assetClass) {
      [assetClass] = await conn.select().from(assetClasses).where(eq(assetClasses.code, seed.code)).limit(1);
    }
  }
  if (!assetClass) throw new Error("کلاس دارایی قابل ایجاد نیست.");

  const [existing] = await conn.select().from(assets).where(eq(assets.symbol, entry.symbol)).limit(1);
  let asset = existing;
  if (asset) {
    // An asset already priced by CoinGecko keeps that pricing method — the
    // valuation layer knows how to read it, and switching a held asset's
    // price source is not a side effect a registration may cause.
    [asset] = await conn
      .update(assets)
      .set({
        name: asset.name || entry.displayName,
        logoUrl: asset.logoUrl || entry.logoUrl,
        isActive: true,
        deletedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(assets.id, asset.id))
      .returning();
  } else {
    [asset] = await conn
      .insert(assets)
      .values({
        symbol: entry.symbol,
        name: entry.displayName,
        classId: assetClass.id,
        decimals: 8,
        pricingMethod: "manual",
        // Where the price is read — «wallex» or «abantether».
        priceSource: entry.source,
        logoUrl: entry.logoUrl,
      })
      .returning();
  }
  if (!asset) throw new Error("ثبت شناسه دارایی ناموفق بود.");

  const userId = input.userId ?? null;
  const ownership = userId ? eq(accounts.userId, userId) : sql`${accounts.userId} is null`;
  let [account] = await conn
    .select()
    .from(accounts)
    .where(and(eq(accounts.assetId, asset.id), eq(accounts.type, "asset"), ownership))
    .limit(1);

  if (!account) {
    const code = `WLX-${entry.symbol}`.toUpperCase().replace(/[^A-Z0-9-]/g, "-").slice(0, 48);
    [account] = await conn
      .insert(accounts)
      .values({
        userId,
        code,
        name: `${entry.displayName} (${entry.symbol})`,
        type: "asset",
        assetId: asset.id,
        isActive: true,
      })
      .onConflictDoNothing()
      .returning();
    if (!account) {
      [account] = await conn
        .select()
        .from(accounts)
        .where(and(eq(accounts.assetId, asset.id), eq(accounts.type, "asset"), ownership))
        .limit(1);
    }
  }
  if (!account) throw new Error("ایجاد حساب دارایی ناموفق بود.");

  return {
    assetId: asset.id,
    accountId: account.id,
    symbol: asset.symbol,
    name: entry.displayName,
    kind: entry.kind,
    account: {
      id: account.id,
      code: account.code,
      name: account.name,
      type: "asset",
      symbol: asset.symbol,
      decimals: asset.decimals,
      logoUrl: asset.logoUrl,
    },
  };
}
