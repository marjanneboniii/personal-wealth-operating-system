/**
 * Observation Providers Registry — DeBank, Zerion, RPC
 * Each provider implements fetchPositions(address, chains) => ProviderPosition[]
 * Providers return observation cache, NOT market price SSOT
 * No provider writes to market_prices or ledger
 */

import type { ProviderResult, ProviderPosition, ObservationProviderName } from "../types";

export interface ObservationProvider {
  getProviderName(): ObservationProviderName;
  fetchPositions(walletAddress: string, chainIds?: number[]): Promise<ProviderResult>;
  isAvailable(): Promise<boolean>;
}

class ProviderRegistry {
  private providers = new Map<ObservationProviderName, ObservationProvider>();

  register(provider: ObservationProvider): void {
    this.providers.set(provider.getProviderName(), provider);
  }

  get(name: ObservationProviderName): ObservationProvider | undefined {
    return this.providers.get(name);
  }

  list(): ObservationProvider[] {
    return Array.from(this.providers.values());
  }

  getPrimary(): ObservationProvider | undefined {
    return this.providers.get("DEBANK") ?? this.providers.get("ZERION") ?? this.providers.values().next().value;
  }

  getBackup(): ObservationProvider | undefined {
    if (this.providers.has("DEBANK") && this.providers.has("ZERION")) {
      return this.providers.get("ZERION");
    }
    return undefined;
  }
}

export const observationProviderRegistry = new ProviderRegistry();

// Stub providers — structure only, no real API calls to avoid keys, but interface compliant

export class DebankProvider implements ObservationProvider {
  getProviderName(): ObservationProviderName {
    return "DEBANK";
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async fetchPositions(walletAddress: string): Promise<ProviderResult> {
    // Stub: In production, call DeBank API https://pro-openapi.debank.com/v1/user/all_token_list etc.
    // Normalizer should map to canonical assets via external_asset_mappings
    // For audit, return empty to prove no ledger write, no market price write
    return {
      providerName: "DEBANK",
      walletAddress,
      positions: [] as ProviderPosition[],
      rawResponseSummary: JSON.stringify({ stub: true, provider: "DEBANK" }),
    };
  }
}

export class ZerionProvider implements ObservationProvider {
  getProviderName(): ObservationProviderName {
    return "ZERION";
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async fetchPositions(walletAddress: string): Promise<ProviderResult> {
    // Stub: Production would call Zerion API https://api.zerion.io/v1/wallets/{address}/positions
    return {
      providerName: "ZERION",
      walletAddress,
      positions: [],
      rawResponseSummary: JSON.stringify({ stub: true, provider: "ZERION" }),
    };
  }
}

export class RpcProvider implements ObservationProvider {
  getProviderName(): ObservationProviderName {
    return "RPC";
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async fetchPositions(walletAddress: string): Promise<ProviderResult> {
    // Stub: Direct RPC eth_call for token balances via alchemy/infura
    return {
      providerName: "RPC",
      walletAddress,
      positions: [],
      rawResponseSummary: JSON.stringify({ stub: true, provider: "RPC" }),
    };
  }
}

// Register default providers
observationProviderRegistry.register(new DebankProvider());
observationProviderRegistry.register(new ZerionProvider());
observationProviderRegistry.register(new RpcProvider());
