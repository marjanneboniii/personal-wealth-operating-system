export type PriceFreshness = "fresh" | "stale" | "unavailable";

export type PriceFailureCode =
  | "missing_configuration"
  | "rate_limited"
  | "upstream_error"
  | "timeout"
  | "network_failure"
  | "invalid_response"
  | "asset_not_found"
  /** The source's daily/5-minute allowance is used up — stop asking until it resets. */
  | "quota_exhausted"
  /** The source refused the request itself (bad key, bad parameter). Retrying cannot help and can get a key banned. */
  | "rejected_request";

export type CoinGeckoPricePoint = {
  coingeckoId: string;
  priceUsd: string | null;
  observedAt: string | null;
  fetchedAt: string | null;
  freshness: PriceFreshness;
  failureCode?: PriceFailureCode;
};

export type CoinGeckoCatalogAsset = {
  coingeckoId: string;
  symbol: string;
  name: string;
  logoUrl: string;
  marketCapRank: number | null;
  kind: "crypto";
};

export type MarketAssetIdentity = {
  assetId: string;
  coingeckoId: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
};
