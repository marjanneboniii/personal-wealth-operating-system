/**
 * Vehicle module — presentation DTOs.
 * Pure types + pure helpers, no database access, so both Server Components
 * and Client Components can import them safely.
 */
import type { ChangeSet, PeriodResult, SnapshotPoint } from "./analytics";
import type { UserVehicle, VehicleCatalogModel, VehicleStatus, VehicleValuationSnapshot } from "./types";

export type VehicleValuationState = {
  /** ارزش فعلی — همیشه از آخرین Snapshot معتبر، هرگز از نرخ لحظه‌ای دلار */
  currentValueToman: string | null;
  currentValueUsd: string | null;
  currentUsdRate: string | null;
  lastValuationDate: string | null;
  /** vehicle → اسنپ‌شات همین خودرو، catalog → ارزش‌گذاری بازارِ همان مدل */
  scope: "vehicle" | "catalog" | "none";
};

export type VehicleGains = {
  gainToman: string | null;
  roiToman: string | null;
  gainUsd: string | null;
  roiUsd: string | null;
  /** true when the figures are based on the real sale price */
  realised: boolean;
};

export type VehicleHistoryRow = SnapshotPoint & Partial<ChangeSet>;

export type VehicleDashboardItem = {
  vehicle: UserVehicle;
  catalog: VehicleCatalogModel | null;
  valuation: VehicleValuationState;
  gains: VehicleGains;
  purchasePoint: SnapshotPoint | null;
  snapshots: VehicleValuationSnapshot[];
  history: VehicleHistoryRow[];
  periods: PeriodResult[];
  holding: { months: number; days: number; label: string } | null;
  cagrToman: string | null;
  cagrUsd: string | null;
};

export type VehiclePortfolioItem = {
  id: string;
  title: string;
  status: VehicleStatus;
  currentValueToman: string | null;
  currentValueUsd: string | null;
  purchasePriceToman: string | null;
  purchaseValueUsd: string | null;
  roiToman: string | null;
  roiUsd: string | null;
  lastValuationDate: string | null;
};

export type VehiclePortfolioSummary = {
  count: number;
  activeCount: number;
  soldCount: number;
  /** vehicles without any valuation snapshot yet */
  unvaluedCount: number;
  totalCurrentToman: string;
  totalCurrentUsd: string;
  totalPurchaseToman: string;
  totalPurchaseUsd: string;
  totalGainToman: string;
  totalGainUsd: string;
  roiToman: string | null;
  roiUsd: string | null;
  /** مجموع مبلغ واقعی فروش خودروهای فروخته‌شده (خارج از ارزش سبد فعلی) */
  soldProceedsToman: string;
  soldProceedsUsd: string;
  /** سود/زیان تحقق‌یافته خودروهای فروخته‌شده */
  realisedGainToman: string;
  realisedGainUsd: string;
  items: VehiclePortfolioItem[];
};
