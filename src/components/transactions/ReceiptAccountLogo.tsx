import AssetLogo from "@/components/ui/AssetLogo";
import { getBankLogo, getCryptoLogo, normalizeBrandKey } from "@/features/branding/persianIcons";
import { SUPPORTED_CRYPTO_ASSETS } from "@/features/pricing/supportedAssets";
import { knownWalletOf, walletLogoFor } from "@/features/setup/holdingWallets";

const CRYPTO_SYMBOL_BY_NAME = new Map<string, string>();
for (const asset of SUPPORTED_CRYPTO_ASSETS) {
  CRYPTO_SYMBOL_BY_NAME.set(normalizeBrandKey(asset.symbol), asset.symbol);
  CRYPTO_SYMBOL_BY_NAME.set(normalizeBrandKey(asset.name), asset.symbol);
  CRYPTO_SYMBOL_BY_NAME.set(normalizeBrandKey(asset.displayName), asset.symbol);
}

function inferSymbolFromName(rawName: string): string {
  const key = normalizeBrandKey(rawName);
  if (!key) return "";
  if (key === "تومان" || key === "ریال" || key === "irt" || key === "irr") return "IRT";
  if (key === "دلار" || key === "usd") return "USD";
  return CRYPTO_SYMBOL_BY_NAME.get(key) ?? "";
}

/**
 * Renders the asset/currency mark + exchange/wallet/bank mark next to an account
 * name on a transaction receipt:
 * - «تتر - بیت‌پین» → Tether logo + Bitpin logo
 * - «تومان — بیت‌پین» → Toman «ت» logo + Bitpin logo
 * - Any other Iranian/global exchange + crypto or Toman → asset logo + place logo
 * - Regular bank account → bank logo
 */
export default function ReceiptAccountLogo({
  accountName,
  symbol,
  size = 18,
}: {
  accountName: string;
  symbol?: string | null;
  size?: number;
}) {
  const trimmed = accountName.trim();
  const parts = trimmed.split(/\s+[-—–]\s+/);
  const hasPlaceSeparator = parts.length >= 2;
  const assetPart = hasPlaceSeparator ? parts.slice(0, -1).join(" - ").trim() : trimmed;
  const placePart = hasPlaceSeparator ? parts[parts.length - 1].trim() : "";

  const placeWallet = knownWalletOf(placePart) ?? knownWalletOf(trimmed);
  const placeLogo = placeWallet ? walletLogoFor(placeWallet.name) : null;
  const placeLabel = placeWallet?.name ?? (placePart || trimmed);

  const explicitSymbol = (symbol ?? "").trim().toUpperCase();
  const effectiveSymbol = explicitSymbol || inferSymbolFromName(assetPart);
  const isToman = effectiveSymbol === "IRT" || effectiveSymbol === "IRR";
  const isCrypto = Boolean(effectiveSymbol && getCryptoLogo(effectiveSymbol));

  // 1) Cryptocurrency + Exchange/Wallet (e.g. «تتر - بیت‌پین», «بیت‌کوین - نوبیتکس»)
  if (isCrypto) {
    return (
      <span className="inline-flex items-center gap-1 shrink-0">
        <AssetLogo
          symbol={effectiveSymbol}
          name={assetPart || trimmed}
          assetClassName="رمزارز"
          size={size}
          title={assetPart || effectiveSymbol}
        />
        {placeLogo && (
          <AssetLogo
            userLogoUrl={placeLogo}
            brandName={placeLabel}
            name={placeLabel}
            size={size}
            title={placeLabel}
          />
        )}
      </span>
    );
  }

  // 2) Toman at an Iranian exchange or brokerage (e.g. «تومان - بیت‌پین», «تومان - کارگزاری مفید»)
  if (isToman && placeLogo) {
    return (
      <span className="inline-flex items-center gap-1 shrink-0">
        <AssetLogo symbol="IRT" name="تومان" size={size} title="تومان" />
        <AssetLogo
          userLogoUrl={placeLogo}
          brandName={placeLabel}
          name={placeLabel}
          size={size}
          title={placeLabel}
        />
      </span>
    );
  }

  // 3) Named exchange/wallet without an explicit asset symbol
  if (placeLogo) {
    return (
      <AssetLogo
        userLogoUrl={placeLogo}
        brandName={placeLabel}
        name={placeLabel}
        size={size}
        title={placeLabel}
      />
    );
  }

  // 4) Foreign fiat currency (e.g. USD, EUR)
  if (effectiveSymbol && !isToman) {
    return <AssetLogo symbol={effectiveSymbol} name={assetPart || trimmed} size={size} title={assetPart || effectiveSymbol} />;
  }

  // 5) Iranian bank account (falls back to Toman «ت» if the account is literally «تومان» and not a bank)
  if (isToman && !getBankLogo(trimmed) && (normalizeBrandKey(assetPart) === "تومان" || normalizeBrandKey(trimmed) === "تومان")) {
    return <AssetLogo symbol="IRT" name="تومان" size={size} title="تومان" />;
  }

  return <AssetLogo assetType="bank" brandName={trimmed} name={trimmed} size={size} />;
}
