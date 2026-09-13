/**
 * صندوق‌ها و سهام بورس تهران — as rows of «نمای بازار».
 *
 * WHY THEY HAVE NO PRICE
 * There is no reachable live NAV / last-trade feed for the Tehran exchange
 * from where this runs (fipiran and TSETMC do not resolve — see
 * features/funds/service). Until one is wired, these rows show WHAT exists —
 * name, symbol, kind, and the drawn mark of what a fund holds — and leave both
 * prices empty. The UI marks an empty price with a small icon rather than a
 * sentence, so a long list stays readable.
 *
 * MARKET VIEW ONLY. These rows are not in the persisted market catalogue, so
 * the transaction picker never offers them (a pick there registers from the
 * catalogue and would fail). Registration stays on «ثبت صندوق و سهام».
 *
 * PURE: built from the hand-maintained catalogues, no database, no network.
 */
import { FUND_CATALOG } from "@/features/funds/catalogData";
import { STOCK_CATALOG } from "@/features/funds/stockCatalogData";
import type { MarketRow } from "./marketSearch";
import { WALLEX_KIND_LABELS } from "./wallexKinds";

export function tseMarketRows(): MarketRow[] {
  const funds: MarketRow[] = FUND_CATALOG.map((fund) => ({
    symbol: fund.symbol,
    displayName: fund.name,
    latinName: fund.symbol,
    kind: "ir_fund",
    kindLabel: WALLEX_KIND_LABELS.ir_fund,
    logoUrl: `mark:fund-${fund.kind}`,
    priceTmn: null,
    priceUsdt: null,
  }));
  const stocks: MarketRow[] = STOCK_CATALOG.map((stock) => ({
    symbol: stock.symbol,
    displayName: stock.name,
    latinName: stock.symbol,
    kind: "ir_stock",
    kindLabel: WALLEX_KIND_LABELS.ir_stock,
    logoUrl: "mark:stock",
    priceTmn: null,
    priceUsdt: null,
  }));
  return [...funds, ...stocks];
}
