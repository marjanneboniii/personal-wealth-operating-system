import assert from "node:assert/strict";
import { test } from "node:test";
import { sql, eq } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assetClasses,
  assets,
  currencies,
  importJobs,
  importRecords,
  journalEntries,
  lots,
  postings,
} from "../src/db/schema";
import { parseImportText } from "../src/features/import/parser";
import {
  createImportJob,
  executeImportJob,
  validateImportRows,
} from "../src/features/import/service";
import { getHoldings, getRealizedPnl } from "../src/features/ledger/queries";
import { D } from "../src/domain/decimal";

async function setupImportDb() {
  await createSchemaIfNotExists();

  await db.delete(importRecords);
  await db.delete(importJobs);
  await db.delete(postings);
  await db.delete(lots);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);

  const [usd] = await db
    .insert(currencies)
    .values({ code: "USD", name: "US Dollar", symbol: "$", decimals: 2, isFiat: true })
    .returning();

  const [cls] = await db
    .insert(assetClasses)
    .values({ code: "crypto", name: "Crypto", color: "#a78bfa" })
    .returning();

  const [ethAsset] = await db
    .insert(assets)
    .values({ symbol: "ETH", name: "Ethereum", classId: cls.id, currencyId: usd.id, decimals: 8 })
    .returning();

  const [usdAsset] = await db
    .insert(assets)
    .values({ symbol: "USD", name: "US Dollar Asset", classId: cls.id, currencyId: usd.id, decimals: 2 })
    .returning();

  const [cashAccount] = await db
    .insert(accounts)
    .values({ code: "1010", name: "Cash Account", type: "asset", assetId: usdAsset.id })
    .returning();

  const [ethAccount] = await db
    .insert(accounts)
    .values({ code: "1200", name: "ETH Account", type: "asset", assetId: ethAsset.id })
    .returning();

  const [feeAccount] = await db
    .insert(accounts)
    .values({ code: "5040", name: "Fee Expense", type: "expense", assetId: usdAsset.id })
    .returning();

  const [equityAccount] = await db
    .insert(accounts)
    .values({ code: "3010", name: "Opening Equity", type: "equity", assetId: usdAsset.id })
    .returning();

  const [pnlAccount] = await db
    .insert(accounts)
    .values({ code: "4100", name: "Realized PnL", type: "income", assetId: usdAsset.id })
    .returning();

  return { ethAsset, cashAccount, ethAccount, feeAccount, equityAccount, pnlAccount };
}

test("Phase 2.2 Requirement — CSV / TSV text parsing works", () => {
  const csvText = `Date, Asset, Quantity, Price, Fee, Type, Description
2025-01-10, ETH, 2, 3000, 10, buy, Purchase 2 ETH
2025-01-15, ETH, 1, 3500, 5, sell, Sale 1 ETH`;

  const rows = parseImportText(csvText);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, "2025-01-10");
  assert.equal(rows[0].asset, "ETH");
  assert.equal(rows[0].quantity, "2");
  assert.equal(rows[0].price, "3000");
  assert.equal(rows[0].fee, "10");
  assert.equal(rows[0].type, "buy");

  assert.equal(rows[1].type, "sell");
  assert.equal(rows[1].quantity, "1");
});

test("Phase 2.2 Requirement — Invalid rows are rejected", async () => {
  await setupImportDb();

  const invalidRows = [
    {
      lineIndex: 1,
      rawText: "bad date",
      date: "invalid-date",
      asset: "ETH",
      type: "buy" as const,
      quantity: "2",
      price: "3000",
      fee: "0",
      description: "Invalid date",
    },
    {
      lineIndex: 2,
      rawText: "unknown asset",
      date: "2025-01-10",
      asset: "UNKNOWN_COIN",
      type: "buy" as const,
      quantity: "2",
      price: "3000",
      fee: "0",
      description: "Unknown asset",
    },
    {
      lineIndex: 3,
      rawText: "negative quantity",
      date: "2025-01-10",
      asset: "ETH",
      type: "buy" as const,
      quantity: "-5",
      price: "3000",
      fee: "0",
      description: "Negative quantity",
    },
  ];

  const validated = await validateImportRows(invalidRows);

  assert.equal(validated[0].status, "invalid");
  assert.match(validated[0].errorMessage!, /تاریخ نامعتبر/);

  assert.equal(validated[1].status, "invalid");
  assert.match(validated[1].errorMessage!, /دارایی نامشخص/);

  assert.equal(validated[2].status, "invalid");
  assert.match(validated[2].errorMessage!, /بزرگ‌تر از صفر/);
});

test("Phase 2.2 Requirement — Imported BUY creates correct FIFO lot & journal entry", async () => {
  const { ethAsset } = await setupImportDb();

  const csvInput = `Date, Asset, Quantity, Price, Fee, Type, Description
2025-01-10, ETH, 2, 3000, 10, buy, Buy ETH via Import`;

  // 1. Create import job
  const summary = await createImportJob(csvInput, "csv");
  assert.equal(summary.rowCount, 1);
  assert.equal(summary.validCount, 1);
  assert.equal(summary.errorCount, 0);

  // 2. Execute import job
  const execResult = await executeImportJob(summary.jobId);
  assert.equal(execResult.success, true);
  assert.equal(execResult.executedCount, 1);

  // 3. Verify ledger state
  const holdings = await getHoldings();
  const ethHolding = holdings.find((h) => h.symbol === "ETH");
  assert.ok(ethHolding);
  assert.equal(D(ethHolding.quantity).toString(), "2");

  // 4. Verify FIFO lot created
  const createdLots = await db.select().from(lots).where(eq(lots.assetId, ethAsset.id));
  assert.equal(createdLots.length, 1);
  assert.equal(D(createdLots[0].qtyRemaining).toString(), "2");
  assert.equal(D(createdLots[0].qtyOpened).toString(), "2");
});

test("Phase 2.2 Requirement — Opening holdings do NOT create fake trade history or purchases", async () => {
  await setupImportDb();

  const csvInput = `Date, Asset, Quantity, Price, Fee, Type, Description
2025-01-01, ETH, 5, 3000, 0, opening, Existing Opening Holding ETH`;

  const summary = await createImportJob(csvInput, "csv");
  assert.equal(summary.validCount, 1);

  await executeImportJob(summary.jobId);

  // Verify journal entry type is "opening" (NOT "buy")
  const entries = await db.select().from(journalEntries);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "opening");

  // Verify FIFO lot created for opening holding
  const createdLots = await db.select().from(lots);
  assert.equal(createdLots.length, 1);
  assert.equal(D(createdLots[0].qtyRemaining).toString(), "5");

  // Verify holdings report
  const holdings = await getHoldings();
  const ethHolding = holdings.find((h) => h.symbol === "ETH");
  assert.equal(D(ethHolding?.quantity ?? "0").toString(), "5");
});

test("Phase 2.2 Requirement — Duplicate import warning detection works", async () => {
  await setupImportDb();

  const csvInput = `Date, Asset, Quantity, Price, Fee, Type, Description
2025-01-10, ETH, 2, 3000, 10, buy, Trade Buy ETH`;

  // First import
  const job1 = await createImportJob(csvInput, "csv");
  await executeImportJob(job1.jobId);

  // Second import with identical payload
  const job2 = await createImportJob(csvInput, "csv");
  assert.equal(job2.records[0].status, "valid");
  assert.ok(job2.records[0].warningMessage);
  assert.match(job2.records[0].warningMessage!, /تراکنش تکراری/);
});
