/**
 * Searching the fund and stock catalogue — pure, database-free.
 *
 * Persian search has to forgive things a naive `includes` does not: users type
 * ي and ك from an Arabic keyboard, type «زر افشان» for «زرافشان», and paste
 * text carrying a ZWNJ. Folding all of that away for MATCHING (never for
 * display) is the difference between a picker that feels broken and one that
 * finds the fund on the second keystroke.
 *
 * Kept separate from the service so the wizard can import it without dragging
 * `pg` into the browser bundle — the same split the onboarding checklist needed.
 */
import { FUND_CATALOG, FUND_KIND_LABELS, type FundKind, type FundSeed } from "./catalogData";

export type FundSearchResult = FundSeed & { kindLabel: string };

/**
 * Normalise for comparison only. Arabic ي/ك → Persian ی/ک, ZWNJ and all
 * whitespace removed, Persian/Arabic digits → Latin. The returned VALUE is
 * always the untouched catalogue entry.
 */
export function foldPersian(value: string): string {
  return value
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ۀة]/g, "ه")
    .replace(/[أإآ]/g, "ا")
    .replace(/[‌\s]+/g, "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .trim()
    .toLowerCase();
}

/**
 * Ranked matches. An exact symbol beats a symbol prefix, which beats a hit
 * anywhere in the name — so typing «زر» offers صندوق زر before صندوق زرفام,
 * instead of whichever happened to be declared first.
 */
export function searchFunds(
  query: string,
  options: { kind?: FundKind; limit?: number } = {},
): FundSearchResult[] {
  const pool = options.kind
    ? FUND_CATALOG.filter((f) => f.kind === options.kind)
    : FUND_CATALOG;
  const limit = options.limit ?? 10;

  const q = foldPersian(query);
  if (!q) {
    // An unfiltered, unsearched list must not be the first N of a gold-first
    // catalogue: that showed twelve gold funds and nothing else, so the «همه»
    // tab looked like the product only supported طلا. Round-robin the kinds so
    // all three families are visible before the user types anything.
    return options.kind
      ? pool.slice(0, limit).map(decorate)
      : interleaveByKind(pool, limit).map(decorate);
  }

  const scored: { fund: FundSeed; score: number }[] = [];
  for (const fund of pool) {
    const symbol = foldPersian(fund.symbol);
    const name = foldPersian(fund.name);
    let score: number;
    if (symbol === q) score = 0;
    else if (symbol.startsWith(q)) score = 1;
    else if (symbol.includes(q)) score = 2;
    else if (name.startsWith(q)) score = 3;
    else if (name.includes(q)) score = 4;
    else continue;
    scored.push({ fund, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.fund.symbol.localeCompare(b.fund.symbol, "fa"))
    .slice(0, limit)
    .map((s) => decorate(s.fund));
}

/** One from each kind in turn, so an empty query represents every family. */
function interleaveByKind(pool: readonly FundSeed[], limit: number): FundSeed[] {
  const buckets = new Map<FundKind, FundSeed[]>();
  for (const fund of pool) {
    const bucket = buckets.get(fund.kind);
    if (bucket) bucket.push(fund);
    else buckets.set(fund.kind, [fund]);
  }
  const queues = [...buckets.values()];
  const out: FundSeed[] = [];
  let index = 0;
  while (out.length < limit && queues.some((q) => index < q.length)) {
    for (const queue of queues) {
      if (out.length >= limit) break;
      if (index < queue.length) out.push(queue[index]);
    }
    index += 1;
  }
  return out;
}

function decorate(fund: FundSeed): FundSearchResult {
  return { ...fund, kindLabel: FUND_KIND_LABELS[fund.kind] };
}

export { FUND_KIND_LABELS };
export type { FundKind, FundSeed };
