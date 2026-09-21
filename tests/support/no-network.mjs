/**
 * Makes the test suite hermetic: any outbound `fetch` throws, naming the URL.
 *
 * WHY THIS EXISTS. `listPricedCoinGeckoCatalog` used to declare its options as
 * `{ client, now }` while forwarding them to a function that also accepts
 * `spotQuotes` / `fallbacks`. The narrower type silently dropped the seam, so a
 * test that injected a fake CoinGecko client still reached Wallex and the
 * public spot quotes over the real network — and asserted against a LIVE
 * market price. It failed with 81102.93874154 where it expected 64000, a
 * number that appears nowhere in this repository.
 *
 * That defect was invisible for one reason: nothing said a test may not use
 * the network. A passing suite that quietly depends on egress is not a passing
 * suite — it is one that has not been run offline yet. It will behave
 * differently on a CI runner, behind a proxy, on a plane, and in Iran, where
 * several of the upstreams this app talks to are routinely unreachable.
 *
 * So the rule is enforced rather than remembered. Every test double belongs at
 * a seam in the code; if a seam is missing, the fix is to open one, not to let
 * the call through.
 *
 * A test that genuinely needs the real network must opt out deliberately by
 * restoring `globalThis.fetch` itself, and should say in a comment why.
 */
/*
 * Throwing is not enough on its own. The pricing chain treats every fallback
 * as best-effort and swallows its error, so a blocked call there is invisible:
 * the test goes green off the last-known price and nobody learns that the code
 * path tried to leave the machine. That is how the original defect hid.
 *
 * So attempts are also RECORDED, and the process fails at exit if any were
 * made. Node's test runner gives each test file its own process, so the
 * failure lands on the file that made the call.
 */
const attempts = [];

globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : String(input?.url ?? input);
  attempts.push(url);
  throw new Error(
    "Outbound fetch is blocked in tests. Inject a client at the seam instead of " +
      `calling the network (see tests/support/no-network.mjs).\n  attempted: ${url}`,
  );
};

process.on("exit", (code) => {
  if (attempts.length === 0) return;
  const unique = [...new Set(attempts)];
  process.stderr.write(
    `\n✖ ${attempts.length} outbound fetch attempt(s) from this test file:\n` +
      unique.map((u) => `    ${u}\n`).join("") +
      "  A passing test that reaches the network is a test that has not been run offline.\n" +
      "  Inject a client at the seam instead. See tests/support/no-network.mjs.\n",
  );
  if (code === 0) process.exitCode = 1;
});
