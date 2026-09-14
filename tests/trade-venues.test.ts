/**
 * Where a trade happens — Iranian exchange, foreign exchange, self-custody
 * wallet — and which coins may be sent where.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  isExchangeOnlyAsset,
  placeSupportsAsset,
  venueTradeError,
  venueTransferError,
  venueTypeOf,
} from "../src/features/trade/venues";

const BITPIN = { walletName: "بیت‌پین", walletKind: "exchange" };
const WALLEX = { walletName: "wallex", walletKind: "exchange" };
const BINANCE = { walletName: "بایننس", walletKind: "exchange" };
const RABBY = { walletName: "rabby", walletKind: "hot" };
const METAMASK = { walletName: "متامسک", walletKind: "hot" };
const SAFE = { walletName: "سیف", walletKind: "hot" };
const LEDGER = { walletName: "لجر", walletKind: "cold" };
const PHANTOM = { walletName: "فانتوم", walletKind: "hot" };

const BANK = { symbol: "IRT", walletKind: "bank", walletName: "بانک ملت", name: "بانک ملت" };
const CASH_BOX = { symbol: "IRT", walletKind: "cash", walletName: "صندوق خانگی", name: "صندوق خانگی" };
const at = (symbol: string, place: { walletName: string; walletKind: string }) => ({ symbol, ...place });

const BTC = { symbol: "BTC", classCode: "crypto" };
const ETH = { symbol: "ETH", classCode: "crypto" };
const US_STOCK = { symbol: "AAPLX", classCode: "equity" };
const INDEX = { symbol: "SPX", classCode: "etf" };
const COMMODITY = { symbol: "OIL", classCode: "commodity" };

test("every catalogue place has a venue type", () => {
  assert.equal(venueTypeOf(BITPIN), "domestic_exchange");
  assert.equal(venueTypeOf(WALLEX), "domestic_exchange", "an alias maps to the same place");
  assert.equal(venueTypeOf(BINANCE), "foreign_exchange");
  assert.equal(venueTypeOf(RABBY), "evm_wallet");
  assert.equal(venueTypeOf(SAFE), "evm_wallet");
  assert.equal(venueTypeOf(LEDGER), "multichain_wallet");
  assert.equal(venueTypeOf({ walletKind: "bank", walletName: "بانک" }), "bank");
});

test("EVM-only wallets hold no Bitcoin; multichain wallets do", () => {
  for (const evm of [RABBY, METAMASK, SAFE]) {
    assert.equal(placeSupportsAsset(evm, "BTC"), false);
    assert.equal(placeSupportsAsset(evm, "SOL"), false);
    assert.equal(placeSupportsAsset(evm, "ETH"), true);
    assert.equal(placeSupportsAsset(evm, "USDE"), true);
  }
  assert.equal(placeSupportsAsset(LEDGER, "BTC"), true);
  assert.equal(placeSupportsAsset(PHANTOM, "SOL"), true);
  assert.equal(placeSupportsAsset(PHANTOM, "XRP"), false);
  assert.equal(placeSupportsAsset(BITPIN, "BTC"), true);
});

test("Iranian exchange: Toman from a bank, or Tether held there — never USDC or USDe", () => {
  for (const asset of [BTC, ETH, US_STOCK, INDEX, COMMODITY]) {
    assert.equal(venueTradeError("buy", asset, BANK, BITPIN), null, `${asset.symbol} with a bank`);
    assert.equal(venueTradeError("buy", asset, at("USDT", BITPIN), BITPIN), null, `${asset.symbol} with USDT`);
    assert.ok(venueTradeError("buy", asset, at("USDC", BITPIN), BITPIN), `${asset.symbol} with USDC`);
    assert.ok(venueTradeError("buy", asset, at("USDE", BITPIN), BITPIN), `${asset.symbol} with USDe`);
  }
  assert.ok(venueTradeError("buy", BTC, CASH_BOX, BITPIN), "Toman comes from a bank account");
});

test("foreign exchange: USDT or USDC held there; no Toman", () => {
  assert.equal(venueTradeError("buy", BTC, at("USDT", BINANCE), BINANCE), null);
  assert.equal(venueTradeError("buy", US_STOCK, at("USDC", BINANCE), BINANCE), null);
  assert.ok(venueTradeError("buy", BTC, at("USDE", BINANCE), BINANCE));
  assert.ok(venueTradeError("buy", BTC, BANK, BINANCE));
  // USDC is converted to USDT at the exchange before it buys Bitcoin elsewhere.
  assert.equal(venueTradeError("sell", { symbol: "USDC", place: BINANCE }, at("USDT", BINANCE), BINANCE), null);
});

test("self-custody wallet: coin-for-stablecoin swaps on its own networks only", () => {
  assert.equal(venueTradeError("buy", ETH, at("USDE", RABBY), RABBY), null);
  assert.equal(venueTradeError("buy", ETH, at("USDT", METAMASK), METAMASK), null);
  assert.ok(venueTradeError("buy", BTC, at("USDT", RABBY), RABBY), "no Bitcoin in Rabby");
  assert.ok(venueTradeError("buy", BTC, at("USDC", SAFE), SAFE), "no Bitcoin in Safe");
  assert.equal(venueTradeError("buy", BTC, at("USDT", LEDGER), LEDGER), null);
  for (const asset of [US_STOCK, INDEX, COMMODITY]) {
    assert.ok(isExchangeOnlyAsset(asset));
    assert.ok(venueTradeError("buy", asset, at("USDC", RABBY), RABBY), `${asset.symbol} is exchange-only`);
  }
});

test("a stablecoin pays only where it is held", () => {
  assert.ok(venueTradeError("buy", ETH, at("USDT", BITPIN), BINANCE));
  assert.ok(venueTradeError("sell", { ...ETH, place: RABBY }, at("USDT", BITPIN), null));
});

test("transfers: Bitcoin goes to Ledger or an exchange, never to Rabby, MetaMask or Safe", () => {
  assert.ok(venueTransferError("BTC", RABBY));
  assert.ok(venueTransferError("BTC", METAMASK));
  assert.ok(venueTransferError("BTC", SAFE));
  assert.equal(venueTransferError("BTC", LEDGER), null);
  assert.equal(venueTransferError("BTC", BINANCE), null);
  assert.equal(venueTransferError("USDT", RABBY), null);
});
