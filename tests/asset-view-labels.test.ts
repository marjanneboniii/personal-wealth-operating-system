/**
 * Asset views — Persian labels and the split Toman/USD valuation box.
 *
 * Covers four requested front-end cleanups, all presentation-only:
 *
 *   1. «ETH» is never shown as a Latin ticker in a table, card or asset list —
 *      the asset reads «اتریوم».
 *   2. The English freshness badge is gone. It used to sit flush against the
 *      valuation-basis chip and read as one word: «مبنای دلارFresh» /
 *      «مبنای تومانFresh».
 *   3. The «ارزش‌گذاری دارایی‌ها» box states SIX figures — current value, cost
 *      basis and unrealized P&L, each once in Toman and once in USD, each with
 *      its own label — instead of a headline amount with a hidden «≈» twin.
 *   4. The box is currency-consistent with the table it sits on: its totals are
 *      the Σ of the very rows the table renders.
 *
 * Renders the REAL client components through React 19 SSR — no DOM mocks,
 * no database.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { D } from "../src/domain/decimal";
import { currencyLabel, formatMoney, formatSignedMoney } from "../src/lib/format";

async function render(node: unknown): Promise<string> {
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(node as never, {
    onError(error: unknown) {
      errors.push(error);
    },
  });
  const html = await new Response(stream).text();
  assert.deepEqual(errors.map((e) => String((e as Error)?.message ?? e)), [], "component must render without errors");
  return html;
}

function valuationRow(overrides: Record<string, unknown> = {}): any {
  return {
    assetId: "eth-1",
    symbol: "ETH",
    name: "اتریوم",
    logoUrl: null,
    className: "رمزارز",
    classColor: "#627eea",
    decimals: 8,
    quantity: "4",
    marketPrice: "3200",
    marketCurrencyCode: "USD",
    currentValue: "12800",
    currentValueToman: "2432000000",
    costBasis: "2400",
    costBasisToman: "456000000",
    historicalCostToman: "456000000",
    unrealizedPnl: "10400",
    unrealizedPnlToman: "1976000000",
    roiPercentage: "433.33",
    sharePercentage: "100",
    valuationBasis: "coingecko",
    valuationBase: "usd",
    priceFreshness: "fresh",
    priceObservedAt: "2026-09-01",
    ...overrides,
  };
}

/* ─────────────────────────── 1 + 2 · holdings table ─────────────────────────── */

test("HoldingsTable names Ethereum in Persian and carries no Latin freshness badge", async () => {
  const { default: HoldingsTable } = await import("../src/components/assets/HoldingsTable");
  const html = await render(
    createElement(HoldingsTable, { rows: [valuationRow()], toIrt: (usd: string | number) => `${usd} تومان` }),
  );

  // The ticker line under the asset name is the Persian name, never «ETH».
  assert.ok(html.includes("اتریوم"), "the asset reads «اتریوم»");
  assert.ok(!/>\s*ETH\s*</.test(html), "no raw ETH ticker in the row");

  // No English freshness word anywhere — and therefore no glued
  // «مبنای دلارFresh» / «مبنای تومانFresh».
  for (const banned of ["Fresh", "Stale", "Unavailable", "دلارFresh", "تومانFresh"]) {
    assert.ok(!html.includes(banned), `«${banned}» must not reach the UI`);
  }

  // A CURRENT price is the normal case: no badge at all next to the basis chip.
  assert.ok(html.includes("مبنای دلار"), "the valuation basis chip is still explained");
  assert.ok(!/مبنای دلار<\/span>\s*<span[^>]*>/.test(html.replace(/<!--.*?-->/g, "")), "nothing follows the basis chip when the price is current");

  // An outdated price IS announced, in Persian.
  const stale = await render(
    createElement(HoldingsTable, {
      rows: [valuationRow({ assetId: "irt-1", symbol: "IRT", name: "تومان", valuationBase: "toman", priceFreshness: "stale" })],
      toIrt: (usd: string | number) => `${usd} تومان`,
    }),
  );
  assert.ok(stale.includes("قیمت قدیمی"), "a stale price says so in Persian");
  assert.ok(stale.includes("مبنای تومان"), "Toman-anchored rows keep their basis chip");
  assert.ok(!stale.includes("Fresh"), "and still no Fresh badge");
});

/* ─────────────────────────────── 3 + 4 · the box ─────────────────────────────── */

test("the asset-valuation box separates every figure into Toman and USD", async () => {
  const { default: AssetValuationSummary, valuationTotalsOf } = await import(
    "../src/components/assets/AssetValuationSummary"
  );
  const totals = valuationTotalsOf([valuationRow()]);

  const html = await render(createElement(AssetValuationSummary, { totals, hint: "نمونه" }));

  // Six separate, labelled figures — the three the user asked for, twice.
  for (const label of [
    "ارزش روز تومانی",
    "ارزش روز دلاری",
    "بهای تمام‌شده تومانی",
    "بهای تمام‌شده دلاری",
    "سود/زیان تحقق‌نیافته تومانی",
    "سود/زیان تحقق‌نیافته دلاری",
  ]) {
    assert.ok(html.includes(label), `the box must label «${label}»`);
  }
  for (const group of ["ارزش روز سبد", "بهای تمام‌شده", "سود / زیان تحقق‌نیافته"]) {
    assert.ok(html.includes(group), `the box must carry the «${group}» group`);
  }

  // Each value is the read model's own figure, formatted by the shared money
  // formatter — never a hand-glued «تومان» suffix.
  assert.ok(html.includes(formatMoney(totals.valueToman, "IRT")), "current value in Toman");
  assert.ok(html.includes(formatMoney(totals.valueUsd, "USD")), "current value in USD");
  assert.ok(html.includes(formatMoney(totals.costToman, "IRT")), "cost basis in Toman");
  assert.ok(html.includes(formatMoney(totals.costUsd, "USD")), "cost basis in USD");
  assert.ok(html.includes(formatSignedMoney(totals.pnlToman, "IRT")), "unrealized P&L in Toman");
  assert.ok(html.includes(formatSignedMoney(totals.pnlUsd, "USD")), "unrealized P&L in USD");

  // The spec's canonical shape: 15,995,133,656 / 75,233.07 …
  const specRow = valuationRow({
    assetId: "all",
    symbol: "IRT",
    currentValue: "75233.07",
    currentValueToman: "15995133656",
    costBasis: "73275.81",
    unrealizedPnl: "1957.26",
    unrealizedPnlToman: "7059250353",
    costBasisToman: D("15995133656").sub("7059250353").toFixed(0),
  });
  const spec = valuationTotalsOf([specRow]);
  assert.equal(spec.valueToman, "15995133656");
  assert.equal(spec.costToman, "8935883303");
  assert.equal(spec.pnlToman, "7059250353");
  // value = cost + P&L must hold in BOTH currencies, or the box contradicts
  // itself the way the old mixed Toman-canonical / USD-frozen pair did.
  assert.equal(D(spec.valueToman).sub(spec.costToman).toFixed(0), spec.pnlToman, "Toman identity");
  assert.ok(
    D(spec.valueUsd).sub(spec.costUsd).sub(spec.pnlUsd).abs().lt("0.01"),
    "USD identity: 75,233.07 − 73,275.81 = 1,957.26",
  );
  const specHtml = await render(createElement(AssetValuationSummary, { totals: spec }));
  assert.ok(specHtml.includes(formatMoney("15995133656", "IRT")), "۱۵٬۹۹۵٬۱۳۳٬۶۵۶ تومان");
  assert.ok(specHtml.includes(formatMoney("75233.07", "USD")), "۷۵٬۲۳۳.۰۷ دلار");
});

test("the box stays currency-consistent with the table it summarizes", async () => {
  const { default: HoldingsTable } = await import("../src/components/assets/HoldingsTable");
  const { valuationTotalsOf } = await import("../src/components/assets/AssetValuationSummary");
  const rows: any[] = [
    valuationRow(),
    valuationRow({
      assetId: "btc-1",
      symbol: "BTC",
      name: "بیت‌کوین",
      quantity: "0.5",
      marketPrice: "95000",
      currentValue: "47500",
      currentValueToman: "9025000000",
      costBasis: "21000",
      costBasisToman: "3990000000",
      unrealizedPnl: "26500",
      unrealizedPnlToman: "5035000000",
    }),
  ];
  const totals = valuationTotalsOf(rows);
  assert.equal(totals.valueToman, D(rows[0].currentValueToman).add(rows[1].currentValueToman).toFixed(0));
  assert.equal(totals.costToman, D(totals.valueToman).sub(totals.pnlToman).toFixed(0), "box never contradicts its own P&L");

  const html = await render(createElement(HoldingsTable, { rows, toIrt: (u: string | number) => `${u} تومان` }));
  // Every row amount the table prints appears in the table; the box is built
  // from the same rows, so the two views cannot drift apart.
  assert.ok(html.includes(formatMoney(rows[0].currentValueToman, "IRT")), "row value renders from currentValueToman");
  assert.ok(!html.includes("Fresh"), "and the table has no English freshness badge");
});

/* ───────────────────────────── wallet + currency wording ─────────────────────── */

test("no UI label calls a wallet «کیف داغ» anymore", async () => {
  const fs = await import("node:fs/promises");
  const files = [
    "src/app/accounts/page.tsx",
    "src/components/forms/WalletForm.tsx",
    "src/components/forms/MoneyAccountForm.tsx",
    "src/i18n/fa.ts",
    "src/features/setup/service.ts",
  ];
  for (const file of files) {
    const src = await fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");
    // «داغ» (hot) and «گرم» as a wallet adjective are both custody jargon.
    // NOTE: «گرم» is also the Persian word for grams (gold), so only the
    // wallet-phrase form is banned here.
    assert.ok(!src.includes("داغ"), `${file} still uses the hot-wallet wording`);
    assert.ok(!/کیف[^ ]* (گرم|داغ)|["'](گرم|داغ)["']/.test(src), `${file} still names a wallet hot/cold jargon`);
  }
  // The container accounts the wizard provisions read Persian too.
  const setup = await fs.readFile(new URL("../src/features/setup/service.ts", import.meta.url), "utf8");
  assert.ok(setup.includes("کیف پول اتریوم"), "the ETH container account is named in Persian");
  assert.ok(!setup.includes("(ETH)"), "no Latin ticker inside a stored account name");
});

test("currencyLabel maps ETH to its Persian name", async () => {
  assert.equal(currencyLabel("ETH"), "اتریوم");
  assert.ok(formatMoney("4", "ETH").includes("اتریوم"), "money in ETH reads «… اتریوم»");
});
