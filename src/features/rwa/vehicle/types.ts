/**
 * Vehicle module types — دارایی واقعی → خودرو
 *
 * Conceptual model (unchanged module, refined logic):
 *
 *   Vehicle Catalog (Brand → Model)
 *        ↓
 *   User Vehicle Asset  (exactly ONE owner — no shares, no percentages)
 *        ↓
 *   Purchase Information (historical, immutable)
 *        ↓
 *   Historical Valuation Snapshots (immutable, append-only)
 */

export type VehicleOrigin = "domestic" | "imported";
export type VehicleStatus = "active" | "sold";

export type VehicleBrand = {
  id: string;
  name: string;
  nameEn: string | null;
  origin: VehicleOrigin;
  allowsCustomModel: boolean;
  isActive: boolean;
  sortOrder: number;
  modelCount?: number;
};

export type VehicleCatalogModel = {
  id: string;
  brandId: string;
  brandName: string;
  brandNameEn: string | null;
  brandOrigin: VehicleOrigin;
  modelName: string;
  modelYear: number | null;
  manufacturer: string | null;
  category: string | null;
  description: string | null;
  isActive: boolean;
};

/** Immutable historical valuation record. */
export type VehicleValuationSnapshot = {
  id: string;
  vehicleCatalogId: string;
  /** NULL → market/catalog level valuation; set → a specific user car */
  userVehicleId: string | null;
  snapshotDate: string;
  currentValueToman: string;
  /** USD rate stored INSIDE the snapshot — never re-read from today's FX */
  usdRate: string;
  currentValueUsd: string;
  source: string;
  note: string | null;
  createdAt: string;
};

export type UserVehicle = {
  id: string;
  assetId: string;
  assetSymbol?: string;
  userId: string | null;
  catalogId: string | null;
  /** Catalog-standardised brand name (denormalised for display/legacy rows) */
  brand: string;
  /** Catalog-standardised model name */
  model: string;
  /** Actual manufacturing year of this car (Jalali or Gregorian) */
  year: number;
  ownershipDate: string | null;
  purchasePriceToman: string | null;
  purchaseUsdRate: string | null;
  purchaseValueUsd: string | null;
  licensePlate: string | null;
  mileage: number | null;
  status: VehicleStatus;
  saleDate: string | null;
  salePriceToman: string | null;
  saleUsdRate: string | null;
  saleValueUsd: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type CreateUserVehicleInput = {
  userId?: string | null;
  catalogId: string;
  /** اجباری — سال ساخت واقعی خودروی کاربر */
  manufacturingYear: number;
  /** اجباری — تاریخ تملک (ISO) */
  ownershipDate: string;
  /** اجباری — قیمت خرید به تومان (ورودی دستی کاربر) */
  purchasePriceToman: string;
  /** اختیاری — در صورت خالی بودن، نرخ دلار تاریخ تملک از سیستم گرفته می‌شود */
  purchaseUsdRate?: string;
  plate?: string;
  mileage?: number;
  notes?: string;
  /** اختیاری — ثبت اولین Snapshot ارزش فعلی همراه با ثبت خودرو */
  initialValuation?: {
    valueToman: string;
    snapshotDate: string;
    usdRate?: string;
    note?: string;
  };
};

export type RecordVehicleValuationInput = {
  catalogId: string;
  /** set → snapshot only for this specific car; null/undefined → market level */
  userVehicleId?: string | null;
  snapshotDate: string;
  currentValueToman: string;
  /** optional override; default = FX rate of the snapshot date */
  usdRate?: string;
  source?: string;
  note?: string;
  createdByUserId?: string | null;
};

export type SellVehicleInput = {
  vehicleId: string;
  saleDate: string;
  salePriceToman: string;
  saleUsdRate?: string;
};

export type UsdRateResolution = {
  rate: string;
  /** date of the rate that was actually used */
  effectiveDate: string;
  /** exact | nearest | current | manual | fallback */
  source: string;
  /** true when a rate for the exact requested date existed */
  isExact: boolean;
};
