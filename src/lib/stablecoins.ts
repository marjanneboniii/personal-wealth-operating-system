/**
 * Coins that are a claim on a US dollar — the ONE list the whole app reads.
 *
 * It decides three things that must never disagree: a trade against one of
 * these is a conversion (سواپ, no FIFO lots — features/trade/rules.ts), setup
 * classes it «استیبل‌کوین» (نقدینگی, not crypto exposure), and the Wallex
 * catalogue labels it a stablecoin. Three copies of this list used to drift:
 * BUSD and USDD were money to the trade form but crypto to setup and pricing.
 */
export const STABLECOIN_SYMBOLS: ReadonlySet<string> = new Set([
  "USDT", "USDC", "USDG", "USDE", "USDS", "PYUSD", "BUSD", "DAI", "USDD", "FDUSD",
]);

export const isStablecoinSymbol = (symbol: string | null | undefined): boolean =>
  STABLECOIN_SYMBOLS.has((symbol ?? "").trim().toUpperCase());
