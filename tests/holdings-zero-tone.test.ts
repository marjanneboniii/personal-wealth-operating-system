/**
 * §2 — سود تحقق‌یافته/تحقق‌نیافته صفر: منطق رنگ بی‌طرف (regression).
 *
 * The reported Portfolio bug: a flat (zero-PnL) holding rendered GREEN with a
 * «+» sign and an «↑» arrow, because the table cell hard-wired
 * `pnl.isNegative() ? negative : positive`. Zero must be neutral grey with NO
 * sign and NO arrow (Global System Directive §2 / §4 — zero-is-neutral).
 *
 * Renders the REAL client component via React 19 SSR (no DOM mocks, no DB).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";

let HoldingsTable: any;

async function loadModules() {
  ({ default: HoldingsTable } = await import("../src/components/assets/HoldingsTable"));
}
const modulesReady = loadModules();

function row(overrides: Record<string, unknown>) {
  return {
    assetId: "a1",
    symbol: "BTC",
    name: "بیت‌کوین",
    logoUrl: null,
    className: "رمزارز",
    classColor: "#f7931a",
    decimals: 8,
    quantity: "0.5",
    marketPrice: "100",
    marketCurrencyCode: "USD",
    currentValue: "50",
    currentValueToman: "9500000",
    costBasis: "50",
    historicalCostToman: null,
    unrealizedPnl: "0",
    unrealizedPnlToman: "0",
    roiPercentage: "0",
    sharePercentage: "50",
    valuationBasis: "coingecko",
    priceFreshness: "fresh",
    priceObservedAt: "2026-08-01",
    ...overrides,
  };
}

const toIrt = (usd: string | number) => `‏${usd} تومان‏`;

async function render(rows: any[]): Promise<string> {
  const stream = await renderToReadableStream(
    createElement(HoldingsTable, { rows, toIrt }),
  );
  return await new Response(stream).text();
}

test("§2 a zero-PnL holding renders NEUTRAL — no green, no «+», no «↑»", async () => {
  await modulesReady;
  const html = await render([row({})]);
  const pnlCell = html.split("سود/زیان")[1] ?? "";

  // Colour: the PnL cell resolves through trendColor → neutral grey…
  assert.ok(
    pnlCell.includes("var(--text-2)"),
    "zero PnL must be painted the neutral grey (var(--text-2))",
  );
  assert.ok(
    !pnlCell.includes("var(--positive)"),
    "zero PnL must never be green (var(--positive))",
  );
  assert.ok(
    !pnlCell.includes("var(--negative)"),
    "zero PnL must never be red (var(--negative))",
  );

  // Sign/arrow: zero gets neither «+» nor «↑»…
  assert.ok(!/>·?\s*\+/.test(pnlCell), "no plus sign on a flat position");
  assert.ok(!pnlCell.includes("↑"), "no up arrow on a flat position");
  // …and the ROI line uses the neutral dash instead.
  assert.ok(pnlCell.includes("—"), "zero ROI shows the neutral «—» marker");
});

test("§2 non-zero PnL keeps its semantic colour, sign and arrow", async () => {
  await modulesReady;
  const html = await render([
    row({ assetId: "g1", symbol: "ETH", name: "اتریوم", unrealizedPnl: "12.5", unrealizedPnlToman: "2500000", costBasisToman: "10000000", roiPercentage: "25" }),
    row({ assetId: "l1", symbol: "SOL", name: "سولانا", unrealizedPnl: "-4.5", unrealizedPnlToman: "-900000", costBasisToman: "10000000", roiPercentage: "-9" }),
  ]);
  const body = html.split("سود/زیان")[1] ?? "";

  // Gain → green + «+» + «↑»; loss → red + «−» + «↓» — one of each, both
  // driven by the SAME tone helper (trendTone/trendColor/trendArrow).
  assert.ok(body.includes("var(--positive)"), "a real gain stays green");
  assert.ok(body.includes("var(--negative)"), "a real loss stays red");
  assert.ok(body.includes("+"), "a real gain keeps its plus sign");
  assert.ok(body.includes("−"), "a real loss keeps its minus sign");
  assert.ok(body.includes("↑"), "a positive ROI keeps its up arrow");
  assert.ok(body.includes("↓"), "a negative ROI keeps its down arrow");
});
