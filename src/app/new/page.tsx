import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { ensureAuth } from "@/lib/authGuard";
import { db } from "@/db";
import { accounts, assets } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { PageHeader } from "@/components/ui/Card";
import TransactionForm from "@/components/forms/TransactionForm";
import { todayIso } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
import { listDebts } from "@/features/planning/service";
import { ensureCategoryCatalog, listCategoryTree } from "@/features/categories/service";
import {
  ensureCoinGeckoCatalog,
  getMarketCatalogStatus,
  listPricedCoinGeckoCatalog,
} from "@/features/pricing/catalog";

export const dynamic = "force-dynamic";

type TxType = "expense" | "income" | "transfer" | "buy" | "sell" | "debt_repayment";
const VALID: TxType[] = ["expense", "income", "transfer", "buy", "sell", "debt_repayment"];

export default async function NewTransactionPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; debtId?: string; installmentId?: string; irtAmount?: string; title?: string; entryDate?: string }>;
}) {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id ?? null;
  await seedIfEmpty();
  await ensureCoinGeckoCatalog();
  const params = await searchParams;
  const defaultType = VALID.includes(params.type as TxType) ? (params.type as TxType) : "expense";

  const sharedAccountingCodes = [
    "3000", "3010", "3200", "4000", "4010", "4100", "4900",
    "5000", "5010", "5020", "5030", "5040", "5050", "5900",
  ];
  const [rows, fxSnap, debts, marketAssets, categoryTree] = await Promise.all([
    db
      .select({
        id: accounts.id,
        code: accounts.code,
        name: accounts.name,
        type: accounts.type,
        symbol: assets.symbol,
        decimals: assets.decimals,
        logoUrl: assets.logoUrl,
        coingeckoId: assets.coingeckoId,
      })
      .from(accounts)
      .leftJoin(assets, eq(assets.id, accounts.assetId))
      .where(and(
        sql`${accounts.deletedAt} is null and ${accounts.assetId} is not null`,
        userId
          ? or(
              eq(accounts.userId, userId),
              and(isNull(accounts.userId), inArray(accounts.code, sharedAccountingCodes)),
            )
          : sql`1=1`,
      ))
      .orderBy(asc(accounts.code)),
    getLatestUsdIrtRate(),
    listDebts(userId ?? undefined),
    listPricedCoinGeckoCatalog("", 500),
    ensureCategoryCatalog().then(() => listCategoryTree(userId ?? undefined)),
  ]);
  const catalogStatus = await getMarketCatalogStatus();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="ثبت تراکنش" subtitle="پول از کجا آمده و به کجا رفته را ثبت کنید. پیش‌نمایش قبل از تأیید فقط نمایشی است." />
      <TransactionForm
        accounts={rows.map((r) => ({ ...r, decimals: r.decimals ?? 2 }))}
        categories={categoryTree.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          children: p.children.map((c) => ({
            id: c.id,
            code: c.code,
            name: c.name,
            nature: c.nature,
            description: c.description,
          })),
        }))}
        marketAssets={marketAssets.map((asset) => ({
          coingeckoId: asset.coingeckoId,
          symbol: asset.symbol,
          name: asset.name,
          displayName: asset.displayName,
          logoUrl: asset.logoUrl,
          priceUsd: asset.priceUsd,
          priceFreshness: asset.priceFreshness,
          priceFailureCode: asset.priceFailureCode,
          priceObservedAt: asset.priceObservedAt,
        }))}
        marketCatalogStatus={{
          total: catalogStatus.total,
          crypto: catalogStatus.crypto,
          bootstrapOnly: catalogStatus.usingOfflineFloor,
        }}
        debts={debts as any}
        defaultType={defaultType}
        today={todayIso()}
        initialRate={fxSnap.rate}
        initialRateDate={fxSnap.effectiveDate}
        initialRateSource={fxSnap.source}
        initialDebtId={params.debtId}
        initialInstallmentId={params.installmentId}
        initialIrtAmount={params.irtAmount}
        initialTitle={params.title}
        initialEntryDate={params.entryDate}
      />
    </div>
  );
}
