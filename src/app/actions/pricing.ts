"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { accounts, assetClasses, assets, coingeckoAssetCatalog } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { authUsersExistCached } from "@/lib/tenantState";
import {
  getMarketCatalogStatus,
  listPricedCoinGeckoCatalog,
  refreshCoinGeckoCatalog,
  type PricedCoinGeckoCatalogEntry,
} from "@/features/pricing/catalog";
import { getSupportedCryptoByCoinGeckoId } from "@/features/pricing/supportedAssets";
import {
  ensureWallexCatalog,
  getWallexAsset,
  refreshWallexCatalog,
  searchWallexCatalog,
  type WallexCatalogResult,
} from "@/features/pricing/wallexCatalog";
import type { PriceFailureCode, PriceFreshness } from "@/features/pricing/types";

export type RegisterMarketAssetResult = {
  ok: boolean;
  message: string;
  account?: {
    id: string;
    code: string;
    name: string;
    type: "asset";
    symbol: string;
    decimals: number;
    logoUrl: string | null;
  };
};

async function requireRegistrationIdentity() {
  const user = await getCurrentUser();
  // Cached "any username-bearing user exists" probe — see lib/tenantState.ts.
  const authEnabled = await authUsersExistCached();
  if (authEnabled && !user) throw new Error("برای افزودن دارایی ابتدا وارد شوید.");
  return user;
}

/**
 * Registers a selected CoinGecko catalog identity and a tenant-owned asset
 * account. It never creates a transaction, journal, posting or FIFO lot; the
 * existing purchase/sale flow remains the only Accounting mutation path.
 */
export async function registerMarketAssetAction(
  coingeckoId: string,
): Promise<RegisterMarketAssetResult> {
  try {
    const user = await requireRegistrationIdentity();
    const normalizedId = coingeckoId.trim().toLowerCase();
    const supported = getSupportedCryptoByCoinGeckoId(normalizedId);
    if (!supported) throw new Error("این رمزارز در فهرست پشتیبانی‌شدهٔ برنامه نیست.");

    const [catalog] = await db
      .select()
      .from(coingeckoAssetCatalog)
      .where(and(
        eq(coingeckoAssetCatalog.coingeckoId, normalizedId),
        eq(coingeckoAssetCatalog.isActive, true),
        eq(coingeckoAssetCatalog.kind, "crypto"),
      ))
      .limit(1);
    if (!catalog) throw new Error("دارایی انتخاب‌شده در کاتالوگ CoinGecko ثبت نشده است.");

    const classCode = "crypto";
    let [assetClass] = await db
      .select()
      .from(assetClasses)
      .where(eq(assetClasses.code, classCode))
      .limit(1);
    if (!assetClass) {
      [assetClass] = await db
        .insert(assetClasses)
        .values({
          code: classCode,
          name: "رمزارز",
          color: "#c9cafa",
          sortOrder: 3,
        })
        .onConflictDoNothing({ target: assetClasses.code })
        .returning();
      if (!assetClass) {
        [assetClass] = await db.select().from(assetClasses).where(eq(assetClasses.code, classCode)).limit(1);
      }
    }
    if (!assetClass) throw new Error("کلاس دارایی قابل ایجاد نیست.");

    const [idOwner] = await db.select().from(assets).where(eq(assets.coingeckoId, normalizedId)).limit(1);
    const [symbolAsset] = await db.select().from(assets).where(eq(assets.symbol, supported.symbol)).limit(1);
    if (idOwner && idOwner.symbol !== supported.symbol) {
      throw new Error("شناسه CoinGecko این دارایی به نماد دیگری متصل است؛ ثبت برای جلوگیری از Mapping اشتباه متوقف شد.");
    }

    let asset = symbolAsset ?? idOwner;
    if (asset) {
      [asset] = await db
        .update(assets)
        .set({
          name: supported.name,
          classId: assetClass.id,
          pricingMethod: "coingecko",
          priceSource: "coingecko",
          coingeckoId: supported.coingeckoId,
          logoUrl: catalog.logoUrl || supported.logoUrl,
          isActive: true,
          deletedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(assets.id, asset.id))
        .returning();
    } else {
      [asset] = await db
        .insert(assets)
        .values({
          symbol: supported.symbol,
          name: supported.name,
          classId: assetClass.id,
          decimals: 8,
          pricingMethod: "coingecko",
          priceSource: "coingecko",
          coingeckoId: supported.coingeckoId,
          logoUrl: catalog.logoUrl || supported.logoUrl,
        })
        .returning();
    }
    if (!asset) throw new Error("ثبت شناسه دارایی ناموفق بود.");

    const ownership = user
      ? eq(accounts.userId, user.id)
      : sql`${accounts.userId} is null`;
    let [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.assetId, asset.id), eq(accounts.type, "asset"), ownership))
      .limit(1);

    if (!account) {
      const codeBase = `MKT-${supported.symbol}-${supported.coingeckoId}`
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, "-")
        .slice(0, 48);
      [account] = await db
        .insert(accounts)
        .values({
          userId: user?.id ?? null,
          code: codeBase,
          name: `${supported.displayName} (${supported.symbol})`,
          type: "asset",
          assetId: asset.id,
          isActive: true,
        })
        .onConflictDoNothing()
        .returning();
      if (!account) {
        [account] = await db
          .select()
          .from(accounts)
          .where(and(eq(accounts.assetId, asset.id), eq(accounts.type, "asset"), ownership))
          .limit(1);
      }
    }
    if (!account) throw new Error("ایجاد حساب دارایی ناموفق بود.");

    revalidatePath("/new");
    revalidatePath("/portfolio");
    return {
      ok: true,
      message: `${supported.displayName} (${supported.symbol}) با قیمت‌گذاری CoinGecko ثبت شد؛ اکنون خرید یا فروش را تکمیل کنید.`,
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
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "ثبت دارایی ناموفق بود." };
  }
}

export type MarketCatalogEntry = {
  coingeckoId: string;
  symbol: string;
  name: string;
  displayName: string;
  logoUrl: string;
  priceUsd: string | null;
  priceFreshness: PriceFreshness;
  priceFailureCode?: PriceFailureCode;
  priceObservedAt: string | null;
};

export type SearchMarketCatalogResult = {
  ok: boolean;
  assets: MarketCatalogEntry[];
  /** Whether the catalog only holds the offline bootstrap identities. */
  bootstrapOnly: boolean;
  total: number;
  message?: string;
};

function toEntry(row: PricedCoinGeckoCatalogEntry): MarketCatalogEntry {
  return {
    coingeckoId: row.coingeckoId,
    symbol: row.symbol,
    name: row.name,
    displayName: row.displayName,
    logoUrl: row.logoUrl,
    priceUsd: row.priceUsd,
    priceFreshness: row.priceFreshness,
    priceFailureCode: row.priceFailureCode,
    priceObservedAt: row.priceObservedAt,
  };
}

/**
 * Server-side search over the explicit supported-crypto allowlist. Results are
 * enriched with one failure-safe CoinGecko price batch for direct UI display.
 */
export async function searchMarketCatalogAction(
  query: string,
): Promise<SearchMarketCatalogResult> {
  try {
    await requireRegistrationIdentity();
    const rows = await listPricedCoinGeckoCatalog(query, 100);
    const status = await getMarketCatalogStatus();
    return {
      ok: true,
      assets: rows.map(toEntry),
      bootstrapOnly: status.usingOfflineFloor,
      total: status.total,
    };
  } catch (error) {
    return {
      ok: false,
      assets: [],
      bootstrapOnly: true,
      total: 0,
      message: error instanceof Error ? error.message : "جستجوی کاتالوگ ناموفق بود.",
    };
  }
}

/**
 * Manual catalog re-sync (top-250 crypto). Read-only with respect to
 * Accounting: it touches the identity catalog and nothing else.
 */
export async function refreshMarketCatalogAction(): Promise<SearchMarketCatalogResult> {
  try {
    await requireRegistrationIdentity();
    const sync = await refreshCoinGeckoCatalog();
    const status = await getMarketCatalogStatus();
    const rows = await listPricedCoinGeckoCatalog("", 100);
    revalidatePath("/new");

    const message =
      sync.status === "fresh" || sync.status === "partial"
        ? `کاتالوگ به‌روزرسانی شد — ${status.total} دارایی.`
        : "اتصال به CoinGecko برقرار نشد؛ فهرست آفلاین نمایش داده می‌شود. برای فهرست کامل، دسترسی شبکه یا COINGECKO_API_KEY را بررسی کنید.";

    return {
      ok: sync.status === "fresh" || sync.status === "partial",
      assets: rows.map(toEntry),
      bootstrapOnly: status.usingOfflineFloor,
      total: status.total,
      message,
    };
  } catch (error) {
    return {
      ok: false,
      assets: [],
      bootstrapOnly: true,
      total: 0,
      message: error instanceof Error ? error.message : "به‌روزرسانی کاتالوگ ناموفق بود.",
    };
  }
}


/* ══════════════════════════════════════════════════════════════════════
   والکس — the Persian-named catalogue with BOTH market quotes.

   Separate from the CoinGecko actions above rather than merged into them,
   because the two sources answer different questions and disagree by design:
   CoinGecko gives a global USD identity for 23 curated coins, Wallex gives a
   few hundred assets named in Persian with a تومان price AND a تتر price, plus
   the tokenised metals the curated list cannot express. Collapsing them into
   one action would have forced one price shape onto both.
   ══════════════════════════════════════════════════════════════════════ */

export type WallexCatalogActionResult = {
  ok: boolean;
  assets: WallexCatalogResult[];
  /** fresh | stale | unavailable — the UI must disclose a stale price. */
  freshness: "fresh" | "stale" | "unavailable";
  total: number;
  syncedAt: string | null;
  message?: string;
};

/**
 * Search the persisted Wallex catalogue, refreshing it first when stale.
 *
 * Never throws on an upstream outage: the persisted rows are served and the
 * freshness is reported as `stale`, because a search box that empties itself
 * during a network blip reads as «the feature is gone».
 */
export async function searchWallexCatalogAction(
  query: string,
  kind?: string,
): Promise<WallexCatalogActionResult> {
  try {
    await requireRegistrationIdentity();
    const status = await ensureWallexCatalog();
    const assets = await searchWallexCatalog(query, { kind, limit: 100 });
    return {
      ok: true,
      assets,
      freshness: status.freshness,
      total: status.total,
      syncedAt: status.lastSyncedAt ? status.lastSyncedAt.toISOString() : null,
    };
  } catch (error) {
    return {
      ok: false,
      assets: [],
      freshness: "unavailable",
      total: 0,
      syncedAt: null,
      message: error instanceof Error ? error.message : "جست‌وجوی کاتالوگ والکس ناموفق بود.",
    };
  }
}

/** Manual re-sync. Touches the identity/price catalogue and nothing else. */
export async function refreshWallexCatalogAction(): Promise<WallexCatalogActionResult> {
  try {
    await requireRegistrationIdentity();
    const sync = await refreshWallexCatalog();
    const status = await getWallexCatalogStatusSafe();
    const assets = await searchWallexCatalog("", { limit: 100 });
    revalidatePath("/new");
    revalidatePath("/funds");
    return {
      ok: sync.status === "fresh",
      assets,
      freshness: status.freshness,
      total: status.total,
      syncedAt: status.lastSyncedAt ? status.lastSyncedAt.toISOString() : null,
      message:
        sync.status === "fresh"
          ? `کاتالوگ والکس به‌روزرسانی شد — ${sync.synced} دارایی با قیمت تومانی و تتری.`
          : "اتصال به والکس برقرار نشد؛ آخرین فهرست ذخیره‌شده نمایش داده می‌شود.",
    };
  } catch (error) {
    return {
      ok: false,
      assets: [],
      freshness: "unavailable",
      total: 0,
      syncedAt: null,
      message: error instanceof Error ? error.message : "به‌روزرسانی کاتالوگ والکس ناموفق بود.",
    };
  }
}

async function getWallexCatalogStatusSafe() {
  const { getWallexCatalogStatus } = await import("@/features/pricing/wallexCatalog");
  return getWallexCatalogStatus();
}

/**
 * Register a Wallex identity plus the tenant-owned asset account.
 *
 * Mirrors `registerMarketAssetAction` exactly in what it does NOT do: no
 * transaction, no journal entry, no posting, no FIFO lot, no balance. The
 * account opens at zero and the existing purchase flow stays the only path
 * that touches accounting.
 *
 * The identity is taken from the PERSISTED catalogue, never from the caller's
 * strings: a client that could supply a name and a symbol could mis-map a
 * holding onto the wrong asset. The symbol is the only thing it chooses, and
 * it must already exist in a catalogue synced from the exchange.
 */
export async function registerWallexAssetAction(
  symbol: string,
): Promise<RegisterMarketAssetResult> {
  try {
    const user = await requireRegistrationIdentity();
    await ensureWallexCatalog();

    const entry = await getWallexAsset(symbol);
    if (!entry) throw new Error("این دارایی در کاتالوگ والکس یافت نشد.");

    // Tokenised metal lands in the gold class, a stablecoin in its own, so a
    // portfolio's allocation chart reads correctly the moment it is bought.
    const classSeed =
      entry.kind === "gold"
        ? { code: "gold", name: "طلا", color: "#363850", sortOrder: 4 }
        : entry.kind === "stablecoin"
          ? { code: "stable", name: "استیبل‌کوین", color: "#9aa3c7", sortOrder: 2 }
          : { code: "crypto", name: "رمزارز", color: "#c9cafa", sortOrder: 3 };

    let [assetClass] = await db
      .select()
      .from(assetClasses)
      .where(eq(assetClasses.code, classSeed.code))
      .limit(1);
    if (!assetClass) {
      [assetClass] = await db
        .insert(assetClasses)
        .values(classSeed)
        .onConflictDoNothing({ target: assetClasses.code })
        .returning();
      if (!assetClass) {
        [assetClass] = await db
          .select()
          .from(assetClasses)
          .where(eq(assetClasses.code, classSeed.code))
          .limit(1);
      }
    }
    if (!assetClass) throw new Error("کلاس دارایی قابل ایجاد نیست.");

    const [existing] = await db.select().from(assets).where(eq(assets.symbol, entry.symbol)).limit(1);
    let asset = existing;
    if (asset) {
      // An asset already priced by CoinGecko keeps that pricing method — the
      // valuation layer knows how to read it, and switching a held asset's
      // price source is not a side effect a registration may cause.
      [asset] = await db
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
      [asset] = await db
        .insert(assets)
        .values({
          symbol: entry.symbol,
          name: entry.displayName,
          classId: assetClass.id,
          decimals: 8,
          pricingMethod: "manual",
          priceSource: "wallex",
          logoUrl: entry.logoUrl,
        })
        .returning();
    }
    if (!asset) throw new Error("ثبت شناسه دارایی ناموفق بود.");

    const ownership = user ? eq(accounts.userId, user.id) : sql`${accounts.userId} is null`;
    let [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.assetId, asset.id), eq(accounts.type, "asset"), ownership))
      .limit(1);

    if (!account) {
      const codeBase = `WLX-${entry.symbol}`.toUpperCase().replace(/[^A-Z0-9-]/g, "-").slice(0, 48);
      [account] = await db
        .insert(accounts)
        .values({
          userId: user?.id ?? null,
          code: codeBase,
          name: `${entry.displayName} (${entry.symbol})`,
          type: "asset",
          assetId: asset.id,
          isActive: true,
        })
        .onConflictDoNothing()
        .returning();
      if (!account) {
        [account] = await db
          .select()
          .from(accounts)
          .where(and(eq(accounts.assetId, asset.id), eq(accounts.type, "asset"), ownership))
          .limit(1);
      }
    }
    if (!account) throw new Error("ایجاد حساب دارایی ناموفق بود.");

    revalidatePath("/new");
    revalidatePath("/portfolio");
    revalidatePath("/crypto");
    return {
      ok: true,
      message: `${entry.displayName} (${entry.symbol}) ثبت شد؛ اکنون خرید را با مقدار و قیمت واقعی تکمیل کنید.`,
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
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "ثبت دارایی ناموفق بود." };
  }
}
