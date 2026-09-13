/**
 * Market search — PURE and database-free, so the browser runs it.
 *
 * WHY THE SEARCH MOVED TO THE CLIENT
 * The picker used to call a server action on every keystroke (debounced), and
 * each call first made sure the catalogue was fresh — which, when it was not,
 * meant waiting on two exchange downloads, one of them ~1 MB. Typing felt
 * frozen. The whole catalogue is a few hundred short rows, so it is loaded
 * ONCE and every keystroke is ranked here, in memory, in well under a frame.
 *
 * The same function ranks on the server, so the two can never disagree about
 * what «matches»: exact symbol, then symbol prefix, then name prefix, then a
 * hit anywhere — with the Persian folding the fund search already uses.
 *
 * A row carries no exchange name. What the user sees is the asset.
 */
import { foldPersian } from "@/features/funds/search";

export type MarketRow = {
  symbol: string;
  displayName: string;
  latinName: string;
  kind: string;
  /** Persian label for the kind. */
  kindLabel: string;
  logoUrl: string | null;
  /** Toman per unit. */
  priceTmn: string | null;
  /** Tether per unit. */
  priceUsdt: string | null;
};

export function rankMarketRows<T extends MarketRow>(
  rows: readonly T[],
  query: string,
  options: { kinds?: readonly string[]; limit?: number } = {},
): T[] {
  const kinds = options.kinds && options.kinds.length > 0 ? new Set(options.kinds) : null;
  const pool = kinds ? rows.filter((r) => kinds.has(r.kind)) : [...rows];
  const limit = options.limit ?? pool.length;
  const q = foldPersian(query);
  if (!q) return pool.slice(0, limit);

  const scored: { row: T; score: number }[] = [];
  for (const row of pool) {
    const symbol = foldPersian(row.symbol);
    const display = foldPersian(row.displayName);
    let score: number;
    if (symbol === q) score = 0;
    else if (symbol.startsWith(q)) score = 1;
    else if (display.startsWith(q)) score = 2;
    else if (symbol.includes(q)) score = 3;
    else if (display.includes(q)) score = 4;
    else if (foldPersian(row.latinName).includes(q)) score = 5;
    else continue;
    scored.push({ row, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.row.displayName.localeCompare(b.row.displayName, "fa"))
    .slice(0, limit)
    .map((s) => s.row);
}
