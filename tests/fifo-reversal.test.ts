import assert from "node:assert/strict";
import { test } from "node:test";
import { consumeFifo, averageCost } from "../src/domain/fifo";
import { D } from "../src/domain/decimal";
import { assertBalanced } from "../src/domain/accounting";

test("FIFO Engine — consumeFifo basic buy and sell", () => {
  const lots = [
    { id: "lot-1", openedAt: "2026-01-01", qtyRemaining: "5", unitCostBase: "3000" },
  ];

  // Sell 2 ETH @ $3500 ($7000 proceeds)
  const result = consumeFifo(lots, "2", "7000");

  assert.equal(result.allocations.length, 1);
  assert.equal(result.allocations[0].lotId, "lot-1");
  assert.equal(result.allocations[0].quantity, "2");
  assert.equal(result.allocations[0].costBase, "6000"); // 2 * 3000
  assert.equal(result.allocations[0].proceedsBase, "7000");
  assert.equal(result.allocations[0].realizedPnl, "1000");
  assert.equal(result.allocations[0].newQtyRemaining, "3");
  assert.equal(result.totalCost, "6000");
  assert.equal(result.totalProceeds, "7000");
  assert.equal(result.realizedPnl, "1000");
  assert.equal(result.unmatchedQty, "0");
});

test("FIFO Engine — average cost calculation", () => {
  const lots = [
    { id: "lot-1", openedAt: "2026-01-01", qtyRemaining: "3", unitCostBase: "3000" },
    { id: "lot-2", openedAt: "2026-02-01", qtyRemaining: "2", unitCostBase: "4000" },
  ];

  // Total cost = (3*3000) + (2*4000) = 9000 + 8000 = 17000
  // Total qty = 5
  // Weighted avg cost = 17000 / 5 = 3400
  const avg = averageCost(lots);
  assert.equal(D(avg).toFixed(2), "3400.00");
});

test("Double Entry Balance Invariant — assertBalanced", () => {
  // Balanced entry (sum = 0)
  assert.doesNotThrow(() => {
    assertBalanced([
      { accountId: "acc-1", assetId: "ast-1", quantity: "5", baseValue: "15000" },
      { accountId: "acc-2", assetId: "ast-2", quantity: "-5", baseValue: "-15000" },
    ]);
  });

  // Unbalanced entry (sum != 0)
  assert.throws(
    () => {
      assertBalanced([
        { accountId: "acc-1", assetId: "ast-1", quantity: "5", baseValue: "15000" },
        { accountId: "acc-2", assetId: "ast-2", quantity: "-5", baseValue: "-14000" },
      ]);
    },
    (err: Error) => err.name === "UnbalancedEntryError",
  );

  // Less than 2 lines
  assert.throws(
    () => {
      assertBalanced([
        { accountId: "acc-1", assetId: "ast-1", quantity: "5", baseValue: "0" },
      ]);
    },
    (err: Error) => err.name === "UnbalancedEntryError",
  );

  // Zero quantity
  assert.throws(
    () => {
      assertBalanced([
        { accountId: "acc-1", assetId: "ast-1", quantity: "0", baseValue: "100" },
        { accountId: "acc-2", assetId: "ast-2", quantity: "-1", baseValue: "-100" },
      ]);
    },
    (err: Error) => err.name === "UnbalancedEntryError",
  );
});
