/**
 * Where a coin is HELD — pure helpers shared by the setup wizard (client), the
 * setup service (server) and the accounts page.
 *
 * A coin is not a wallet. The same stablecoin lives in many places (USDT alone
 * circulates on 100+ chains and sits on every exchange), and one place holds
 * many coins: an exchange account may hold USDT and USDC, a Safe may hold
 * USDe, a Ledger only DAI. So every holding line is (coin, place); lines of
 * the same place share one `wallets` row, each coin being its own account
 * inside it, named «<ارز> - <محل>».
 *
 * The wizard offers places ONLY as a pick list (no free typing), so the stored
 * name is always the catalogue's Persian name below. Aliases keep older or
 * API-supplied spellings («MetaMask», «gnosis safe») mapping to the same place.
 *
 * LOGOS are local files (CSP allows only same-origin images, and remote CDNs
 * are unreliable from Iran). Global wallets and exchanges come from
 * DefiLlama's protocol icons; Iranian exchanges and Ledger from their own
 * sites' icons.
 */

/** Grouping key for a place name: case, spacing, ZWNJ and Arabic ی/ک folded. */
export function walletKeyOf(name: string | null | undefined): string {
  return (name ?? "")
    .replace(/‌/g, " ")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Identity of one holding line: the same coin may sit in two places, never twice in one. */
export function holdingKeyOf(symbol: string, walletName: string | null | undefined): string {
  return `${symbol.trim().toUpperCase()}@${walletKeyOf(canonicalWalletName(walletName))}`;
}

export type WalletKind = "exchange" | "hot" | "cold";

export type KnownWallet = {
  /** Persian display name — what is stored and shown. */
  name: string;
  kind: WalletKind;
  /** Local logo, when one exists. */
  logo?: string;
  /** Other spellings (English, spaced, without ZWNJ). */
  aliases: string[];
};

const L = "/icons/wallets";

/** The pick list, in display order: Iranian exchanges, global exchanges, then wallets. */
export const KNOWN_WALLETS: KnownWallet[] = [
  { name: "نوبیتکس", kind: "exchange", logo: "/ir-icons/brands/nobitex.svg", aliases: ["nobitex"] },
  { name: "بیت‌پین", kind: "exchange", logo: `${L}/bitpin.png`, aliases: ["bitpin", "بیت پین"] },
  { name: "آبان‌تتر", kind: "exchange", logo: `${L}/abantether.png`, aliases: ["abantether", "aban tether", "آبان تتر"] },
  { name: "والکس", kind: "exchange", logo: `${L}/wallex.png`, aliases: ["wallex"] },
  { name: "رمزینکس", kind: "exchange", logo: `${L}/ramzinex.png`, aliases: ["ramzinex"] },
  { name: "تبدیل", kind: "exchange", logo: `${L}/tabdeal.png`, aliases: ["tabdeal"] },
  { name: "اکسکوینو", kind: "exchange", logo: `${L}/excoino.png`, aliases: ["excoino"] },
  { name: "بایننس", kind: "exchange", logo: `${L}/binance.png`, aliases: ["binance"] },
  { name: "او‌کی‌ایکس", kind: "exchange", logo: `${L}/okx.png`, aliases: ["okx", "اوکی ایکس"] },
  { name: "بای‌بیت", kind: "exchange", logo: `${L}/bybit.png`, aliases: ["bybit", "بای بیت"] },
  { name: "کوکوین", kind: "exchange", logo: `${L}/kucoin.png`, aliases: ["kucoin"] },
  { name: "بیت‌گت", kind: "exchange", logo: `${L}/bitget.png`, aliases: ["bitget", "بیت گت"] },
  { name: "گیت", kind: "exchange", logo: `${L}/gate.png`, aliases: ["gate", "gate.io"] },
  { name: "کوینکس", kind: "exchange", logo: `${L}/coinex.png`, aliases: ["coinex"] },
  { name: "ال‌بانک", kind: "exchange", logo: `${L}/lbank.png`, aliases: ["lbank", "l bank", "ال بانک", "البانک"] },
  { name: "بیت‌یونیکس", kind: "exchange", logo: `${L}/bitunix.png`, aliases: ["bitunix", "بیت یونیکس", "بیتیونیکس"] },
  { name: "کوین‌بیس", kind: "exchange", logo: `${L}/coinbase.png`, aliases: ["coinbase", "کوین بیس"] },

  { name: "لجر", kind: "cold", logo: `${L}/ledger.png`, aliases: ["ledger", "ledger nano", "ledger live"] },
  // Safe (app.safe.global) — a multisig smart-contract wallet.
  { name: "سیف", kind: "hot", logo: `${L}/safe.png`, aliases: ["safe", "safe wallet", "safe global", "safe{wallet}", "gnosis safe", "سیف والت"] },
  { name: "متامسک", kind: "hot", logo: `${L}/metamask.png`, aliases: ["metamask", "meta mask", "متا مسک"] },
  { name: "ربی والت", kind: "hot", logo: `${L}/rabby.png`, aliases: ["rabby", "rabby wallet", "ربی"] },
  { name: "تراست والت", kind: "hot", logo: `${L}/trust.png`, aliases: ["trust wallet", "trust", "تراست"] },
  { name: "فانتوم", kind: "hot", logo: `${L}/phantom.png`, aliases: ["phantom", "phantom wallet"] },
  { name: "او‌کی‌ایکس والت", kind: "hot", logo: `${L}/okx.png`, aliases: ["okx wallet", "okx web3", "اوکی ایکس والت"] },
  { name: "کوین‌بیس والت", kind: "hot", logo: `${L}/coinbase.png`, aliases: ["coinbase wallet", "base wallet", "کوین بیس والت"] },
];

/** Label of the «not in the list» pick. Its stored place name is empty. */
export const OTHER_PLACE_LABEL = "سایر";

const KNOWN_BY_KEY = new Map<string, KnownWallet>();
for (const w of KNOWN_WALLETS) {
  for (const spelling of [w.name, ...w.aliases]) KNOWN_BY_KEY.set(walletKeyOf(spelling), w);
}

export function knownWalletOf(name: string | null | undefined): KnownWallet | null {
  const key = walletKeyOf(name);
  return key ? KNOWN_BY_KEY.get(key) ?? null : null;
}

/** «metamask» → «متامسک»; an unknown place keeps its own spelling (tidied). */
export function canonicalWalletName(name: string | null | undefined): string {
  return knownWalletOf(name)?.name ?? (name ?? "").replace(/\s+/g, " ").trim();
}

export function walletKindOf(name: string): WalletKind {
  return knownWalletOf(name)?.kind ?? "hot";
}

export function walletLogoFor(name: string | null | undefined): string | null {
  return knownWalletOf(name)?.logo ?? null;
}

/** Account name of a coin line: «تتر - بیت‌پین», or just «تتر» without a place. */
export function holdingAccountName(coinName: string, walletName: string | null | undefined): string {
  const place = canonicalWalletName(walletName);
  return place ? `${coinName} - ${place}` : coinName;
}
