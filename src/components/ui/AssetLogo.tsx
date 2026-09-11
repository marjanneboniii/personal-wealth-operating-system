/**
 * AssetLogo — the single UI entry point for rendering an asset's logo.
 *
 * All logo decisions are delegated to `resolveAssetLogo`, so every surface
 * (portfolio table, account row, wallet header, form preview) renders exactly
 * the same image for the same asset. Presentation only: this component reads
 * no financial data and never triggers a re-valuation.
 *
 * Remote CoinGecko artwork can fail to load (offline PWA, blocked CDN). The
 * `<img>` therefore degrades to a type-appropriate local placeholder instead
 * of showing a broken image, and never to another asset's logo.
 */
"use client";

import { useState } from "react";
import {
  resolveAssetLogoDetailed,
  type AssetLogoInput,
} from "@/features/branding/assetLogo";
import {
  DEFAULT_ASSET_LOGO,
  DEFAULT_AUTO_LOGO,
  DEFAULT_INSTITUTION_LOGO,
  REAL_ESTATE_LOGO,
  TOMAN_LOGO,
} from "@/features/branding/persianIcons";
import TomanIcon from "@/components/ui/TomanIcon";
import { RealEstateMark, VehicleMark } from "@/components/ui/AssetTypeMarks";

function localFallback(assetType: string): string {
  if (assetType === "vehicle") return DEFAULT_AUTO_LOGO;
  if (assetType === "real_estate") return REAL_ESTATE_LOGO;
  if (assetType === "bank" || assetType === "payment" || assetType === "insurance") {
    return DEFAULT_INSTITUTION_LOGO;
  }
  return DEFAULT_ASSET_LOGO;
}

export type AssetLogoProps = Omit<AssetLogoInput, "className"> & {
  /** Accounting asset-class name (e.g. «رمزارز»). Named to avoid clashing
   *  with the CSS `className` below. */
  assetClassName?: string | null;
  size?: number;
  /** CSS classes applied to the rendered image. */
  className?: string;
  /** Accessible label; defaults to the asset name/symbol. */
  title?: string;
  /** Corner radius in px. Currency-style marks look best fully round. */
  radius?: number;
};

export default function AssetLogo({
  size = 28,
  className = "",
  assetClassName,
  title,
  radius,
  ...input
}: AssetLogoProps) {
  const resolved = resolveAssetLogoDetailed({ ...input, className: assetClassName });
  // `failed` is reset by the `key` below whenever the resolved asset changes,
  // so a previous load error never sticks to a different asset.
  const [failed, setFailed] = useState(false);
  const src = failed ? localFallback(resolved.assetType) : resolved.src;

  const alt = title ?? input.name ?? input.symbol ?? "";
  const borderRadius = radius ?? Math.round(size * 0.28);

  if (resolved.src === TOMAN_LOGO) {
    return (
      <span
        className={`inline-flex shrink-0 overflow-hidden ${className}`}
        style={{ width: size, height: size, borderRadius }}
        role="img"
        aria-label={alt}
      >
        <TomanIcon size={size} />
      </span>
    );
  }

  /*
   * The two hand-registered real-world classes get their own inline mark
   * whenever no brand artwork applies. Three quarters of the vehicle catalogue
   * (every imported marque — تویوتا, کیا, هیوندای, بنز …) has no brand logo at
   * all, so this mark — not a brand emblem — is what most users actually see
   * next to their car. Inline, so a list of assets costs no extra requests.
   */
  if (resolved.src === DEFAULT_AUTO_LOGO || resolved.src === REAL_ESTATE_LOGO) {
    const Mark = resolved.src === DEFAULT_AUTO_LOGO ? VehicleMark : RealEstateMark;
    return (
      <span
        className={`inline-flex shrink-0 overflow-hidden ${className}`}
        style={{ width: size, height: size, borderRadius }}
        role="img"
        aria-label={alt}
      >
        <Mark size={size} />
      </span>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      key={resolved.src}
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={`shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius,
        objectFit: "contain",
        /*
         * Brand artwork (automaker emblems, bank marks, token logos) is drawn
         * for a LIGHT background. Plating it with `var(--surface)` meant that
         * on the dark theme the plate went dark too, and any dark-inked emblem
         * disappeared — «بهمن موتور», a grey chevron, was effectively invisible
         * in a dark asset list. The plate is therefore always light, which also
         * gives every row in a mixed list the same 28px silhouette.
         */
        background: "#fff",
        padding: Math.max(1, Math.round(size * 0.08)),
      }}
      // Remote CoinGecko artwork may fail offline; fall back once to a local
      // mark. `failed` short-circuits further attempts, so there is no loop.
      onError={() => setFailed(true)}
    />
  );
}
