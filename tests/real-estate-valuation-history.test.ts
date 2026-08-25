/**
 * دارایی واقعی ← ملک — تاریخچه ارزش‌گذاری تغییرناپذیر + بررسی رشد/افت دلاری بازه‌ای
 *
 * LOCKED RULES (mirror of vehicle_valuation_snapshots, enforced by tests):
 *
 *   1. Every valuation (initial registration included) is appended as an
 *      IMMUTABLE snapshot: Toman value + USD rate of that date + USD value.
 *      Revaluating later NEVER deletes or rewrites the previous snapshot —
 *      «ارزش سه ماه پیش» stays available forever.
 *   2. A second valuation for the SAME date is refused (unique index) — and
 *      the refusal is atomic: the property's current value is untouched.
 *   3. USD figures always use the rate stored IN the snapshot; today's rate
 *      never rewrites history (FX update ≠ valuation update).
 *   4. Period analysis (1m/3m/6m/1y/purchase/all) uses ONLY real snapshots —
 *      the baseline of «۳ ماه پیش» is the last valuation on or before that
 *      date; no interpolation, no invented values.
 *   5. Worked example (the product scenario):
 *        1405/01/01 — ملک ۱۰۰ متری، متری ۷۰M → 7,000,000,000 T، دلار 130,000
 *                    → 53,846.15 USD
 *        1405/06/01 — متری 80M → 8,000,000,000 T، دلار 200,000
 *                    → 40,000.00 USD
 *      → رشد تومانی +1,000,000,000 (+14.29٪) اما افت دلاری −13,846.15 (−25.71٪)
 *        (رشد قیمت ملک از رشد دلار عقب مانده است).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  cities,
  exchangeRates,
  journalEntries,
  neighborhoods,
  postings,
  prices,
  propertyTypes,
  realEstateProperties,
  realEstateValuationSnapshots,
} from "../src/db/schema";
import {
  backfillRealEstateValuationSnapshots,
  createRealEstateAsset,
  getRealEstateDashboard,
  listRealEstateValuationSnapshots,
  recordRealEstateValuation,
} from "../src/features/rwa/realEstate/service";
import {
  allRealEstatePeriodResults,
  compareRealEstateDates,
} from "../src/features/rwa/realEstate/analytics";
import { seedRealEstateMasterData } from "../src/features/rwa/realEstate/masterData";
import { jalaliToIso } from "../src/lib/format";
import { D } from "../src/domain/decimal";

/* ── the user's worked example dates ── */
const ACQUISITION = jalaliToIso(1404, 1, 1); // 2025-03-21 — تملک
const FARVARDIN = jalaliToIso(1405, 1, 1); // 2026-03-21 — 1 Farvardin 1405
const ORDIBEHESHT = jalaliToIso(1405, 2, 1); // +1 month
const TIR = jalaliToIso(1405, 4, 1); // +3 months
const SHAHRIVAR = jalaliToIso(1405, 6, 1); // 2026-08-23 — Shahrivar 1405
const MEHR = jalaliToIso(1405, 7, 1); // 2026-09-22 — +6 months

const SEVEN_B = "7000000000"; // 100 m² × 70M
const EIGHT_B = "8000000000"; // 100 m² × 80M

async function reset() {
  await createSchemaIfNotExists();
  await db.delete(realEstateValuationSnapshots);
  await db.delete(realEstateProperties);
  await db.delete(prices);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(exchangeRates);
  await db.delete(neighborhoods);
  await db.delete(propertyTypes);
  await db.delete(cities);
  await seedRealEstateMasterData();
}

async function setFxRate(date: string, rate: string) {
  await db
    .insert(exchangeRates)
    .values({ baseCurrency: "USD", quoteCurrency: "IRT", effectiveDate: date, rate, source: "test" })
    .onConflictDoNothing();
}

async function pickAhvazApartment() {
  const [city] = await db.select().from(cities).where(eq(cities.code, "AHZ"));
  const [hood] = await db.select().from(neighborhoods).where(eq(neighborhoods.code, "KPE"));
  const [type] = await db.select().from(propertyTypes).where(eq(propertyTypes.code, "APT"));
  assert.ok(city && hood && type, "master data must be seeded");
  return { cityId: city.id, neighborhoodId: hood.id, propertyTypeId: type.id };
}

/* ─────────────────────── the worked example, end to end ─────────────────────── */

test("کاربر مثال واقعی: رشد تومانی ۱۴.۲۹٪ و افت دلاری ۲۵.۷۱٪ بین فروردین و شهریور ۱۴۰۵", async () => {
  await reset();
  const ids = await pickAhvazApartment();
  // دلار ۱۳۰ هزار در ۱ فروردین ۱۴۰۵ (و زمان تملک ۱۴۰۴)
  await setFxRate(ACQUISITION, "130000");
  await setFxRate(FARVARDIN, "130000");

  const created = await createRealEstateAsset({
    ...ids,
    acquisitionDate: ACQUISITION,
    acquisitionDatePersian: "1404/01/01",
    valuationDate: FARVARDIN,
    valuationDatePersian: "1405/01/01",
    purchasePriceToman: SEVEN_B,
    currentValueToman: SEVEN_B,
    sizeSqm: "100",
  });

  // ثبتِ اولیه خودش یک Snapshot تغییرناپذیر است
  const initialHistory = await listRealEstateValuationSnapshots(created.id);
  assert.equal(initialHistory.length, 1, "initial valuation must be frozen as a snapshot");
  assert.equal(initialHistory[0]!.snapshotDate, FARVARDIN);
  assert.equal(initialHistory[0]!.currentValueToman, SEVEN_B);
  assert.equal(initialHistory[0]!.usdRate, "130000");
  assert.equal(initialHistory[0]!.currentValueUsd, "53846.15"); // 7B ÷ 130k

  // شهریور ۱۴۰۵: متری ۸۰ میلیون → ۸ میلیارد؛ دلار ۲۰۰ هزار
  await setFxRate(SHAHRIVAR, "200000");
  const reval = await recordRealEstateValuation({
    propertyId: created.id,
    valuationDate: SHAHRIVAR,
    valuationDatePersian: "1405/06/01",
    currentValueToman: EIGHT_B,
  });
  assert.equal(reval.currentValueUsd, "40000.00"); // 8B ÷ 200k
  assert.equal(reval.valuationFxRate, "200000");

  // تاریخچه: ردیف فروردین حذف/بازنویسی نشده — هر دو Snapshot موجودند
  const history = await listRealEstateValuationSnapshots(created.id);
  assert.equal(history.length, 2, "history must append, never replace");
  assert.equal(history[0]!.snapshotDate, FARVARDIN, "فروردین باید بماند");
  assert.equal(history[0]!.currentValueToman, SEVEN_B, "ارزش تومانی فروردین باید بماند");
  assert.equal(history[0]!.usdRate, "130000", "نرخ دلار فروردین باید بماند");
  assert.equal(history[0]!.currentValueUsd, "53846.15", "ارزش دلاری فروردین باید بماند");
  assert.equal(history[1]!.snapshotDate, SHAHRIVAR);
  assert.equal(history[1]!.currentValueToman, EIGHT_B);
  assert.equal(history[1]!.usdRate, "200000");
  assert.equal(history[1]!.currentValueUsd, "40000.00");

  // نقاط سری برای تحلیل بازه‌ای
  const points = history.map((s) => ({
    date: s.snapshotDate,
    valueToman: s.currentValueToman,
    usdRate: s.usdRate,
    valueUsd: s.currentValueUsd,
  }));
  const purchasePoint = {
    date: ACQUISITION,
    valueToman: SEVEN_B,
    usdRate: "130000",
    valueUsd: "53846.15",
  };

  const periods = allRealEstatePeriodResults(points, { todayIso: SHAHRIVAR, purchasePoint });
  const byKey = Object.fromEntries(periods.map((p) => [p.key, p]));

  // «از تاریخ تملک»: +1 میلیارد تومان (+14.29٪) اما −13,846.15 دلار (−25.71٪)
  const purchase = byKey["purchase"]!;
  assert.equal(purchase.available, true);
  if (!purchase.available) return;
  assert.equal(purchase.tomanChange, "1000000000");
  assert.equal(purchase.tomanChangePct, "14.29");
  assert.equal(purchase.usdChange, "-13846.15");
  assert.equal(purchase.usdChangePct, "-25.71");
  assert.equal(purchase.baselineIsPurchase, true);

  // «کل دوره»: همان واگرایی بین دو Snapshot واقعی
  const all = byKey["all"]!;
  assert.equal(all.available, true);
  if (!all.available) return;
  assert.equal(all.from.date, FARVARDIN);
  assert.equal(all.to.date, SHAHRIVAR);
  assert.equal(all.usdChange, "-13846.15");
  assert.equal(all.usdChangePct, "-25.71");
  assert.equal(all.tomanChange, "1000000000");
  assert.equal(all.tomanChangePct, "14.29");

  // مقایسه دلخواه دو تاریخ — همان اعداد، مستقیم
  const cmp = compareRealEstateDates(points, FARVARDIN, SHAHRIVAR, purchasePoint);
  assert.equal(cmp.available, true);
  if (!cmp.available) return;
  assert.equal(cmp.usdChange, "-13846.15");
  assert.equal(cmp.usdChangePct, "-25.71");
  assert.equal(cmp.tomanChangePct, "14.29");
});

/* ─────────────────────── immutability of history ─────────────────────── */

test("به‌روزرسانی‌های پیاپی (۱ماه/۳ماه/۶ماه) هیچ Snapshot قبلی را حذف نمی‌کنند", async () => {
  await reset();
  const ids = await pickAhvazApartment();
  await setFxRate(ACQUISITION, "130000");
  await setFxRate(FARVARDIN, "130000");
  await setFxRate(ORDIBEHESHT, "150000");
  await setFxRate(TIR, "170000");
  await setFxRate(MEHR, "200000");

  const created = await createRealEstateAsset({
    ...ids,
    acquisitionDate: ACQUISITION,
    valuationDate: FARVARDIN,
    purchasePriceToman: SEVEN_B,
    currentValueToman: SEVEN_B,
  });

  // کاربر هر بازه یک‌بار ارزش و نرخ دلار را آپدیت می‌کند
  await recordRealEstateValuation({
    propertyId: created.id,
    valuationDate: ORDIBEHESHT,
    currentValueToman: "7200000000",
  });
  await recordRealEstateValuation({
    propertyId: created.id,
    valuationDate: TIR,
    currentValueToman: "7500000000",
  });
  await recordRealEstateValuation({
    propertyId: created.id,
    valuationDate: MEHR,
    currentValueToman: EIGHT_B,
  });

  const history = await listRealEstateValuationSnapshots(created.id);
  assert.equal(history.length, 4, "initial + 3 revaluations = 4 immutable snapshots");
  assert.deepEqual(
    history.map((s) => s.snapshotDate),
    [FARVARDIN, ORDIBEHESHT, TIR, MEHR],
  );
  // اولین ردیف دست‌نخورده — ارزش سه/شش ماه پیش هنوز موجود است
  assert.equal(history[0]!.currentValueToman, SEVEN_B);
  assert.equal(history[0]!.usdRate, "130000");
  assert.equal(history[0]!.currentValueUsd, "53846.15");
  // ردیف آخر = ارزش جاری
  assert.equal(history[3]!.currentValueToman, EIGHT_B);
  assert.equal(history[3]!.usdRate, "200000");
  assert.equal(history[3]!.currentValueUsd, "40000.00");

  // prices هم برای هر تاریخ یک ردیف دارد (تاریخچه USD در Aggregates)
  const priceRows = await db.select().from(prices).where(eq(prices.assetId, created.assetId));
  assert.equal(priceRows.length, 4);

  // ردیف property به آخرین Snapshot اشاره می‌کند
  const [prop] = await db.select().from(realEstateProperties).where(eq(realEstateProperties.id, created.id));
  assert.equal(D(prop.currentValueToman!).toFixed(0), EIGHT_B);
  assert.equal(D(prop.valuationFxRate!).toFixed(0), "200000");
});

test("ارزش‌گذاری دوم در همان تاریخ رد می‌شود و چیزی هم تغییر نمی‌کند (اتم)", async () => {
  await reset();
  const ids = await pickAhvazApartment();
  await setFxRate(ACQUISITION, "130000");
  await setFxRate(FARVARDIN, "130000");
  await setFxRate(SHAHRIVAR, "200000");

  const created = await createRealEstateAsset({
    ...ids,
    acquisitionDate: ACQUISITION,
    valuationDate: FARVARDIN,
    purchasePriceToman: SEVEN_B,
    currentValueToman: SEVEN_B,
  });
  await recordRealEstateValuation({
    propertyId: created.id,
    valuationDate: SHAHRIVAR,
    currentValueToman: EIGHT_B,
  });

  await assert.rejects(
    () =>
      recordRealEstateValuation({
        propertyId: created.id,
        valuationDate: SHAHRIVAR, // همان تاریخ — باید رد شود
        currentValueToman: "9000000000",
      }),
    /تاریخ جدید ثبت کنید/,
  );

  // رد نشدنِ اتمیک: نه Snapshot اضافه شد، نه ارزش جاری عوض شد
  const history = await listRealEstateValuationSnapshots(created.id);
  assert.equal(history.length, 2);
  const [prop] = await db.select().from(realEstateProperties).where(eq(realEstateProperties.id, created.id));
  assert.equal(D(prop.currentValueToman!).toFixed(0), EIGHT_B);
});

test("نرخ دلار جدید، Snapshotهای قبلی را بازنویسی نمی‌کند (FX ≠ Valuation)", async () => {
  await reset();
  const ids = await pickAhvazApartment();
  await setFxRate(ACQUISITION, "130000");
  await setFxRate(FARVARDIN, "130000");

  const created = await createRealEstateAsset({
    ...ids,
    acquisitionDate: ACQUISITION,
    valuationDate: FARVARDIN,
    purchasePriceToman: SEVEN_B,
    currentValueToman: SEVEN_B,
  });

  // دلار جهش می‌کند ولی کاربر ارزش ملک را آپدیت نمی‌کند
  await setFxRate(SHAHRIVAR, "300000");
  const history = await listRealEstateValuationSnapshots(created.id);
  assert.equal(history.length, 1);
  assert.equal(history[0]!.usdRate, "130000", "stored snapshot rate must stay frozen");
  assert.equal(history[0]!.currentValueUsd, "53846.15");
});

/* ─────────────────────── period baselines use real data only ─────────────────────── */

test("مبنای «۱ ماه/۳ ماه/۶ ماه پیش» آخرین Snapshot واقعیِ همان تاریخ است — بدون درون‌یابی", async () => {
  const series = [
    { date: FARVARDIN, valueToman: "7000000000", usdRate: "130000", valueUsd: "53846.15" }, // 2026-03-21
    { date: TIR, valueToman: "7200000000", usdRate: "170000", valueUsd: "42352.94" }, // 2026-06-22
    { date: MEHR, valueToman: "8000000000", usdRate: "200000", valueUsd: "40000.00" }, // 2026-09-22
  ];

  const periods = allRealEstatePeriodResults(series, { todayIso: MEHR });
  const byKey = Object.fromEntries(periods.map((p) => [p.key, p]));

  // ۶ ماه پیش = 2026-03-22 → آخرین Snapshotِ قبل از آن: فروردین
  const six = byKey["6m"]!;
  assert.equal(six.available, true);
  if (!six.available) return;
  assert.equal(six.from.date, FARVARDIN);
  assert.equal(six.to.date, MEHR);

  // ۳ ماه پیش = 2026-06-22 → دقیقاً Snapshot تیر
  const three = byKey["3m"]!;
  assert.equal(three.available, true);
  if (!three.available) return;
  assert.equal(three.from.date, TIR);
  assert.equal(three.to.date, MEHR);

  // ۱ ماه پیش = 2026-08-22 → آخرین Snapshotِ قبل از آن: تیر (بدون اختراع مقدار)
  const one = byKey["1m"]!;
  assert.equal(one.available, true);
  if (!one.available) return;
  assert.equal(one.from.date, TIR);
  assert.equal(one.to.date, MEHR);
});

test("بدون داده تاریخی، بازه‌ها صریحاً «ناموجود» هستند — مقدار فرضی ساخته نمی‌شود", async () => {
  const series = [{ date: SHAHRIVAR, valueToman: EIGHT_B, usdRate: "200000", valueUsd: "40000.00" }];
  const periods = allRealEstatePeriodResults(series, { todayIso: SHAHRIVAR });
  const byKey = Object.fromEntries(periods.map((p) => [p.key, p]));
  assert.equal(byKey["1m"]!.available, false);
  assert.equal(byKey["3m"]!.available, false);
  assert.equal(byKey["6m"]!.available, false);
  assert.equal(byKey["purchase"]!.available, false, "no purchase record → unavailable");
  assert.equal(byKey["all"]!.available, false, "single snapshot → nothing to compare");
});

/* ─────────────────────── dashboard wiring ─────────────────────── */

test("داشبورد ملک: تاریخچه، بازه‌ها و نقطه خرید همه از داده واقعی ساخته می‌شوند", async () => {
  await reset();
  const ids = await pickAhvazApartment();
  await setFxRate(ACQUISITION, "130000");
  await setFxRate(FARVARDIN, "130000");
  await setFxRate(SHAHRIVAR, "200000");

  const created = await createRealEstateAsset({
    ...ids,
    acquisitionDate: ACQUISITION,
    valuationDate: FARVARDIN,
    purchasePriceToman: SEVEN_B,
    currentValueToman: SEVEN_B,
  });
  await recordRealEstateValuation({
    propertyId: created.id,
    valuationDate: SHAHRIVAR,
    currentValueToman: EIGHT_B,
  });

  const dashboard = await getRealEstateDashboard();
  const item = dashboard.find((d) => d.id === created.id);
  assert.ok(item, "property must appear on the dashboard");
  assert.equal(item.snapshots.length, 2);
  assert.equal(item.history.length, 2);
  assert.ok(item.purchasePoint, "purchase point must be derived from the immutable purchase row");
  assert.equal(item.purchasePoint!.date, ACQUISITION);
  assert.equal(item.purchasePoint!.usdRate, "130000");
  // اولین ردیف تاریخچه دلتا ندارد؛ دومی دلتای نسبت به قبلی دارد
  assert.equal(item.history[0]!.tomanChange, undefined);
  assert.equal(item.history[1]!.tomanChange, "1000000000");
  assert.equal(item.history[1]!.usdChange, "-13846.15");
  // بازه «از تاریخ تملک» موجود است و واگرایی تومان/دلار را نشان می‌دهد
  const purchase = item.periods.find((p) => p.key === "purchase");
  assert.ok(purchase?.available);
  if (!purchase?.available) return;
  assert.equal(purchase.usdChangePct, "-25.71");
  assert.equal(purchase.tomanChangePct, "14.29");
});

/* ─────────────────────── backfill of legacy rows ─────────────────────── */

test("Backfill: املاک قدیمی دقیقاً یک Snapshot از آخرین ارزش‌گذاری معتبر می‌گیرند — idempotent", async () => {
  await reset();
  const ids = await pickAhvazApartment();
  await setFxRate(ACQUISITION, "130000");
  await setFxRate(FARVARDIN, "130000");

  const created = await createRealEstateAsset({
    ...ids,
    acquisitionDate: ACQUISITION,
    valuationDate: FARVARDIN,
    purchasePriceToman: SEVEN_B,
    currentValueToman: SEVEN_B,
  });

  // شبیه‌سازی ملک قدیمی: تاریخچه Snapshotها پاک شده (قبل از این قابلیت ثبت شده بود)
  await db.delete(realEstateValuationSnapshots).where(eq(realEstateValuationSnapshots.propertyId, created.id));

  const first = await backfillRealEstateValuationSnapshots();
  assert.equal(first.inserted, 1, "legacy property gets exactly one snapshot");
  const afterFirst = await listRealEstateValuationSnapshots(created.id);
  assert.equal(afterFirst.length, 1);
  assert.equal(afterFirst[0]!.snapshotDate, FARVARDIN);
  assert.equal(afterFirst[0]!.currentValueToman, SEVEN_B);
  assert.equal(afterFirst[0]!.usdRate, "130000");
  assert.equal(afterFirst[0]!.currentValueUsd, "53846.15");

  // اجرای دوباره هیچ ردیف جدیدی نمی‌سازد
  const second = await backfillRealEstateValuationSnapshots();
  assert.equal(second.inserted, 0);
  assert.equal(second.skipped, 1);
  assert.equal((await listRealEstateValuationSnapshots(created.id)).length, 1);
});
