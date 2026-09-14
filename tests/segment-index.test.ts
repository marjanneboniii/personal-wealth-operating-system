/**
 * Segment index (dormant) — robust level and repeat-valuation growth from many
 * independent valuations, with input checks and minimum-contributor gating.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INDEX_MIN_CONTRIBUTORS,
  checkValuationInput,
  robustKeep,
  segmentGrowth,
  segmentLevel,
  type ValuationObservation,
} from "../src/features/rwa/realEstate/market/segmentIndex";

const OLD_ACCOUNT = "2026-01-01";

function obs(contributor: number, property: number, date: string, valueToman: number, areaSqm = 100, accountCreatedAt = OLD_ACCOUNT): ValuationObservation {
  return { contributorId: `c${contributor}`, propertyId: `c${contributor}-p${property}`, date, valueToman, areaSqm, accountCreatedAt };
}

test("input checks catch ×10 / ×1000 unit slips and large jumps", () => {
  const ref = 95_000_000;
  assert.deepEqual(checkValuationInput({ valueToman: 9_500_000_000_000, areaSqm: 100, referencePpsqm: ref }), [
    { code: "unit_x1000", suggestedToman: 9_500_000_000 },
  ]);
  assert.deepEqual(checkValuationInput({ valueToman: 950_000_000, areaSqm: 100, referencePpsqm: ref }), [
    { code: "unit_x10", suggestedToman: 9_500_000_000 },
  ]);
  assert.deepEqual(checkValuationInput({ valueToman: 15_000_000_000, areaSqm: 100, previousValueToman: 10_000_000_000 }), [
    { code: "jump", changePct: 50 },
  ]);
  assert.deepEqual(checkValuationInput({ valueToman: 10_500_000_000, areaSqm: 100, previousValueToman: 10_000_000_000, referencePpsqm: ref }), []);
});

test("robustKeep removes extreme values", () => {
  const kept = robustKeep([1, 1.02, 0.98, 1.01, 0.99, 1.03, 9]);
  assert.ok(!kept.includes(9));
  assert.equal(kept.length, 6);
});

test("level: silent below the minimum number of independent contributors", () => {
  const few = Array.from({ length: INDEX_MIN_CONTRIBUTORS - 1 }, (_, i) => obs(i, 0, "2026-09-01", 9_500_000_000));
  assert.deepEqual(segmentLevel(few, "2026-09-15"), { status: "insufficient", contributors: INDEX_MIN_CONTRIBUTORS - 1 });
});

test("level: one vote per contributor — one user with ten fake properties cannot move it", () => {
  const honest = Array.from({ length: 6 }, (_, i) => obs(i, 0, "2026-09-01", 9_500_000_000 + i * 50_000_000));
  const spam = Array.from({ length: 10 }, (_, k) => obs(99, k, "2026-09-01", 90_000_000_000));
  const level = segmentLevel([...honest, ...spam], "2026-09-15");
  assert.equal(level.status, "ok");
  assert.ok(level.status === "ok" && level.ppsqmToman < 100_000_000, "the spammer is one extreme vote, removed as an outlier");
  assert.ok(level.status === "ok" && level.contributors === 6);
});

test("level: stale observations and brand-new accounts are excluded", () => {
  const fresh = Array.from({ length: 5 }, (_, i) => obs(i, 0, "2026-09-01", 9_500_000_000));
  const stale = Array.from({ length: 5 }, (_, i) => obs(10 + i, 0, "2026-01-01", 1_000_000_000));
  const newAccounts = Array.from({ length: 5 }, (_, i) => obs(20 + i, 0, "2026-09-10", 1_000_000_000, 100, "2026-09-05"));
  const level = segmentLevel([...fresh, ...stale, ...newAccounts], "2026-09-15");
  assert.deepEqual(level, { status: "ok", ppsqmToman: 95_000_000, contributors: 5 });
});

test("growth: repeat valuations of the same property cancel constant optimism", () => {
  // Each contributor has their own constant bias (0.8× … 1.3×) but everyone's property rose 20%.
  const biases = [0.8, 0.9, 1.0, 1.1, 1.2, 1.3];
  const observations = biases.flatMap((b, i) => [obs(i, 0, "2026-09-01", 10_000_000_000 * b), obs(i, 0, "2027-09-01", 12_000_000_000 * b)]);
  const g = segmentGrowth(observations, "2026-09-01", "2027-09-01");
  assert.deepEqual(g, { status: "ok", pct: 20, contributors: 6 });
});

test("growth: needs a valuation near BOTH dates for enough contributors", () => {
  const onlyEnd = Array.from({ length: 6 }, (_, i) => obs(i, 0, "2027-09-01", 12_000_000_000));
  assert.equal(segmentGrowth(onlyEnd, "2026-09-01", "2027-09-01").status, "insufficient");
});
