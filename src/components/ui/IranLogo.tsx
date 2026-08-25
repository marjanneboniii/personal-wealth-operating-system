/**
 * IranLogo — category-scoped brand mark (bank, automobile, payment gateway,
 * insurance, real estate).
 *
 * Thin wrapper over the central `AssetLogo` / `resolveAssetLogo` pipeline so
 * that these convenience components and the asset tables can never disagree
 * about which image a brand gets. Presentation only.
 *
 * Props:
 *   name      — Brand name (Persian or English), used for lookup
 *   category  — bank | automobile | payment | insurance | realestate | crypto | default
 *   size      — Width/height in px (default 28)
 */
import AssetLogo from "@/components/ui/AssetLogo";
import type { AssetLogoType } from "@/features/branding/assetLogo";
import {
  getAutomobileLogo,
  getBankLogo,
  getPaymentGatewayLogo,
  type LogoCategory,
} from "@/features/branding/persianIcons";

export type { LogoCategory };

const CATEGORY_TO_ASSET_TYPE: Record<LogoCategory, AssetLogoType> = {
  bank: "bank",
  automobile: "vehicle",
  payment: "payment",
  insurance: "insurance",
  brand: "company",
  realestate: "real_estate",
  crypto: "crypto",
  default: "unknown",
};

export function IranLogo({
  name,
  category = "default",
  size = 28,
  className = "",
  title,
}: {
  name?: string | null;
  category?: LogoCategory;
  size?: number;
  /** Kept for backwards compatibility; the resolver owns the fallback chain. */
  fallback?: string | null;
  className?: string;
  title?: string;
}) {
  return (
    <AssetLogo
      assetType={CATEGORY_TO_ASSET_TYPE[category] ?? "unknown"}
      brandName={name}
      name={name}
      symbol={category === "crypto" ? name : null}
      size={size}
      radius={Math.round(size / 2)}
      className={className}
      title={title ?? name ?? ""}
    />
  );
}

/** Convenience components for each category */
export function BankLogo({ name, size = 28, ...rest }: { name?: string | null; size?: number; className?: string }) {
  return <IranLogo name={name} category="bank" size={size} {...rest} />;
}

export function AutomobileLogo({ name, size = 28, ...rest }: { name?: string | null; size?: number; className?: string }) {
  return <IranLogo name={name} category="automobile" size={size} {...rest} />;
}

export function PaymentLogo({ name, size = 28, ...rest }: { name?: string | null; size?: number; className?: string }) {
  return <IranLogo name={name} category="payment" size={size} {...rest} />;
}

export function RealEstateLogo({ size = 28, ...rest }: { size?: number; className?: string }) {
  return <IranLogo name="" category="realestate" size={size} {...rest} />;
}

export { getBankLogo, getAutomobileLogo, getPaymentGatewayLogo };
