import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { currencyLabel, persianAssetName } from "../src/lib/format";
import { wallexKindLabel } from "../src/features/pricing/wallexKinds";

test("a real asset's global numeric key never reaches the screen as a unit", () => {
  assert.equal(currencyLabel("002"), "");
  assert.equal(currencyLabel("1007"), "");
  assert.equal(currencyLabel("USDT"), "تتر");
});

test("assets read by their Persian name", () => {
  assert.equal(persianAssetName("BTC", "Bitcoin"), "بیت‌کوین");
  assert.equal(persianAssetName("ETH", "اتریوم (ETH)"), "اتریوم");
  assert.equal(persianAssetName("NVDAX", "NVIDIA xStock", "انویدیا"), "انویدیا");
  assert.equal(persianAssetName("002", "ملک ۱"), "ملک ۱");
});

test("tokenised stocks are not labelled as US shares", () => {
  assert.equal(wallexKindLabel("tokenized_stock"), "سهام توکنیزه");
});

test("unrealised P&L colours each currency by its own sign", async () => {
  const { default: AssetValuationSummary } = await import("../src/components/assets/AssetValuationSummary");
  const html = renderToStaticMarkup(
    createElement(AssetValuationSummary, {
      totals: { valueToman: "110", valueUsd: "9", costToman: "100", costUsd: "10", pnlToman: "10", pnlUsd: "-1" },
    }),
  );
  assert.ok(html.includes("var(--positive)"), "the Toman gain is green");
  assert.ok(html.includes("var(--negative)"), "the USD loss is not green");
});
