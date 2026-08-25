/**
 * IranLogo — Displays a branded Iranian logo (bank, automobile, payment gateway, etc.)
 *
 * Props:
 *   name      — Brand name (Persian or English), used for lookup
 *   category  — One of: bank | automobile | payment | realestate | crypto | default
 *   size      — Width/height in px (default 28)
 *   fallback  — Optional fallback logo path
 */
import {
  resolveBrandLogo,
  getBankLogo,
  getAutomobileLogo,
  getPaymentGatewayLogo,
  categoryFallback,
} from "@/features/branding/persianIcons";

export type LogoCategory = "bank" | "automobile" | "payment" | "realestate" | "crypto" | "default";

export function IranLogo({
  name,
  category = "default",
  size = 28,
  fallback,
  className = "",
  title,
}: {
  name?: string | null;
  category?: LogoCategory;
  size?: number;
  fallback?: string | null;
  className?: string;
  title?: string;
}) {
  const logoUrl = resolveBrandLogo(name ?? null, category);
  const src = logoUrl ?? fallback ?? categoryFallback(category);

  return (
    <img
      src={src}
      alt={title ?? name ?? ""}
      width={size}
      height={size}
      className={`shrink-0 rounded-full ${className}`}
      style={{ objectFit: "contain", background: "#f8fafc" }}
      loading="lazy"
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
