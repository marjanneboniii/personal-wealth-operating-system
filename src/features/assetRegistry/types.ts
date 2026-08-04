/**
 * Asset Registry Extension — Identity-Focused
 * assets entity represents "What is this asset?" — must NOT store wallet observations, balances, ownership history, valuation history
 * Correct: Asset Gold Metadata Purity Location
 * Incorrect: Asset Ahvaz Kianpars because location is metadata, not asset identity
 */

export type AssetClassNode = {
  id: string;
  code: string;
  name: string;
  color: string;
  sortOrder: number;
  parentId: string | null;
  level: number;
  attributesSchema: string | null;
  children?: AssetClassNode[];
};

export type AssetNetwork = {
  id: string;
  assetId: string;
  assetSymbol?: string;
  networkId: string;
  networkCode?: string;
  networkName?: string;
  contractAddress: string | null;
  chainId: number | null;
  decimals: number | null;
  tokenStandard: string | null;
  isPrimary: boolean;
  isActive: boolean;
  explorerUrl: string | null;
  logoUri: string | null;
  createdAt: string;
};

export type TokenMetadata = {
  id: string;
  assetId: string;
  assetSymbol?: string;
  underlyingAssetId: string | null;
  underlyingSymbol?: string;
  logoUri: string | null;
  coingeckoId: string | null;
  coinMarketCapId: string | null;
  websiteUrl: string | null;
  description: string | null;
  createdAt: string;
};

export type CreateAssetClassInput = {
  code: string;
  name: string;
  color?: string;
  sortOrder?: number;
  parentId?: string | null;
  level?: number;
  attributesSchema?: string;
};

export type CreateAssetNetworkInput = {
  assetId: string;
  networkId: string;
  contractAddress?: string;
  chainId?: number;
  decimals?: number;
  tokenStandard?: string;
  isPrimary?: boolean;
  isActive?: boolean;
  explorerUrl?: string;
  logoUri?: string;
};
