/**
 * WHICH NETWORK a coin lives on — derived from CoinGecko's platform data, never
 * from a per-coin list someone has to maintain.
 *
 * CoinGecko publishes, for every coin, the chains it is deployed on
 * (`/coins/list?include_platform=true` → `platforms: { ethereum: "0x…",
 * "binance-smart-chain": "0x…" }`). A token newly listed on the market is
 * therefore classified the moment the sync sees it. What is fixed here is
 * CHAIN-level knowledge only — which platform ids are EVM chains, and which
 * chain a native coin (no contract address) runs on — which changes when a new
 * chain launches, not when a coin is listed.
 *
 * PURE: shared by the client form, the server action and the sync.
 */

/** CoinGecko platform ids of EVM chains — what Rabby / MetaMask / Safe can use. */
export const EVM_PLATFORM_IDS: ReadonlySet<string> = new Set([
  "ethereum", "binance-smart-chain", "arbitrum-one", "arbitrum-nova", "base", "polygon-pos",
  "polygon-zkevm", "avalanche", "optimistic-ethereum", "linea", "zksync", "scroll", "mantle",
  "blast", "sonic", "fantom", "xdai", "celo", "cronos", "moonbeam", "metis-andromeda",
  "unichain", "berachain", "hyperevm", "sei-v2", "ink", "abstract", "world-chain", "plasma",
  "kaia", "core", "opbnb", "manta-pacific", "mode", "taiko", "bob-network", "flare-network",
]);

/** Native coins (no platform entry): the chain they run on. Any other native coin is its own chain. */
const NATIVE_CHAIN: Record<string, string> = {
  bitcoin: "bitcoin",
  ethereum: "evm",
  binancecoin: "evm",
  "avalanche-2": "evm",
  "matic-network": "evm",
  "polygon-ecosystem-token": "evm",
  mantle: "evm",
  "ethereum-classic": "evm",
  fantom: "evm",
  "sonic-3": "evm",
  solana: "solana",
  sui: "sui",
  tron: "tron",
};

/** Network families of one coin, from its CoinGecko id and platform map. */
export function networksFromPlatforms(coingeckoId: string, platforms: Record<string, string | null | undefined>): string[] {
  const families = new Set<string>();
  for (const platform of Object.keys(platforms ?? {})) {
    if (!platform) continue;
    families.add(EVM_PLATFORM_IDS.has(platform) ? "evm" : platform);
  }
  if (NATIVE_CHAIN[coingeckoId]) families.add(NATIVE_CHAIN[coingeckoId]);
  if (families.size === 0) families.add(coingeckoId);
  return [...families].sort();
}

/**
 * OFFLINE SEED ONLY — what is known before the first successful sync (CoinGecko
 * unreachable, fresh install). Written with an epoch timestamp, so any real sync
 * replaces it. Never the source of truth once data has arrived.
 */
export const BOOTSTRAP_NETWORKS: Readonly<Record<string, readonly string[]>> = {
  BTC: ["bitcoin"],
  SOL: ["solana"],
  SUI: ["sui"],
  JUP: ["solana"],
  RAY: ["solana"],
  PYTH: ["solana"],
  TRX: ["tron"],
  ...Object.fromEntries(
    [
      "ETH", "WBTC", "BNB", "AVAX", "POL", "ARB", "MNT", "ETC",
      "USDT", "USDC", "USDE", "USDS", "DAI", "PYUSD", "FDUSD", "USDG", "BUSD",
      "LINK", "UNI", "AAVE", "CRV", "CVX", "SNX", "1INCH", "SUSHI", "YFI", "LRC", "DYDX", "CAKE",
      "ENA", "ETHFI", "MORPHO", "ONDO", "ZRX", "BAND", "API3", "SKY", "ASTER", "QNT", "PAXG", "XAUT",
    ].map((symbol) => [symbol, ["evm"]]),
  ),
};

/** Network families a wallet can hold. `null` = every network (an exchange, Ledger, Trust…). */
export function walletNetworks(venue: string, canonicalName: string): readonly string[] | null {
  if (venue === "evm_wallet") return ["evm"];
  if (canonicalName === "فانتوم") return ["bitcoin", "evm", "solana", "sui"];
  return null;
}

/** Whether a coin on `assetNetworks` can sit in a wallet that supports `walletFamilies`. */
export function networksCompatible(walletFamilies: readonly string[] | null, assetNetworks: readonly string[] | null | undefined): boolean {
  if (!walletFamilies) return true;
  // A coin whose network is not known yet is not offered to a network-limited wallet.
  if (!assetNetworks || assetNetworks.length === 0) return false;
  return assetNetworks.some((family) => walletFamilies.includes(family));
}
