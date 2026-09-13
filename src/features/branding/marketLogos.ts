/**
 * Local logos for market symbols — tokenised US stocks, index / bond / gold
 * ETFs, commodity funds and a few stablecoins.
 *
 * WHERE THEY CAME FROM
 * CoinGecko's public API, category «Tokenized Assets» (`tokenized-products`,
 * 1,418 coins on 2026-09-13) plus `paypal-usd`, `ethena-usde` and
 * `global-dollar`. Each app symbol was matched to a CoinGecko coin by SYMBOL
 * AND NAME (never symbol alone — symbols are not unique there), and every
 * match had exactly one candidate.
 *
 * WHY THEY ARE LOCAL FILES, NOT CoinGecko URLs
 * CoinGecko's image CDN is slow or unreachable from where this app's users
 * are. Stored under /public at 96px, they cost one small same-origin request,
 * render offline in the PWA, and cannot change or disappear upstream.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * USOON (oil) and UNGON (natural gas): CoinGecko shows the same «USCF» issuer
 * badge for both, so the app's drawn oil-drop and flame marks are kept.
 *
 * PRESENTATION ONLY — pure data, no network, no database.
 */

const SYMBOLS_WITH_LOGO = [
  "AAOIB",
  "AAPLON",
  "AAPLX",
  "ABTX",
  "AGGON",
  "AMDB",
  "AMDON",
  "AMZNON",
  "AMZNX",
  "ARMB",
  "AVGOB",
  "AXTIB",
  "AZNX",
  "BABAB",
  "BABAON",
  "CBRSB",
  "COINON",
  "COINX",
  "COPXON",
  "CRCLB",
  "CRCLON",
  "CRCLX",
  "CRWVB",
  "DFDVX",
  "DRAMB",
  "EWYB",
  "GLDX",
  "GLWB",
  "GOOGLB",
  "GOOGLON",
  "GOOGLX",
  "HDX",
  "HOODB",
  "HOODON",
  "HOODX",
  "IAUON",
  "IBMB",
  "IEFAON",
  "INTCB",
  "INTWB",
  "KOON",
  "KORUB",
  "LLYON",
  "LMTON",
  "MCDX",
  "METAON",
  "METAX",
  "MRVLB",
  "MSFTON",
  "MSTRON",
  "MSTRX",
  "MUB",
  "MUUB",
  "MVLLB",
  "NBISB",
  "NFLXON",
  "NOKB",
  "NVDAB",
  "NVDAON",
  "NVDAX",
  "ORCLB",
  "PAXG",
  "PPLTON",
  "PYUSD",
  "QCOMB",
  "QNTB",
  "QQQB",
  "QQQON",
  "QQQX",
  "RKLBB",
  "SKHYB",
  "SLVON",
  "SMHB",
  "SNDKB",
  "SNDKON",
  "SNXXB",
  "SOXLB",
  "SOXSB",
  "SPCXB",
  "SPYB",
  "SPYON",
  "SPYX",
  "TLTON",
  "TQQQB",
  "TSLAB",
  "TSLAON",
  "TSLAX",
  "TSMB",
  "USDE",
  "USDG",
  "WDCB",
  "XAUT",
] as const;

const LOGO_SET: ReadonlySet<string> = new Set(SYMBOLS_WITH_LOGO);

/** Same-origin path of a symbol's logo, or null when the app has none. */
export function marketLogoFor(symbol: string | null | undefined): string | null {
  const key = (symbol ?? "").trim().toUpperCase();
  return LOGO_SET.has(key) ? `/icons/market/${key}.png` : null;
}

export const MARKET_LOGO_SYMBOLS: readonly string[] = SYMBOLS_WITH_LOGO;
