/**
 * DEV-ONLY sample data for the vehicle module — NEVER runs by default.
 *
 * Activated only when `PWOS_VEHICLE_DEMO=1` is set, so a developer can explore
 * the module (purchase → snapshots → sale → portfolio) without hand-entering
 * data. These numbers are illustrative placeholders, NOT market data: the real
 * catalog ships with brands/models only, and every valuation must be recorded
 * by the user. Nothing here is ever seeded in personal/production mode.
 */
import { db } from "@/db";
import { exchangeRates, vehicleAssets } from "@/db/schema";
import { listVehicleBrands, listVehicleCatalogModels, normalizeKey } from "@/features/rwa/vehicle/catalog";
import { createUserVehicle, sellVehicle } from "@/features/rwa/vehicle/service";
import { recordVehicleValuationSnapshot } from "@/features/rwa/vehicle/valuation";
import { jalaliToIso } from "@/lib/format";

let done = false;

export async function demoSeedVehicles(userId: string | null) {
  if (process.env.PWOS_VEHICLE_DEMO !== "1") return;
  if (done) return;
  done = true;
  const rows = await db.select().from(vehicleAssets).limit(1);
  if (rows.length) return;

  for (const [d, r] of [
    [jalaliToIso(1403, 5, 18), "62000"],
    [jalaliToIso(1404, 5, 18), "95000"],
    [jalaliToIso(1405, 2, 10), "150000"],
    [jalaliToIso(1405, 5, 18), "200000"],
  ] as const) {
    await db.insert(exchangeRates).values({ baseCurrency: "USD", quoteCurrency: "IRT", effectiveDate: d, rate: r, source: "demo" }).onConflictDoNothing();
  }

  const brands = await listVehicleBrands();
  const pick = async (name: string) => {
    const k = normalizeKey(name);
    const b = brands.find((x) => normalizeKey(x.name) === k || normalizeKey(x.nameEn ?? "") === k);
    if (!b) return null;
    const m = await listVehicleCatalogModels(b.id);
    return m[0] ?? null;
  };

  const a = await pick("ایران‌خودرو");
  const bmw = await pick("BMW");
  if (a) {
    const v = await createUserVehicle({
      userId, catalogId: a.id, manufacturingYear: 1403,
      ownershipDate: jalaliToIso(1404, 5, 18), purchasePriceToman: "8500000000",
      plate: "۱۲ ب ۳۴۵ ایران ۱۰", mileage: 32000,
    });
    await recordVehicleValuationSnapshot({ catalogId: a.id, userVehicleId: v.id, snapshotDate: jalaliToIso(1405, 2, 10), currentValueToman: "9000000000" });
    await recordVehicleValuationSnapshot({ catalogId: a.id, userVehicleId: v.id, snapshotDate: jalaliToIso(1405, 5, 18), currentValueToman: "10200000000" });
  }
  if (bmw) {
    const v = await createUserVehicle({
      userId, catalogId: bmw.id, manufacturingYear: 2023,
      ownershipDate: jalaliToIso(1403, 5, 18), purchasePriceToman: "45000000000",
    });
    await recordVehicleValuationSnapshot({ catalogId: bmw.id, userVehicleId: v.id, snapshotDate: jalaliToIso(1405, 2, 10), currentValueToman: "70000000000" });
    await recordVehicleValuationSnapshot({ catalogId: bmw.id, userVehicleId: v.id, snapshotDate: jalaliToIso(1405, 5, 18), currentValueToman: "78000000000" });
  }
  const saipa = await pick("سایپا");
  if (saipa) {
    const v = await createUserVehicle({
      userId, catalogId: saipa.id, manufacturingYear: 1400,
      ownershipDate: jalaliToIso(1403, 5, 18), purchasePriceToman: "3000000000",
    });
    await sellVehicle({ vehicleId: v.id, userId, saleDate: jalaliToIso(1405, 2, 10), salePriceToman: "4100000000" });
  }
}
