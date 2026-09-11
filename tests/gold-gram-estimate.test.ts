/**
 * The 18-carat gram estimate derived from تترگلد.
 *
 * What matters here is that the arithmetic is exact and that the result is
 * never presented as a dealt price: the domestic آب‌شده market carries a حباب
 * and each platform adds its own spread, so this is a parity anchor.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { D } from "../src/domain/decimal";
import { WallexProvider } from "../src/features/pricing/providers/wallex";
import {
  CARAT_18_PURITY,
  GRAMS_PER_TROY_OUNCE,
  estimateGoldGramToman,
  valueGoldGrams,
} from "../src/features/pricing/goldGram";

const FIXTURE = readFileSync(new URL("./fixtures/wallex-markets.json", import.meta.url), "utf8");

function provider(body: string = FIXTURE, status = 200) {
  return new WallexProvider({
    fetchImpl: (async () => new Response(body, { status })) as unknown as typeof fetch,
  });
}

test("a gram of 18-carat is the ounce ÷ 31.1034768 × 0.750", async () => {
  const estimate = await estimateGoldGramToman({ provider: provider() });
  assert.ok(estimate);

  // XAUTTMN in the fixture is 1,020,804,123 — a real captured quote.
  assert.equal(estimate.tomanPerOunce, "1020804123");
  const gram24 = D("1020804123").div(D(GRAMS_PER_TROY_OUNCE));
  assert.equal(estimate.tomanPerGram24, gram24.toFixed(0));
  assert.equal(estimate.tomanPerGram18, gram24.mul(D(CARAT_18_PURITY)).toFixed(0));

  // 18 carat is three quarters of 24 — the ۷۵۰ stamp, not an approximation.
  assert.equal(CARAT_18_PURITY, "0.750");
});

test("it is always labelled an estimate, with the time it came from", async () => {
  const estimate = await estimateGoldGramToman({ provider: provider() });
  assert.equal(estimate!.isEstimate, true);
  assert.ok(estimate!.observedAt, "an estimate with no timestamp cannot be judged stale");
  assert.match(estimate!.source, /[؀-ۿ]/, "the source is named in Persian for «بر اساس …»");
});

test("پکس گلد stands in when تترگلد is missing", async () => {
  const body = JSON.parse(FIXTURE);
  delete body.result.symbols.XAUTTMN;
  const estimate = await estimateGoldGramToman({ provider: provider(JSON.stringify(body)) });
  assert.ok(estimate, "the second gold market should have answered");
  assert.match(estimate.source, /پکس گلد/);
  assert.equal(estimate.tomanPerOunce, "1004554980");
});

test("no gold market means null — never a fabricated gram price", async () => {
  const body = JSON.parse(FIXTURE);
  delete body.result.symbols.XAUTTMN;
  delete body.result.symbols.PAXGTMN;
  assert.equal(await estimateGoldGramToman({ provider: provider(JSON.stringify(body)) }), null);

  // An upstream failure is the same answer: nothing, so the caller falls back
  // to the user's own last manual price instead of showing an invented one.
  assert.equal(await estimateGoldGramToman({ provider: provider("nope", 503) }), null);
});

test("a holding is valued without ever touching a float", async () => {
  const estimate = await estimateGoldGramToman({ provider: provider() });
  const value = valueGoldGrams("5.5", estimate!);
  assert.equal(value, D("5.5").mul(D(estimate!.tomanPerGram18)).toFixed(0));

  // سوت is a milligram: 1000 سوت = 1 گرم. A sub-gram holding must not round
  // away — this is how these platforms actually sell.
  const tiny = valueGoldGrams("0.125", estimate!);
  assert.ok(D(tiny).gt(0), "an eighth of a gram is still worth millions of Toman");
});

test("the derived gram price lands in a plausible range", async () => {
  // A guard against a unit slip — dividing by grams-per-kilo, or forgetting
  // the purity factor, would put this orders of magnitude out.
  const estimate = await estimateGoldGramToman({ provider: provider() });
  const gram18 = Number(estimate!.tomanPerGram18);
  const ounce = Number(estimate!.tomanPerOunce);
  assert.ok(gram18 < ounce / 31, "a gram must be far cheaper than an ounce");
  assert.ok(gram18 > ounce / 42, "…but not absurdly so");
  assert.equal(
    Number(estimate!.tomanPerGram18) < Number(estimate!.tomanPerGram24),
    true,
    "18 carat is always cheaper than 24",
  );
});
