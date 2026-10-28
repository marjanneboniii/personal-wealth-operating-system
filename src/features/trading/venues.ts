/**
 * Perp venues — which places hold a trading (margin) account, and which of
 * them can be read automatically from their public, read-only API by wallet
 * address. PURE: shared by the accounts page (server), the update form
 * (client) and tests.
 *
 * Verified against the venues' own docs (آبان ۱۴۰۵):
 *   • Hyperliquid  POST https://api.hyperliquid.xyz/info {type:"clearinghouseState", user}
 *                  → marginSummary.accountValue, assetPositions[].position.unrealizedPnl.
 *                  The default call covers the main perp dex only, not HIP-3 dexes.
 *   • Lighter      GET {base}/api/v1/account?by=l1_address&value=…
 *                  → accounts[].total_asset_value (= collateral + unrealized PnL),
 *                    accounts[].positions[].unrealized_pnl.
 *                  Mainnet: https://mainnet.zklighter.elliot.ai
 *                  Robinhood Chain: https://api.rh.lighter.xyz
 * Ondo Perps and Arcus publish no such endpoint: updated by hand.
 */
import { D } from "@/domain/decimal";
import { canonicalWalletName } from "@/features/setup/holdingWallets";

export type SyncVenue = "hyperliquid" | "lighter" | "lighter_rh";

export type PerpVenue = { place: string; sync: SyncVenue | null; site: string };

export const PERP_VENUES: readonly PerpVenue[] = [
  { place: "هایپرلیکوئید", sync: "hyperliquid", site: "app.hyperliquid.xyz" },
  { place: "لایتر", sync: "lighter", site: "app.lighter.xyz" },
  { place: "لایتر رابین‌هود", sync: "lighter_rh", site: "robinhoodchain.lighter.xyz" },
  { place: "اوندو پرپس", sync: null, site: "app.ondoperps.xyz" },
  { place: "آرکوس", sync: null, site: "app.arcus.xyz" },
];

const BY_PLACE = new Map(PERP_VENUES.map((v) => [v.place, v]));

/** The perp venue a wallet (place) name belongs to, or null for any other place. */
export function perpVenueOf(walletName: string | null | undefined): PerpVenue | null {
  return BY_PLACE.get(canonicalWalletName(walletName)) ?? null;
}

export const LIGHTER_BASE: Record<"lighter" | "lighter_rh", string> = {
  lighter: "https://mainnet.zklighter.elliot.ai",
  lighter_rh: "https://api.rh.lighter.xyz",
};

export function isEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

/** What a venue reports for one account, in its margin unit (USDC). */
export type VenueReading = { accountValue: string; unrealizedPnl: string };

/** Hyperliquid `clearinghouseState` → the two numbers; null if the shape is not the documented one. */
export function readHyperliquid(json: unknown): VenueReading | null {
  const j = json as { marginSummary?: { accountValue?: unknown }; assetPositions?: { position?: { unrealizedPnl?: unknown } }[] } | null;
  const value = j?.marginSummary?.accountValue;
  if (typeof value !== "string" || !Number.isFinite(Number(value))) return null;
  let upnl = D(0);
  for (const p of j?.assetPositions ?? []) {
    const u = p?.position?.unrealizedPnl;
    if (typeof u === "string" && Number.isFinite(Number(u))) upnl = upnl.add(u);
  }
  return { accountValue: D(value).toString(), unrealizedPnl: upnl.toString() };
}

/**
 * Lighter `account?by=l1_address` → the two numbers, summed over every
 * account (main and sub-accounts) of the address. null when the address has
 * no Lighter account («account not found») or the shape is not documented.
 */
export function readLighter(json: unknown): VenueReading | null {
  const j = json as { accounts?: { total_asset_value?: unknown; positions?: { unrealized_pnl?: unknown }[] }[] } | null;
  if (!Array.isArray(j?.accounts) || j.accounts.length === 0) return null;
  let value = D(0);
  let upnl = D(0);
  for (const a of j.accounts) {
    if (typeof a?.total_asset_value !== "string" || !Number.isFinite(Number(a.total_asset_value))) return null;
    value = value.add(a.total_asset_value);
    for (const p of a.positions ?? []) {
      if (typeof p?.unrealized_pnl === "string" && Number.isFinite(Number(p.unrealized_pnl))) upnl = upnl.add(p.unrealized_pnl);
    }
  }
  return { accountValue: value.toString(), unrealizedPnl: upnl.toString() };
}

/** Realized balance = account value − open P&L: the part already won or lost. */
export function realizedBalanceOf(reading: VenueReading): string {
  return D(reading.accountValue).sub(reading.unrealizedPnl).toString();
}
