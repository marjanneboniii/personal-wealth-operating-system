/**
 * The crypto assets PWOS intentionally supports.
 *
 * CoinGecko IDs — not symbols — are the external pricing identity. Symbols are
 * not globally unique, so every registration/setup path must take its mapping
 * from this registry instead of guessing or maintaining its own list.
 *
 * This module is deliberately data-only: no database, HTTP, ledger, FIFO or
 * valuation imports. Existing historical assets outside this allowlist remain
 * untouched; they are simply not offered for new crypto registration.
 */
export type SupportedCryptoAsset = {
  symbol: string;
  name: string;
  displayName: string;
  coingeckoId: string;
  logoUrl: string;
  marketCapRank: number | null;
};

export const SUPPORTED_CRYPTO_ASSETS = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    displayName: "بیت‌کوین",
    coingeckoId: "bitcoin",
    logoUrl: "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png",
    marketCapRank: 1,
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    displayName: "اتریوم",
    coingeckoId: "ethereum",
    logoUrl: "https://coin-images.coingecko.com/coins/images/279/large/ethereum.png",
    marketCapRank: 2,
  },
  {
    symbol: "USDT",
    name: "Tether",
    displayName: "تتر",
    coingeckoId: "tether",
    logoUrl: "https://coin-images.coingecko.com/coins/images/325/large/Tether.png",
    marketCapRank: 3,
  },
  {
    symbol: "BNB",
    name: "BNB",
    displayName: "بایننس کوین",
    coingeckoId: "binancecoin",
    logoUrl: "https://coin-images.coingecko.com/coins/images/825/large/bnb-icon2_2x.png",
    marketCapRank: 4,
  },
  {
    symbol: "USDC",
    name: "USDC",
    displayName: "یو اس دی سی",
    coingeckoId: "usd-coin",
    logoUrl: "https://coin-images.coingecko.com/coins/images/6319/large/USDC.png",
    marketCapRank: 5,
  },
  {
    symbol: "XRP",
    name: "XRP",
    displayName: "ریپل",
    coingeckoId: "ripple",
    logoUrl: "https://coin-images.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png",
    marketCapRank: 6,
  },
  {
    symbol: "SOL",
    name: "Solana",
    displayName: "سولانا",
    coingeckoId: "solana",
    logoUrl: "https://coin-images.coingecko.com/coins/images/4128/large/solana.png",
    marketCapRank: 7,
  },
  {
    symbol: "TRX",
    name: "TRON",
    displayName: "ترون",
    coingeckoId: "tron",
    logoUrl: "https://coin-images.coingecko.com/coins/images/1094/large/tron-logo.png",
    marketCapRank: 8,
  },
  {
    symbol: "HYPE",
    name: "Hyperliquid",
    displayName: "هایپرلیکویید",
    coingeckoId: "hyperliquid",
    logoUrl: "https://coin-images.coingecko.com/coins/images/50882/large/hyperliquid.jpg",
    marketCapRank: 10,
  },
  {
    symbol: "DOGE",
    name: "Dogecoin",
    displayName: "دوج کوین",
    coingeckoId: "dogecoin",
    logoUrl: "https://coin-images.coingecko.com/coins/images/5/large/dogecoin.png",
    marketCapRank: 11,
  },
  {
    symbol: "USDS",
    name: "USDS",
    displayName: "USDS",
    coingeckoId: "usds",
    logoUrl: "https://coin-images.coingecko.com/coins/images/39926/large/usds.webp",
    marketCapRank: 12,
  },
  {
    symbol: "XMR",
    name: "Monero",
    displayName: "مونرو",
    coingeckoId: "monero",
    logoUrl: "https://coin-images.coingecko.com/coins/images/69/large/monero_logo.png",
    marketCapRank: 16,
  },
  {
    symbol: "LTC",
    name: "Litecoin",
    displayName: "لایت‌کوین",
    coingeckoId: "litecoin",
    logoUrl: "https://coin-images.coingecko.com/coins/images/2/large/litecoin.png",
    marketCapRank: 22,
  },
  {
    symbol: "USDE",
    name: "Ethena USDe",
    displayName: "Ethena USDe",
    coingeckoId: "ethena-usde",
    logoUrl: "https://coin-images.coingecko.com/coins/images/33613/large/usde.png",
    marketCapRank: 24,
  },
  {
    symbol: "AVAX",
    name: "Avalanche",
    displayName: "آوالانچ",
    coingeckoId: "avalanche-2",
    logoUrl: "https://coin-images.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png",
    marketCapRank: 25,
  },
  {
    symbol: "USDG",
    name: "Global Dollar",
    displayName: "Global Dollar",
    coingeckoId: "global-dollar",
    logoUrl: "https://coin-images.coingecko.com/coins/images/51281/large/GDN_USDG_Token_200x200.png",
    marketCapRank: 28,
  },
  {
    symbol: "XAUT",
    name: "Tether Gold",
    displayName: "تتر گلد",
    coingeckoId: "tether-gold",
    logoUrl: "https://coin-images.coingecko.com/coins/images/10481/large/logo.png",
    marketCapRank: 35,
  },
  {
    symbol: "PAXG",
    name: "PAX Gold",
    displayName: "PAX Gold",
    coingeckoId: "pax-gold",
    logoUrl: "https://coin-images.coingecko.com/coins/images/9519/large/asset-paxg.png",
    marketCapRank: 42,
  },
  {
    symbol: "CBBTC",
    name: "Coinbase Wrapped BTC",
    displayName: "Coinbase Wrapped BTC",
    coingeckoId: "coinbase-wrapped-btc",
    logoUrl: "https://coin-images.coingecko.com/coins/images/40143/large/cbbtc.webp",
    marketCapRank: null,
  },
  {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    displayName: "Wrapped Bitcoin",
    coingeckoId: "wrapped-bitcoin",
    logoUrl: "https://coin-images.coingecko.com/coins/images/7598/large/WBTCLOGO.png",
    marketCapRank: null,
  },
] as const satisfies readonly SupportedCryptoAsset[];

export type SupportedCryptoSymbol = (typeof SUPPORTED_CRYPTO_ASSETS)[number]["symbol"];

export const SUPPORTED_COINGECKO_IDS = SUPPORTED_CRYPTO_ASSETS.map((asset) => asset.coingeckoId);

const bySymbol = new Map<string, SupportedCryptoAsset>(
  SUPPORTED_CRYPTO_ASSETS.map((asset) => [asset.symbol, asset]),
);
const byCoinGeckoId = new Map<string, SupportedCryptoAsset>(
  SUPPORTED_CRYPTO_ASSETS.map((asset) => [asset.coingeckoId, asset]),
);

export function getSupportedCryptoBySymbol(symbol: string): SupportedCryptoAsset | undefined {
  return bySymbol.get(symbol.trim().toUpperCase());
}

export function requireSupportedCryptoBySymbol(symbol: SupportedCryptoSymbol): SupportedCryptoAsset {
  const asset = bySymbol.get(symbol);
  if (!asset) throw new Error(`Missing supported crypto registry entry: ${symbol}`);
  return asset;
}

export function getSupportedCryptoByCoinGeckoId(coingeckoId: string): SupportedCryptoAsset | undefined {
  return byCoinGeckoId.get(coingeckoId.trim().toLowerCase());
}

export function isSupportedCoinGeckoId(coingeckoId: string): boolean {
  return byCoinGeckoId.has(coingeckoId.trim().toLowerCase());
}
