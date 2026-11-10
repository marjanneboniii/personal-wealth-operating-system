import crypto from "node:crypto";
import { LIGHTER_BASE, isEvmAddress, readArcus, readHyperliquid, readLighter, type SyncVenue, type VenueReading } from "./venues";

function signArcusRequest(signKeyHex: string, timestamp: number, method = "GET", path = "/v1/account"): string {
  const clean = signKeyHex.trim().replace(/^0x/i, "");
  const buf = Buffer.from(clean, "hex");
  const seed = buf.length === 64 ? buf.subarray(0, 32) : buf;
  if (seed.length !== 32) {
    throw new Error("کلید امضای آرکوس معتبر نیست (باید یک کلید هگز ۶۴ کاراکتری باشد).");
  }
  // PKCS#8 DER prefix for Ed25519 private key
  const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  const key = crypto.createPrivateKey({
    key: Buffer.concat([prefix, seed]),
    format: "der",
    type: "pkcs8",
  });
  const message = Buffer.from(`${timestamp}${method}${path}`);
  return crypto.sign(null, message, key).toString("hex").toLowerCase();
}

async function fetchArcusReading(credentials: string): Promise<VenueReading> {
  let apiKey = "";
  let signKey = "";
  try {
    const parsed = JSON.parse(credentials);
    apiKey = (parsed.apiKey ?? "").trim();
    signKey = (parsed.signKey ?? "").trim();
  } catch {
    const parts = credentials.split(":");
    apiKey = (parts[0] ?? "").trim();
    signKey = (parts[1] ?? "").trim();
  }
  if (!apiKey || !signKey) {
    throw new Error("کلید API و کلید امضای آرکوس وارد نشده است.");
  }

  const timestamp = Date.now();
  const signature = signArcusRequest(signKey, timestamp, "GET", "/v1/account");
  const signal = AbortSignal.timeout(10_000);
  let res: Response;
  try {
    res = await fetch("https://api.arcus.xyz/v1/account", {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        "X-Timestamp": String(timestamp),
        "X-Signature": signature,
        Accept: "application/json",
      },
      signal,
      cache: "no-store",
    });
  } catch {
    throw new Error("پاسخی از صرافی آرکوس دریافت نشد؛ لطفاً کمی بعد دوباره امتحان کنید.");
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`خطا از صرافی آرکوس (${res.status}): ${errText || "اطلاعات حساب خوانده نشد."}`);
  }

  const json = await res.json().catch(() => null);
  const reading = readArcus(json);
  if (!reading) {
    throw new Error("پاسخ صرافی آرکوس قابل خواندن نبود.");
  }
  return reading;
}

/**
 * Reads one account from a venue's public, read-only API. Server only: the
 * credentials never reach the browser, and no trading/withdrawal permission
 * is involved.
 */
export async function fetchVenueReading(venue: SyncVenue, addressOrCreds: string): Promise<VenueReading> {
  if (venue === "arcus") {
    return fetchArcusReading(addressOrCreds);
  }
  if (!isEvmAddress(addressOrCreds)) throw new Error("آدرس کیف پول معتبر نیست (0x و ۴۰ کاراکتر).");
  const signal = AbortSignal.timeout(10_000);
  let res: Response;
  try {
    res =
      venue === "hyperliquid"
        ? await fetch("https://api.hyperliquid.xyz/info", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "clearinghouseState", user: addressOrCreds.trim() }),
            signal,
            cache: "no-store",
          })
        : await fetch(`${LIGHTER_BASE[venue]}/api/v1/account?by=l1_address&value=${encodeURIComponent(addressOrCreds.trim())}`, {
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
