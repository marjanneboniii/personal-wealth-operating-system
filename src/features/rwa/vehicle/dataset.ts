/**
 * Vehicle dataset import — «قیمت بازار» ⇒ «ارزش فعلی».
 *
 * Import rules enforced here (they are part of the module contract):
 *  1. The first snapshot of an imported dataset is dated 18 مرداد 1405.
 *  2. Only the market value is imported and it becomes «ارزش فعلی»
 *     (Current Value). There is NO «قیمت نمایندگی» (dealer price) anywhere in
 *     the module: such a field is ignored on import and never stored.
 *  3. Intra-day / daily fluctuations are NOT imported as history — a dataset
 *     import creates exactly ONE snapshot per model, so no fake history is
 *     produced.
 *  4. Import is idempotent: an existing snapshot for the same model and date
 *     is left untouched (snapshots are immutable).
 */
import { jalaliToIso } from "@/lib/format";
import { createCatalogModel, createVehicleBrand, listVehicleBrands, listVehicleCatalogModels, normalizeKey } from "./catalog";
import { listCatalogSnapshots, recordVehicleValuationSnapshot } from "./valuation";
import type { VehicleOrigin } from "./types";

/** 18 مرداد 1405 — تاریخ اولین Snapshot دیتاست اولیه */
export const DATASET_FIRST_SNAPSHOT_JALALI = "1405/05/18";
export const DATASET_FIRST_SNAPSHOT_DATE = jalaliToIso(1405, 5, 18); // 2026-08-09

export type VehicleDatasetRow = {
  brand: string;
  brandEn?: string;
  origin?: VehicleOrigin;
  manufacturer?: string;
  model: string;
  /** ارزش فعلی (قیمت بازار سابق) به تومان */
  currentValueToman: string;
  /** نرخ دلار آن تاریخ؛ در صورت نبود، از سیستم نرخ ارز خوانده می‌شود */
  usdRate?: string;
  /** پیش‌فرض: 18 مرداد 1405 */
  snapshotDate?: string;
  /**
   * قیمت نمایندگی — عمداً پشتیبانی نمی‌شود.
   * اگر در دیتاست خام وجود داشته باشد، نادیده گرفته و ذخیره نمی‌شود.
   */
  dealerPrice?: never;
};

export type DatasetImportReport = {
  createdBrands: number;
  createdModels: number;
  createdSnapshots: number;
  skipped: { model: string; reason: string }[];
};

export async function importVehicleDataset(
  rows: VehicleDatasetRow[],
  opts: { snapshotDate?: string; source?: string } = {},
): Promise<DatasetImportReport> {
  const report: DatasetImportReport = { createdBrands: 0, createdModels: 0, createdSnapshots: 0, skipped: [] };
  const snapshotDate = opts.snapshotDate ?? DATASET_FIRST_SNAPSHOT_DATE;

  for (const row of rows) {
    const label = `${row.brand} — ${row.model}`;
    try {
      const brands = await listVehicleBrands(true);
      const brandKey = normalizeKey(row.brand);
      let brand = brands.find((b) => normalizeKey(b.name) === brandKey || normalizeKey(b.nameEn ?? "") === brandKey);
      if (!brand) {
        brand = await createVehicleBrand({
          name: row.brand,
          nameEn: row.brandEn,
          origin: row.origin ?? "imported",
        });
        report.createdBrands++;
      }

      const models = await listVehicleCatalogModels(brand.id);
      const modelKey = normalizeKey(row.model);
      let model = models.find((m) => normalizeKey(m.modelName) === modelKey);
      if (!model) {
        model = await createCatalogModel({
          brandId: brand.id,
          modelName: row.model,
          manufacturer: row.manufacturer ?? null,
        });
        report.createdModels++;
      }

      const rowDate = (row.snapshotDate ?? snapshotDate).slice(0, 10);
      const existing = await listCatalogSnapshots(model.id);
      if (existing.some((s) => s.snapshotDate === rowDate)) {
        report.skipped.push({ model: label, reason: "Snapshot این تاریخ از قبل وجود دارد (تغییرناپذیر)" });
        continue;
      }

      await recordVehicleValuationSnapshot({
        catalogId: model.id,
        userVehicleId: null,
        snapshotDate: rowDate,
        currentValueToman: row.currentValueToman,
        usdRate: row.usdRate,
        source: opts.source ?? "dataset",
        note: "ارزش فعلی وارد شده از دیتاست اولیه",
      });
      report.createdSnapshots++;
    } catch (e) {
      report.skipped.push({ model: label, reason: e instanceof Error ? e.message : "خطای نامشخص" });
    }
  }

  return report;
}
