import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const retiredPaths = [
  "src/features/marketData",
  "src/domain/marketData.ts",
  "src/app/actions/marketData.ts",
  "src/app/market-data",
  "src/components/forms/MarketPriceForm.tsx",
  "src/components/forms/PriceForm.tsx",
  "tests/market-data.test.ts",
];

function sourceFiles(path: string): string[] {
  return readdirSync(path).flatMap((entry) => {
    const absolute = join(path, entry);
    if (absolute.includes("node_modules") || absolute.includes(".next")) return [];
    return statSync(absolute).isDirectory() ? sourceFiles(absolute) : /\.(ts|tsx)$/.test(entry) ? [absolute] : [];
  });
}

test("retired Market Data files/routes/forms/providers are absent", () => {
  for (const path of retiredPaths) assert.equal(existsSync(join(root, path)), false, `${path} must be deleted`);
});

test("no active runtime reference to the retired Market Data architecture remains", () => {
  const forbidden = [
    "recordManualPrice",
    "recordManualPriceAction",
    "updatePriceAction",
    "getMarketPrices",
    "getMarketSnapshots",
    "MarketProviderRegistry",
    "BinanceProvider",
    "CoinbaseProvider",
    "MockProvider",
    "MarketPriceForm",
    'href="/market-data"',
  ];
  const runtimeFiles = sourceFiles(join(root, "src")).filter((file) => !file.endsWith("db/init-schema.ts"));
  const runtime = runtimeFiles.map((file) => readFileSync(file, "utf8")).join("\n");
  for (const symbol of forbidden) assert.equal(runtime.includes(symbol), false, `${symbol} must not be active`);
});

test("CoinGecko pricing has no Accounting mutation dependency and manual current Crypto action is absent", () => {
  // The pricing CORE stays database-free: it can never touch the ledger, and
  // has no direct DB/schema or mutation primitive. Persistence is delegated to
  // a dedicated last-known-price adapter (covered below).
  const pricing = ["coingecko.ts", "service.ts", "publicSpotQuotes.ts"]
    .map((file) => readFileSync(join(root, "src/features/pricing", file), "utf8"))
    .join("\n");
  for (const dependency of [
    '@/features/ledger',
    '@/domain/fifo',
    'from "@/db/schema"',
    '.insert(',
    '.update(',
    '.delete(',
  ]) {
    assert.equal(pricing.includes(dependency), false, `pricing core must not import/use ${dependency}`);
  }

  // The persistence adapter is the ONLY pricing file allowed to touch the
  // database, and it must limit itself to the market price cache — never an
  // accounting table.
  const adapter = readFileSync(join(root, "src/features/pricing/lastKnownPrice.ts"), "utf8");
  assert.equal(adapter.includes("coingeckoPriceCache"), true, "adapter must use the price cache table");
  for (const accountingTable of ["postings", "journalEntries", "lots", "accounts", "assets"]) {
    assert.equal(
      adapter.includes(accountingTable),
      false,
      `pricing adapter must not import/use accounting table ${accountingTable}`,
    );
  }
  for (const dependency of ['@/features/ledger', '@/domain/fifo']) {
    assert.equal(adapter.includes(dependency), false, `pricing adapter must not import/use ${dependency}`);
  }

  const actions = readFileSync(join(root, "src/app/actions.ts"), "utf8");
  assert.equal(actions.includes("recordManualPriceAction"), false);
  assert.equal(actions.includes("updatePriceAction"), false);

  const setup = readFileSync(join(root, "src/features/setup/service.ts"), "utf8");
  assert.equal(
    /insert\(prices\)[\s\S]{0,180}assetMap\.ETH/.test(setup),
    false,
    "setup purchase price must not become a manual current ETH price",
  );
});
