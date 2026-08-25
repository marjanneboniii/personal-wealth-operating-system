/**
 * End-to-end smoke test of the REAL server actions (form → action → service).
 * Uses real FormData exactly like the browser would submit it.
 */
import assert from "node:assert/strict";
import { before, mock, test } from "node:test";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import { assets, cities, neighborhoods, propertyTypes, postings, prices, realEstateProperties, journalEntries, exchangeRates } from "../src/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { seedRealEstateMasterData } from "../src/features/rwa/realEstate/masterData";
import { jalaliToIso } from "../src/lib/format";
import { D } from "../src/domain/decimal";

// The actions call revalidatePath() which needs a Next.js request context —
// mock it out (module mocks must be registered before the action module loads).
mock.module("next/cache", {
  namedExports: { revalidatePath: () => undefined },
});

let actions: {
  saveRealEstateAction: (p: any, f: FormData) => Promise<{ ok: boolean; message: string }>;
  previewRealEstateIdentityAction: (...a: any[]) => Promise<any>;
  previewRealEstateUsdAction: (...a: any[]) => Promise<any>;
  recordRealEstateValuationAction: (p: any, f: FormData) => Promise<{ ok: boolean; message: string }>;
};
before(async () => {
  actions = await import("../src/app/actions/realEstate");
});

async function reset() {
  await createSchemaIfNotExists();
  const registered = await db.select({ assetId: realEstateProperties.assetId }).from(realEstateProperties);
  await db.delete(realEstateProperties);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(prices);
  await db.delete(exchangeRates);
  if (registered.length) await db.delete(assets).where(inArray(assets.id, registered.map((row) => row.assetId)));
  await db.delete(neighborhoods);
  await db.delete(propertyTypes);
  await db.delete(cities);
  await seedRealEstateMasterData();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

async function ids() {
  const [city] = await db.select().from(cities).where(eq(cities.code, "AHZ"));
  const [hood] = await db.select().from(neighborhoods).where(eq(neighborhoods.code, "KPE"));
  const [type] = await db.select().from(propertyTypes).where(eq(propertyTypes.code, "APT"));
  return { cityId: city!.id, neighborhoodId: hood!.id, propertyTypeId: type!.id };
}

test("saveRealEstateAction registers the property end-to-end (with Persian dates)", async () => {
  await reset();
  await db
    .insert(exchangeRates)
    .values([
      { baseCurrency: "USD", quoteCurrency: "IRT", effectiveDate: jalaliToIso(1404, 5, 20), rate: "90000", source: "test" },
      { baseCurrency: "USD", quoteCurrency: "IRT", effectiveDate: jalaliToIso(1405, 5, 20), rate: "150000", source: "test" },
    ]);

  const { cityId, neighborhoodId, propertyTypeId } = await ids();
  const result = await 
actions.saveRealEstateAction(null, fd({
    cityId,
    neighborhoodId,
    propertyTypeId,
    acquisitionDate: jalaliToIso(1404, 5, 20),
    acquisitionDatePersian: "1404/05/20",
    valuationDate: jalaliToIso(1405, 5, 20),
    valuationDatePersian: "1405/05/20",
    purchasePriceToman: "4,500,000,000",
    currentValueToman: "7,000,000,000",
  }));

  assert.equal(result.ok, true, result.message);
  assert.match(result.message, /شناسه ۰۰۱/);

  const [prop] = await db.select().from(realEstateProperties);
  assert.ok(prop);
  assert.equal(prop!.acquisitionDate, "2025-08-11");
  assert.equal(D(prop!.purchaseValueUsd!).toFixed(2), "50000.00");
  assert.equal(D(prop!.currentValueUsd!).toFixed(2), "46666.67");
  assert.equal(prop!.isHistorical, true);
  assert.ok(prop!.ledgerEntryId, "ledger link must be stored");

  // Second registration gets the next compact RWA identity.
  const result2 = await 
actions.saveRealEstateAction(null, fd({
    cityId,
    neighborhoodId,
    propertyTypeId,
    acquisitionDate: jalaliToIso(1404, 5, 20),
    acquisitionDatePersian: "1404/05/20",
    valuationDate: jalaliToIso(1405, 5, 20),
    valuationDatePersian: "1405/05/20",
    purchasePriceToman: "4500000000",
    currentValueToman: "7000000000",
  }));
  assert.equal(result2.ok, true, result2.message);
  assert.match(result2.message, /شناسه ۰۰۲/);
});

test("preview actions return generated identity and USD values", async () => {
  await reset();
  await db
    .insert(exchangeRates)
    .values({ baseCurrency: "USD", quoteCurrency: "IRT", effectiveDate: jalaliToIso(1404, 5, 20), rate: "90000", source: "test" });
  const { cityId, neighborhoodId, propertyTypeId } = await ids();

  const id = await 
actions.previewRealEstateIdentityAction(cityId, neighborhoodId, propertyTypeId);
  assert.equal(id.ok, true);
  assert.equal(id.symbol, "001");
  assert.equal(id.assetName, "001");

  const usd = await 
actions.previewRealEstateUsdAction("4500000000", jalaliToIso(1404, 5, 20));
  assert.equal(usd.ok, true);
  assert.equal(usd.usd, "50000.00");
  assert.equal(D(usd.rate).toFixed(0), "90000");
  assert.equal(usd.isExact, true);
});

test("recordRealEstateValuationAction revalues without touching the ledger", async () => {
  await reset();
  await db
    .insert(exchangeRates)
    .values([
      { baseCurrency: "USD", quoteCurrency: "IRT", effectiveDate: jalaliToIso(1404, 5, 20), rate: "90000", source: "test" },
      { baseCurrency: "USD", quoteCurrency: "IRT", effectiveDate: jalaliToIso(1405, 5, 20), rate: "150000", source: "test" },
    ]);
  const { cityId, neighborhoodId, propertyTypeId } = await ids();
  await 
actions.saveRealEstateAction(null, fd({
    cityId,
    neighborhoodId,
    propertyTypeId,
    acquisitionDate: jalaliToIso(1404, 5, 20),
    acquisitionDatePersian: "1404/05/20",
    valuationDate: jalaliToIso(1405, 5, 20),
    valuationDatePersian: "1405/05/20",
    purchasePriceToman: "4500000000",
    currentValueToman: "7000000000",
  }));

  const [prop] = await db.select().from(realEstateProperties);
  const entriesBefore = await db.select().from(journalEntries).where(sql`status = 'posted'`);

  const reval = await 
actions.recordRealEstateValuationAction(null, fd({
    propertyId: prop!.id,
    valuationDate: jalaliToIso(1405, 8, 1),
    valuationDatePersian: "1405/08/01",
    currentValueToman: "8400000000",
  }));
  assert.equal(reval.ok, true, reval.message);

  const entriesAfter = await db.select().from(journalEntries).where(sql`status = 'posted'`);
  assert.equal(entriesAfter.length, entriesBefore.length, "revaluation must not add ledger entries");
  assert.equal(entriesAfter[0]!.id, entriesBefore[0]!.id, "existing ledger entry untouched");
});
