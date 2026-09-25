/**
 * AssetLogo — the single UI entry point for rendering an asset's logo.
 *
 * All logo decisions are delegated to `resolveAssetLogo`, so every surface
 * (portfolio table, account row, wallet header, form preview) renders exactly
 * the same image for the same asset. Presentation only: this component reads
 * no financial data and never triggers a re-valuation.
 *
 * ONE PLATE FOR EVERYTHING
 * Every logo — a drawn mark (خودرو، ملک، تومان، صندوق) or a real artwork (a
 * coin, a stock, a bank) — sits on the SAME white rounded square: the 48-grid
 * plate with rx=12 that the drawn marks use, i.e. a corner radius of a quarter
 * of the size. Round coin artwork used to be clipped to a circle by callers
 * passing `radius={size / 2}`, which made a mixed list read as two visual
 * systems. The `radius` prop is therefore kept for call-site compatibility but
 * no longer changes the plate.
 *
 * Remote artwork can fail to load (offline PWA, blocked CDN). The `<img>`
 * degrades to a type-appropriate local placeholder instead of a broken image,
 * and never to another asset's logo.
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
import { marketLogoFor } from "@/features/branding/marketLogos";
import {
  CoinMark,
  CommodityFundMark,
  EquityFundMark,
  FIAT_MARKS,
  FixedIncomeFundMark,
  GoldFundMark,
  GramCoinMark,
  HalfCoinMark,
  IndexMark,
  OilMark,
  QuarterCoinMark,
  RealEstateMark,
  SilverMark,
  StockMark,
  VehicleMark,
  WALLEX_ASSET_MARKS,
} from "@/components/ui/AssetTypeMarks";

/** `mark:<kind>` logo references → the drawn mark on the white plate. */
const KIND_MARKS: Record<string, typeof StockMark> = {
  stock: StockMark,
  index: IndexMark,
  bond: FixedIncomeFundMark,
  gold: GoldFundMark,
  commodity: CommodityFundMark,
  // Tehran-exchange funds, drawn by what they hold (see AssetTypeMarks).
  "fund-gold": GoldFundMark,
  "fund-fixed_income": FixedIncomeFundMark,
  "fund-etf": EquityFundMark,
  "fund-commodity": CommodityFundMark,
  // Gold, coins, silver and oil as the Iranian market lists them.
  coin: CoinMark,
  "coin-half": HalfCoinMark,
  "coin-quarter": QuarterCoinMark,
  "coin-gram": GramCoinMark,
  silver: SilverMark,
  oil: OilMark,
};


/** The drawn marks' plate: rx=12 on a 48 grid — a quarter of the size. */
export function plateRadius(size: number): number {
  return Math.round((size * 12) / 48);
}

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
  /** CSS classes applied to the rendered plate. */
  className?: string;
  /** Accessible label; defaults to the asset name/symbol. */
  title?: string;
  /**
   * Kept so existing call sites compile. The plate radius is fixed by the mark
   * system (see the note above) and this value is ignored.
   */
  radius?: number;
};

export default function AssetLogo({
  size = 28,
  className = "",
  assetClassName,
  title,
  radius: _radius,
  ...input
}: AssetLogoProps) {
  const resolved = resolveAssetLogoDetailed({ ...input, className: assetClassName });
  // `failed` is reset by the `key` below whenever the resolved asset changes,
  // so a previous load error never sticks to a different asset.
  const [failed, setFailed] = useState(false);
  /*
   * A market symbol with a real brand logo (Apple, S&P 500, PayPal USD…) shows
   * it from a local file — see features/branding/marketLogos. It beats a
   * stored exchange artwork and a drawn `mark:` fallback, but never an explicit
   * user choice.
   */
  const marketLogo = input.userLogoUrl ? null : marketLogoFor(input.symbol);
  const primarySrc = marketLogo ?? resolved.src;
  const src = failed ? localFallback(resolved.assetType) : primarySrc;

  const alt = title ?? input.name ?? input.symbol ?? "";
  const borderRadius = plateRadius(size);

  /** The shared white plate every logo sits on. */
  const plate = (child: React.ReactNode) => (
    <span
      className={className}
      // Layout lives in the inline style, not in utility classes: a logo must
      // stay centred on its plate on any surface, including ones rendered
      // without the app stylesheet (PDF export, email, a static preview).
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        overflow: "hidden",
        width: size,
        height: size,
        borderRadius,
        background: "var(--paper-000)",
      }}
      role="img"
      aria-label={alt}
    >
      {child}
    </span>
  );

  if (resolved.src === TOMAN_LOGO) {
    return plate(<TomanIcon size={size} />);
  }

  /*
   * Tokenised commodities get the system's drawn mark even though the catalogue
   * stored a logo: that stored image is the ISSUER badge — the same grey
   * «iShares» disc for oil, silver and gas — so honouring it would make five
   * different holdings indistinguishable. A `mark:` logo is a catalogue row
   * with no trustworthy artwork that asks for the drawn mark of its kind.
   * An explicit user logo, or a real local market logo, still wins.
   */
  const upperSymbol = (input.symbol ?? "").trim().toUpperCase();
  // `mark:fiat-EUR` → the euro's sign; any other `mark:<key>` → KIND_MARKS.
  const markKey = input.logoUrl?.startsWith("mark:") ? input.logoUrl.slice(5) : null;
  const commodityMark = !input.userLogoUrl && !marketLogo
    ? WALLEX_ASSET_MARKS[upperSymbol] ??
      (markKey
        ? (markKey.startsWith("fiat-") ? FIAT_MARKS[markKey.slice(5)] : KIND_MARKS[markKey]) ?? StockMark
        : undefined) ??
      // A foreign-currency holding with no artwork (a EUR account) gets the
      // same sign the market list draws for it, not the generic placeholder.
      (resolved.source === "default" && resolved.assetType === "fiat" ? FIAT_MARKS[upperSymbol] : undefined)
    : undefined;
  if (commodityMark) {
    const Mark = commodityMark;
    return plate(<Mark size={size} />);
  }

  /*
   * The two hand-registered real-world classes get their own inline mark
   * whenever no brand artwork applies. Three quarters of the vehicle catalogue
   * has no brand logo at all, so this mark is what most users actually see next
   * to their car. Inline, so a list of assets costs no extra requests.
   */
  if (resolved.src === DEFAULT_AUTO_LOGO || resolved.src === REAL_ESTATE_LOGO) {
    const Mark = resolved.src === DEFAULT_AUTO_LOGO ? VehicleMark : RealEstateMark;
    return plate(<Mark size={size} />);
  }

  /*
   * Real artwork, drawn for a LIGHT background, inset on the plate by the same
   * margin the drawn marks keep from its edge — so a round coin reads as a
   * glyph ON the white square, never as a circle beside a square.
   */
  const inset = Math.max(2, Math.round(size * 0.14));
  return plate(
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      key={primarySrc}
      src={src}
      alt=""
      aria-hidden="true"
      width={size - inset * 2}
      height={size - inset * 2}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      style={{ width: size - inset * 2, height: size - inset * 2, objectFit: "contain" }}
      // Remote artwork may fail offline; fall back once to a local mark.
      // `failed` short-circuits further attempts, so there is no loop.
      onError={() => setFailed(true)}
    />,
  );
}
