/**
 * Reports page — «نقدینگی پیش‌رو» (forward liquidity) regression.
 *
 * Pins the user-reported bug: the projection engine returns TOMAN figures
 * (contract: "Projection unit = Toman"), but the reports table passed them
 * through toIrt() — a usd→irt conversion that multiplied every amount by the
 * live rate a SECOND time and mislabeled the raw Toman figure as "≈ دلار".
 *
 * Concrete scenario (the report exactly as the user saw it):
 *   rate = 200,000 IRT/USD, one debt installment of 909,090 TOMAN due in
 *   Shahrivar/Mehr, starting liquidity ≈ 4,922,371,394 TOMAN (~24,612 USD).
 *   Buggy render showed «۱۸۱٬۸۱۸٬۰۰۰٬۰۰۰ تومان» (= 909,090 × 200,000) and
 *   «۹۸۴٬۴۷۴٬۲۷۸٬۸۰۰٬۰۰۰ تومان» cumulative (= 4,922,371,394 × 200,000).
 *
 * The table must render «۹۰۹٬۰۹۰ تومان» with a «≈ ۴.۵۵ دلار» hint.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

/* ── Mock every server/service dependency — pure render test ── */
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("next/link", {
  defaultExport: (props: any) => React.createElement("a", { href: props.href, className: props.className }, props.children),
});

// The exact user-reported data: 909,090-Toman installment, ≈4.9B-Toman liquidity.
const RATE = "200000";
const INSTALLMENT_TOMAN = "909090";
const START_LIQUIDITY_TOMAN = "4922371394";

const PROJECTION = {
  startingLiquidity: START_LIQUIDITY_TOMAN,
  netWorth: START_LIQUIDITY_TOMAN,
  startingLiquidityToman: START_LIQUIDITY_TOMAN,
  netWorthToman: START_LIQUIDITY_TOMAN,
  startingLiquidityUsd: "24611.85697",
  netWorthUsd: "24611.85697",
  scenario: "base",
  unit: "IRT",
  points: [
    { month: "2026-08-01", inflow: "0", outflow: "0", net: "0", cumulative: "4922371394", inflowUsd: "0", outflowUsd: "0", cumulativeUsd: "24611.85697", deficit: false },
    { month: "2026-09-01", inflow: "0", outflow: INSTALLMENT_TOMAN, net: "-909090", cumulative: "4921462304", inflowUsd: "0", outflowUsd: "4.54545", cumulativeUsd: "24607.31152", deficit: false },
    { month: "2026-10-01", inflow: "0", outflow: INSTALLMENT_TOMAN, net: "-909090", cumulative: "4920553214", inflowUsd: "0", outflowUsd: "4.54545", cumulativeUsd: "24602.76607", deficit: false },
  ],
};

mock.module("@/lib/authGuard", { namedExports: { ensureAuth: async () => {} } });
mock.module("@/db/seed", { namedExports: { seedIfEmpty: async () => {} } });
mock.module("@/features/ledger/queries", {
  namedExports: {
    getAccountBalances: async () => [],
    getCashflow: async () => [],
    getHoldings: async () => [],
    getRealizedPnl: async () => ({ total: "0", bySymbol: [] }),
  },
});
mock.module("@/features/planning/service", {
  namedExports: {
    listDebts: async () => [],
    projectCashflow: async () => PROJECTION,
  },
});
mock.module("@/features/portfolio/service", {
  namedExports: {
    getCurrentNetWorth: async () => ({
      netWorth: "24611.85697",
      netWorthToman: START_LIQUIDITY_TOMAN,
      totalAssets: "24611.85697",
      totalAssetsToman: START_LIQUIDITY_TOMAN,
      totalLiabilities: "0",
      totalLiabilitiesToman: "0",
      liquid: "24611.85697",
      liquidToman: START_LIQUIDITY_TOMAN,
      valuation: { totalUnrealizedPnl: "0", totalUnrealizedPnlToman: "0" },
    }),
  },
});
mock.module("@/lib/fx", {
  namedExports: {
    getLatestUsdIrtRate: async () => ({ rate: RATE, effectiveDate: "2026-08-01", source: "manual" }),
  },
});
mock.module("@/components/RowAction", { defaultExport: () => null });
mock.module("@/components/reports/PdfButton", { defaultExport: () => null });
mock.module("@/components/charts/Charts", { namedExports: { BarsChart: () => null } });

const NBSP = " ";

/** Isolate the «نقدینگی پیش‌رو» section so assertions can't be satisfied by
 *  unrelated numbers elsewhere on the reports page (KPI strip, monthly
 *  table, …). Runs from the section header to the closing `</table>`. */
function forwardLiquiditySection(html: string): string {
  const start = html.indexOf("نقدینگی پیش‌رو");
  assert.notEqual(start, -1, "reports page must contain the نقدینگی پیش‌رو section");
  const end = html.indexOf("</table>", start);
  assert.notEqual(end, -1, "forward liquidity table must render");
  return html.slice(start, end);
}

test("forward liquidity renders Toman AS-IS — no second FX multiplication", async () => {
  const { default: ReportsPage } = await import("../src/app/reports/page");
  const html = forwardLiquiditySection(renderToStaticMarkup(await (ReportsPage as any)()));

  // The 909,090-Toman installment renders as-is in the outflow column…
  assert.ok(
    html.includes(`۹۰۹٬۰۹۰${NBSP}تومان`),
    "installment must render as «۹۰۹٬۰۹۰ تومان»",
  );
  // …NOT re-multiplied by the 200,000 rate (the bug the user reported).
  assert.ok(
    !html.includes("۱۸۱٬۸۱۸٬۰۰۰٬۰۰۰"),
    "outflow must never be re-multiplied by the FX rate (181,818,000,000 = 909,090 × 200,000)",
  );
  // «نقدینگی تجمیعی» was removed from the forward-liquidity UI entirely
  // (its computation stays in the service for /planning's end-of-year KPI).
  assert.ok(!html.includes("نقدینگی تجمعی"), "the نقدینگی تجمیعی column must be gone from the UI");
  assert.ok(!html.includes(`۴٬۹۲۲٬۳۷۱٬۳۹۴${NBSP}تومان`), "cumulative figures must not be rendered as a column");

  // The USD hint is the Toman amount ÷ rate (909,090 ÷ 200,000 = 4.55 USD)…
  assert.ok(html.includes(`۴.۵۵${NBSP}دلار`), "USD hint must be the ÷-rate equivalent (≈ ۴.۵۵ دلار)");
  // …never the Toman figure mislabeled as dollars (the old «≈ ۹۰۹٬۰۹۰ دلار»).
  assert.ok(!html.includes(`۹۰۹٬۰۹۰${NBSP}دلار`), "Toman figure must never be labeled as USD");
  assert.ok(!html.includes(`۴٬۹۲۲٬۳۷۱٬۳۹۴${NBSP}دلار`), "Toman figure must never be labeled as USD");
});

test("forward liquidity USD hints follow the rate (display-only, Toman stays fixed)", async () => {
  const { default: ReportsPage } = await import("../src/app/reports/page");
  const html = forwardLiquiditySection(renderToStaticMarkup(await (ReportsPage as any)()));
  // The monthly outflow hint is 909,090 ÷ 200,000 = 4.55 USD.
  assert.ok(html.includes(`۴.۵۵${NBSP}دلار`), "outflow USD hint must be the ÷-rate equivalent");
  // The removed cumulative column must not reappear with any stale hints.
  assert.ok(!html.includes("نقدینگی تجمعی"), "نقدینگی تجمیعی must not be rendered");
  assert.ok(!html.includes("۲۴٬۶۱۱.۸۶"), "cumulative USD hint must be gone with the column");
});
