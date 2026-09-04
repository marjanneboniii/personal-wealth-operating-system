/**
 * Real-estate visibility — «چرا بخش املاک خالی است؟»
 *
 * Locks two things:
 *   1. The module's read path (`loadProperties` via `listRealEstateAssets`) keeps
 *      its security semantics: a tenant only ever sees rows it owns, unowned
 *      (user_id NULL) rows are never shared, and a soft-deleted asset is gone.
 *   2. `buildVisibilityReport` explains each of those filters and NEVER claims a
 *      row is visible/hidden differently from what the read path actually returns.
 *      A diagnosis that disagrees with the module would be worse than no diagnosis.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  assetClasses,
  assets,
  cities,
  exchangeRates,
  journalEntries,
  neighborhoods,
  postings,
  prices,
  propertyTypes,
  realEstateProperties,
  users,
} from "../src/db/schema";
import { createRealEstateAsset, listRealEstateAssets, repairOrphanedRealEstate } from "../src/features/rwa/realEstate/service";
import { seedRealEstateMasterData } from "../src/features/rwa/realEstate/masterData";
import { buildVisibilityReport, classify, type QueryRunner, type Verdict } from "../src/features/rwa/realEstate/visibility";
import { jalaliToIso } from "../src/lib/format";

const ACQ = jalaliToIso(1404, 5, 20);
const VAL = jalaliToIso(1405, 5, 20);

const q: QueryRunner = async (text) => {
  const res = await db.execute(sql.raw(text));
  return (res as { rows: Record<string, any>[] }).rows;
};

async function reset() {
  await createSchemaIfNotExists();
  await db.delete(realEstateProperties);
  await db.delete(prices);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(users);
  await db.delete(assets).where(sql`${assets.symbol} ~ '^[0-9]+$' OR ${assets.symbol} LIKE '__del_%'`);
  await db.delete(exchangeRates);
  await db.delete(neighborhoods);
  await db.delete(propertyTypes);
  await db.delete(cities);
  await seedRealEstateMasterData();
  for (const date of [ACQ, VAL]) {
    await db
      .insert(exchangeRates)
      .values({ baseCurrency: "USD", quoteCurrency: "IRT", effectiveDate: date, rate: "100000", source: "test" })
      .onConflictDoNothing();
  }
}

async function ids() {
  const [city] = await db.select().from(cities).where(sql`${cities.code} = 'AHZ'`);
  const [hood] = await db.select().from(neighborhoods).where(sql`${neighborhoods.code} = 'KPE'`);
  const [type] = await db.select().from(propertyTypes).where(sql`${propertyTypes.code} = 'APT'`);
  return { cityId: city!.id, neighborhoodId: hood!.id, propertyTypeId: type!.id };
}

async function makeUser(name: string, role = "user") {
  const [u] = await db.insert(users).values({ name, role } as any).returning();
  return u!;
}

async function makeProperty(userId: string | null) {
  const idsValue = await ids();
  return createRealEstateAsset({
    userId,
    cityId: idsValue.cityId,
    neighborhoodId: idsValue.neighborhoodId,
    propertyTypeId: idsValue.propertyTypeId,
    acquisitionDate: ACQ,
    valuationDate: VAL,
    purchasePriceToman: "4500000000",
    currentValueToman: "7000000000",
  });
}

/** The verdict the diagnosis gives for `propertyId` from `userId`'s point of view. */
async function verdictFor(userId: string | null, propertyId: string): Promise<Verdict | "ABSENT"> {
  const report = await buildVisibilityReport(q, { userIdentity: userId ?? undefined });
  const tenant = report.tenants.find((t) => (t.user.id ?? null) === userId) ?? report.tenants[0];
  const hidden = tenant?.hidden.find((h) => h.row.id === propertyId);
  if (hidden) return hidden.verdict;
  const inInventory = await db
    .select({ id: realEstateProperties.id })
    .from(realEstateProperties)
    .where(sql`${realEstateProperties.id} = ${propertyId}`)
    .limit(1);
  if (inInventory.length === 0) return "ABSENT";
  return "VISIBLE";
}

/* ─────────────── tenant scoping: the #1 cause, by design ─────────────── */

test("a property registered under another account stays invisible — and is diagnosed as HIDDEN_OTHER_TENANT", async () => {
  await reset();
  const owner = await makeUser("owner-a", "owner");
  const other = await makeUser("user-b");

  const created = await makeProperty(owner.id);

  // Read path: security first — B must not see A's property at all.
  assert.equal((await listRealEstateAssets(owner.id)).length, 1);
  assert.equal((await listRealEstateAssets(other.id)).length, 0);

  // Diagnosis: agrees with the read path, and names the reason.
  assert.equal(await verdictFor(owner.id, created.id), "VISIBLE");
  assert.equal(await verdictFor(other.id, created.id), "HIDDEN_OTHER_TENANT");

  const report = await buildVisibilityReport(q, { userIdentity: other.username ?? other.id });
  assert.equal(report.tenants.length, 1, "one account in scope");
  assert.equal(report.tenants[0]!.visibleCount, 0);
  assert.equal(report.tenants[0]!.hidden[0]!.row.user_id, owner.id, "the hidden row is attributed to the other owner");
});

test("a pre-multi-user property (user_id NULL) is hidden from every tenant and reported as HIDDEN_NO_OWNER", async () => {
  await reset();
  const u = await makeUser("solo", "owner");

  // Legacy row: created before auth existed → no tenant.
  const created = await makeProperty(null);

  assert.equal((await listRealEstateAssets(u.id)).length, 0, "unowned rows are never shared with an identified tenant");
  assert.equal(await verdictFor(u.id, created.id), "HIDDEN_NO_OWNER");

  const report = await buildVisibilityReport(q, { userIdentity: u.id });
  assert.equal(report.unownedPropertyCount, 1);
  assert.equal(report.totalProperties, 1);

  // And it becomes visible the moment the sanctioned claim migration owns it.
  await db.update(realEstateProperties).set({ userId: u.id } as any).where(sql`${realEstateProperties.id} = ${created.id}`);
  assert.equal((await listRealEstateAssets(u.id)).length, 1);
  assert.equal(await verdictFor(u.id, created.id), "VISIBLE");
});

/* ─────────────── soft-deleted asset: deleted / sold / orphan-repair ─────────────── */

test("a property whose asset is soft-deleted is hidden and diagnosed as HIDDEN_ASSET_SOFT_DELETED", async () => {
  await reset();
  const u = await makeUser("owner-c", "owner");
  const created = await makeProperty(u.id);
  assert.equal((await listRealEstateAssets(u.id)).length, 1);

  // Shape left behind by an asset-level soft-delete (tombstone on `assets`).
  await db
    .update(assets)
    .set({ deletedAt: new Date() } as any)
    .where(sql`${assets.id} = ${created.assetId}`);

  assert.equal((await listRealEstateAssets(u.id)).length, 0, "assets.deleted_at is part of the module's filter");
  assert.equal(await verdictFor(u.id, created.id), "HIDDEN_ASSET_SOFT_DELETED");
});

test("orphan repair hides a ghost asset from the registry AND the diagnosis lists it as a ghost", async () => {
  await reset();
  const u = await makeUser("owner-d", "owner");

  // A «دارایی واقعی» asset with no real_estate_properties row — counted by the
  // portfolio read model, unlistable by the املاک module.
  const [rwaClass] = await db.select().from(assetClasses).where(sql`${assetClasses.code} = 'RWA'`);
  const klass =
    rwaClass ??
    (await db
      .insert(assetClasses)
      .values({ code: "RWA", name: "دارایی واقعی", color: "#12131c", sortOrder: 90 } as any)
      .onConflictDoNothing()
      .returning()
      .then((r) => r[0] ?? null));
  assert.ok(klass, "RWA class must exist");

  const [ghost] = await db
    .insert(assets)
    .values({ name: "ملكِ بدون ثبت در ماژول", symbol: "910", classId: klass!.id, decimals: 2, priceSource: "manual", pricingMethod: "manual" } as any)
    .returning();

  const report = await buildVisibilityReport(q, { userIdentity: u.id });
  assert.ok(
    report.tenants[0]!.ghostAssets.some((g) => g.id === ghost!.id),
    "the ghost asset must be surfaced as 'counted as a real asset, no property row'",
  );

  // Repair is the sanctioned cleanup: it soft-deletes the ghost (so it leaves
  // every read model) and the diagnosis stops reporting it as a live ghost.
  await repairOrphanedRealEstate();
  const after = await buildVisibilityReport(q, { userIdentity: u.id });
  assert.ok(!after.tenants[0]!.ghostAssets.some((g) => g.id === ghost!.id), "repaired ghost must disappear from the ghost list");
  const [stillThere] = await db.select({ tombstone: assets.deletedAt }).from(assets).where(sql`${assets.id} = ${ghost!.id}`).limit(1);
  assert.ok(stillThere?.tombstone, "repair soft-deletes the asset instead of destroying the row");
});

/* ─────────────── the diagnosis must never contradict the module ─────────────── */

test("reported visibility count equals the module's own read path, for every account", async () => {
  await reset();
  const a = await makeUser("owner-e", "owner");
  const b = await makeUser("user-f");
  const createdForA = await makeProperty(a.id);
  // The pre-multi-user shape: an owned row whose owner was never backfilled.
  const legacyRow = await makeProperty(a.id);
  await db.update(realEstateProperties).set({ userId: null } as any).where(sql`${realEstateProperties.id} = ${legacyRow.id}`);

  const report = await buildVisibilityReport(q);
  for (const tenant of report.tenants) {
    const expected = (await listRealEstateAssets(tenant.user.id)).length;
    assert.equal(tenant.visibleCount, expected, `visibleCount must equal listRealEstateAssets() for ${tenant.user.name}`);
  }

  // Pure-function contract for the four states a row can be in.
  assert.equal(classify({ id: "1", asset_id: "x", asset_deleted_at: null, user_id: a.id } as any, a.id), "VISIBLE");
  assert.equal(classify({ id: "1", asset_id: "x", asset_deleted_at: null, user_id: null } as any, a.id), "HIDDEN_NO_OWNER");
  assert.equal(classify({ id: "1", asset_id: "x", asset_deleted_at: null, user_id: b.id } as any, a.id), "HIDDEN_OTHER_TENANT");
  assert.equal(classify({ id: "1", asset_id: "x", asset_deleted_at: new Date(), user_id: a.id } as any, a.id), "HIDDEN_ASSET_SOFT_DELETED");
  assert.equal(classify({ id: "1", asset_id: null, asset_deleted_at: null, user_id: a.id } as any, a.id), "HIDDEN_ASSET_MISSING");

  assert.ok(createdForA.id && legacyRow.id);
});
