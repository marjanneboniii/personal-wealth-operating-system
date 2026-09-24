/**
 * WHERE a trade happens — the place an account sits in (a bank, an Iranian
 * exchange, a foreign exchange, a self-custody wallet) decides what can be
 * bought there, with which money, and which coins can be sent to it.
 *
 * PRODUCT RULES
 *   • Iranian exchange (نوبیتکس، بیت‌پین، والکس…): crypto and tokenised stocks,
 *     indices and commodities are bought with the TOMAN or the TETHER held at
 *     that exchange — never from a bank account. USDC, USDe and other
 *     stablecoins do not trade there.
 *   • Foreign exchange (بایننس، او‌کی‌ایکس…): the same assets, with USDT or USDC
 *     held at that exchange. Other stablecoins are converted to USDT/USDC there
 *     first. Toman never trades there.
 *   • Self-custody wallet (ربی، متامسک، سیف، تراست، لجر…): coins only — no US
 *     shares, indices or commodities — swapped with any stablecoin held in that
 *     wallet, and only on a network the wallet supports. Rabby, MetaMask, Safe
 *     and Coinbase Wallet are EVM-only: Bitcoin can neither be bought in them
 *     nor sent to them.
 *   • Money never jumps places inside a trade: a stablecoin pays only for what
 *     is bought in the SAME place. Moving it elsewhere is a transfer.
 *
 * PURE: shared by the client form and the server action.
 */
import { canonicalWalletName, isBrokerage, IRANIAN_EXCHANGE_NAMES } from "@/features/setup/holdingWallets";
import { BOOTSTRAP_NETWORKS, networksCompatible, walletNetworks } from "./networks";
import {
  isTomanBankAccount,
  isTomanBrokerAccount,
  isTomanExchangeAccount,
  MARKET_TOMAN_MESSAGE,
  STABLECOIN_SYMBOLS,
} from "./rules";

export type VenueType = "bank" | "cash" | "domestic_exchange" | "foreign_exchange" | "evm_wallet" | "multichain_wallet" | "unknown";

const DOMESTIC_EXCHANGES = new Set(IRANIAN_EXCHANGE_NAMES);
const FOREIGN_EXCHANGES = new Set(["بایننس", "او‌کی‌ایکس", "بای‌بیت", "کوکوین", "بیت‌گت", "ال‌بانک", "بیت‌یونیکس", "کوین‌بیس"]);
const EVM_WALLETS = new Set(["متامسک", "ربی والت", "سیف", "کوین‌بیس والت"]);
const MULTICHAIN_WALLETS = new Set(["لجر", "تراست والت", "او‌کی‌ایکس والت", "فانتوم"]);

/** The Iranian exchanges, in catalogue order — the only places that hold Toman for crypto. */
export const DOMESTIC_EXCHANGE_NAMES: readonly string[] = IRANIAN_EXCHANGE_NAMES;

export type Place = {
  /** `wallets.name` */
  walletName?: string | null;
  /** `wallets.kind` — bank | cash | exchange | hot | cold | fund */
  walletKind?: string | null;
};

export function venueTypeOf(place: Place | null | undefined): VenueType {
  const kind = (place?.walletKind ?? "").trim().toLowerCase();
  if (kind === "bank") return "bank";
  // A brokerage is a Toman container, like a cash box: nothing coin-like trades there.
  if (kind === "cash" || kind === "fund" || kind === "broker") return "cash";
  if (isBrokerage(place?.walletName)) return "cash";
  const name = canonicalWalletName(place?.walletName);
  if (DOMESTIC_EXCHANGES.has(name)) return "domestic_exchange";
  if (FOREIGN_EXCHANGES.has(name)) return "foreign_exchange";
  if (EVM_WALLETS.has(name)) return "evm_wallet";
  if (MULTICHAIN_WALLETS.has(name)) return "multichain_wallet";
  return "unknown";
}

export const isExchange = (v: VenueType) => v === "domestic_exchange" || v === "foreign_exchange";
export const isSelfCustody = (v: VenueType) => v === "evm_wallet" || v === "multichain_wallet";

export const sameWallet = (a: Place | null | undefined, b: Place | null | undefined) =>
  !!a?.walletName && !!b?.walletName && canonicalWalletName(a.walletName) === canonicalWalletName(b.walletName);

/**
 * Whether a wallet at this place can hold (and so receive) this coin.
 *
 * `networks` are the coin's synced network families (`crypto_networks`, from
 * CoinGecko platform data). Without them — pure callers, tests — the offline
 * seed is used.
 */
export function placeSupportsAsset(
  place: Place | null | undefined,
  symbol: string | null | undefined,
  networks?: readonly string[] | null,
): boolean {
  const s = (symbol ?? "").trim().toUpperCase();
  const families = walletNetworks(venueTypeOf(place), canonicalWalletName(place?.walletName));
  return networksCompatible(families, networks === undefined ? (BOOTSTRAP_NETWORKS[s] ?? null) : networks);
}

/** US shares, indices, commodities, bonds and tokenised metal: exchange-listed only. */
const EXCHANGE_ONLY_CLASS_CODES: ReadonlySet<string> = new Set(["equity", "etf", "commodity", "security"]);
export function isExchangeOnlyAsset(asset: { classCode?: string | null; kind?: string | null }): boolean {
  if (asset.kind && ["tokenized_stock", "index", "commodity", "bond"].includes(asset.kind)) return true;
  return EXCHANGE_ONLY_CLASS_CODES.has((asset.classCode ?? "").trim().toLowerCase());
}

/** Stablecoins a place quotes non-stable assets in. `null` = any stablecoin. */
function quoteStablecoinsOf(venue: VenueType): ReadonlySet<string> | null {
  if (venue === "domestic_exchange") return new Set(["USDT"]);
  if (venue === "foreign_exchange") return new Set(["USDT", "USDC"]);
  return null;
}

export type VenueAsset = {
  symbol?: string | null;
  classCode?: string | null;
  kind?: string | null;
  place?: Place | null;
  /** synced network families of the coin (see `placeSupportsAsset`) */
  networks?: readonly string[] | null;
};
export type VenueSettlement = {
  symbol?: string | null;
  walletKind?: string | null;
  walletName?: string | null;
  /** account name — recognises an older bank account that has no wallet */
  name?: string | null;
};

/**
 * Where-rules for a buy or sell of a market asset (the what-rules live in
 * `rules.ts`). For a buy, `targetPlace` is where the asset will be held —
 * the stablecoin's own place, or the Iranian exchange chosen for a Toman buy.
 * For a sell, the asset's current place. Returns a Persian reason or `null`.
 */
export function venueTradeError(
  side: "buy" | "sell",
  asset: VenueAsset,
  settle: VenueSettlement,
  targetPlace: Place | null | undefined,
): string | null {
  const symbol = (settle.symbol ?? "").trim().toUpperCase();
  const assetSymbol = (asset.symbol ?? "").trim().toUpperCase();
  const place = side === "sell" ? (asset.place ?? null) : (targetPlace ?? null);
  const venue = venueTypeOf(place);
  const assetIsStable = STABLECOIN_SYMBOLS.has(assetSymbol);

  // Toman: only the Toman held at an Iranian exchange, and only at that exchange.
  if (symbol === "IRT" || symbol === "IRR") {
    if (!isTomanExchangeAccount(settle)) return MARKET_TOMAN_MESSAGE;
    if (place?.walletName && !sameWallet(place, settle)) {
      return "تومان فقط برای معامله در همان صرافی‌ای که در آن نگهداری می‌شود استفاده می‌شود.";
    }
    if (venue !== "domestic_exchange" && venue !== "unknown") return "خرید و فروش با تومان فقط در صرافی داخلی انجام می‌شود.";
    return null;
  }

  if (!STABLECOIN_SYMBOLS.has(symbol)) return null; // not money — rules.ts already refuses it

  // A stablecoin pays only where it is held.
  if (place?.walletName && settle.walletName && !sameWallet(place, settle)) {
    return "استیبل‌کوین فقط برای معامله در همان صرافی یا کیف پولی که در آن نگهداری می‌شود استفاده می‌شود.";
  }
  const where = venueTypeOf(settle);
  if (isSelfCustody(where)) {
    if (isExchangeOnlyAsset(asset)) return "این دارایی فقط در صرافی معامله می‌شود.";
    if (!placeSupportsAsset(settle, assetSymbol, asset.networks)) return "این کیف پول از شبکهٔ این رمزارز پشتیبانی نمی‌کند.";
    return null;
  }
  const quotes = quoteStablecoinsOf(where);
  if (quotes) {
    // Stable ⇄ stable at an exchange is a conversion into the quote coin (USDC → USDT); other pairs need a quote coin.
    if (assetIsStable) return quotes.has(symbol) || quotes.has(assetSymbol) ? null : "این تبدیل در این صرافی انجام نمی‌شود.";
    if (!quotes.has(symbol)) {
      return where === "domestic_exchange"
        ? "در صرافی داخلی فقط با تومان یا تتر معامله می‌شود."
        : "در صرافی خارجی فقط با تتر یا یو اس دی سی معامله می‌شود.";
    }
  }
  return null;
}

export type TransferAccount = {
  symbol?: string | null;
  walletKind?: string | null;
  walletName?: string | null;
  name?: string | null;
};

const TOMAN_UNITS: ReadonlySet<string> = new Set(["IRT", "IRR"]);
const FIAT_UNITS: ReadonlySet<string> = new Set(["IRT", "IRR", "USD", "EUR", "AED", "TRY", "GBP"]);

/**
 * Where money may be moved — «انتقال».
 *
 *   • Toman moves between Toman bank accounts, the Toman held at an Iranian
 *     exchange and the Toman held at a brokerage, in every direction — never
 *     to a crypto wallet, a foreign exchange or a cash box. It is also paid
 *     INTO a life policy's savings account (wallet kind `insurance`).
 *   • A coin or a tokenised asset (Tether included) goes to the SAME asset
 *     held at an exchange or a wallet — never into Toman, a bank or a
 *     brokerage — and only on a network that place supports.
 *
 * Returns a Persian reason, or `null` when the move is allowed.
 */
export function transferDestinationError(
  from: TransferAccount,
  to: TransferAccount,
  networks?: readonly string[] | null,
): string | null {
  const fromSymbol = (from.symbol ?? "").trim().toUpperCase();
  const toSymbol = (to.symbol ?? "").trim().toUpperCase();

  if (TOMAN_UNITS.has(fromSymbol)) {
    if (!TOMAN_UNITS.has(toSymbol)) return "تومان فقط به حساب تومانی منتقل می‌شود.";
    if (isTomanBankAccount(to) || isTomanExchangeAccount(to) || isTomanBrokerAccount(to)) return null;
    // A life policy's savings (اندوخته): the saved part of each premium is paid into it.
    if ((to.walletKind ?? "").trim().toLowerCase() === "insurance") return null;
    return "تومان فقط بین حساب بانکی، تومانِ صرافی داخلی و تومانِ کارگزاری منتقل می‌شود.";
  }

  if (!fromSymbol || FIAT_UNITS.has(fromSymbol)) return venueTransferError(toSymbol, to, networks);

  if (toSymbol !== fromSymbol) return "رمزارز و دارایی توکنیزه فقط به همان دارایی در صرافی یا کیف پول دیگر منتقل می‌شود.";
  const kind = (to.walletKind ?? "").trim().toLowerCase();
  if (["bank", "cash", "fund", "broker"].includes(kind) || isBrokerage(to.walletName)) {
    return "رمزارز به حساب بانکی یا کارگزاری منتقل نمی‌شود.";
  }
  return venueTransferError(toSymbol, to, networks);
}

/** Can this coin be sent to that place? (a transfer between two holdings) */
export function venueTransferError(
  symbol: string | null | undefined,
  to: Place | null | undefined,
  networks?: readonly string[] | null,
): string | null {
  return placeSupportsAsset(to, symbol, networks) ? null : "کیف پول مقصد از شبکهٔ این رمزارز پشتیبانی نمی‌کند.";
}
