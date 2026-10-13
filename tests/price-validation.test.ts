import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePropertyPrices, validateVehiclePrices } from "../src/features/rwa/priceValidation";

const RATE = "266000"; // Toman per USD today
const B = "1000000000"; // 1 billion Toman

const property = (over: Partial<Parameters<typeof validatePropertyPrices>[0]> = {}) =>
  validatePropertyPrices({ cityCode: "AHZ", typeCode: "APT", sizeSqm: "100", purchaseToman: String(15 * Number(B)), purchaseRate: RATE, currentToman: String(15 * Number(B)), currentRate: RATE, ...over });

test("a normal property passes", () => {
  assert.equal(property().level, "ok");
});

test("absurdly cheap property values are blocked (1M, 10M, 100M, 1B for 100 m²)", () => {
  for (const value of ["1000000", "10000000", "100000000", B]) {
    assert.equal(property({ currentToman: value, purchaseToman: value }).level, "block", value);
  }
});

test("a missing zero is offered as a one-tap fix", () => {
  const verdict = property({ currentToman: String(1.5 * Number(B)) });
  const issue = verdict.issues.find((i) => i.field === "current");
  assert.ok(issue, "current value flagged");
  assert.equal(issue!.suggestion, 15 * Number(B));
});

test("an old cheap purchase is judged at its own dollar rate, not today's", () => {
  // 1398: one billion Toman at ~13,000 Toman/USD — normal then.
  assert.equal(property({ purchaseToman: B, purchaseRate: "13000" }).level, "ok");
});

test("purchase and current value that disagree ×10 in dollars are blocked", () => {
  const verdict = property({ purchaseToman: String(150 * Number(B)), currentToman: String(15 * Number(B)) });
  assert.equal(verdict.level, "block");
});

test("a city without a tier only warns, never blocks inside the fence", () => {
  assert.notEqual(property({ cityCode: "ZZZ", purchaseToman: String(3 * Number(B)), currentToman: String(3 * Number(B)) }).level, "block");
});

test("impossible size is blocked", () => {
  assert.equal(property({ sizeSqm: "2" }).level, "block");
});

const vehicle = (over: Partial<Parameters<typeof validateVehiclePrices>[0]> = {}) =>
  validateVehiclePrices({ modelName: "x", origin: "domestic", manufacturingYear: "1402", ownershipDate: "2024-01-01", valuationDate: "2026-10-13", purchaseToman: String(1.2 * Number(B)), purchaseRate: "55000", currentToman: String(2 * Number(B)), currentRate: RATE, ...over });

test("a normal car passes; mileage is optional", () => {
  assert.equal(vehicle().level, "ok");
  assert.equal(vehicle({ mileage: "" }).level, "ok");
});

test("a purchase before the manufacturing year is blocked", () => {
  assert.equal(vehicle({ manufacturingYear: "1405", ownershipDate: "2020-01-01" }).level, "block");
});

test("mileage typed in thousands is flagged with a fix", () => {
  const issue = vehicle({ manufacturingYear: "1395", mileage: "120" }).issues.find((i) => i.field === "mileage");
  assert.equal(issue?.suggestion, 120000);
});

test("a recorded market price narrows the current-value check", () => {
  const ref = 2 * Number(B) / Number(RATE);
  assert.equal(vehicle({ referenceUsd: ref }).level, "ok");
  assert.equal(vehicle({ referenceUsd: ref, currentToman: String(8 * Number(B)) }).level, "block");
});

test("a cheap purchase from 1390 is never blocked — it is judged at that day's dollar", () => {
  // 1390: ~1,515 Toman per USD. 200M and even 900M for 100 m² must register.
  assert.equal(property({ purchaseToman: "200000000", purchaseRate: "1515" }).level, "ok");
  assert.notEqual(property({ purchaseToman: "900000000", purchaseRate: "1515", currentToman: String(20 * Number(B)) }).level, "block");
});

test("no home is worth under ~1 billion Toman today, whatever its size or city", () => {
  for (const [cityCode, sizeSqm] of [["AHZ", "100"], ["YES", "50"], ["THR", "30"]]) {
    assert.equal(property({ cityCode, sizeSqm, currentToman: B }).level, "block", `${cityCode} ${sizeSqm}`);
  }
});

test("an 8-billion car is fine today and stays fine as the dollar rises (bands are in USD)", () => {
  const car = (rate: string) => validateVehiclePrices({ modelName: "x", origin: "domestic", manufacturingYear: "1404", ownershipDate: "2026-10-12", valuationDate: "2026-10-13", purchaseToman: String(8 * Number(B)), purchaseRate: rate, currentToman: String(8 * Number(B)), currentRate: rate }).level;
  assert.equal(car(RATE), "ok");
  assert.equal(car("600000"), "ok");
});
