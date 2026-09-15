/**
 * خرید و فروش دارایی — the pair rules and price arithmetic shared by the form
 * and the server action.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  isTomanBankAccount,
  isTomanOnlyInstrument,
  priceUnitFor,
  quoteTrade,
  registrySaleError,
  settlementUnitOf,
  tradePairError,
  tradeRouteFor,
  MARKET_TOMAN_MESSAGE,
  TOMAN_ONLY_MESSAGE,
} from "../src/features/trade/rules";

const ETH = { symbol: "ETH", classCode: "crypto", className: "رمزارز" };
const US_STOCK = { symbol: "AAPLX", classCode: "equity", className: "سهام توکنیزه" };
const GOLD_FUND = { symbol: "طلا", classCode: "fund", className: "صندوق سرمایه‌گذاری" };
const TSE_STOCK = { symbol: "فولاد", classCode: "stock", className: "سهام" };
const MELTED_GOLD = { symbol: "GOLD18", classCode: "gold", className: "طلا" };
const TOKENISED_GOLD = { symbol: "PAXG", classCode: "gold", className: "طلا" };
const USDT = { symbol: "USDT", classCode: "stable", className: "استیبل‌کوین" };

const BANK = { symbol: "IRT", walletKind: "bank", name: "بانک ملت" };
const CASH_BOX = { symbol: "IRT", walletKind: "cash", name: "صندوق خانگی" };
const TOMAN_FUND_WALLET = { symbol: "IRT", walletKind: "fund", name: "صندوق نقد" };
const USDT_WALLET = { symbol: "USDT", walletKind: "exchange", name: "کیف تتر" };
const TOMAN_EXCHANGE = { symbol: "IRT", walletKind: "exchange", walletName: "نوبیتکس", name: "تومان - نوبیتکس" };
const TOMAN_FOREIGN = { symbol: "IRT", walletKind: "exchange", walletName: "بای‌بیت", name: "تومان - بای‌بیت" };
const BROKER = { symbol: "IRT", walletKind: "broker", walletName: "کارگزاری مفید", name: "تومان - کارگزاری مفید" };

test("every trade settles in Toman or a stablecoin — never in another position", () => {
  assert.equal(settlementUnitOf("IRT"), "toman");
  assert.equal(settlementUnitOf("USDT"), "stablecoin");
  assert.equal(settlementUnitOf("USDC"), "stablecoin");
  for (const position of ["BTC", "ETH", "GOLD18", "PAXG", "AAPLX"]) {
    assert.equal(settlementUnitOf(position), null, position);
    assert.ok(tradePairError("buy", ETH, position === "ETH" ? "BTC" : position));
  }
});

test("crypto and tokenised assets trade with Toman at an Iranian exchange or with Tether — never a bank", () => {
  for (const asset of [ETH, { ...ETH, symbol: "SOL" }, US_STOCK, TOKENISED_GOLD]) {
    assert.equal(tradePairError("buy", asset, USDT_WALLET), null);
    assert.equal(tradePairError("buy", asset, TOMAN_EXCHANGE), null);
    assert.equal(tradePairError("sell", asset, USDT_WALLET), null);
    for (const settle of [BANK, CASH_BOX, TOMAN_FUND_WALLET, BROKER, TOMAN_FOREIGN]) {
      assert.equal(tradePairError("buy", asset, settle), MARKET_TOMAN_MESSAGE, `${asset.symbol} with ${settle.name}`);
    }
  }
});

test("Iranian-market assets settle through Toman at a brokerage only", () => {
  for (const asset of [GOLD_FUND, TSE_STOCK, MELTED_GOLD, { symbol: "X", kind: "ir_fund" }]) {
    assert.ok(isTomanOnlyInstrument(asset), asset.symbol);
    assert.equal(tradePairError("buy", asset, BROKER), null, `${asset.symbol} at a brokerage`);
    assert.equal(tradePairError("sell", asset, BROKER), null);
    for (const settle of [BANK, TOMAN_EXCHANGE, USDT_WALLET, CASH_BOX, TOMAN_FUND_WALLET, { symbol: "USDC" }]) {
      assert.equal(tradePairError("buy", asset, settle), TOMAN_ONLY_MESSAGE, `${asset.symbol} with ${settle.symbol}`);
    }
  }
  assert.ok(!isTomanOnlyInstrument(US_STOCK));
  assert.ok(!isTomanOnlyInstrument(TOKENISED_GOLD), "PAXG trades against Tether");
});

test("the message states the rule — it does not tell the user to sell something first", () => {
  assert.doesNotMatch(TOMAN_ONLY_MESSAGE, /ابتدا|بفروشید/);
  const form = readFileSync(new URL("../src/components/forms/TransactionForm.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(form, /ابتدا آن را به تومان بفروشید|ابتدا استیبل‌کوین/);
});

test("a bank is recognised by its wallet, or by name only when it has none", () => {
  assert.ok(isTomanBankAccount(BANK));
  assert.ok(!isTomanBankAccount(CASH_BOX));
  assert.ok(!isTomanBankAccount(TOMAN_FUND_WALLET));
  assert.ok(!isTomanBankAccount(USDT_WALLET));
  assert.ok(isTomanBankAccount({ symbol: "IRT", name: "بانک اصلی" }), "legacy account without a wallet");
  assert.ok(!isTomanBankAccount({ symbol: "IRT", name: "صندوق خانگی" }));
});

test("property and vehicle sales are paid into a Toman bank account only", () => {
  assert.equal(registrySaleError(BANK), null);
  for (const settle of [CASH_BOX, USDT_WALLET, TOMAN_FUND_WALLET, "USDT"]) assert.ok(registrySaleError(settle));
});

test("a stablecoin is swapped, not traded through FIFO; Toman itself is not tradable", () => {
  assert.equal(tradeRouteFor(USDT), "conversion");
  assert.equal(tradeRouteFor(ETH), "trade");
  assert.equal(tradePairError("sell", USDT, TOMAN_EXCHANGE), null, "USDT is sold for the Toman held at an Iranian exchange");
  assert.equal(tradePairError("sell", USDT, CASH_BOX), MARKET_TOMAN_MESSAGE, "never straight into a cash box or a bank");
  assert.ok(tradePairError("sell", USDT, "USDT"), "same unit on both sides");
  assert.ok(tradePairError("buy", { symbol: "IRT" }, "USDT"));
});

test("the price unit follows the settlement account", () => {
  assert.equal(priceUnitFor("IRT"), "IRT");
  assert.equal(priceUnitFor("USDT"), "USDT");
  assert.equal(priceUnitFor("USDC"), "USDT");
});

test("quote: quantity × unit price, with Toman and Tether side by side", () => {
  const inUsdt = quoteTrade({ quantity: "0.5", unitPrice: "3000", priceUnit: "USDT", usdtToman: "100000" })!;
  assert.equal(inUsdt.total, "1500");
  assert.equal(inUsdt.totalUsdt, "1500");
  assert.equal(inUsdt.totalToman, "150000000");
  assert.equal(inUsdt.unitToman, "300000000");

  const inToman = quoteTrade({ quantity: "100", unitPrice: "101000", priceUnit: "IRT", usdtToman: "100000" })!;
  assert.equal(inToman.total, "10100000");
  assert.equal(inToman.totalUsdt, "101");
  assert.equal(inToman.unitUsdt, "1.01");

  assert.equal(quoteTrade({ quantity: "0", unitPrice: "1", priceUnit: "IRT" }), null);
  assert.equal(quoteTrade({ quantity: "1", unitPrice: "", priceUnit: "IRT" }), null);
  assert.equal(quoteTrade({ quantity: "1", unitPrice: "5", priceUnit: "USDT" }), null, "a Tether price needs the Tether rate");
});

test("the form and the server both use the shared rules — the form is not the only guard", () => {
  const form = readFileSync(new URL("../src/components/forms/TransactionForm.tsx", import.meta.url), "utf8");
  const actions = readFileSync(new URL("../src/app/actions.ts", import.meta.url), "utf8");
  assert.match(form, /tradePairError\(type, assetInstrument, a\)/);
  assert.match(form, /registrySaleError\(a\)/);
  assert.match(actions, /const pairError = tradePairError\(side, assetRow, cashRow\);/);
  assert.match(actions, /const settleError = registrySaleError\(bank \?\? null\);/);
  assert.match(actions, /tradeRouteFor\(assetRow\) === "conversion"/);
});
