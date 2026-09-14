/**
 * Property Market Intelligence — FORWARD-ONLY market price tracking, per user.
 *
 *  - Growth from the first recorded price onward: 1m, 3m, 6m, 1y, 2y, …
 *    (open-ended). Future horizons «pending», passed horizons without a nearby
 *    record «missing» — nothing is interpolated or back-filled.
 *  - Toman AND dollar growth; dollars use the rate frozen on each record.
 *  - Future dates and dates older than 31 days are refused.
 *  - Every user sees and changes only their own market prices.
 *  - Market prices never touch the ledger, prices, lots or valuations.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import {
  areaBandOf,
  horizonsFor,
  marketGrowth,
  relativeToMarket,
  type MarketPoint,
} from "../src/features/rwa/realEstate/market/forward";
import { marketReminders } from "../src/features/rwa/realEstate/market/reminders";

function point(date: string, ppsqmToman: number, usdRate: number): MarketPoint {
  return { date, ppsqmToman, usdRate, ppsqmUsd: ppsqmToman / usdRate };
}

/* ─────────────────────────── pure engine ─────────────────────────── */

test("horizons: 1m, 3m, 6m, then yearly — at least 5 years, and they keep going", () => {
  assert.deepEqual(horizonsFor("2026-09-15", "2026-09-15"), [1, 3, 6, 12, 24, 36, 48, 60]);
  assert.deepEqual(horizonsFor("2026-09-15", "2033-10-01").slice(-3), [72, 84, 96]);
});

test("a brand-new market: every horizon is pending with its target date, nothing is invented", () => {
  const g = marketGrowth([point("2026-09-15", 95_000_000, 100_000)], "2026-09-15")!;
  assert.equal(g.sinceStart, null);
  assert.ok(g.horizons.every((h) => h.status === "pending"));
  assert.equal(g.horizons[0].targetDate, "2026-10-15");
  assert.equal(g.horizons[3].targetDate, "2027-09-15");
});

test("Toman up but dollar down — each record's own frozen rate is used", () => {
  const g = marketGrowth(
    [
      point("2026-09-15", 100_000_000, 100_000),
      point("2026-10-14", 105_000_000, 110_000),
      point("2027-03-16", 120_000_000, 150_000),
      point("2027-09-20", 140_000_000, 200_000),
    ],
    "2027-10-01",
  )!;
  const [m1, m3, m6, y1, y2] = g.horizons;
  assert.ok(m1.status === "available" && m1.tomanPct === 5 && m1.usdPct === -4.55);
  assert.equal(m3.status, "missing", "no record near the 3-month date — not interpolated");
  assert.ok(m6.status === "available" && m6.tomanPct === 20 && m6.usdPct === -20);
  assert.ok(y1.status === "available" && y1.tomanPct === 40 && y1.usdPct === -30);
  assert.equal(y2.status, "pending");
});

test("stale market data is flagged after 45 days without a new record", () => {
  const points = [point("2026-09-15", 95_000_000, 100_000)];
  assert.equal(marketGrowth(points, "2026-10-20")!.stale, false);
  assert.equal(marketGrowth(points, "2026-11-10")!.stale, true);
});

test("size band of a property", () => {
  assert.equal(areaBandOf(60), "a0-80");
  assert.equal(areaBandOf(120), "a80-150");
  assert.equal(areaBandOf(150), "a150-up");
  assert.equal(areaBandOf(null), null);
});

test("property vs market over the same window, only from real valuations near both ends", () => {
  const since = marketGrowth([point("2026-09-15", 100_000_000, 100_000), point("2027-09-15", 130_000_000, 130_000)], "2027-09-20")!.sinceStart;
  const rel = relativeToMarket(
    [
      { date: "2026-09-20", valueToman: 10_000_000_000, valueUsd: 100_000 },
      { date: "2027-09-10", valueToman: 12_000_000_000, valueUsd: 92_307.69 },
    ],
    since,
  )!;
  assert.equal(rel.propertyTomanPct, 20);
  assert.equal(rel.tomanPts, -10);
  assert.equal(rel.usdPts, -7.69);
  assert.equal(relativeToMarket([{ date: "2025-01-01", valueToman: 1, valueUsd: 1 }], since), null);
});

test("monthly reminders: missing market, due after 30 days, silent when fresh", () => {
  const props = [
    { id: "p1", label: "ملک ۱", neighborhoodId: "h1", propertyTypeId: "t1", sizeSqm: "120" },
    { id: "p2", label: "ملک ۲", neighborhoodId: "h2", propertyTypeId: "t1", sizeSqm: "60" },
    { id: "p3", label: "ملک ۳", neighborhoodId: "h3", propertyTypeId: "t1", sizeSqm: null },
  ];
  const segments = [
    { neighborhoodId: "h1", propertyTypeId: "t1", areaBand: "a80-150", latestDate: "2026-09-01" },
    { neighborhoodId: "h3", propertyTypeId: "t1", areaBand: "all", latestDate: "2026-08-01" },
  ];
  assert.deepEqual(marketReminders(props, segments, "2026-09-15"), [
    { propertyId: "p2", label: "ملک ۲", status: "missing" },
    { propertyId: "p3", label: "ملک ۳", status: "due", daysSinceLatest: 45 },
  ]);
  assert.deepEqual(
    marketReminders(props.slice(0, 1), segments, "2026-10-05").map((r) => r.status),
    ["due"],
    "30 days after the last price the reminder appears",
  );
});

/* ─────────────────────────── database: ownership + accounting firewall ─────────────────────────── */

test("DB: per-user entries, frozen dollar rate, property view, isolation, and no accounting writes", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const schema = await import("../src/db/schema");
  const { seedRealEstateMasterData } = await import("../src/features/rwa/realEstate/masterData");
  const { createRealEstateAsset, getRealEstateDashboard } = await import("../src/features/rwa/realEstate/service");
  const { recordMarketPrice, deleteMarketPrice, getPropertyMarketViews, listMarketSegments } = await import(
    "../src/features/rwa/realEstate/market/service"
  );

  await createSchemaIfNotExists();
  await db.delete(schema.marketPriceSnapshots);
  await db.delete(schema.realEstateValuationSnapshots);
  await db.delete(schema.realEstateProperties);
  await db.delete(schema.prices);
  await db.delete(schema.postings);
  await db.delete(schema.journalEntries);
  await db.delete(schema.exchangeRates);
  await db.delete(schema.neighborhoods);
  await db.delete(schema.propertyTypes);
  await db.delete(schema.cities);
  await seedRealEstateMasterData();
  for (const [d, rate] of [
    ["2025-03-21", "80000"],
    ["2026-09-15", "100000"],
    ["2026-10-15", "110000"],
  ]) {
    await db.insert(schema.exchangeRates).values({ baseCurrency: "USD", quoteCurrency: "IRT", effectiveDate: d, rate, source: "test" });
  }
  const [other] = await db.insert(schema.users).values({ name: "کاربر دیگر", username: `market-other-${Date.now()}`, role: "user" }).returning();

  const [city] = await db.select().from(schema.cities).where(eq(schema.cities.code, "AHZ"));
  const [hood] = await db.select().from(schema.neighborhoods).where(eq(schema.neighborhoods.code, "KPE"));
  const [otherHood] = await db.select().from(schema.neighborhoods).where(eq(schema.neighborhoods.code, "GOL"));
  const [type] = await db.select().from(schema.propertyTypes).where(eq(schema.propertyTypes.code, "APT"));
  await createRealEstateAsset({
    cityId: city.id,
    neighborhoodId: hood.id,
    propertyTypeId: type.id,
    acquisitionDate: "2025-03-21",
    valuationDate: "2026-09-15",
    purchasePriceToman: "8000000000",
    currentValueToman: "10000000000",
    sizeSqm: "120",
  });

  const base = { cityId: city.id, neighborhoodId: hood.id, propertyTypeId: type.id, areaBand: "a80-150" };

  await assert.rejects(() => recordMarketPrice({ ...base, observedOn: "2026-09-16", pricePerSqmToman: "90000000" }, { todayIso: "2026-09-15" }), /آینده/);
  await assert.rejects(() => recordMarketPrice({ ...base, observedOn: "2026-07-01", pricePerSqmToman: "90000000" }, { todayIso: "2026-09-15" }), /گذشته/);
  await assert.rejects(
    () => recordMarketPrice({ ...base, cityId: "00000000-0000-0000-0000-000000000000", observedOn: "2026-09-15", pricePerSqmToman: "90000000" }, { todayIso: "2026-09-15" }),
    /محله/,
  );
  await assert.rejects(
    () => recordMarketPrice({ ...base, observedOn: "2026-09-15", pricePerSqmToman: "90000000", lowPpsqmToman: "95000000" }, { todayIso: "2026-09-15" }),
    /بازهٔ قیمت/,
  );

  const count = async (table: any) => Number((await db.select({ n: sql<number>`count(*)` }).from(table))[0].n);
  const before = {
    entries: await count(schema.journalEntries),
    postings: await count(schema.postings),
    prices: await count(schema.prices),
    valuations: await count(schema.realEstateValuationSnapshots),
  };

  const first = await recordMarketPrice({ ...base, observedOn: "2026-09-15", pricePerSqmToman: "90000000", sampleCount: 25 }, { todayIso: "2026-09-15" });
  assert.equal(first.usdRate, "100000");
  assert.equal(Number(first.pricePerSqmUsd), 900);
  await assert.rejects(() => recordMarketPrice({ ...base, observedOn: "2026-09-15", pricePerSqmToman: "91000000" }, { todayIso: "2026-09-15" }), /قبلاً/);
  const second = await recordMarketPrice({ ...base, observedOn: "2026-10-15", pricePerSqmToman: "99000000" }, { todayIso: "2026-10-20" });
  assert.equal(second.usdRate, "110000");
  await recordMarketPrice({ ...base, neighborhoodId: otherHood.id, observedOn: "2026-10-15", pricePerSqmToman: "70000000" }, { todayIso: "2026-10-20" });

  // Another user's price for the SAME market is invisible to this user, and vice versa.
  const foreign = await recordMarketPrice({ ...base, userId: other.id, observedOn: "2026-10-15", pricePerSqmToman: "500000000" }, { todayIso: "2026-10-20" });

  const items = await getRealEstateDashboard(null);
  const view = (await getPropertyMarketViews(items, { todayIso: "2026-10-20" }))[items[0].id];
  assert.equal(view.status, "ok");
  if (view.status !== "ok") return;
  const oneMonth = view.growth.horizons[0];
  assert.ok(oneMonth.status === "available" && oneMonth.tomanPct === 10 && oneMonth.usdPct === 0, "+10% Toman, 0% dollar");
  assert.equal(view.growth.latest.ppsqmToman, 99_000_000, "another user's 500M entry is never used");
  assert.equal(view.estimate!.toman, 99_000_000 * 120);
  assert.equal(view.neighborhoods.length, 2);

  assert.equal((await listMarketSegments(null, { todayIso: "2026-10-20" })).length, 2);
  const otherSegments = await listMarketSegments(other.id, { todayIso: "2026-10-20" });
  assert.equal(otherSegments.length, 1);
  assert.equal(otherSegments[0].latestPpsqmToman, "500000000");
  await assert.rejects(() => deleteMarketPrice(foreign.id, null), /یافت نشد/, "a user cannot delete another user's entry");

  const after = {
    entries: await count(schema.journalEntries),
    postings: await count(schema.postings),
    prices: await count(schema.prices),
    valuations: await count(schema.realEstateValuationSnapshots),
  };
  assert.deepEqual(after, before, "market prices never write accounting, prices or valuations");
  const [prop] = await db.select().from(schema.realEstateProperties);
  assert.equal(Number(prop.currentValueToman), 10_000_000_000);

  await deleteMarketPrice(second.id);
  const afterDelete = (await getPropertyMarketViews(items, { todayIso: "2026-10-20" }))[items[0].id];
  assert.ok(afterDelete.status === "ok" && afterDelete.growth.horizons[0].status === "missing");
  assert.deepEqual(await getPropertyMarketViews([]), {});
});
