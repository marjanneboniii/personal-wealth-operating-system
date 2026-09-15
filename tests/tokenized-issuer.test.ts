/**
 * دارایی توکنیزه — one company, several issuers. The issuer is a short Persian
 * tag after the name, and a tokenised asset moves only as itself.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { tokenIssuerOf, withIssuerTag } from "../src/features/pricing/wallexKinds";
import { networksForHolding } from "../src/features/trade/networks";
import { transferDestinationError } from "../src/features/trade/venues";

const BITPIN = { walletName: "بیت‌پین", walletKind: "exchange" };
const RABBY = { walletName: "ربی والت", walletKind: "hot" };
const at = (symbol: string, place: { walletName: string; walletKind: string }) => ({ symbol, ...place });

test("the issuer is read from the source's name, else from the ticker", () => {
  assert.equal(tokenIssuerOf("AMZNON"), "ondo");
  assert.equal(tokenIssuerOf("AMZNX"), "xstock");
  assert.equal(tokenIssuerOf("SPCXB", "SpaceX Tokenized bStocks"), "bstock");
  assert.equal(tokenIssuerOf("NFLXON", "Netflix stock price"), "ondo");
  assert.equal(tokenIssuerOf("SPYX", "SP500 tokenized ETF (xStock)"), "xstock");
});

test("two tokens of one company read apart, in short Persian", () => {
  assert.equal(withIssuerTag("آمازون", "AMZNON", "tokenized_stock"), "آمازون اندو");
  assert.equal(withIssuerTag("آمازون", "AMZNX", "tokenized_stock"), "آمازون ایکس");
  assert.equal(withIssuerTag("اسپیس‌ایکس", "SPCXB", "tokenized_stock", "SpaceX Tokenized bStocks"), "اسپیس‌ایکس بی");
  assert.equal(withIssuerTag("توکن نفت", "USOON", "commodity"), "توکن نفت اندو");
  assert.equal(withIssuerTag("آمازون ایکس", "AMZNX", "tokenized_stock"), "آمازون ایکس", "never tagged twice");
  assert.equal(withIssuerTag("ترون", "TRX", "crypto"), "ترون", "a coin keeps its name");
});

test("a tokenised asset moves between exchanges and wallets as itself — never into Toman", () => {
  const networks = networksForHolding("AMZNX", "equity", null);
  assert.deepEqual(networks, ["evm", "solana"]);
  assert.deepEqual(networksForHolding("AMZNON", "equity", null), ["evm"]);
  assert.equal(networksForHolding("TRX", "crypto", null), null, "a coin without synced networks gets none invented");

  assert.equal(transferDestinationError(at("AMZNX", BITPIN), at("AMZNX", RABBY), networks), null, "آمازون ایکس - بیت‌پین → آمازون ایکس - ربی والت");
  assert.ok(transferDestinationError(at("AMZNX", BITPIN), at("AMZNON", RABBY), ["evm"]), "another issuer is another asset");
  assert.ok(transferDestinationError(at("AMZNX", BITPIN), { symbol: "IRT", walletKind: "bank", name: "بانک شهر" }), "never into Toman");
  assert.ok(transferDestinationError(at("AMZNX", BITPIN), at("IRT", BITPIN)), "not even Toman at the same exchange");
});
