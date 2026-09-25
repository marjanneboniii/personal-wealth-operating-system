/**
 * Existing asset-type marks on the shared 48px plate. Their shapes and
 * classification stay unchanged; visual ink comes from the shared palette.
 */
import React from "react";

type MarkProps = {
  size?: number;
  /** Plate (background) colour. Overridable for previews and brand tests. */
  plate?: string;
  /** Mark (foreground) colour. */
  ink?: string;
  className?: string;
};

/**
 * Metal and energy colours. These marks name a MATERIAL, so they carry its
 * colour — the way every Iranian price board shows gold as gold and oil as
 * crude — instead of the neutral ink the document-like marks use.
 */
export const MATERIAL_INK = {
  goldLight: "#F7C948",
  gold: "#E6A817",
  goldDeep: "#C28410",
  silverLight: "#D5DCE4",
  silver: "#A3AFBD",
  silverDeep: "#7D8A99",
  crude: "#3E2A1C",
  crudeSheen: "#F59E0B",
  gas: "#2F80ED",
  gasCore: "#A9CCFF",
  platinum: "#8A9BB4",
  copper: "#C4672D",
} as const;

/* The pair shares one plate so the two marks are visually interchangeable in
   a list: same square, same radius, same inset for the artwork. */
const PLATE_RADIUS = 12;

function Plate({ fill }: { fill: string }) {
  return <rect width="48" height="48" rx={PLATE_RADIUS} fill={fill} />;
}

/**
 * خودرو — a side profile, the only car view that survives 24px, drawn as a
 * SILHOUETTE ONLY. Every interior detail (glass, grille, door line) was tried
 * and removed: below ~40px it turns to noise, and above it, it competes with
 * the outline that is doing the actual work.
 */
export function VehicleMark({
  size = 48,
  plate = "var(--paper-000)",
  ink = "var(--ink-800)",
  className = "",
}: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <Plate fill={plate} />
      {/* Drawn INSIDE a 12px margin, not edge to edge. The mark reads as a
          quiet glyph on the plate the way a brand emblem does, instead of a
          silhouette pressed against the corners. */}
      <path
        d="M11.4 29.9v-2.5c0-1.3.7-2.2 2-2.6l3.7-1.1 2.6-3.2c.7-.9 1.7-1.4 2.9-1.4h4.5c1.2 0 2.3.4 3.1 1.2l3.5 3.4 2.9 1.1c1.2.5 1.9 1.3 1.9 2.6v2.5c0 .9-.7 1.6-1.6 1.6H13c-.9 0-1.6-.7-1.6-1.6z"
        fill={ink}
      />
      <circle cx="18.4" cy="30.6" r="3.3" fill={plate} />
      <circle cx="29.6" cy="30.6" r="3.3" fill={plate} />
      <circle cx="18.4" cy="30.6" r="2" fill={ink} />
      <circle cx="29.6" cy="30.6" r="2" fill={ink} />
    </svg>
  );
}

/**
 * ملک — two masses on one baseline. An apartment block, not a cottage: in this
 * market a property is far more often a واحد than a detached house, and the
 * stepped pair also reads as "portfolio of property" rather than "my home".
 * Exactly three windows survive the 24px budget; a full grid does not.
 */
export function RealEstateMark({
  size = 48,
  plate = "var(--paper-000)",
  ink = "var(--ink-700)",
  className = "",
}: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <Plate fill={plate} />
      {/* Flat-topped tower (the mark is not mirrored in RTL — a logo is an
          image, not text). */}
      <rect x="13.4" y="16.6" width="9.6" height="18.8" rx="1.8" fill={ink} />
      {/* Pitched-roof mass. The single diagonal is load-bearing: without it
          two flat blocks read as a BAR CHART, which is a genuine ambiguity in
          an app whose every other screen is a chart. */}
      <path
        d="M29.4 19.9c.4-.3 1-.3 1.4 0l4 3.3c.4.3.6.8.6 1.3v9.2c0 1-.8 1.7-1.7 1.7h-7.2c-1 0-1.7-.8-1.7-1.7v-9.2c0-.5.2-1 .6-1.3z"
        fill={ink}
      />
      {/* Three windows — the most detail that survives 24px. */}
      <rect x="16.2" y="19.8" width="4" height="4" rx="0.9" fill={plate} />
      <rect x="16.2" y="26.2" width="4" height="4" rx="0.9" fill={plate} />
      <rect x="28.4" y="26.6" width="4" height="4" rx="0.9" fill={plate} />
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   صندوق‌ها و سهام — drawn by what the instrument HOLDS.
   Same 48 grid, same white plate, same 12px margin as the pair above, so a
   portfolio row of mixed asset types reads as one system.
   ══════════════════════════════════════════════════════════════════════ */

/** صندوق طلا — stacked bullion. Three bars survive 24px; a coin pile does not. */
export function GoldFundMark({ size = 48, plate = "var(--paper-000)", ink = MATERIAL_INK.gold, className = "" }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true" focusable="false">
      <Plate fill={plate} />
      {/* Trapezoids, not rectangles: the taper is what says "ingot". */}
      {/* Lit from above: the top bar lightest, the base row deepest. */}
      <path d="M19.4 15.2h9.2c.5 0 .9.3 1.1.8l1.6 4.2H16.7l1.6-4.2c.2-.5.6-.8 1.1-.8z" fill={MATERIAL_INK.goldLight} />
      <path d="M14.2 23.4h9.2c.5 0 .9.3 1.1.8l1.6 4.2H11.5l1.6-4.2c.2-.5.6-.8 1.1-.8z" fill={ink} />
      <path d="M24.6 23.4h9.2c.5 0 .9.3 1.1.8l1.6 4.2H21.9l1.6-4.2c.2-.5.6-.8 1.1-.8z" fill={ink} />
      <path d="M19.4 31.6h9.2c.5 0 .9.3 1.1.8l1.6 4.2H16.7l1.6-4.2c.2-.5.6-.8 1.1-.8z" fill={MATERIAL_INK.goldDeep} />
    </svg>
  );
}

/**
 * صندوق درآمد ثابت — a flat line that steps up once. Deliberately the dullest
 * mark in the set: the product's whole promise is that it does not move much,
 * and a dramatic chart here would misrepresent it.
 */
export function FixedIncomeFundMark({ size = 48, plate = "var(--paper-000)", ink = "var(--ink-700)", className = "" }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true" focusable="false">
      <Plate fill={plate} />
      {/* Thicker than it looks like it needs. The first version used a 3.4
          stroke and simply vanished at 20-24px — a stepped line is mostly
          empty space, so it has to carry far more weight than a filled mark
          to survive the same size. */}
      <path d="M12.6 30.8h7.4v-5.2h7.4v-5.2h7.8" stroke={ink} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="12.6" y="35.2" width="22.6" height="4" rx="2" fill={ink} opacity="0.4" />
    </svg>
  );
}

/** صندوق سهامی (ETF) — three columns with real variance, the opposite reading. */
export function EquityFundMark({ size = 48, plate = "var(--paper-000)", ink = "var(--ink-800)", className = "" }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true" focusable="false">
      <Plate fill={plate} />
      <rect x="12.4" y="26.4" width="6.4" height="11.2" rx="1.8" fill={ink} opacity="0.45" />
      <rect x="20.8" y="19.6" width="6.4" height="18" rx="1.8" fill={ink} opacity="0.7" />
      <rect x="29.2" y="12.8" width="6.4" height="24.8" rx="1.8" fill={ink} />
    </svg>
  );
}

/** صندوق کالایی — زعفران و مشابه. A stigma-and-petals mark, not a chart. */
export function CommodityFundMark({ size = 48, plate = "var(--paper-000)", ink = "var(--ink-700)", className = "" }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true" focusable="false">
      <Plate fill={plate} />
      {/* Three saffron threads from one root — the crop's actual signature. */}
      <path d="M24 37V22.4" stroke={ink} strokeWidth="4" strokeLinecap="round" />
      <path d="M24 24.6c-3.4-1.2-5.6-4.2-5.8-8 3.4.4 5.8 3.2 5.8 8z" fill={ink} />
      <path d="M24 24.6c3.4-1.2 5.6-4.2 5.8-8-3.4.4-5.8 3.2-5.8 8z" fill={ink} />
      <path d="M24 21.8c0-4 1.4-7 3.4-9.4-2.8-.6-5.6 3-5.6 9.4z" fill={ink} opacity="0.55" />
    </svg>
  );
}

/**
 * سهام — a single certificate with a corner fold. A share is a document, not a
 * chart: every fund kind above already uses chart language, so reusing it here
 * would make the one non-fund instrument indistinguishable from the funds.
 */
export function StockMark({ size = 48, plate = "var(--paper-000)", ink = "var(--ink-700)", className = "" }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true" focusable="false">
      <Plate fill={plate} />
      <path d="M14.4 13.6c0-1.1.9-2 2-2h10.3c.5 0 1 .2 1.4.6l5.1 5.1c.4.4.6.9.6 1.4v15.7c0 1.1-.9 2-2 2H16.4c-1.1 0-2-.9-2-2z" fill={ink} />
      {/* The fold — punched back to the plate so it needs no third tone. */}
      <path d="M27.2 11.9l6 6h-4.6c-.8 0-1.4-.6-1.4-1.4z" fill={plate} />
      <rect x="18.6" y="24.2" width="10.8" height="2.6" rx="1.3" fill={plate} />
      <rect x="18.6" y="29.4" width="7.2" height="2.6" rx="1.3" fill={plate} />
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   کامودیتی و شاخص — the tokenised real-world assets listed on والکس.
   Wallex's own artwork for these is the ISSUER's badge («iShares» on a grey
   disc for oil, silver AND gas alike), which says nothing about what is held
   and makes five different commodities look identical. So each is drawn by
   the thing itself, on the same white plate as every mark above. The US
   stocks keep their real brand logos — those do identify the holding.
   ══════════════════════════════════════════════════════════════════════ */

/** نفت — a single drop. A barrel needs hoops and a lid that die at 24px. */
export function OilMark({ size = 48, plate = "var(--paper-000)", ink = MATERIAL_INK.crude, className = "" }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true" focusable="false">
      <Plate fill={plate} />
      <path d="M24 11.4c-3.8 4.6-9.6 11.2-9.6 17.4a9.6 9.6 0 0 0 19.2 0c0-6.2-5.8-12.8-9.6-17.4z" fill={ink} />
      {/* The sheen — the one detail that makes a drop read as LIQUID. */}
      <path d="M19.4 29.2c.1 2.7 2 4.7 4.6 5.1" stroke={MATERIAL_INK.crudeSheen} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** گاز طبیعی — a blue flame with its hollow core. */
export function NaturalGasMark({ size = 48, plate = "var(--paper-000)", ink = MATERIAL_INK.gas, className = "" }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true" focusable="false">
      <Plate fill={plate} />
      <path d="M24.4 10.8c1 4.6 4.4 7.2 7 10.6 1.9 2.5 2.8 5 2.8 7.6 0 5.6-4.5 9.6-10.2 9.6s-10.2-4-10.2-9.6c0-3.9 2-6.9 4.6-9.2.3 2.6 1.4 4.4 3.2 5.2-.6-5 .8-10 2.8-14.2z" fill={ink} />
      <path d="M24 26.4c2.4 2.2 3.8 4 3.8 6 0 2.2-1.7 3.8-3.8 3.8s-3.8-1.6-3.8-3.8c0-2 1.4-3.8 3.8-6z" fill={MATERIAL_INK.gasCore} />
    </svg>
  );
}

/**
 * نقره — ingots, the SAME taper as صندوق طلا so the two metals read as
 * siblings, but stacked as a pyramid on a bar so they differ in silhouette and
 * not only in colour (a colour-blind user must still tell them apart).
 */
export function SilverMark({ size = 48, plate = "var(--paper-000)", ink = MATERIAL_INK.silver, className = "" }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true" focusable="false">
      <Plate fill={plate} />
      <path d="M19.4 16.4h9.2c.5 0 .9.3 1.1.8l1.6 4.2H16.7l1.6-4.2c.2-.5.6-.8 1.1-.8z" fill={MATERIAL_INK.silverLight} />
      <path d="M14.2 24.6h9.2c.5 0 .9.3 1.1.8l1.6 4.2H11.5l1.6-4.2c.2-.5.6-.8 1.1-.8z" fill={ink} />
      <path d="M24.6 24.6h9.2c.5 0 .9.3 1.1.8l1.6 4.2H21.9l1.6-4.2c.2-.5.6-.8 1.1-.8z" fill={ink} />
      <rect x="11.5" y="32.6" width="25" height="3.4" rx="1.7" fill={MATERIAL_INK.silverDeep} />
    </svg>
  );
}

/** پلاتین — a faceted hexagon: the one metal here sold as a «precious» cut. */
export function PlatinumMark({ size = 48, plate = "var(--paper-000)", ink = MATERIAL_INK.platinum, className = "" }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true" focusable="false">
      <Plate fill={plate} />
      <path d="M24 11.6l10.8 6.2v12.4L24 36.4l-10.8-6.2V17.8z" fill={ink} />
      <path d="M24 18.6l4.8 2.8v5.2L24 29.4l-4.8-2.8v-5.2z" fill={plate} />
    </svg>
  );
}

/**
 * مس — a spool of wound wire: copper's use, not its ore. A ring-with-a-tail
 * coil was tried first and read as a MAGNIFYING GLASS — a search icon — which
 * in an app full of search boxes is a genuine misreading.
 */
export function CopperMark({ size = 48, plate = "var(--paper-000)", ink = MATERIAL_INK.copper, className = "" }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true" focusable="false">
      <Plate fill={plate} />
      {/* Two flanges, and the winding between them at lower weight. */}
      <rect x="12.4" y="12.4" width="5" height="23.2" rx="2" fill={ink} />
      <rect x="30.6" y="12.4" width="5" height="23.2" rx="2" fill={ink} />
      <rect x="17.4" y="17" width="13.2" height="3.6" rx="1.2" fill={ink} opacity="0.6" />
      <rect x="17.4" y="22.2" width="13.2" height="3.6" rx="1.2" fill={ink} opacity="0.6" />
      <rect x="17.4" y="27.4" width="13.2" height="3.6" rx="1.2" fill={ink} opacity="0.6" />
    </svg>
  );
}

/** شاخص — an axis with a rising index line: a MARKET, not a single share. */
export function IndexMark({ size = 48, plate = "var(--paper-000)", ink = "var(--ink-800)", className = "" }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true" focusable="false">
      <Plate fill={plate} />
      <path d="M13 12.6v22.4h22.4" stroke={ink} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.45" />
      <path d="M18 29l5-5.4 4.4 3.6 7-8.2" stroke={ink} strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Wallex symbol → its drawn mark. Keyed by SYMBOL because that is what every
 * asset row has; an unlisted future commodity simply falls back to the
 * source's artwork on the white plate, never to another commodity's mark.
 */
export const WALLEX_ASSET_MARKS: Record<string, (props: MarkProps) => React.JSX.Element> = {
  USOON: OilMark,
  UNGON: NaturalGasMark,
  SLVON: SilverMark,
  PPLTON: PlatinumMark,
  COPXON: CopperMark,
};

/** The fund kinds, keyed the way features/funds/catalogData.ts keys them. */
export const FUND_KIND_MARKS = {
  gold: GoldFundMark,
  fixed_income: FixedIncomeFundMark,
  etf: EquityFundMark,
  commodity: CommodityFundMark,
} as const;

/* ══════════════════════════════════════════════════════════════════════
   سکه و ارز — the Iranian market's everyday holdings, listed on «نمای بازار».
   Coins are drawn in gold on the white plate. Currencies show the issuer's
   round flag, as every Iranian price board (tgju, alanchand, bonbast) does:
   that is the mark users scan for. The sign/code glyph is kept as the
   fallback for a currency with no flag file.
   ══════════════════════════════════════════════════════════════════════ */

type CoinPart = "full" | "half" | "quarter" | "gram";

/**
 * سکه — a disc with its milled rim. The fraction a coin IS is drawn as the
 * share of the disc that is filled, over a faint whole: نیم‌سکه is half a
 * disc, ربع‌سکه a quarter. That survives 24px, where the digits «½» and «¼»
 * do not, and it tells the four sizes apart by silhouette alone.
 */
function CoinGlyph({ part, size = 48, plate = "var(--paper-000)", ink = MATERIAL_INK.gold, className = "" }: MarkProps & { part: CoinPart }) {
  const r = part === "gram" ? 8.6 : 12.6;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true" focusable="false">
      <Plate fill={plate} />
      {(part === "half" || part === "quarter") && <circle cx="24" cy="24" r={r} fill={ink} opacity="0.25" />}
      {(part === "full" || part === "gram") && <circle cx="24" cy="24" r={r} fill={ink} />}
      {part === "half" && <path d="M24 11.4a12.6 12.6 0 0 1 0 25.2z" fill={ink} />}
      {part === "quarter" && <path d="M24 24V11.4a12.6 12.6 0 0 1 12.6 12.6z" fill={ink} />}
      {/* The rim — what makes a disc a COIN and not a dot. */}
      <circle cx="24" cy="24" r={r - 3.2} stroke={MATERIAL_INK.goldLight} strokeWidth="2" />
    </svg>
  );
}

export function CoinMark(props: MarkProps) {
  return <CoinGlyph part="full" {...props} />;
}
export function HalfCoinMark(props: MarkProps) {
  return <CoinGlyph part="half" {...props} />;
}
export function QuarterCoinMark(props: MarkProps) {
  return <CoinGlyph part="quarter" {...props} />;
}
export function GramCoinMark(props: MarkProps) {
  return <CoinGlyph part="gram" {...props} />;
}

/**
 * The glyph each foreign currency is drawn with: its SIGN where one sign names
 * exactly one currency and people read it (€ £ ₺ ₽ ₹), and its ISO code where
 * a sign is shared or unknown — «kr» is Swedish, Norwegian AND Danish, «$» is
 * five different dollars, and the Gulf currencies have no sign in any font.
 */
export const FIAT_GLYPHS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  TRY: "₺",
  RUB: "₽",
  INR: "₹",
  JPY: "¥",
  CNY: "CN¥",
  THB: "฿",
  AZN: "₼",
  AMD: "֏",
  CAD: "C$",
  AUD: "A$",
  HKD: "HK$",
  MYR: "RM",
  CHF: "CHF",
  SEK: "SEK",
  NOK: "NOK",
  DKK: "DKK",
  AED: "AED",
  SAR: "SAR",
  OMR: "OMR",
  KWD: "KWD",
  IQD: "IQD",
  AFN: "AFN",
};

/**
 * Currencies with a round flag under /public/icons/flags (circle-flags, MIT —
 * see the README there). Stored locally so they render offline in the PWA.
 */
export const FIAT_FLAGS: ReadonlySet<string> = new Set([
  "USD", "EUR", "AED", "GBP", "TRY", "CNY", "CAD", "AUD", "CHF", "JPY", "IQD", "OMR", "KWD",
  "SAR", "RUB", "INR", "AZN", "AMD", "AFN", "THB", "MYR", "SEK", "HKD", "NOK", "DKK",
]);

/** ارز — the issuer's round flag on the plate; the sign or code when it has none. */
export function FiatMark({ code, glyph, size = 48, plate = "var(--paper-000)", ink = "var(--ink-800)", className = "" }: MarkProps & { code: string; glyph: string }) {
  if (FIAT_FLAGS.has(code)) {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true" focusable="false">
        <Plate fill={plate} />
        <image href={`/icons/flags/${code}.svg`} x="8" y="8" width="32" height="32" />
        {/* A hairline edge, so a mostly-white flag (Japan) still reads as a disc. */}
        <circle cx="24" cy="24" r="15.75" stroke="#000" strokeOpacity="0.08" strokeWidth="0.5" />
      </svg>
    );
  }
  // One sign fills the glyph box; a three-letter code has to fit the same box.
  const fontSize = glyph.length === 1 ? 26 : glyph.length === 2 ? 18 : 13.5;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true" focusable="false">
      <Plate fill={plate} />
      {/* LTR explicitly: inside an RTL page the bidi algorithm would print
          «C$» as «$C». System fonts first — Vazirmatn has no ₼, ֏ or ฿. */}
      <text
        x="24"
        y="25"
        direction="ltr"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily='ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
        fontWeight="700"
        fontSize={fontSize}
        letterSpacing={glyph.length > 2 ? "-0.3" : undefined}
        fill={ink}
      >
        {glyph}
      </text>
    </svg>
  );
}

/**
 * ISO code → a ready mark component. Built ONCE here, so a renderer never
 * creates a component inside render (which would remount it every time).
 */
export const FIAT_MARKS: Record<string, (props: MarkProps) => React.JSX.Element> = Object.fromEntries(
  Object.entries(FIAT_GLYPHS).map(([code, glyph]) => {
    const Mark = (props: MarkProps) => <FiatMark code={code} glyph={glyph} {...props} />;
    Mark.displayName = `FiatMark(${code})`;
    return [code, Mark];
  }),
);
