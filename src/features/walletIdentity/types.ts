/**
 * Wallet Identity Layer — Separate Identity Domain
 * Purpose: Store blockchain wallet address, network/chain, ownership relationship, user association, optional link to internal asset accounts
 * MUST NOT: Create accounting transactions, journal entries, lots, cost basis
 */

export type WalletType = "personal" | "external_research" | "protocol_treasury" | "whale" | "exchange";
export type OwnershipCategory = "self_custody" | "external" | "research" | "observed" | "custodial";

export type WalletIdentity = {
  id: string;
  userId: string | null;
  address: string; // lowercased
  networkId: string | null;
  networkCode?: string;
  networkName?: string;
  chainId: number | null;
  label: string | null;
  walletType: WalletType;
  ownershipCategory: OwnershipCategory;
  isVerified: boolean;
  linkedAccountId: string | null; // optional soft link to accounts.id, SET NULL, never creates accounting movement
  linkedAccountCode?: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type CreateWalletIdentityInput = {
  userId?: string;
  address: string;
  networkId?: string;
  chainId?: number;
  label?: string;
  walletType?: WalletType;
  ownershipCategory?: OwnershipCategory;
  isVerified?: boolean;
  linkedAccountId?: string | null;
  notes?: string;
};

export type WalletIdentityWithHoldings = WalletIdentity & {
  ledgerHoldings?: Array<{
    assetId: string;
    symbol: string;
    quantity: string;
    costBase: string;
  }>;
};

export type OwnershipResolutionCategory =
  | "already_accounted"
  | "not_yet_accounted"
  | "external_research"
  | "duplicate"
  | "new_acquisition_candidate";
