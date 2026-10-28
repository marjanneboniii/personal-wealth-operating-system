import { LIGHTER_BASE, isEvmAddress, readHyperliquid, readLighter, type SyncVenue, type VenueReading } from "./venues";

/**
 * Reads one account from a venue's public, read-only API. Server only: the
 * address never reaches the browser, and no key, signature or permission is
 * involved — the same data any block explorer shows.
 */
export async function fetchVenueReading(venue: SyncVenue, address: string): Promise<VenueReading> {
  if (!isEvmAddress(address)) throw new Error("آدرس کیف پول معتبر نیست (0x و ۴۰ کاراکتر).");
  const signal = AbortSignal.timeout(10_000);
  let res: Response;
  try {
    res =
      venue === "hyperliquid"
        ? await fetch("https://api.hyperliquid.xyz/info", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "clearinghouseState", user: address.trim() }),
            signal,
            cache: "no-store",
          })
        : await fetch(`${LIGHTER_BASE[venue]}/api/v1/account?by=l1_address&value=${encodeURIComponent(address.trim())}`, {
            signal,
            cache: "no-store",
          });
  } catch {
    throw new Error("پاسخی از پلتفرم نرسید؛ کمی بعد دوباره امتحان کنید.");
  }
  const json = await res.json().catch(() => null);
  const reading = venue === "hyperliquid" ? readHyperliquid(json) : readLighter(json);
  if (!reading) {
    throw new Error(venue === "hyperliquid" ? "پاسخ هایپرلیکوئید قابل خواندن نبود." : "برای این آدرس حسابی در لایتر پیدا نشد.");
  }
  return reading;
}
