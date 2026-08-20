"use server";

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { accounts, assetClasses, assets, coingeckoAssetCatalog, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  getMarketCatalogStatus,
  listPricedCoinGeckoCatalog,
  refreshCoinGeckoCatalog,
  type PricedCoinGeckoCatalogEntry,
} from "@/features/pricing/catalog";
import { getSupportedCryptoByCoinGeckoId } from "@/features/pricing/supportedAssets";
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
  const [authEnabled] = await db
    .select({ id: users.id })
    .from(users)
    .where(isNotNull(users.username))
    .limit(1);
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
