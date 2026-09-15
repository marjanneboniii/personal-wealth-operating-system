/**
 * نرخ تاریخی دلار — the dollar of a past purchase day, and the split setup steps.
 *
 * A property bought on ۱۵ آذر ۱۴۰۱ must be converted at the dollar of that day,
 * not today's — the bundled free-market series answers without a network call
 * or a table row, and `resolveUsdRateForDate` consults it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { HISTORICAL_MAX_GAP_DAYS, historicalUsdIrtOnOrBefore } from "../src/features/fx/historicalUsdIrt";
import { HISTORICAL_USD_IRT_FIRST, HISTORICAL_USD_IRT_LAST } from "../src/features/fx/historicalUsdIrtData";
import {
  propertyRowReady,
  vehicleRowReady,
  vehicleYearOf,
  type PropertyDraftRow,
  type VehicleDraftRow,
} from "../src/components/setup/SetupRealAssetsStep";
import { jalaliToIso } from "../src/lib/format";

const src = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf-8");

test("the bundled series covers ۱۳۹۰ to recent days", () => {
  assert.ok(HISTORICAL_USD_IRT_FIRST <= "2012-03-20", "starts by ۱۳۹۱");
  assert.ok(HISTORICAL_USD_IRT_LAST >= "2026-01-01", "reaches the recent past");
});

test("۱۵ آذر ۱۴۰۱ resolves to the dollar of that day, in Toman", () => {
  const hit = historicalUsdIrtOnOrBefore(jalaliToIso(1401, 9, 15));
  assert.ok(hit, "a rate exists");
  assert.equal(hit.effectiveDate, "2022-12-06");
  const rate = Number(hit.rate);
  assert.ok(rate > 30_000 && rate < 45_000, `≈ ۳۶ هزار تومان, got ${rate}`);
});

test("a closed market day falls back to the last trading day before it", () => {
  const nowruz = historicalUsdIrtOnOrBefore(jalaliToIso(1404, 1, 1));
  assert.ok(nowruz);
  assert.ok(nowruz.effectiveDate < jalaliToIso(1404, 1, 1), "an earlier close");
  assert.ok(Date.parse(jalaliToIso(1404, 1, 1)) - Date.parse(nowruz.effectiveDate) <= HISTORICAL_MAX_GAP_DAYS * 86_400_000);
});

test("outside the series the lookup steps aside", () => {
  assert.equal(historicalUsdIrtOnOrBefore("2005-01-01"), null, "before the first day");
  assert.equal(historicalUsdIrtOnOrBefore("2099-01-01"), null, "far past the last day — recorded/current rate takes over");
  assert.equal(historicalUsdIrtOnOrBefore(""), null);
  assert.equal(historicalUsdIrtOnOrBefore("not-a-date"), null);
});

test("the purchase-date resolver consults the history before any nearest/current rate", () => {
  const fx = src("src/features/rwa/vehicle/fx.ts");
  assert.match(fx, /historicalUsdIrtOnOrBefore\(date\)/);
  assert.ok(fx.indexOf('source: "historical"') < fx.indexOf('source: "nearest"'), "history outranks an older recorded rate");
  assert.ok(fx.indexOf('source: "exact"') < fx.indexOf('source: "historical"'), "a rate recorded for that exact day still wins");
});

test("setup: ملک and خودرو are separate steps, filled in by search + «+»", () => {
  const page = src("src/app/setup/page.tsx");
  assert.match(page, /"ملک", "خودرو"/, "two steps in the wizard");
  assert.match(page, /<SetupPropertiesStep/);
  assert.match(page, /<SetupVehiclesStep/);

  const step = src("src/components/setup/SetupRealAssetsStep.tsx");
  assert.match(step, /getUsdRateForDateAction/, "the dollar of the purchase day is shown right away");
  assert.match(step, /معادل دلاری در زمان خرید/);
});

test("setup rows need only the purchase date and price", () => {
  const vehicle: VehicleDraftRow = {
    key: "v",
    catalogId: "c",
    label: "پژو ۲۰۶",
    manufacturingYear: "",
    ownershipDate: jalaliToIso(1401, 9, 15),
    purchasePriceToman: "300000000",
    currentValueToman: "",
  };
  assert.equal(vehicleRowReady(vehicle), true);
  assert.equal(vehicleYearOf(vehicle), "1401", "no year picked → the year it was bought");
  assert.equal(vehicleYearOf({ ...vehicle, manufacturingYear: "1398" }), "1398");
  assert.equal(vehicleRowReady({ ...vehicle, purchasePriceToman: "" }), false);
  assert.equal(vehicleRowReady({ ...vehicle, ownershipDate: "" }), false);

  const property: PropertyDraftRow = {
    key: "p",
    cityId: "c",
    neighborhoodId: "n",
    propertyTypeId: "t",
    label: "آپارتمان — گلستان",
    acquisitionDate: jalaliToIso(1401, 9, 15),
    purchasePriceToman: "4000000000",
    currentValueToman: "",
    sizeSqm: "",
  };
  assert.equal(propertyRowReady(property), true, "current value is optional");
  assert.equal(propertyRowReady({ ...property, acquisitionDate: "" }), false);

  const service = src("src/features/setup/service.ts");
  assert.match(service, /valuationDate: hasCurrentValue \? setupResult\.today : property\.acquisitionDate/,
    "a missing current value is the purchase price, dated the purchase day");
});
