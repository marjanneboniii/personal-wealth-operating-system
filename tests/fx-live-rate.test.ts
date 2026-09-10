/**
 * The live USDT/Toman source is the app's only reference rate once manual
 * entry is gone, so its failure modes matter more than its happy path: a
 * hostile or broken payload must never become someone's exchange rate.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchLiveUsdtRate } from "../src/features/fx/liveRate";

const json = (body: unknown, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

const wallex = (ask: string, bid: string) => ({ result: { ask: [{ price: ask }], bid: [{ price: bid }] } });

test("Wallex answers: the mid of best bid/ask becomes the rate", async () => {
  const q = await fetchLiveUsdtRate({ fetchImpl: (() => json(wallex("235598", "235570"))) as typeof fetch });
  assert.equal(q?.source, "wallex");
  assert.equal(q?.rate, "235584"); // (235598 + 235570) / 2
});

test("a one-sided book still yields a rate, not a skewed mid", async () => {
  const q = await fetchLiveUsdtRate({
    fetchImpl: (() => json({ result: { ask: [{ price: "235598" }], bid: [] } })) as typeof fetch,
  });
  assert.equal(q?.rate, "235598");
});

test("Bitpin takes over when Wallex fails", async () => {
  let call = 0;
  const q = await fetchLiveUsdtRate({
    fetchImpl: ((url: string) => {
      call += 1;
      if (String(url).includes("wallex")) return json(null, false);
      return json({ results: [{ code: "USDT_IRT", price: 235898 }] });
    }) as unknown as typeof fetch,
  });
  assert.equal(q?.source, "bitpin");
  assert.equal(q?.rate, "235898");
  assert.equal(call, 2, "Wallex is tried first");
});

test("both sources down returns null — never a fabricated rate", async () => {
  const q = await fetchLiveUsdtRate({ fetchImpl: (() => json(null, false)) as typeof fetch });
  assert.equal(q, null);
});

test("a network throw is contained, not propagated", async () => {
  const q = await fetchLiveUsdtRate({
    fetchImpl: (() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch,
  });
  assert.equal(q, null);
});

test("implausible payloads are refused", async () => {
  for (const bad of ["0", "-235000", "12", "99999999999", "not-a-number", ""]) {
    const q = await fetchLiveUsdtRate({
      fetchImpl: (() => json({ result: { ask: [{ price: bad }], bid: [{ price: bad }] } })) as typeof fetch,
    });
    assert.equal(q, null, `"${bad}" must be refused`);
  }
});

test("an HTML error page cannot become a rate", async () => {
  const q = await fetchLiveUsdtRate({
    fetchImpl: (() => Promise.resolve({ ok: true, json: () => Promise.reject(new Error("bad json")) } as unknown as Response)) as typeof fetch,
  });
  assert.equal(q, null);
});

test("the quote carries its own source and timestamp — never invented", async () => {
  const before = Date.now();
  const q = await fetchLiveUsdtRate({ fetchImpl: (() => json(wallex("235000", "235000"))) as typeof fetch });
  assert.ok(q);
  assert.ok(["wallex", "bitpin"].includes(q!.source));
  assert.ok(new Date(q!.observedAt).getTime() >= before);
});
