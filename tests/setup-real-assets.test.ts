/**
 * خودرو و ملک در راه‌اندازی اولیه.
 *
 * WHAT THIS PINS
 *
 * REUSE, NOT REIMPLEMENTATION. The wizard delegates to the registry's OWN
 * `createUserVehicle` / `createRealEstateAsset` — the same functions
 * «دارایی‌های واقعی» calls — so the rules those own (catalogue-only vehicle
 * models, acquisition-date FX, RWA symbol sequencing, valuation snapshots, and
 * the property's own ledger entry) are not restated anywhere and cannot drift.
 * The tests below assert the registry's own invariants hold for a row that
 * entered through the wizard, which is what «it really is the same path» means.
 *
 * REGISTRY ≠ OPENING BALANCE. A vehicle posts NO journal entry at all, and a
 * property posts its OWN entry — neither joins the wizard's single opening
 * entry or its 3010 equity counterweight. Folding them in would have made the
 * opening entry claim they were cash the user deposited.
 *
 * A FAILED ROW DOES NOT COST THE USER THEIR SETUP. The accounts and the
 * opening balance commit first and are already durable, so a bad خودرو row is
 * reported by name while everything else survives.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assets,
  exchangeRates,
  journalEntries,
  lotConsumptions,
  lots,
  postings,
  settings,
  userFxSettings,
  userSetupState,
  realEstateProperties,
  realEstateValuationSnapshots,
  users,
  vehicleAssets,
} from "../src/db/schema";
import { completeSetup } from "../src/features/setup/service";
import {
  ensureVehicleModuleReady,
  listUserVehicles,
} from "../src/features/rwa/vehicle/service";
import { listVehicleCatalogModels } from "../src/features/rwa/vehicle/catalog";
import {
  ensureRealEstateModuleReady,
  listRealEstateAssets,
} from "../src/features/rwa/realEstate/service";
import {
  listCities,
  listNeighborhoods,
  listPropertyTypes,
} from "../src/features/rwa/realEstate/masterData";
import { D } from "../src/domain/decimal";

async function freshDb() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(postings);
  // A property REFERENCES its own ledger entry, so it has to go before the
  // entries do — which is itself a small confirmation that the registry really
  // does post one.
  await db.delete(realEstateValuationSnapshots);
  await db.delete(realEstateProperties);
  await db.delete(journalEntries);
  await db.delete(vehicleAssets);
  await db.delete(userSetupState);
  await db.delete(userFxSettings);
  await db.delete(exchangeRates);
  await db.delete(settings);
  await db.delete(users);
  await db.delete(accounts);
}

const BASE = {
  userName: "مالک خودرو و ملک",
  baseCurrency: "USD" as const,
  displayCurrency: "IRT" as const,
  dateCalendar: "jalali" as const,
  digitStyle: "fa" as const,
  bankAccountName: "بانک اصلی",
  cashWalletName: "صندوق خانگی",
  bankOpeningBalance: "",
  cashOpeningBalance: "",
};

/** The master data the wizard's step offers, read the same way it reads it. */
async function catalogs() {
  await ensureVehicleModuleReady();
  await ensureRealEstateModuleReady();
  const [models, cities, hoods, types] = await Promise.all([
    listVehicleCatalogModels(),
    listCities(),
    listNeighborhoods(),
    listPropertyTypes(),
  ]);
  const city = cities[0];
  const hood = hoods.find((h) => h.cityId === city?.id);
  return { model: models[0], city, hood, propertyType: types[0] };
}

test("a خودرو entered in the wizard lands in the registry, with NO journal entry", async () => {
  await freshDb();
  const { model } = await catalogs();
  assert.ok(model, "the vehicle catalogue is seeded by its own bootstrap");

  const result = await completeSetup({
    ...BASE,
    vehicles: [
      {
        catalogId: model.id,
        manufacturingYear: "1400",
        ownershipDate: "2024-06-01",
        purchasePriceToman: "8500000000",
      },
    ],
  });
  assert.equal(result.ok, true, result.message);

  const vehicles = await listUserVehicles();
  assert.equal(vehicles.length, 1, "the vehicle reached the SAME list «دارایی‌های واقعی» renders");
  assert.equal(D(vehicles[0].purchasePriceToman ?? "0").toFixed(0), "8500000000");

  // The registry's own identity rules applied — the wizard restated none of
  // them. A symbol and an RWA asset row exist because `createUserVehicle`
  // made them, not because the wizard did.
  const [asset] = await db.select().from(assets).where(eq(assets.id, vehicles[0].assetId));
  assert.ok(asset, "an asset identity was created by the registry");
  assert.equal(asset.priceSource, "manual", "a vehicle is manually valued — the registry's rule");

  // THE INVARIANT: a vehicle is a registry record, not money that moved. The
  // only entry in the book is the wizard's own opening entry — and with no
  // opening balances entered, there is not even one.
  const entries = await db.select().from(journalEntries);
  assert.equal(entries.length, 0, "registering a vehicle posts no journal entry at all");
  assert.equal((await db.select().from(lots)).length, 0, "and opens no FIFO lot");
});

test("a ملک entered in the wizard lands in the registry with its own ledger entry", async () => {
  await freshDb();
  const { city, hood, propertyType } = await catalogs();
  assert.ok(city && hood && propertyType, "real-estate master data is seeded by its own bootstrap");

  const result = await completeSetup({
    ...BASE,
    properties: [
      {
        cityId: city!.id,
        neighborhoodId: hood!.id,
        propertyTypeId: propertyType!.id,
        acquisitionDate: "2023-05-10",
        purchasePriceToman: "45000000000",
        currentValueToman: "62000000000",
        sizeSqm: "120",
      },
    ],
  });
  assert.equal(result.ok, true, result.message);

  const properties = await listRealEstateAssets();
  assert.equal(properties.length, 1, "the property reached the registry's own list");
  assert.equal(D(properties[0].purchasePriceToman ?? "0").toFixed(0), "45000000000");

  // A property DOES post its own entry — that is the registry's behaviour and
  // the wizard neither adds to it nor suppresses it. What matters is that the
  // entry is the registry's, and it balances.
  const entries = await db.select().from(journalEntries);
  assert.equal(entries.length, 1, "exactly one entry, and it came from the registry path");
  const lines = await db.select().from(postings).where(eq(postings.entryId, entries[0].id));
  assert.ok(lines.length >= 2, "double entry");
  assert.ok(
    lines.reduce((sum: any, l: any) => sum.add(l.baseValue), D("0")).isZero(),
    "Σ base_value = 0",
  );
});

test("real assets do NOT join the opening entry or its equity counterweight", async () => {
  await freshDb();
  const { model } = await catalogs();

  // A bank balance AND a vehicle: the opening entry must carry only the bank.
  const result = await completeSetup({
    ...BASE,
    bankOpeningBalance: "50000000",
    vehicles: [
      {
        catalogId: model!.id,
        manufacturingYear: "1399",
        ownershipDate: "2024-01-15",
        purchasePriceToman: "6000000000",
      },
    ],
  });
  assert.equal(result.ok, true, result.message);

  const opening = await db.select().from(journalEntries).where(eq(journalEntries.type, "opening"));
  assert.equal(opening.length, 1);
  const lines = await db.select().from(postings).where(eq(postings.entryId, opening[0].id));

  // Two legs: the bank and the 3010 equity counterweight. The 6-billion-Toman
  // vehicle appears in NEITHER — it is not cash the user deposited, and adding
  // it here would have inflated opening equity by the price of a car.
  assert.equal(lines.length, 2, "bank + equity only");
  assert.ok(
    lines.reduce((sum: any, l: any) => sum.add(l.baseValue), D("0")).isZero(),
    "the opening entry still balances on its own",
  );

  // …and the vehicle is nonetheless registered.
  assert.equal((await listUserVehicles()).length, 1);
});

test("a bad real-asset row is reported by name and never costs the user their setup", async () => {
  await freshDb();

  const result = await completeSetup({
    ...BASE,
    bankOpeningBalance: "25000000",
    vehicles: [
      {
        // A catalogue id that does not exist — `createUserVehicle` refuses it,
        // which is exactly the rule the wizard must not restate.
        catalogId: "00000000-0000-4000-8000-000000000000",
        manufacturingYear: "1400",
        ownershipDate: "2024-06-01",
        purchasePriceToman: "8500000000",
      },
    ],
  });

  // The wizard still SUCCEEDS: the accounts and the opening balance committed
  // before the registry pass ran, so failing the whole thing would have made
  // the user re-enter every account for one bad row.
  assert.equal(result.ok, true);
  assert.match(result.message, /خودرو/, "the failure names which kind of row failed");
  assert.match(result.message, /دارایی‌های واقعی/, "…and where to add it instead");

  // The setup itself is intact and usable.
  const opening = await db.select().from(journalEntries).where(eq(journalEntries.type, "opening"));
  assert.equal(opening.length, 1, "the opening entry survived");
  assert.equal((await listUserVehicles()).length, 0, "and nothing half-written was left behind");
});

test("an empty real-asset list changes nothing at all", async () => {
  await freshDb();

  const result = await completeSetup({ ...BASE, vehicles: [], properties: [] });
  assert.equal(result.ok, true, result.message);
  assert.equal(
    result.message,
    "راه‌اندازی اولیه سیستم با موفقیت ثبت شد.",
    "a user who owns neither sees the plain success message, with no appended report",
  );
  assert.equal((await listUserVehicles()).length, 0);
  assert.equal((await listRealEstateAssets()).length, 0);
});
