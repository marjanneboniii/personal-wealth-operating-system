"use server";

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { accounts, assetClasses, assets, coingeckoAssetCatalog, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  getMarketCatalogStatus,
  listCoinGeckoCatalog,
  refreshCoinGeckoCatalog,
} from "@/features/pricing/catalog";

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
    const normalizedId = coingeckoId.trim();
    const [catalog] = await db
      .select()
      .from(coingeckoAssetCatalog)
      .where(and(
        eq(coingeckoAssetCatalog.coingeckoId, normalizedId),
        eq(coingeckoAssetCatalog.isActive, true),
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
          color: "#a78bfa",
          sortOrder: 3,
        })
        .onConflictDoNothing({ target: assetClasses.code })
        .returning();
      if (!assetClass) {
        [assetClass] = await db.select().from(assetClasses).where(eq(assetClasses.code, classCode)).limit(1);
      }
    }
    if (!assetClass) throw new Error("کلاس دارایی قابل ایجاد نیست.");

    let [asset] = await db.select().from(assets).where(eq(assets.coingeckoId, normalizedId)).limit(1);
    if (!asset) {
      const [symbolCollision] = await db.select().from(assets).where(eq(assets.symbol, catalog.symbol)).limit(1);
      if (symbolCollision?.coingeckoId && symbolCollision.coingeckoId !== normalizedId) {
        throw new Error("این نماد قبلاً به یک شناسه متفاوت CoinGecko متصل شده است.");
      }
      if (symbolCollision) {
        [asset] = await db
          .update(assets)
          .set({
            name: catalog.name,
            classId: assetClass.id,
            pricingMethod: "coingecko",
            priceSource: "coingecko",
            coingeckoId: normalizedId,
            logoUrl: catalog.logoUrl,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(assets.id, symbolCollision.id))
          .returning();
      } else {
        [asset] = await db
          .insert(assets)
          .values({
            symbol: catalog.symbol,
            name: catalog.name,
            classId: assetClass.id,
            decimals: 8,
            pricingMethod: "coingecko",
            priceSource: "coingecko",
            coingeckoId: normalizedId,
            logoUrl: catalog.logoUrl,
          })
          .returning();
      }
    } else if (asset.logoUrl !== catalog.logoUrl || asset.pricingMethod !== "coingecko") {
      [asset] = await db
        .update(assets)
        .set({
          name: catalog.name,
          logoUrl: catalog.logoUrl,
          pricingMethod: "coingecko",
          priceSource: "coingecko",
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(assets.id, asset.id))
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
      const codeBase = `MKT-${catalog.symbol}-${catalog.coingeckoId}`
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, "-")
        .slice(0, 48);
      [account] = await db
        .insert(accounts)
        .values({
          userId: user?.id ?? null,
          code: codeBase,
          name: `${catalog.name} (${catalog.symbol})`,
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
      message: `${catalog.symbol} با لوگوی CoinGecko ثبت شد؛ اکنون خرید یا فروش را تکمیل کنید.`,
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
  logoUrl: string;
};

export type SearchMarketCatalogResult = {
  ok: boolean;
  assets: MarketCatalogEntry[];
  /** Whether the catalog only holds the offline bootstrap identities. */
  bootstrapOnly: boolean;
  total: number;
  message?: string;
};

function toEntry(row: {
  coingeckoId: string;
  symbol: string;
  name: string;
  logoUrl: string;
}): MarketCatalogEntry {
  return {
    coingeckoId: row.coingeckoId,
    symbol: row.symbol,
    name: row.name,
    logoUrl: row.logoUrl,
  };
}

/**
 * Server-side search over the full CoinGecko identity catalog (crypto + RWA).
 * The picker no longer depends on the slice that was shipped with the page,
 * so every synced identity — not just the first few — is reachable.
 */
export async function searchMarketCatalogAction(
  query: string,
): Promise<SearchMarketCatalogResult> {
  try {
    await requireRegistrationIdentity();
    const rows = await listCoinGeckoCatalog(query, 100);
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
    const rows = await listCoinGeckoCatalog("", 100);
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
