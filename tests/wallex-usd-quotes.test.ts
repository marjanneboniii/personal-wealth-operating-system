/**
 * والکس as a USD quote source.
 *
 * The interesting property under test is that the dollar comes from Wallex's
 * OWN USDT/TMN market in the same response, so a quote cannot drift because an
 * FX rate was fetched a minute apart from the coin price, and no rate has to be
 * configured anywhere for this source to work.
 *
 * The fixture is a real captured response from https://api.wallex.ir/v1/markets.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { D } from "../src/domain/decimal";
import { WallexProvider } from "../src/features/pricing/providers/wallex";
import { WallexUsdQuoteClient } from "../src/features/pricing/wallexUsdQuotes";

const FIXTURE = readFileSync(new URL("./fixtures/wallex-markets.json", import.meta.url), "utf8");

function client(body: string = FIXTURE, status = 200) {
  const provider = new WallexProvider({
    fetchImpl: (async () => new Response(body, { status })) as unknown as typeof fetch,
  });
  return new WallexUsdQuoteClient({
    provider,
    now: () => new Date("2026-09-11T09:00:00.000Z"),
  });
}

test("USD is derived from Wallex's own Toman dollar market", async () => {
  const quotes = await client().fetchUsdPrices(["bitcoin"]);
  const btc = quotes.get("bitcoin");
  assert.ok(btc, "bitcoin was not priced");

  // BTCTMN ÷ USDTTMN, from one snapshot. Both legs are in the fixture, so the
  // expectation is recomputed rather than hard-coded to a stale number.
  const expected = D("18122214670").div(D("235997")).toFixed(8);
  assert.equal(btc.priceUsd, expected);

  // Sanity: BTC is tens of thousands of dollars, not a rounding artefact.
  assert.ok(Number(btc.priceUsd) > 10_000 && Number(btc.priceUsd) < 1_000_000, btc.priceUsd);
});

test("the reference market prices itself as exactly 1", async () => {
  const quotes = await client().fetchUsdPrices(["tether"]);
  // Dividing USDTTMN by itself would only invite rounding noise; a dollar
  // stablecoin is one dollar by definition in this source's own terms.
  assert.equal(quotes.get("tether")!.priceUsd, "1");
});

test("a billion-Toman price survives the conversion intact", async () => {
  // تترگلد is quoted above 1,020,804,123 Toman. This is the case that would
  // quietly lose precision if the pipeline ever went through a binary float.
  const quotes = await client().fetchUsdPrices(["tether-gold"]);
  const xaut = quotes.get("tether-gold")!;
  assert.equal(xaut.priceUsd, D("1020804123").div(D("235997")).toFixed(8));
  assert.ok(Number(xaut.priceUsd) > 1_000, "gold is thousands of dollars an ounce");
});

test("only ids this source can price are requested or returned", async () => {
  const quotes = await client().fetchUsdPrices(["bitcoin", "some-unlisted-coin"]);
  assert.equal(quotes.has("bitcoin"), true);
  assert.equal(quotes.has("some-unlisted-coin"), false);

  // Nothing mappable at all means no upstream call is worth making.
  const none = await client().fetchUsdPrices(["some-unlisted-coin"]);
  assert.equal(none.size, 0);
});

test("without the dollar leg, nothing is guessed", async () => {
  // If USDTTMN is missing there is no honest denominator, so the client returns
  // nothing and lets the chain fall through to the last known price.
  const body = JSON.parse(FIXTURE);
  delete body.result.symbols.USDTTMN;
  const quotes = await client(JSON.stringify(body)).fetchUsdPrices(["bitcoin"]);
  assert.equal(quotes.size, 0);
});

test("an upstream failure yields no price — never a fabricated one", async () => {
  // WallexProvider reports transport failures per-reference rather than
  // throwing, so this resolves with an empty map. That is the right shape: the
  // refresh chain moves on to the next source and then to the last known
  // price, and at no point is a zero or an invented figure introduced.
  const quotes = await client("nope", 503).fetchUsdPrices(["bitcoin"]);
  assert.equal(quotes.size, 0);
});
