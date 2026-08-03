/**
 * PWOS — Phase 2.7: External Market Data Provider Layer
 *
 * Implements external market data ingestion, normalization, caching,
 * retrieval, provider mapping, and wallet observations.
 *
 * ARCHITECTURAL GUARANTEES:
 * 1. Market Data is reference data only.
 * 2. MUST NOT modify or write to Ledger, Journal Entries, Postings, Accounts,
 *    FIFO Engine, Lot Tracking, Cost Basis Engine, or Accounting Core.
 * 3. Profit & Loss calculations remain internally calculated using recorded
 *    transactions, cost basis engine, and FIFO lot tracking.
 * 4. Wallet observations prevent double counting between blockchain balances
 *    and manually recorded transactions. Manual transactions remain the source
 *    of accounting truth.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  assetProviderMappings,
  assets,
  externalPriceHistory,
  externalProviders,
  walletObservations,
} from "@/db/schema";
import { D } from "@/domain/decimal";
import { getHoldings } from "@/features/ledger/queries";
import { todayIso } from "@/lib/format";
import { marketProviderRegistry } from "./providers";
import {
  ExternalAssetMetadata,
  ExternalPriceQuote,
  ProviderMappingDTO,
  WalletObservationInput,
  WalletObservationResult,
} from "./types";

/**
 * Ensure default external providers are seeded in the database.
 * Pure reference data operation.
 */
export async function ensureExternalProvidersInDb() {
  const defaults = [
    {
      name: "coingecko",
      displayName: "CoinGecko API",
      providerType: "crypto",
      baseUrl: "https://api.coingecko.com/api/v3",
      description: "CoinGecko public cryptocurrency & tokenized gold market data API",
    },
    {
      name: "binance",
      displayName: "Binance API",
      providerType: "crypto",
      baseUrl: "https://api.binance.com/api/v3",
      description: "Binance spot ticker market data API",
    },
    {
      name: "coinbase",
      displayName: "Coinbase API",
      providerType: "crypto",
      baseUrl: "https://api.coinbase.com/v2",
      description: "Coinbase spot price market data API",
    },
    {
      name: "mock",
      displayName: "Mock Market Data Provider",
      providerType: "crypto",
      baseUrl: "memory://mock",
      description: "Mock provider for deterministic offline testing and fallback",
    },
  ];

  for (const p of defaults) {
    await db
      .insert(externalProviders)
      .values(p)
      .onConflictDoNothing({ target: externalProviders.name });
  }

  const all = await db.select().from(externalProviders);
  return new Map(all.map((p) => [p.name, p]));
}

/**
 * List all registered external providers from database.
 */
export async function listExternalProvidersFromDb() {
  await ensureExternalProvidersInDb();
  return db.select().from(externalProviders);
}

/**
 * Create or update an asset provider mapping.
 * Maps an internal system asset to an external symbol/ID on a provider.
 *
 * CRITICAL RULE: Pure reference metadata. No ledger impact.
 */
export async function registerAssetProviderMapping(
  input: ProviderMappingDTO,
): Promise<{ id: string }> {
  const providerMap = await ensureExternalProvidersInDb();

  let providerId = input.providerId;
  if (!providerId && input.providerName) {
    const p = providerMap.get(input.providerName.toLowerCase());
    if (p) providerId = p.id;
  }
  if (!providerId) {
    const defaultP = providerMap.get("coingecko");
    providerId = defaultP?.id;
  }
  if (!providerId) {
    throw new Error("Provider ID or valid provider name is required");
  }

  const [existing] = await db
    .select()
    .from(assetProviderMappings)
    .where(
      and(
        eq(assetProviderMappings.assetId, input.assetId),
        eq(assetProviderMappings.providerId, providerId),
      ),
    );

  if (existing) {
    await db
      .update(assetProviderMappings)
      .set({
        externalSymbol: input.externalSymbol.toUpperCase(),
        externalName: input.externalName ?? existing.externalName,
        providerAssetId: input.providerAssetId ?? existing.providerAssetId,
        assetType: input.assetType ?? existing.assetType,
        logoUrl: input.logoUrl ?? existing.logoUrl,
        supportedMarkets: input.supportedMarkets ?? existing.supportedMarkets,
        metadataJson: input.metadataJson ?? existing.metadataJson,
      })
      .where(eq(assetProviderMappings.id, existing.id));
    return { id: existing.id };
  }

  const [inserted] = await db
    .insert(assetProviderMappings)
    .values({
      assetId: input.assetId,
      providerId,
      externalSymbol: input.externalSymbol.toUpperCase(),
      externalName: input.externalName,
      providerAssetId: input.providerAssetId,
      assetType: input.assetType ?? "crypto",
      logoUrl: input.logoUrl,
      supportedMarkets: input.supportedMarkets,
      metadataJson: input.metadataJson,
    })
    .returning();

  return inserted;
}

/**
 * Retrieve asset provider mapping for a given asset and provider.
 */
export async function getAssetProviderMapping(
  assetId: string,
  providerName = "coingecko",
) {
  const providerMap = await ensureExternalProvidersInDb();
  const provider = providerMap.get(providerName.toLowerCase());
  if (!provider) return null;

  const [mapping] = await db
    .select()
    .from(assetProviderMappings)
    .where(
      and(
        eq(assetProviderMappings.assetId, assetId),
        eq(assetProviderMappings.providerId, provider.id),
      ),
    );

  return mapping ?? null;
}

/**
 * Retrieve asset metadata (symbol, name, logo URL, supported markets) from DB mapping
 * or fallback to Provider Registry metadata.
 */
export async function getAssetMetadata(
  assetId: string,
  providerName = "coingecko",
): Promise<ExternalAssetMetadata | null> {
  const mapping = await getAssetProviderMapping(assetId, providerName);

  if (mapping) {
    let supportedMarkets: string[] | undefined;
    if (mapping.supportedMarkets) {
      try {
        supportedMarkets = JSON.parse(mapping.supportedMarkets);
      } catch {
        supportedMarkets = mapping.supportedMarkets.split(",").map((s) => s.trim());
      }
    }

    return {
      name: mapping.externalName ?? mapping.externalSymbol,
      symbol: mapping.externalSymbol,
      assetType: mapping.assetType,
      providerId: mapping.providerAssetId ?? mapping.externalSymbol.toLowerCase(),
      logoUrl: mapping.logoUrl ?? undefined,
      supportedMarkets,
    };
  }

  // Fallback to symbol lookup on asset table
  const [assetRow] = await db
    .select()
    .from(assets)
    .where(eq(assets.id, assetId));
  if (!assetRow) return null;

  const provider = marketProviderRegistry.getProvider(providerName);
  if (provider) {
    const meta = await provider.getAssetMetadata(assetRow.symbol);
    if (meta) return meta;
  }

  return {
    name: assetRow.name,
    symbol: assetRow.symbol,
    assetType: "crypto",
    providerId: assetRow.symbol.toLowerCase(),
  };
}

/**
 * Fetch current market price from external provider and store in price history cache.
 *
 * CRITICAL FINANCIAL INVARIANT:
 * This operation ONLY writes to external_price_history (valuation reference layer).
 * It NEVER modifies or writes to:
 * - Ledger (journal_entries, postings)
 * - Accounts
 * - FIFO Engine / Lot Tracking (lots, lot_consumptions)
 * - Cost Basis Engine
 */
export async function fetchAndCacheCurrentPrice(
  assetId: string,
  providerName = "coingecko",
  currency = "USD",
  symbolOverride?: string,
): Promise<{ quote: ExternalPriceQuote | null; cached: boolean }> {
  const providerMap = await ensureExternalProvidersInDb();
  const providerRow = providerMap.get(providerName.toLowerCase());
  if (!providerRow) {
    throw new Error(`External provider not found: ${providerName}`);
  }

  let symbol = symbolOverride;
  if (!symbol) {
    const mapping = await getAssetProviderMapping(assetId, providerName);
    if (mapping) {
      symbol = mapping.providerAssetId ?? mapping.externalSymbol;
    } else {
      const [assetRow] = await db
        .select()
        .from(assets)
        .where(eq(assets.id, assetId));
      if (!assetRow) {
        throw new Error(`Asset not found: ${assetId}`);
      }
      symbol = assetRow.symbol;
    }
  }

  const quote = await marketProviderRegistry.getCurrentPriceQuote(
    symbol,
    providerName,
    currency,
  );
  if (!quote) {
    return { quote: null, cached: false };
  }

  const today = todayIso();
  const decPrice = D(quote.price).toString();

  // Upsert into external_price_history
  await db
    .insert(externalPriceHistory)
    .values({
      assetId,
      providerId: providerRow.id,
      price: decPrice,
      currency: currency.toUpperCase(),
      asOfDate: today,
      isCurrent: true,
      rawResponse: quote.rawResponse,
    })
    .onConflictDoUpdate({
      target: [
        externalPriceHistory.assetId,
        externalPriceHistory.providerId,
        externalPriceHistory.asOfDate,
        externalPriceHistory.currency,
      ],
      set: {
        price: decPrice,
        timestamp: new Date(),
        isCurrent: true,
        rawResponse: quote.rawResponse,
      },
    });

  return { quote: { ...quote, price: decPrice }, cached: true };
}

/**
 * Retrieve current price quote for an asset.
 * First inspects cached external_price_history for today's date; if missing, fetches from API.
 */
export async function getCurrentPriceQuote(
  assetId: string,
  providerName = "coingecko",
  currency = "USD",
): Promise<ExternalPriceQuote | null> {
  const providerMap = await ensureExternalProvidersInDb();
  const providerRow = providerMap.get(providerName.toLowerCase());
  if (!providerRow) return null;

  const today = todayIso();
  const [cached] = await db
    .select()
    .from(externalPriceHistory)
    .where(
      and(
        eq(externalPriceHistory.assetId, assetId),
        eq(externalPriceHistory.providerId, providerRow.id),
        eq(externalPriceHistory.asOfDate, today),
        eq(externalPriceHistory.currency, currency.toUpperCase()),
        eq(externalPriceHistory.isCurrent, true),
      ),
    )
    .orderBy(desc(externalPriceHistory.timestamp))
    .limit(1);

  if (cached) {
    const [assetRow] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, assetId));
    return {
      provider: providerRow.name,
      symbol: assetRow?.symbol ?? "",
      price: D(cached.price).toString(),
      currency: cached.currency,
      timestamp: cached.timestamp.toISOString(),
      asOfDate: cached.asOfDate,
      sourceType: "cache",
      rawResponse: cached.rawResponse ?? undefined,
    };
  }

  const { quote } = await fetchAndCacheCurrentPrice(
    assetId,
    providerName,
    currency,
  );
  return quote;
}

/**
 * Fetch and cache historical price quote for an asset as of a specific date (YYYY-MM-DD).
 *
 * CRITICAL RULE: Historical prices are reference valuation data.
 * Never modifies journal entries, postings, accounts, lots, or lot consumptions.
 */
export async function fetchAndCacheHistoricalPrice(
  assetId: string,
  asOfDate: string,
  providerName = "coingecko",
  currency = "USD",
  symbolOverride?: string,
): Promise<{ quote: ExternalPriceQuote | null; cached: boolean }> {
  const providerMap = await ensureExternalProvidersInDb();
  const providerRow = providerMap.get(providerName.toLowerCase());
  if (!providerRow) {
    throw new Error(`External provider not found: ${providerName}`);
  }

  let symbol = symbolOverride;
  if (!symbol) {
    const mapping = await getAssetProviderMapping(assetId, providerName);
    if (mapping) {
      symbol = mapping.providerAssetId ?? mapping.externalSymbol;
    } else {
      const [assetRow] = await db
        .select()
        .from(assets)
        .where(eq(assets.id, assetId));
      if (!assetRow) {
        throw new Error(`Asset not found: ${assetId}`);
      }
      symbol = assetRow.symbol;
    }
  }

  const quote = await marketProviderRegistry.getHistoricalPriceQuote(
    symbol,
    asOfDate,
    providerName,
    currency,
  );
  if (!quote) {
    return { quote: null, cached: false };
  }

  const decPrice = D(quote.price).toString();

  await db
    .insert(externalPriceHistory)
    .values({
      assetId,
      providerId: providerRow.id,
      price: decPrice,
      currency: currency.toUpperCase(),
      asOfDate,
      isCurrent: false,
      rawResponse: quote.rawResponse,
    })
    .onConflictDoUpdate({
      target: [
        externalPriceHistory.assetId,
        externalPriceHistory.providerId,
        externalPriceHistory.asOfDate,
        externalPriceHistory.currency,
      ],
      set: {
        price: decPrice,
        timestamp: new Date(),
        isCurrent: false,
        rawResponse: quote.rawResponse,
      },
    });

  return { quote: { ...quote, price: decPrice, asOfDate }, cached: true };
}

/**
 * Retrieve historical price quote from cache or API.
 */
export async function getHistoricalPriceQuote(
  assetId: string,
  asOfDate: string,
  providerName = "coingecko",
  currency = "USD",
): Promise<ExternalPriceQuote | null> {
  const providerMap = await ensureExternalProvidersInDb();
  const providerRow = providerMap.get(providerName.toLowerCase());
  if (!providerRow) return null;

  const [cached] = await db
    .select()
    .from(externalPriceHistory)
    .where(
      and(
        eq(externalPriceHistory.assetId, assetId),
        eq(externalPriceHistory.providerId, providerRow.id),
        eq(externalPriceHistory.asOfDate, asOfDate),
        eq(externalPriceHistory.currency, currency.toUpperCase()),
      ),
    )
    .limit(1);

  if (cached) {
    const [assetRow] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, assetId));
    return {
      provider: providerRow.name,
      symbol: assetRow?.symbol ?? "",
      price: D(cached.price).toString(),
      currency: cached.currency,
      timestamp: cached.timestamp.toISOString(),
      asOfDate: cached.asOfDate,
      sourceType: "cache",
      rawResponse: cached.rawResponse ?? undefined,
    };
  }

  const { quote } = await fetchAndCacheHistoricalPrice(
    assetId,
    asOfDate,
    providerName,
    currency,
  );
  return quote;
}

/**
 * Record an external wallet balance observation.
 *
 * CRITICAL ARCHITECTURAL GUARANTEE:
 * 1. Prevents double counting between blockchain wallet balances and manually recorded transactions.
 * 2. Wallet balances are portfolio observations ONLY.
 * 3. Manual transactions remain the source of accounting truth.
 * 4. NEVER creates or modifies journal_entries, postings, accounts, lots, or lot_consumptions.
 */
export async function recordWalletObservation(
  input: WalletObservationInput,
): Promise<WalletObservationResult> {
  const observedDec = D(input.observedBalance);

  // 1. Retrieve recorded balance from internal accounting ledger (source of accounting truth)
  const holdings = await getHoldings();
  const assetHolding = holdings.find((h) => h.assetId === input.assetId);
  const recordedDec = assetHolding ? D(assetHolding.quantity) : D("0");

  const discrepancyDec = observedDec.sub(recordedDec);
  const isReconciled = discrepancyDec.abs().lte("0.000000001");

  // 2. Store observation in wallet_observations (portfolio observation only)
  const [row] = await db
    .insert(walletObservations)
    .values({
      userId: input.userId,
      walletId: input.walletId,
      assetId: input.assetId,
      observedBalance: observedDec.toString(),
      recordedBalance: recordedDec.toString(),
      discrepancy: discrepancyDec.toString(),
      observationDate: input.observationDate,
      source: input.source ?? "manual_observation",
      notes: input.notes,
    })
    .returning();

  return {
    id: row.id,
    assetId: row.assetId,
    observedBalance: D(row.observedBalance).toString(),
    recordedBalance: D(row.recordedBalance).toString(),
    discrepancy: D(row.discrepancy).toString(),
    observationDate: row.observationDate,
    source: row.source,
    notes: row.notes ?? undefined,
    isReconciled,
  };
}

/**
 * List stored wallet observations for an asset.
 */
export async function listWalletObservations(assetId?: string) {
  let query = db.select().from(walletObservations);
  if (assetId) {
    query = query.where(eq(walletObservations.assetId, assetId)) as typeof query;
  }
  const rows = await query.orderBy(desc(walletObservations.observationDate));
  return rows.map((r) => ({
    ...r,
    observedBalance: D(r.observedBalance).toString(),
    recordedBalance: D(r.recordedBalance).toString(),
    discrepancy: D(r.discrepancy).toString(),
    isReconciled: D(r.discrepancy).abs().lte("0.000000001"),
  }));
}
