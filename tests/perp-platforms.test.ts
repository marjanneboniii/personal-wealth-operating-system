/**
 * Perp DEXes as places to hold a coin: Hyperliquid, Lighter (and its Robinhood
 * Chain venue), Ondo Perps and Arcus. Margin is a USDC moved in from a wallet,
 * so each is a foreign trading venue: a local logo, English spellings that map
 * to the Persian name, and no Toman account.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalWalletName, moneyPlaceError, walletKindOf, walletLogoFor } from "../src/features/setup/holdingWallets";
import { venueTypeOf } from "../src/features/trade/venues";

const PERPS: [string, string, string][] = [
  ["Hyperliquid", "هایپرلیکوئید", "/icons/wallets/hyperliquid.png"],
  ["lighter", "لایتر", "/icons/wallets/lighter.png"],
  ["Lighter Robinhood", "لایتر رابین‌هود", "/icons/wallets/lighter.png"],
  ["Ondo Perps", "اوندو پرپس", "/icons/wallets/ondo-perps.png"],
  ["arcus.xyz", "آرکوس", "/icons/wallets/arcus.png"],
];

test("each perp DEX maps from its English spelling to one Persian place with a logo on disk", () => {
  for (const [english, persian, logo] of PERPS) {
    assert.equal(canonicalWalletName(english), persian);
    assert.equal(walletKindOf(persian), "exchange");
    assert.equal(walletLogoFor(english), logo);
    assert.ok(existsSync(fileURLToPath(new URL(`../public${logo}`, import.meta.url))), `${persian} logo file exists`);
  }
});

test("a perp DEX is a foreign venue: USDC margin yes, Toman no", () => {
  for (const [, persian] of PERPS) {
    assert.equal(venueTypeOf({ walletName: persian, walletKind: "exchange" }), "foreign_exchange");
    assert.equal(moneyPlaceError("exchange", "USDC", persian), null);
    assert.ok(moneyPlaceError("exchange", "IRT", persian), `${persian} has no Toman account`);
  }
});

test("Lighter and Lighter on Robinhood Chain stay two separate places", () => {
  assert.notEqual(canonicalWalletName("lighter"), canonicalWalletName("lighter robinhood"));
});
