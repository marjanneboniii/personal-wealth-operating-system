/**
 * §2 — Presentation-layer Toman consistency for inherently-Toman real assets.
 *
 * Two reported portfolio bugs, both fixed at the read-model / presentation
 * layer (no accounting, FIFO or GL change):
 *
 *  1. A Toman-denominated asset (ملک/خودرو) whose stored USD figure is FROZEN
 *     at its valuation-date rate must never show a Toman market price that is
 *     re-derived as `frozenUSD × today's rate` (that used to inflate the Toman
 *     price when the dollar rose). The Toman market price must equal the
 *     asset's own static Toman value.
 *  2. The per-row P&L is Toman-canonical. A property bought for 4.5B toman and
 *     now worth 7B toman shows a TOMAN GAIN (+2.5B, green) even when its USD
 *     equivalent fell (frozen-USD P&L negative) — the two must never
 *     contradict the displayed (Toman) value.
 *
 * Renders the REAL client component via React SSR (no DOM mocks, no DB).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";

let HoldingsTable: any;
const modulesReady = (async () => {
  ({ default: HoldingsTable } = await import("../src/components/assets/HoldingsTable"));
})();

function propertyRow(overrides: Record<string, unknown>) {
  return {
    assetId: "re1",
    symbol: "RE-001",
    name: "ملک آپارتمان",
    logoUrl: null,
    className: "املاک",
    classColor: "#0ea5e9",
    decimals: 0,
    quantity: "1",
    marketPrice: "46666.67", // frozen USD value at valuation-date rate (7B ÷ 150k)
    marketCurrencyCode: "USD",
    currentValue: "46666.67",
    currentValueToman: "7000000000", // static Toman value — must not move with the rate
    costBasis: "50000", // frozen USD cost (4.5B ÷ 90k)
    costBasisToman: "4500000000",
    historicalCostToman: "4500000000",
    unrealizedPnl: "-3333.33", // USD equivalent FELL (frozen basis)
    unrealizedPnlToman: "2500000000", // Toman P&L: 7B − 4.5B = GAIN
    roiPercentage: "-6.67",
    sharePercentage: "0",
    valuationBasis: "manual_real_asset",
    priceFreshness: "fresh",
    priceObservedAt: "2026-08-01",
    ...overrides,
  };
}

/**
 * If any cell still derived the Toman price as `toIrt(frozenUSD)` this sentinel
 * would leak into the markup — it proves no presentation path re-scales a
 * frozen USD figure by a rate anymore.
 */
const toIrt = (usd: string | number) => `SENTINEL-${usd} تومان`;

async function render(rows: any[]): Promise<string> {
  const stream = await renderToReadableStream(
    createElement(HoldingsTable, { rows, toIrt }),
  );
  return await new Response(stream).text();
}

test("Toman market price for a Toman real asset is its static Toman value — never frozenUSD × today's rate", async () => {
  await modulesReady;
  const html = await render([propertyRow({})]);

  assert.ok(!html.includes("SENTINEL"), "no cell may re-derive Toman from frozen USD × rate");
  // The asset's own static Toman value is shown as the Toman market price.
  assert.ok(html.includes("۷٬۰۰۰٬۰۰۰٬۰۰۰"), "market price must equal the static Toman value");
});

test("a Toman real-asset GAIN stays green/positive even when its USD equivalent FELL", async () => {
  await modulesReady;
  const html = await render([propertyRow({})]);
  const pnlCell = html.split("سود/زیان")[1] ?? "";

  assert.ok(pnlCell.includes("var(--positive)"), "Toman gain must be green");
  assert.ok(!pnlCell.includes("var(--negative)"), "USD loss must NOT make the Toman-gain row red");
  assert.ok(pnlCell.includes("+"), "Toman gain keeps its plus sign");
  assert.ok(pnlCell.includes("۲٬۵۰۰٬۰۰۰٬۰۰۰"), "shows the Toman gain magnitude");
});

test("a Toman real-asset LOSS stays red/negative even when its USD equivalent ROSE", async () => {
  await modulesReady;
  const html = await render([
    propertyRow({
      currentValueToman: "7000000000",
      costBasisToman: "10000000000",
      historicalCostToman: "10000000000",
      unrealizedPnl: "3333.33", // USD rose on frozen basis
      unrealizedPnlToman: "-3000000000", // Toman: 7B − 10B = LOSS
    }),
  ]);
  const pnlCell = html.split("سود/زیان")[1] ?? "";

  assert.ok(pnlCell.includes("var(--negative)"), "Toman loss must be red");
  assert.ok(!pnlCell.includes("var(--positive)"), "USD rise must NOT make the Toman-loss row green");
  assert.ok(pnlCell.includes("−"), "Toman loss keeps its minus sign");
  assert.ok(pnlCell.includes("۳٬۰۰۰٬۰۰۰٬۰۰۰"), "shows the Toman loss magnitude");
});
