/**
 * Coin networks are synced from CoinGecko platform data — a coin newly listed
 * on the market is classified without anyone editing a list.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import { wallexAssetCatalog } from "../src/db/schema";
import { CoinGeckoClient } from "../src/features/pricing/coingecko";
import { getCryptoNetworks, getCryptoNetworksOf, refreshCryptoNetworks } from "../src/features/trade/networkSync";
import { networksFromPlatforms } from "../src/features/trade/networks";
import { placeSupportsAsset } from "../src/features/trade/venues";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const COINS = [
  { id: "bitcoin", symbol: "btc", name: "Bitcoin", platforms: {} },
  { id: "ethereum", symbol: "eth", name: "Ethereum", platforms: {} },
  { id: "ripple", symbol: "xrp", name: "XRP", platforms: {} },
  // Listed on the market today; no code mentions it anywhere.
  { id: "brand-new-token", symbol: "newt", name: "New Token", platforms: { base: "0xabc", ethereum: "0xdef" } },
  { id: "some-solana-token", symbol: "solt", name: "Sol Token", platforms: { solana: "So1…" } },
  { id: "dup-one", symbol: "dup", name: "Dup One", platforms: { ethereum: "0x1" } },
  { id: "dup-two", symbol: "dup", name: "Dup Two", platforms: { solana: "So2" } },
];

const fakeClient = (fail = false) =>
  new CoinGeckoClient({
    apiKey: null,
    fetchImpl: (async (url: string | URL) => {
      if (fail) throw new Error("offline");
      const u = String(url);
      if (u.includes("/coins/list")) return json(COINS);
      if (u.includes("/coins/markets")) return json([]);
      return json({});
    }) as typeof fetch,
  });

async function reset() {
  await createSchemaIfNotExists();
  await db.execute(sql`truncate crypto_networks, wallex_asset_catalog`);
  for (const [symbol, kind] of [["NEWT", "crypto"], ["SOLT", "crypto"], ["DUP", "crypto"], ["XRP", "crypto"], ["AAPLX", "tokenized_stock"]]) {
    await db.insert(wallexAssetCatalog).values({ symbol, displayName: symbol, latinName: symbol, kind } as any);
  }
}

const RABBY = { walletName: "ربی والت", walletKind: "hot" };
const PHANTOM = { walletName: "فانتوم", walletKind: "hot" };
const LEDGER = { walletName: "لجر", walletKind: "cold" };

test("platform ids map to network families; native coins use their own chain", () => {
  assert.deepEqual(networksFromPlatforms("brand-new-token", { base: "0x", ethereum: "0x" }), ["evm"]);
  assert.deepEqual(networksFromPlatforms("bitcoin", {}), ["bitcoin"]);
  assert.deepEqual(networksFromPlatforms("ethereum", {}), ["evm"]);
  assert.deepEqual(networksFromPlatforms("ripple", {}), ["ripple"]);
  assert.deepEqual(networksFromPlatforms("x", { solana: "S", ethereum: "0x" }), ["evm", "solana"]);
});

test("a newly listed coin is classified by the sync — nobody adds it by hand", async () => {
  await reset();
  const result = await refreshCryptoNetworks(fakeClient());
  assert.equal(result.status, "fresh");

  const networks = await getCryptoNetworks();
  assert.deepEqual(networks.NEWT, ["evm"], "a token on Base/Ethereum is EVM automatically");
  assert.deepEqual(networks.SOLT, ["solana"]);
  assert.deepEqual(networks.BTC, ["bitcoin"]);
  assert.deepEqual(networks.ETH, ["evm"]);
  assert.deepEqual(networks.XRP, ["ripple"]);
  assert.equal(networks.DUP, undefined, "an ambiguous ticker is not guessed");
  assert.equal(networks.AAPLX, undefined, "shares have no chain");

  assert.equal(placeSupportsAsset(RABBY, "NEWT", networks.NEWT), true);
  assert.equal(placeSupportsAsset(RABBY, "BTC", networks.BTC), false);
  assert.equal(placeSupportsAsset(RABBY, "XRP", networks.XRP), false);
  assert.equal(placeSupportsAsset(PHANTOM, "SOLT", networks.SOLT), true);
  assert.equal(placeSupportsAsset(LEDGER, "XRP", networks.XRP), true);
  assert.equal(placeSupportsAsset(RABBY, "DUP", null), false, "an unknown network is not offered to an EVM-only wallet");
});

test("CoinGecko unreachable: synced rows stay, and a never-synced coin uses the offline seed", async () => {
  await reset();
  await refreshCryptoNetworks(fakeClient());
  const failed = await refreshCryptoNetworks(fakeClient(true));
  assert.equal(failed.status, "unavailable");
  assert.deepEqual((await getCryptoNetworks()).NEWT, ["evm"], "the last synced data is kept");

  await db.execute(sql`truncate crypto_networks`);
  assert.deepEqual(await getCryptoNetworksOf("USDE"), ["evm"], "offline seed before any sync");
  assert.equal(await getCryptoNetworksOf("NEWT"), null, "no data, no guess");
});
