import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assetClasses,
  assets,
  currencies,
  portfolioSnapshots,
  portfolioValuations,
  realEstateProperties,
  rwaOwnershipRecords,
  rwaValuationEvents,
  vehicleAssets,
  vehicleValuationSnapshots,
} from "@/db/schema";
import {
  getAccountBalances,
  getHoldings,
  getOpenLots,
  hasMultipleUsers,
} from "@/features/ledger/queries";
import { D, Decimal } from "@/domain/decimal";
import { todayIso } from "@/lib/format";
import { getLatestUsdIrtRateForUser } from "@/lib/fx";
import { calculateMarketValuation, valueCoinGeckoAssets } from "@/features/valuation/service";
import { calculateRoi, calculateUnrealizedPnl } from "./valuation";
import { calculateAssetAllocation } from "./allocation";
import type { AssetValuation, PortfolioSummary, ValuationBasis } from "./types";
import { REAL_ESTATE_LOGO } from "@/features/branding/persianIcons";
import { resolveAssetLogo } from "@/features/branding/assetLogo";

/**
 * Vehicle logo. `existing` is the STORED asset logo and always wins, so a
 * vehicle a user registered earlier keeps the artwork it was saved with.
 */
function logoForVehicleBrand(brand: string | null | undefined, existing?: string | null): string {
  return resolveAssetLogo({ logoUrl: existing, brandName: brand, assetType: "vehicle" });
}

/**
 * Logo for a ledger-held asset. Order is the canonical resolver order:
 * stored metadata → PersianLabs brand → CoinGecko → placeholder.
 */
function logoForSymbol(
  symbol: string,
  existing?: string | null,
  meta?: { className?: string | null; coingeckoId?: string | null; name?: string | null },
): string | null {
  return resolveAssetLogo({
    logoUrl: existing,
    symbol,
    name: meta?.name ?? null,
    className: meta?.className ?? null,
    coingeckoId: meta?.coingeckoId ?? null,
  });
}

const MARKET_CLASS_CODES = new Set([
  "crypto",
  "stable",
  "stock",
  "security",
]);

async function resolveValuationUserId(explicitUserId?: string): Promise<string | null> {
  if (explicitUserId) return explicitUserId;
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    return (await getCurrentUser())?.id ?? null;
  } catch (error: any) {
    if (error?.message?.includes("Authentication/Database error")) throw error;
    return null;
  }
}

async function historicalTomanCostByAsset(userId: string | null): Promise<Map<string, string>> {
  const response = await db.execute(sql`
    select l.asset_id as "assetId",
           sum(l.qty_remaining * l.unit_cost_base * fx.fx_rate)::text as "costToman"
    from lots l
      join assets ast on ast.id = l.asset_id
      join asset_classes ac on ac.id = ast.class_id
      join entry_fx_snapshots fx on fx.entry_id = l.open_entry_id
    where l.qty_remaining > 0
      and ast.deleted_at is null
      and not (
        ac.code = 'RWA'
        and (ast.symbol ~ '^[0-9]+$' or ast.symbol ~ '^RE-')
        and not exists (select 1 from real_estate_properties rep where rep.asset_id = ast.id)
        and not exists (select 1 from vehicle_assets va where va.asset_id = ast.id)
        and not exists (
          select 1 from rwa_ownership_records rwo
          where rwo.asset_id = ast.id and rwo.is_active = true
        )
      )
      ${userId ? sql`and l.user_id = ${userId}` : sql``}
    group by l.asset_id
  `);
  return new Map((response.rows as Array<{ assetId: string; costToman: string }>).map((row) => [row.assetId, row.costToman]));
}

/**
 * Real assets (property / vehicle / generic RWA) that live in their own
 * registry tables but have no remaining ledger quantity. Overlay is READ ONLY:
 * it never posts, never opens lots, and never rewrites cost basis.
 */
async function loadUnheldRealAssets(input: {
  userId: string | null;
  fxRate: string;
  alreadyHeld: Set<string>;
}): Promise<AssetValuation[]> {
  const { userId, fxRate, alreadyHeld } = input;
  const extras: AssetValuation[] = [];
  const seen = new Set(alreadyHeld);

  const push = (row: AssetValuation) => {
    if (seen.has(row.assetId)) return;
    if (!D(row.currentValue).abs().gt("0.00000001") && !D(row.costBasis).abs().gt("0.00000001")) return;
    seen.add(row.assetId);
    extras.push(row);
  };

  const propertyRows = await db
    .select({
      assetId: realEstateProperties.assetId,
      symbol: assets.symbol,
      name: assets.name,
      logoUrl: assets.logoUrl,
      decimals: assets.decimals,
      className: assetClasses.name,
      classColor: assetClasses.color,
      currentValueUsd: realEstateProperties.currentValueUsd,
      currentValueToman: realEstateProperties.currentValueToman,
      purchaseValueUsd: realEstateProperties.purchaseValueUsd,
      purchasePriceToman: realEstateProperties.purchasePriceToman,
      valuationDate: realEstateProperties.valuationDate,
    })
    .from(realEstateProperties)
    .innerJoin(assets, eq(assets.id, realEstateProperties.assetId))
    .innerJoin(assetClasses, eq(assetClasses.id, assets.classId))
    .where(and(
      isNull(assets.deletedAt),
      userId ? eq(realEstateProperties.userId, userId) : sql`1=1`,
    ));

  for (const row of propertyRows) {
    const currentValue = row.currentValueUsd?.toString()
      ?? (row.currentValueToman && D(fxRate).gt(0) ? D(row.currentValueToman).div(fxRate).toString() : "0");
    const currentValueToman = row.currentValueToman
      ? D(row.currentValueToman).toFixed(0)
      : D(currentValue).mul(fxRate).toFixed(0);
    const costBasis = row.purchaseValueUsd?.toString() ?? currentValue;
    const historicalCostToman = row.purchasePriceToman ? D(row.purchasePriceToman).toFixed(0) : null;
    push({
      assetId: row.assetId,
      symbol: row.symbol,
      name: row.name,
      logoUrl: row.logoUrl ?? REAL_ESTATE_LOGO,
      className: row.className,
      classColor: row.classColor,
      decimals: row.decimals,
      quantity: "1",
      marketPrice: currentValue,
      marketCurrencyCode: "USD",
      currentValue,
      currentValueToman,
      costBasis,
      historicalCostToman,
      unrealizedPnl: calculateUnrealizedPnl(currentValue, costBasis),
      unrealizedPnlToman: historicalCostToman
        ? D(currentValueToman).sub(historicalCostToman).toFixed(0)
        : D(calculateUnrealizedPnl(currentValue, costBasis)).mul(fxRate).toFixed(0),
      roiPercentage: calculateRoi(currentValue, costBasis),
      sharePercentage: "0",
      valuationBasis: "manual_real_asset",
      priceFreshness: "fresh",
      priceObservedAt: row.valuationDate ? `${row.valuationDate}T00:00:00.000Z` : null,
    });
  }

  const vehicleRows = await db
    .select({
      vehicleId: vehicleAssets.id,
      assetId: vehicleAssets.assetId,
      catalogId: vehicleAssets.catalogId,
      symbol: assets.symbol,
      name: assets.name,
      logoUrl: assets.logoUrl,
      decimals: assets.decimals,
      className: assetClasses.name,
      classColor: assetClasses.color,
      status: vehicleAssets.status,
      brand: vehicleAssets.brand,
      purchaseValueUsd: vehicleAssets.purchaseValueUsd,
      purchasePriceToman: vehicleAssets.purchasePriceToman,
    })
    .from(vehicleAssets)
    .innerJoin(assets, eq(assets.id, vehicleAssets.assetId))
    .innerJoin(assetClasses, eq(assetClasses.id, assets.classId))
    .where(and(
      isNull(assets.deletedAt),
      userId ? eq(vehicleAssets.userId, userId) : sql`1=1`,
      sql`coalesce(${vehicleAssets.status}, 'active') <> 'sold'`,
    ));

  const vehicleIds = vehicleRows.map((row) => row.vehicleId);
  const snapshotRows = vehicleIds.length
    ? await db
        .select()
        .from(vehicleValuationSnapshots)
        .where(inArray(vehicleValuationSnapshots.userVehicleId, vehicleIds))
        .orderBy(desc(vehicleValuationSnapshots.snapshotDate), desc(vehicleValuationSnapshots.createdAt))
    : [];
  const latestByVehicle = new Map<string, (typeof snapshotRows)[number]>();
  for (const snap of snapshotRows) {
    if (snap.userVehicleId && !latestByVehicle.has(snap.userVehicleId)) {
      latestByVehicle.set(snap.userVehicleId, snap);
    }
  }

  for (const row of vehicleRows) {
    const snap = latestByVehicle.get(row.vehicleId);
    const currentValue = snap?.currentValueUsd?.toString()
      ?? row.purchaseValueUsd?.toString()
      ?? "0";
    const currentValueToman = snap?.currentValueToman
      ? D(snap.currentValueToman).toFixed(0)
      : row.purchasePriceToman
        ? D(row.purchasePriceToman).toFixed(0)
        : D(currentValue).mul(fxRate).toFixed(0);
    const costBasis = row.purchaseValueUsd?.toString() ?? currentValue;
    const historicalCostToman = row.purchasePriceToman ? D(row.purchasePriceToman).toFixed(0) : null;
    push({
      assetId: row.assetId,
      symbol: row.symbol,
      name: row.name,
      logoUrl: logoForVehicleBrand(row.brand, row.logoUrl),
      className: row.className,
      classColor: row.classColor,
      decimals: row.decimals,
      quantity: "1",
      marketPrice: currentValue,
      marketCurrencyCode: "USD",
      currentValue,
      currentValueToman,
      costBasis,
      historicalCostToman,
      unrealizedPnl: calculateUnrealizedPnl(currentValue, costBasis),
      unrealizedPnlToman: historicalCostToman
        ? D(currentValueToman).sub(historicalCostToman).toFixed(0)
        : D(calculateUnrealizedPnl(currentValue, costBasis)).mul(fxRate).toFixed(0),
      roiPercentage: calculateRoi(currentValue, costBasis),
      sharePercentage: "0",
      valuationBasis: "manual_real_asset",
      priceFreshness: snap ? "fresh" : "unavailable",
      priceObservedAt: snap?.snapshotDate ? `${snap.snapshotDate}T00:00:00.000Z` : null,
    });
  }

  const ownershipRows = await db
    .select({
      assetId: rwaOwnershipRecords.assetId,
      symbol: assets.symbol,
      name: assets.name,
      logoUrl: assets.logoUrl,
      decimals: assets.decimals,
      className: assetClasses.name,
      classColor: assetClasses.color,
      purchaseToman: rwaOwnershipRecords.acquisitionPriceIRR,
    })
    .from(rwaOwnershipRecords)
    .innerJoin(assets, eq(assets.id, rwaOwnershipRecords.assetId))
    .innerJoin(assetClasses, eq(assetClasses.id, assets.classId))
    .where(and(
      isNull(assets.deletedAt),
      eq(rwaOwnershipRecords.isActive, true),
      userId ? eq(rwaOwnershipRecords.userId, userId) : sql`1=1`,
    ));

  const ownedIds = ownershipRows.map((row) => row.assetId).filter((id) => !seen.has(id));
  const genericValuationRows = ownedIds.length
    ? await db
        .select()
        .from(rwaValuationEvents)
        .where(and(
          inArray(rwaValuationEvents.assetId, ownedIds),
          userId ? eq(rwaValuationEvents.userId, userId) : sql`1=1`,
        ))
        .orderBy(desc(rwaValuationEvents.valuationDate), desc(rwaValuationEvents.createdAt))
    : [];
  const latestGeneric = new Map<string, (typeof genericValuationRows)[number]>();
  for (const row of genericValuationRows) {
    if (!latestGeneric.has(row.assetId)) latestGeneric.set(row.assetId, row);
  }

  for (const row of ownershipRows) {
    const generic = latestGeneric.get(row.assetId);
    const purchaseToman = row.purchaseToman ? D(row.purchaseToman).toFixed(0) : null;
    let currentValue = "0";
    let currentValueToman = purchaseToman ?? "0";
    if (generic?.priceUSD) {
      currentValue = D(generic.priceUSD).toString();
      currentValueToman = generic.priceIRR
        ? D(generic.priceIRR).toFixed(0)
        : D(currentValue).mul(fxRate).toFixed(0);
    } else if (generic?.priceIRR) {
      currentValueToman = D(generic.priceIRR).toFixed(0);
      currentValue = D(fxRate).gt(0) ? D(currentValueToman).div(fxRate).toString() : "0";
    } else if (purchaseToman && D(fxRate).gt(0)) {
      currentValue = D(purchaseToman).div(fxRate).toString();
      currentValueToman = purchaseToman;
    }
    const costBasis = purchaseToman && D(fxRate).gt(0) ? D(purchaseToman).div(fxRate).toString() : currentValue;
    push({
      assetId: row.assetId,
      symbol: row.symbol,
      name: row.name,
      logoUrl: row.logoUrl ?? null,
      className: row.className,
      classColor: row.classColor,
      decimals: row.decimals,
      quantity: "1",
      marketPrice: currentValue,
      marketCurrencyCode: "USD",
      currentValue,
      currentValueToman,
      costBasis,
      historicalCostToman: purchaseToman,
      unrealizedPnl: calculateUnrealizedPnl(currentValue, costBasis),
      unrealizedPnlToman: purchaseToman
        ? D(currentValueToman).sub(purchaseToman).toFixed(0)
        : "0",
      roiPercentage: calculateRoi(currentValue, costBasis),
      sharePercentage: "0",
      valuationBasis: "manual_real_asset",
      priceFreshness: generic ? "fresh" : "unavailable",
      priceObservedAt: generic?.valuationDate ? `${generic.valuationDate}T00:00:00.000Z` : null,
    });
  }

  return extras;
}

/**
 * Complete current Portfolio Valuation.
 *
 * Accounting is READ ONLY: holdings, quantities, FIFO lots, cost basis and
 * balances are consumed through existing query primitives. This service has
 * no journal/posting/lot/account mutation path.
 *
 * FAIL-CLOSED (multi-user isolation): with no resolvable identity in a
 * multi-tenant database the valuation returns an EMPTY summary — it never
 * degrades to a global (tenant-blending) read via `WHERE 1=1`.
 */
export async function getPortfolioValuation(
  valuationDate = todayIso(),
  explicitUserId?: string,
): Promise<PortfolioSummary> {
  const userId = await resolveValuationUserId(explicitUserId);
  if (!userId && (await hasMultipleUsers())) {
    return {
      totalNetWorth: "0",
      totalNetWorthToman: "0",
      totalCostBasis: "0",
      totalUnrealizedPnl: "0",
      totalUnrealizedPnlToman: "0",
      overallRoiPercentage: "0",
      assetValuations: [],
      allocationByClass: [],
      valuationDate,
      baseCurrencyCode: "USD",
      currentFxRate: "0",
      priceStatus: { fresh: 0, stale: 0, unavailable: 0 },
    };
  }

  const [holdings, openLots, balances, fx, historicalTomanCosts] = await Promise.all([
    getHoldings(userId ?? undefined),
    getOpenLots(undefined, userId ?? undefined),
    getAccountBalances(userId ?? undefined),
    getLatestUsdIrtRateForUser(userId),
    historicalTomanCostByAsset(userId),
  ]);

  void balances;

  const activeHoldings = holdings.filter((holding) => D(holding.quantity).abs().gt("0.00000001"));
  const assetIds = activeHoldings.map((holding) => holding.assetId);

  const metadataRows = assetIds.length
    ? await db
        .select({
          assetId: assets.id,
          pricingMethod: assets.pricingMethod,
          coingeckoId: assets.coingeckoId,
          logoUrl: assets.logoUrl,
          classCode: assetClasses.code,
        })
        .from(assets)
        .innerJoin(assetClasses, eq(assetClasses.id, assets.classId))
        .where(inArray(assets.id, assetIds))
    : [];
  const metadata = new Map(metadataRows.map((row) => [row.assetId, row]));

  const realEstateRows = assetIds.length
    ? await db
        .select({
          assetId: realEstateProperties.assetId,
          currentValueUsd: realEstateProperties.currentValueUsd,
          currentValueToman: realEstateProperties.currentValueToman,
          purchasePriceToman: realEstateProperties.purchasePriceToman,
          valuationDate: realEstateProperties.valuationDate,
        })
        .from(realEstateProperties)
        .where(and(
          inArray(realEstateProperties.assetId, assetIds),
          userId ? eq(realEstateProperties.userId, userId) : sql`1=1`,
        ))
    : [];
  const realEstate = new Map(realEstateRows.map((row) => [row.assetId, row]));

  const genericOwnershipRows = assetIds.length
    ? await db
        .select({
          assetId: rwaOwnershipRecords.assetId,
          purchaseToman: rwaOwnershipRecords.acquisitionPriceIRR,
        })
        .from(rwaOwnershipRecords)
        .where(and(
          inArray(rwaOwnershipRecords.assetId, assetIds),
          eq(rwaOwnershipRecords.isActive, true),
          userId ? eq(rwaOwnershipRecords.userId, userId) : sql`1=1`,
        ))
    : [];
  const genericPurchaseToman = new Map(genericOwnershipRows.map((row) => [row.assetId, row.purchaseToman?.toString() ?? null]));

  const genericValuationRows = assetIds.length
    ? await db
        .select()
        .from(rwaValuationEvents)
        .where(and(
          inArray(rwaValuationEvents.assetId, assetIds),
          userId ? eq(rwaValuationEvents.userId, userId) : sql`1=1`,
        ))
        .orderBy(desc(rwaValuationEvents.valuationDate), desc(rwaValuationEvents.createdAt))
    : [];
  const latestGenericValuation = new Map<string, (typeof genericValuationRows)[number]>();
  for (const row of genericValuationRows) {
    if (!latestGenericValuation.has(row.assetId)) latestGenericValuation.set(row.assetId, row);
  }

  const costBasisByAsset = new Map<string, string>();
  for (const holding of activeHoldings) {
    const assetLots = openLots.filter((lot) => lot.assetId === holding.assetId);
    const cost = assetLots.length
      ? assetLots.reduce((sum, lot) => sum.add(D(lot.qtyRemaining).mul(lot.unitCostBase)), Decimal.zero())
      : D(holding.costBase);
    costBasisByAsset.set(holding.assetId, cost.toString());
  }

  const marketInputs = activeHoldings.flatMap((holding) => {
    const meta = metadata.get(holding.assetId);
    if (!meta?.coingeckoId || meta.pricingMethod !== "coingecko") return [];
    return [{
      assetId: holding.assetId,
      symbol: holding.symbol,
      coingeckoId: meta.coingeckoId,
      quantity: holding.quantity,
      costBasisUsd: costBasisByAsset.get(holding.assetId) ?? holding.costBase,
      currentTomanPerUsd: fx.rate,
      historicalCostToman: historicalTomanCosts.get(holding.assetId) ?? null,
    }];
  });
  const marketValuations = await valueCoinGeckoAssets(marketInputs);

  let totalNetWorth = Decimal.zero();
  let totalNetWorthToman = Decimal.zero();
  let totalCostBasis = Decimal.zero();
  let totalUnrealizedPnl = Decimal.zero();
  let totalUnrealizedPnlToman = Decimal.zero();
  const assetValuations: AssetValuation[] = [];

  for (const holding of activeHoldings) {
    const qty = D(holding.quantity);
    const costBasis = costBasisByAsset.get(holding.assetId) ?? holding.costBase;
    const meta = metadata.get(holding.assetId);
    const market = marketValuations.get(holding.assetId);
    const property = realEstate.get(holding.assetId);
    const generic = latestGenericValuation.get(holding.assetId);
    const isMarketClass = !!meta && MARKET_CLASS_CODES.has(meta.classCode.toLowerCase());

    let marketPrice = "0";
    let currentValue = costBasis;
    let currentValueToman = D(costBasis).mul(fx.rate).toFixed(0);
    let historicalCostToman = historicalTomanCosts.get(holding.assetId) ?? null;
    let unrealizedPnl = "0";
    let unrealizedPnlToman = "0";
    let valuationBasis: ValuationBasis = "cost_basis_fallback";
    let priceFreshness: AssetValuation["priceFreshness"] = "unavailable";
    let priceObservedAt: string | null = null;
    let priceFailureCode: string | undefined;

    if (market) {
      marketPrice = market.currentPriceUsd ?? "0";
      currentValue = market.currentValueUsd;
      currentValueToman = market.currentValueToman;
      historicalCostToman = market.historicalCostToman;
      unrealizedPnl = market.unrealizedPnlUsd;
      unrealizedPnlToman = market.unrealizedPnlToman;
      valuationBasis = market.currentPriceUsd ? "coingecko" : "cost_basis_fallback";
      priceFreshness = market.freshness;
      priceObservedAt = market.observedAt;
      priceFailureCode = market.failureCode;
    } else if (holding.symbol === "USD") {
      // USD Balance = Z USD (canonical, fixed vs FX), Toman Valuation = Z * Rate (derived, changes)
      marketPrice = "1";
      currentValue = qty.toString();
      currentValueToman = qty.mul(fx.rate).toFixed(0);
      unrealizedPnl = D(currentValue).sub(costBasis).toString();
      unrealizedPnlToman = historicalCostToman
        ? D(currentValueToman).sub(historicalCostToman).toFixed(0)
        : D(unrealizedPnl).mul(fx.rate).toFixed(0);
      valuationBasis = "face_value";
      priceFreshness = "fresh";
    } else if (holding.symbol === "IRT" || holding.symbol === "IRR") {
      // IRT Balance = X IRT (canonical from ledger, fixed vs FX), USD Valuation = X / Rate (derived)
      const tomanQuantity = holding.symbol === "IRR" ? qty.div("10") : qty;
      currentValueToman = tomanQuantity.toFixed(0);
      currentValue = tomanQuantity.div(fx.rate).toString();
      marketPrice = qty.isZero() ? "0" : D(currentValue).div(qty).toString();
      unrealizedPnl = D(currentValue).sub(costBasis).toString();
      unrealizedPnlToman = historicalCostToman
        ? D(currentValueToman).sub(historicalCostToman).toFixed(0)
        : D(unrealizedPnl).mul(fx.rate).toFixed(0);
      valuationBasis = "face_value";
      priceFreshness = "fresh";
    } else if (property?.currentValueUsd && property.currentValueToman) {
      currentValue = property.currentValueUsd.toString();
      currentValueToman = D(property.currentValueToman).toFixed(0);
      marketPrice = qty.isZero() ? "0" : D(currentValue).div(qty).toString();
      historicalCostToman = property.purchasePriceToman ? D(property.purchasePriceToman).toFixed(0) : null;
      unrealizedPnl = calculateUnrealizedPnl(currentValue, costBasis);
      unrealizedPnlToman = historicalCostToman
        ? D(currentValueToman).sub(historicalCostToman).toFixed(0)
        : D(unrealizedPnl).mul(fx.rate).toFixed(0);
      valuationBasis = "manual_real_asset";
      priceFreshness = "fresh";
      priceObservedAt = property.valuationDate ? `${property.valuationDate}T00:00:00.000Z` : null;
    } else if (generic && (generic.priceUSD || generic.priceIRR || generic.priceBase)) {
      const unitUsd = generic.priceUSD?.toString() ?? generic.priceBase?.toString() ?? null;
      if (unitUsd) {
        const calculated = calculateMarketValuation({
          quantity: qty.toString(),
          currentPriceUsd: unitUsd,
          costBasisUsd: costBasis,
          currentTomanPerUsd: fx.rate,
          historicalCostToman: genericPurchaseToman.get(holding.assetId) ?? historicalCostToman,
        });
        marketPrice = unitUsd;
        currentValue = calculated.currentValueUsd;
        currentValueToman = generic.priceIRR
          ? D(generic.priceIRR).mul(qty).toFixed(0)
          : calculated.currentValueToman;
        historicalCostToman = calculated.historicalCostToman;
        unrealizedPnl = calculated.unrealizedPnlUsd;
        unrealizedPnlToman = historicalCostToman
          ? D(currentValueToman).sub(historicalCostToman).toFixed(0)
          : calculated.unrealizedPnlToman;
      } else if (generic.priceIRR) {
        currentValueToman = D(generic.priceIRR).mul(qty).toFixed(0);
        currentValue = D(currentValueToman).div(fx.rate).toString();
        marketPrice = D(currentValue).div(qty).toString();
        historicalCostToman = genericPurchaseToman.get(holding.assetId) ?? historicalCostToman;
        unrealizedPnl = D(currentValue).sub(costBasis).toString();
        unrealizedPnlToman = historicalCostToman ? D(currentValueToman).sub(historicalCostToman).toFixed(0) : "0";
      }
      valuationBasis = "manual_real_asset";
      priceFreshness = "fresh";
      priceObservedAt = `${generic.valuationDate}T00:00:00.000Z`;
    } else if (!isMarketClass && holding.price && D(holding.price).gt(0)) {
      marketPrice = holding.price;
      const calculated = calculateMarketValuation({
        quantity: qty.toString(),
        currentPriceUsd: marketPrice,
        costBasisUsd: costBasis,
        currentTomanPerUsd: fx.rate,
        historicalCostToman,
      });
      currentValue = calculated.currentValueUsd;
      currentValueToman = calculated.currentValueToman;
      unrealizedPnl = calculated.unrealizedPnlUsd;
      unrealizedPnlToman = calculated.unrealizedPnlToman;
      valuationBasis = meta?.pricingMethod === "face_value" ? "face_value" : "manual_reference";
      priceFreshness = "fresh";
    }

    totalNetWorth = totalNetWorth.add(currentValue);
    totalNetWorthToman = totalNetWorthToman.add(currentValueToman);
    totalCostBasis = totalCostBasis.add(costBasis);
    totalUnrealizedPnl = totalUnrealizedPnl.add(unrealizedPnl);
    totalUnrealizedPnlToman = totalUnrealizedPnlToman.add(unrealizedPnlToman);

    assetValuations.push({
      assetId: holding.assetId,
      symbol: holding.symbol,
      name: holding.name,
      logoUrl: meta?.logoUrl ?? null,
      className: holding.className,
      classColor: holding.classColor,
      decimals: holding.decimals,
      quantity: qty.toString(),
      marketPrice,
      marketCurrencyCode: "USD",
      currentValue,
      currentValueToman,
      costBasis,
      historicalCostToman,
      unrealizedPnl,
      unrealizedPnlToman,
      roiPercentage: calculateRoi(currentValue, costBasis),
      sharePercentage: "0",
      valuationBasis,
      priceFreshness,
      priceObservedAt,
      priceFailureCode,
    });
  }

  const extras = await loadUnheldRealAssets({
    userId,
    fxRate: fx.rate,
    alreadyHeld: new Set(assetValuations.map((row) => row.assetId)),
  });
  for (const extra of extras) {
    totalNetWorth = totalNetWorth.add(extra.currentValue);
    totalNetWorthToman = totalNetWorthToman.add(extra.currentValueToman);
    totalCostBasis = totalCostBasis.add(extra.costBasis);
    totalUnrealizedPnl = totalUnrealizedPnl.add(extra.unrealizedPnl);
    totalUnrealizedPnlToman = totalUnrealizedPnlToman.add(extra.unrealizedPnlToman);
    assetValuations.push(extra);
  }

  const logoAssetIds = assetValuations.map((row) => row.assetId);
  if (logoAssetIds.length) {
    const brandRows = await db
      .select({ assetId: vehicleAssets.assetId, brand: vehicleAssets.brand })
      .from(vehicleAssets)
      .where(inArray(vehicleAssets.assetId, logoAssetIds));
    const brandByAsset = new Map(brandRows.map((row) => [row.assetId, row.brand]));
    for (const valuation of assetValuations) {
      const brand = brandByAsset.get(valuation.assetId);
      if (brand) {
        valuation.logoUrl = logoForVehicleBrand(brand, valuation.logoUrl);
      } else if (realEstate.has(valuation.assetId)) {
        valuation.logoUrl = valuation.logoUrl || REAL_ESTATE_LOGO;
      } else {
        valuation.logoUrl = logoForSymbol(valuation.symbol, valuation.logoUrl, {
          className: valuation.className,
          coingeckoId: metadata.get(valuation.assetId)?.coingeckoId ?? null,
          name: valuation.name,
        });
      }
    }
  }

  for (const valuation of assetValuations) {
    if (totalNetWorth.gt(0)) {
      valuation.sharePercentage = D(valuation.currentValue).div(totalNetWorth).mul("100").toFixed(2);
    }
  }

  const totalValue = totalNetWorth.toString();
  return {
    totalNetWorth: totalValue,
    totalNetWorthToman: totalNetWorthToman.toFixed(0),
    totalCostBasis: totalCostBasis.toString(),
    totalUnrealizedPnl: totalUnrealizedPnl.toString(),
    totalUnrealizedPnlToman: totalUnrealizedPnlToman.toFixed(0),
    overallRoiPercentage: calculateRoi(totalValue, totalCostBasis.toString()),
    assetValuations: assetValuations.sort((a, b) => Number(b.currentValue) - Number(a.currentValue)),
    allocationByClass: calculateAssetAllocation(assetValuations, totalValue),
    valuationDate,
    baseCurrencyCode: "USD",
    currentFxRate: fx.rate,
    priceStatus: {
      fresh: assetValuations.filter((row) => row.priceFreshness === "fresh").length,
      stale: assetValuations.filter((row) => row.priceFreshness === "stale").length,
      unavailable: assetValuations.filter((row) => row.priceFreshness === "unavailable").length,
    },
  };
}

/**
 * Persists a user-scoped valuation OUTPUT for historical analytics. It never
 * writes current prices into accounting or mutates holdings/cost basis.
 */
export async function createPortfolioSnapshot(
  snapshotDate = todayIso(),
  userId?: string,
): Promise<{ id: string }> {
  const valuation = await getPortfolioValuation(snapshotDate, userId);
  const [usdCurrency] = await db.select().from(currencies).where(eq(currencies.code, "USD")).limit(1);

  return db.transaction(async (tx) => {
    const [snapshot] = await tx
      .insert(portfolioSnapshots)
      .values({
        userId: userId ?? null,
        snapshotDate,
        totalPortfolioValue: valuation.totalNetWorth,
        baseCurrencyId: usdCurrency?.id ?? null,
      })
      .onConflictDoUpdate({
        target: [portfolioSnapshots.userId, portfolioSnapshots.snapshotDate],
        set: { totalPortfolioValue: valuation.totalNetWorth },
      })
      .returning();

    for (const asset of valuation.assetValuations) {
      await tx
        .insert(portfolioValuations)
        .values({
          userId: userId ?? null,
          assetId: asset.assetId,
          quantity: asset.quantity,
          marketPrice: asset.marketPrice,
          totalValue: asset.currentValue,
          valuationDate: snapshotDate,
        })
        .onConflictDoUpdate({
          target: [portfolioValuations.userId, portfolioValuations.assetId, portfolioValuations.valuationDate],
          set: {
            quantity: asset.quantity,
            marketPrice: asset.marketPrice,
            totalValue: asset.currentValue,
          },
        });
    }

    return { id: snapshot.id };
  });
}

export async function getAssetValuationDetail(assetId: string, userId?: string) {
  const summary = await getPortfolioValuation(undefined, userId);
  const asset = summary.assetValuations.find((valuation) => valuation.assetId === assetId);
  if (!asset) return null;
  return { ...asset, openLots: await getOpenLots(assetId, userId) };
}

/**
 * Current net worth is a Valuation output, not an Accounting mutation.
 * Assets from getPortfolioValuation; liabilities combine ledger + planning debts.
 *
 * FIX: Toman liabilities for debts with principalToman are FIXED (contractual),
 * USD equivalent is DYNAMIC (Toman / currentRate). No round-trip for balance.
 */
export async function getCurrentNetWorth(userId?: string) {
  const [valuation, balances, debts] = await Promise.all([
    getPortfolioValuation(undefined, userId),
    getAccountBalances(userId),
    (async () => {
      try {
        const { listDebts } = await import("@/features/planning/service");
        return await listDebts(userId);
      } catch {
        return [] as any[];
      }
    })(),
  ]);

  const rate = D(valuation.currentFxRate).gt(0) ? D(valuation.currentFxRate) : D("1");

  // Ledger liabilities
  const ledgerLiabilities = balances.filter((b) => b.type === "liability");
  const debtAccountIds = new Set(
    (debts as any[]).filter((d: any) => d.accountId).map((d: any) => d.accountId as string),
  );
  const otherLedgerLiabilities = ledgerLiabilities.filter((b) => !debtAccountIds.has(b.accountId));
  const otherLedgerUsd = otherLedgerLiabilities.reduce((sum, b) => sum.add(D(b.baseValue).neg()), Decimal.zero());
  const otherLedgerToman = otherLedgerUsd.mul(rate);

  let debtsUsd = Decimal.zero();
  let debtsToman = Decimal.zero();
  for (const d of debts as any[]) {
    const outBase = D((d as any).outstandingBase ?? "0");
    const outToman = (d as any).outstandingToman != null ? D((d as any).outstandingToman) : null;
    debtsUsd = debtsUsd.add(outBase);
    if (outToman != null) {
      debtsToman = debtsToman.add(outToman);
    } else {
      debtsToman = debtsToman.add(outBase.mul(rate));
    }
  }

  const totalLiabilitiesUsd = debts.length > 0 ? otherLedgerUsd.add(debtsUsd) : ledgerLiabilities.reduce((sum, b) => sum.add(D(b.baseValue).neg()), Decimal.zero());
  const totalLiabilitiesToman = debts.length > 0 ? otherLedgerToman.add(debtsToman) : totalLiabilitiesUsd.mul(rate);

  const liquidAssets = valuation.assetValuations.filter((asset) =>
    ["نقد و بانک", "Cash", "استیبل‌کوین", "Stablecoin"].includes(asset.className),
  );
  const liquid = liquidAssets.reduce((sum, asset) => sum.add(asset.currentValue), Decimal.zero());
  const liquidToman = liquidAssets.reduce((sum, asset) => sum.add(asset.currentValueToman), Decimal.zero());

  return {
    totalAssets: valuation.totalNetWorth,
    totalAssetsToman: valuation.totalNetWorthToman,
    totalLiabilities: totalLiabilitiesUsd.toString(),
    totalLiabilitiesToman: totalLiabilitiesToman.toFixed(0),
    netWorth: D(valuation.totalNetWorth).sub(totalLiabilitiesUsd).toString(),
    netWorthToman: D(valuation.totalNetWorthToman).sub(totalLiabilitiesToman).toFixed(0),
    liquid: liquid.toString(),
    liquidToman: liquidToman.toFixed(0),
    byClass: valuation.allocationByClass.map((group) => ({
      className: group.className,
      color: group.color,
      value: group.value,
      share: group.percentage,
    })),
    valuation,
  };
}
