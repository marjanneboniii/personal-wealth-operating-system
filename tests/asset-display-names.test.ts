import assert from "node:assert/strict";
import { test } from "node:test";
import { displayAccountName } from "../src/lib/assetDisplay";
import { plainAccountName } from "../src/lib/tx";
import { INFLATION_CATEGORY_SUGGESTIONS } from "../src/features/inflation/constants";

test("USDG legacy display names retain custom prefixes and normalize everywhere", () => {
  for (const name of ["Global Dollar", "گلوبال دلار", "USDG", "global dollar", "Global Dollar (USDG)"]) {
    assert.equal(displayAccountName(name), "یو اس دی جی");
    assert.equal(plainAccountName(`کیف من · ${name}`), "کیف من · یو اس دی جی");
  }
  assert.equal(displayAccountName("بانک ملت"), "بانک ملت");
  assert.equal(displayAccountName(displayAccountName("Global Dollar")), "یو اس دی جی");
});

test("inflation suggestions cover everyday services as well as groceries without duplicates", () => {
  const names = [...INFLATION_CATEGORY_SUGGESTIONS];
  assert.equal(new Set(names).size, names.length);
  for (const name of ["مسکن و اجاره", "قبوض و انرژی", "درمان و دارو", "آموزش", "حمل‌ونقل", "ارتباطات و اینترنت"]) assert.ok(names.includes(name as typeof names[number]));
});
