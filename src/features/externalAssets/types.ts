/**
 * External Asset Discovery + Mapping
 * Correct flow: Unknown Token -> Discovery -> Review Queue -> Mapping -> Asset Registry
 * Never: Unknown Token -> INSERT INTO assets (because spam/scam/dust)
 */

export type DiscoveryStatus = "pending_review" | "approved" | "rejected" | "ignored";
export type MappingStatus = "pending" | "verified" | "rejected";

export type ExternalAsset = {
  id: string;
  providerName: string; // DEBANK, ZERION, RPC, COINGECKO, etc.
  rawSymbol: string | null;
  rawName: string | null;
  contractAddress: string | null;
  chainId: number | null;
  networkId: string | null;
  networkCode?: string;
  decimals: number | null;
  tokenStandard: string | null;
  logoUri: string | null;
  explorerUrl: string | null;
  sourceMetadata: string | null;
  discoveryStatus: DiscoveryStatus;
  discoveredAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  notes: string | null;
  createdAt: string;
};

export type ExternalAssetMapping = {
  id: string;
  externalAssetId: string;
  internalAssetId: string | null;
  internalSymbol?: string;
  mappingStatus: MappingStatus;
  mappedAt: string | null;
  mappedBy: string | null;
  confidenceScore: string | null;
  mappingSource: string; // manual | auto
  notes: string | null;
  createdAt: string;
};

export type CreateExternalAssetInput = {
  providerName: string;
  rawSymbol?: string;
  rawName?: string;
  contractAddress?: string;
  chainId?: number;
  networkId?: string;
  decimals?: number;
  tokenStandard?: string;
  logoUri?: string;
  explorerUrl?: string;
  sourceMetadata?: string;
  notes?: string;
};

export type CreateMappingInput = {
  externalAssetId: string;
  internalAssetId?: string | null;
  mappingStatus?: MappingStatus;
  confidenceScore?: string;
  mappingSource?: string;
  notes?: string;
};
