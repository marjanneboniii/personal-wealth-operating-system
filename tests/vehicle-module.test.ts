/**
 * دارایی واقعی → خودرو  (Real Asset → Vehicle)
 *
 * These tests lock down the non-negotiable rules of the vehicle module:
 *
 *   1. Brand/model come from the dynamic catalog — free text is rejected.
 *   2. Exactly one owner — no ownership share / co-owner / mortgage fields.
 *   3. Purchase USD value = purchase Toman ÷ FX rate OF THE PURCHASE DATE,
 *      computed once and frozen.
 *   4. Current Value comes ONLY from the latest immutable snapshot.
 *   5. FX rate update  ≠  vehicle valuation update.
 *   6. Snapshots are append-only: historical USD is always
 *      value_toman ÷ usd_rate_stored_in_the_same_snapshot.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import { exchangeRates, vehicleAssets, vehicleBrands, vehicleCatalog, vehicleValuationSnapshots } from "../src/db/schema";
import {
  createVehicleBrand,
  createCatalogModel,
  listVehicleBrands,
  listVehicleCatalogModels,
  normalizeKey,
  seedVehicleCatalog,
} from "../src/features/rwa/vehicle/catalog";
import {
  createUserVehicle,
  getVehicleDashboard,
  getVehiclePortfolioSummary,
  sellVehicle,
  updateVehicleDetails,
} from "../src/features/rwa/vehicle/service";
import { recordVehicleValuationSnapshot } from "../src/features/rwa/vehicle/valuation";
import { DOMESTIC_BRANDS, FREE_ENTRY_BRANDS, IMPORTED_BRANDS } from "../src/features/rwa/vehicle/catalogData";
import { DATASET_FIRST_SNAPSHOT_DATE } from "../src/features/rwa/vehicle/dataset";
import { cagrPercent, periodPerformance, roiPercent } from "../src/features/rwa/vehicle/analytics";
import { tomanToUsd } from "../src/features/rwa/vehicle/fx";
import { jalaliToIso } from "../src/lib/format";
import { D } from "../src/domain/decimal";

const OWNERSHIP_DATE = jalaliToIso(1404, 5, 18); // 2025-08-09
const SNAP_1 = jalaliToIso(1405, 2, 10); // 2026-04-30
const SNAP_2 = DATASET_FIRST_SNAPSHOT_DATE; // 1405/05/18 → 2026-08-09

async function reset() {
  await createSchemaIfNotExists();
  await db.delete(vehicleValuationSnapshots);
  await db.delete(vehicleAssets);
  await db.delete(vehicleCatalog);
  await db.delete(vehicleBrands);
  await db.delete(exchangeRates);
  // The memoised `seedVehicleCatalogIfEmpty` would skip after the first reset,
  // so the tests call the idempotent seeder directly.
  await seedVehicleCatalog();
}

async function setFxRate(date: string, rate: string) {
  await db
    .insert(exchangeRates)
    .values({ baseCurrency: "USD", quoteCurrency: "IRT", effectiveDate: date, rate, source: "test" })
    .onConflictDoNothing();
}

async function pickModel(brandName: string) {
  const brands = await listVehicleBrands();
  const brand = brands.find((b) => normalizeKey(b.name) === normalizeKey(brandName));
  assert.ok(brand, `brand not found in catalog: ${brandName}`);
  const models = await listVehicleCatalogModels(brand!.id);
  assert.ok(models.length > 0, `no models for brand ${brandName}`);
  return { brand: brand!, model: models[0] };
}

/* ─────────────────────────── catalog ─────────────────────────── */

test("catalog is seeded with the mandated domestic / imported / free-entry brands", async () => {
  await reset();
  const brands = await listVehicleBrands();
  const names = brands.map((b) => normalizeKey(b.name));

  for (const b of [...DOMESTIC_BRANDS, ...IMPORTED_BRANDS, ...FREE_ENTRY_BRANDS]) {
    assert.ok(
      names.includes(normalizeKey(b.name)),
      `brand missing from catalog: ${b.name}`,
    );
  }

  const domestic = brands.filter((b) => b.origin === "domestic");
  const imported = brands.filter((b) => b.origin === "imported");
  assert.ok(domestic.length >= DOMESTIC_BRANDS.length, "domestic brands incomplete");
  assert.ok(imported.length >= IMPORTED_BRANDS.length, "imported brands incomplete");

  // Every catalog model resolves to a real brand (no orphan free text).
  const models = await listVehicleCatalogModels();
  assert.ok(models.length > 0, "catalog has no models");
  for (const m of models) assert.ok(m.brandName && m.modelName, "model without brand/model name");
});

test("admin can add a brand and a model at runtime, duplicates are rejected", async () => {
  await reset();

  const brand = await createVehicleBrand({ name: "برند آزمایشی", origin: "imported", allowsCustomModel: true });
  assert.ok(brand.id);

  await assert.rejects(
    () => createVehicleBrand({ name: "برند آزمایشی", origin: "imported" }),
    /از قبل|تکرار|duplicate/i,
    "duplicate brand must be rejected",
  );

  const model = await createCatalogModel({ brandId: brand.id, modelName: "مدل آزمایشی", modelYear: 1404 });
  assert.equal(model.brandId, brand.id);

  await assert.rejects(
    () => createCatalogModel({ brandId: brand.id, modelName: "مدل آزمایشی" }),
    /قبلاً|از قبل|تکرار|duplicate/i,
    "duplicate brand+model must be rejected",
  );

  // The new entry is immediately selectable — the catalog is dynamic.
  const models = await listVehicleCatalogModels(brand.id);
  assert.equal(models.length, 1);
  assert.equal(models[0].modelName, "مدل آزمایشی");
});

/* ────────────────────── purchase / historical USD ────────────────────── */

test("purchase USD value uses the FX rate of the ownership date and is frozen", async () => {
  await reset();
  await setFxRate(OWNERSHIP_DATE, "95000");
  await setFxRate(SNAP_2, "190000");

  const { model } = await pickModel("ایران‌خودرو");

  const created = await createUserVehicle({
    catalogId: model.id,
    manufacturingYear: 1403,
    ownershipDate: OWNERSHIP_DATE,
    purchasePriceToman: "8500000000",
  });

  const [row] = await db.select().from(vehicleAssets).where(eq(vehicleAssets.id, created.id)).limit(1);
  assert.equal(D(row.purchasePriceToman!.toString()).toFixed(0), "8500000000");
  assert.equal(D(row.purchaseUsdRate!.toString()).toString(), "95000", "must use the OWNERSHIP-DATE rate");
  assert.equal(D(row.purchaseValueUsd!.toString()).toFixed(2), tomanToUsd("8500000000", "95000")); // 89473.68
  assert.equal(D(row.purchaseValueUsd!.toString()).toFixed(2), "89473.68");

  // The vehicle table carries NO ownership-share columns (property module only).
  const cols = Object.keys(row);
  for (const forbidden of [
    "ownershipPercentage",
    "coOwner",
    "coOwnerName",
    "ownershipType",
    "inheritanceShare",
    "mortgageShare",
  ]) {
    assert.ok(!cols.includes(forbidden), `vehicle must not carry «${forbidden}»`);
  }
  assert.ok(cols.includes("userId"), "vehicle must have exactly one owner (user_id)");
});

test("free-text brand/model is refused — the catalog is the only source", async () => {
  await reset();
  await assert.rejects(
    () =>
      createUserVehicle({
        catalogId: "",
        manufacturingYear: 1403,
        ownershipDate: OWNERSHIP_DATE,
        purchasePriceToman: "1000000000",
      }),
    /کاتالوگ|فهرست/,
  );
});

test("manufacturing year, ownership date and purchase price are required; plate & mileage are optional", async () => {
  await reset();
  const { model } = await pickModel("ایران‌خودرو");
  const base = {
    catalogId: model.id,
    manufacturingYear: 1403,
    ownershipDate: OWNERSHIP_DATE,
    purchasePriceToman: "1000000000",
  };

  await assert.rejects(() => createUserVehicle({ ...base, manufacturingYear: 0 }), /سال ساخت/);
  await assert.rejects(() => createUserVehicle({ ...base, ownershipDate: "" }), /تاریخ تملک/);
  await assert.rejects(() => createUserVehicle({ ...base, purchasePriceToman: "0" }), /قیمت خرید/);

  // plate & mileage omitted → accepted
  const ok = await createUserVehicle(base);
  const [row] = await db.select().from(vehicleAssets).where(eq(vehicleAssets.id, ok.id)).limit(1);
  assert.equal(row.licensePlate, null);
  assert.equal(row.mileage, null);

  await updateVehicleDetails({ vehicleId: ok.id, plate: "۱۲ ب ۳۴۵ ایران ۱۰", mileage: 42_000 });
  const [updated] = await db.select().from(vehicleAssets).where(eq(vehicleAssets.id, ok.id)).limit(1);
  assert.equal(updated.mileage, 42_000);
  // Editing details must never touch the frozen purchase figures.
  assert.equal(updated.purchaseValueUsd?.toString(), row.purchaseValueUsd?.toString());
  assert.equal(updated.purchaseUsdRate?.toString(), row.purchaseUsdRate?.toString());
  assert.equal(updated.purchasePriceToman?.toString(), row.purchasePriceToman?.toString());
});

/* ───────────────────── snapshots & current value ───────────────────── */

test("current value comes only from the latest snapshot; gains/ROI are computed from it", async () => {
  await reset();
  await setFxRate(OWNERSHIP_DATE, "100000");
  await setFxRate(SNAP_2, "200000");

  const { model } = await pickModel("ایران‌خودرو");
  const created = await createUserVehicle({
    catalogId: model.id,
    manufacturingYear: 1403,
    ownershipDate: OWNERSHIP_DATE,
    purchasePriceToman: "8500000000",
  });

  // No snapshot yet → no current value, no fabricated numbers.
  let [item] = await getVehicleDashboard();
  assert.equal(item.valuation.currentValueToman, null);
  assert.equal(item.valuation.scope, "none");
  assert.equal(item.gains.gainToman, null);

  await recordVehicleValuationSnapshot({
    catalogId: model.id,
    userVehicleId: created.id,
    snapshotDate: SNAP_2,
    currentValueToman: "10200000000",
  });

  [item] = await getVehicleDashboard();
  assert.equal(item.valuation.currentValueToman, "10200000000");
  assert.equal(item.valuation.lastValuationDate, SNAP_2);
  assert.equal(item.valuation.scope, "vehicle");
  assert.equal(item.valuation.currentUsdRate, "200000");
  assert.equal(item.valuation.currentValueUsd, "51000.00"); // 10.2e9 / 200000
  assert.equal(item.gains.gainToman, "1700000000");
  assert.equal(item.gains.roiToman, roiPercent("8500000000", "10200000000"));
  assert.equal(item.gains.roiToman, "20.00");
  // USD view: 51000 vs 85000 purchased → a Toman gain can be a USD loss.
  assert.equal(item.vehicle.purchaseValueUsd, "85000.00");
  assert.equal(item.gains.gainUsd, "-34000.00");
});

test("FX rate update ≠ vehicle valuation update", async () => {
  await reset();
  await setFxRate(OWNERSHIP_DATE, "100000");
  await setFxRate(SNAP_2, "200000");

  const { model } = await pickModel("ایران‌خودرو");
  const created = await createUserVehicle({
    catalogId: model.id,
    manufacturingYear: 1403,
    ownershipDate: OWNERSHIP_DATE,
    purchasePriceToman: "8500000000",
  });
  await recordVehicleValuationSnapshot({
    catalogId: model.id,
    userVehicleId: created.id,
    snapshotDate: SNAP_2,
    currentValueToman: "10200000000",
  });

  const before = (await getVehicleDashboard())[0];

  // A brand-new (much higher) FX rate arrives — the vehicle must not move.
  await setFxRate("2026-09-01", "400000");

  const after = (await getVehicleDashboard())[0];
  assert.deepEqual(after.valuation, before.valuation, "FX change must not alter the stored valuation");
  assert.deepEqual(after.gains, before.gains, "FX change must not alter gains");
  assert.equal(after.vehicle.purchaseValueUsd, before.vehicle.purchaseValueUsd, "purchase USD is immutable");
  assert.equal(after.vehicle.purchaseUsdRate, "100000");
});

test("snapshots are append-only and store their own USD rate", async () => {
  await reset();
  await setFxRate(OWNERSHIP_DATE, "100000");
  await setFxRate(SNAP_1, "150000");
  await setFxRate(SNAP_2, "200000");

  const { model } = await pickModel("ایران‌خودرو");
  const created = await createUserVehicle({
    catalogId: model.id,
    manufacturingYear: 1403,
    ownershipDate: OWNERSHIP_DATE,
    purchasePriceToman: "8500000000",
  });

  const s1 = await recordVehicleValuationSnapshot({
    catalogId: model.id,
    userVehicleId: created.id,
    snapshotDate: SNAP_1,
    currentValueToman: "9000000000",
  });
  const s2 = await recordVehicleValuationSnapshot({
    catalogId: model.id,
    userVehicleId: created.id,
    snapshotDate: SNAP_2,
    currentValueToman: "10200000000",
  });

  // Each snapshot keeps its own rate: USD = toman ÷ that snapshot's rate.
  assert.equal(s1.usdRate, "150000");
  assert.equal(s1.currentValueUsd, tomanToUsd("9000000000", "150000"));
  assert.equal(s1.currentValueUsd, "60000.00");
  assert.equal(s2.usdRate, "200000");
  assert.equal(s2.currentValueUsd, "51000.00");

  // Same-day re-valuation is refused — history cannot be rewritten.
  await assert.rejects(
    () =>
      recordVehicleValuationSnapshot({
        catalogId: model.id,
        userVehicleId: created.id,
        snapshotDate: SNAP_2,
        currentValueToman: "11000000000",
      }),
    /تغییرناپذیر|ثبت شده/,
  );

  const stored = await db
    .select()
    .from(vehicleValuationSnapshots)
    .where(eq(vehicleValuationSnapshots.userVehicleId, created.id));
  assert.equal(stored.length, 2, "no snapshot may be overwritten");

  const item = (await getVehicleDashboard())[0];
  assert.equal(item.history.length, 2);
  assert.equal(item.history[1].valueToman, "10200000000");
  // Toman up, USD down — both computed from real stored snapshots only.
  assert.equal(item.history[1].tomanChangePct, "13.33");
  assert.equal(item.history[1].usdChangePct, "-15.00");
});

test("period analysis uses real snapshots only and reports missing history honestly", async () => {
  const series = [
    { date: "2026-04-30", valueToman: "9000000000", usdRate: "150000", valueUsd: "60000.00" },
    { date: "2026-08-09", valueToman: "10200000000", usdRate: "200000", valueUsd: "51000.00" },
  ];

  const threeMonths = periodPerformance(series, "3m", { todayIso: "2026-08-09" });
  assert.equal(threeMonths.available, true);

  // Nothing exists 3 years back — the module must say so instead of inventing.
  const threeYears = periodPerformance(series, "3y", { todayIso: "2026-08-09" });
  assert.equal(threeYears.available, false);

  // CAGR only makes sense for ≥ 1 year.
  assert.equal(cagrPercent("9000000000", "10200000000", "2026-04-30", "2026-08-09"), null);
  assert.ok(cagrPercent("8500000000", "10200000000", "2025-08-09", "2026-08-09") !== null);
});

/* ──────────────────────── sale & portfolio ──────────────────────── */

test("selling a vehicle freezes the realised result at the sale-date rate", async () => {
  await reset();
  await setFxRate(OWNERSHIP_DATE, "100000");
  await setFxRate(SNAP_2, "200000");

  const { model } = await pickModel("ایران‌خودرو");
  const created = await createUserVehicle({
    catalogId: model.id,
    manufacturingYear: 1403,
    ownershipDate: OWNERSHIP_DATE,
    purchasePriceToman: "8500000000",
  });
  await recordVehicleValuationSnapshot({
    catalogId: model.id,
    userVehicleId: created.id,
    snapshotDate: SNAP_2,
    currentValueToman: "10200000000",
  });

  await sellVehicle({ vehicleId: created.id, saleDate: SNAP_2, salePriceToman: "11000000000" });

  const item = (await getVehicleDashboard())[0];
  assert.equal(item.vehicle.status, "sold");
  assert.equal(item.gains.realised, true);
  // The realised result follows the SALE price, not the last valuation.
  assert.equal(item.gains.gainToman, "2500000000");
  assert.equal(item.vehicle.saleValueUsd, "55000.00");

  // A sold car leaves the portfolio value and is reported as a realised result.
  const summary = await getVehiclePortfolioSummary();
  assert.equal(summary.soldCount, 1);
  assert.equal(summary.activeCount, 0);
  assert.equal(summary.totalCurrentToman, "0", "sold cars are not part of the portfolio value");
  assert.equal(summary.soldProceedsToman, "11000000000");
  assert.equal(summary.realisedGainToman, "2500000000");
  assert.equal(summary.realisedGainUsd, "-30000.00"); // 55000 − 85000
});

test("portfolio summary aggregates snapshot USD values, never today's FX", async () => {
  await reset();
  await setFxRate(OWNERSHIP_DATE, "100000");
  await setFxRate(SNAP_2, "200000");

  const a = await pickModel("ایران‌خودرو");
  const b = await pickModel("سایپا");

  const v1 = await createUserVehicle({
    catalogId: a.model.id,
    manufacturingYear: 1403,
    ownershipDate: OWNERSHIP_DATE,
    purchasePriceToman: "8500000000",
  });
  const v2 = await createUserVehicle({
    catalogId: b.model.id,
    manufacturingYear: 1402,
    ownershipDate: OWNERSHIP_DATE,
    purchasePriceToman: "3000000000",
  });

  await recordVehicleValuationSnapshot({
    catalogId: a.model.id,
    userVehicleId: v1.id,
    snapshotDate: SNAP_2,
    currentValueToman: "10200000000",
  });
  await recordVehicleValuationSnapshot({
    catalogId: b.model.id,
    userVehicleId: v2.id,
    snapshotDate: SNAP_2,
    currentValueToman: "3600000000",
  });

  const summary = await getVehiclePortfolioSummary();
  assert.equal(summary.count, 2);
  assert.equal(summary.activeCount, 2);
  assert.equal(summary.unvaluedCount, 0);
  assert.equal(summary.totalCurrentToman, "13800000000");
  assert.equal(summary.totalPurchaseToman, "11500000000");
  assert.equal(summary.totalGainToman, "2300000000");
  assert.equal(summary.totalCurrentUsd, "69000.00"); // 51000 + 18000
  assert.equal(summary.totalPurchaseUsd, "115000.00"); // 85000 + 30000

  const before = { ...summary };
  await setFxRate("2026-09-15", "500000");
  const after = await getVehiclePortfolioSummary();
  assert.equal(after.totalCurrentUsd, before.totalCurrentUsd, "FX change must not move portfolio USD totals");
  assert.equal(after.totalCurrentToman, before.totalCurrentToman);
});

test("real-asset valuation performs zero CoinGecko requests", async () => {
  await reset();
  await setFxRate(OWNERSHIP_DATE, "100000");
  await setFxRate(SNAP_2, "200000");
  const { model } = await pickModel("ایران‌خودرو");
  const originalFetch = globalThis.fetch;
  let coinGeckoRequests = 0;
  globalThis.fetch = (async () => {
    coinGeckoRequests++;
    throw new Error("CoinGecko must not be called for a vehicle");
  }) as typeof fetch;

  try {
    const vehicle = await createUserVehicle({
      catalogId: model.id,
      manufacturingYear: 1403,
      ownershipDate: OWNERSHIP_DATE,
      purchasePriceToman: "8500000000",
    });
    await recordVehicleValuationSnapshot({
      catalogId: model.id,
      userVehicleId: vehicle.id,
      snapshotDate: SNAP_2,
      currentValueToman: "10200000000",
    });
    const [item] = await getVehicleDashboard();
    assert.equal(item.valuation.currentValueToman, "10200000000");
    assert.equal(coinGeckoRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
