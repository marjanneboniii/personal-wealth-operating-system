/**
 * A valid, all-empty «تحلیل تورم» dashboard.
 *
 * Used as the fail-soft fallback of `/inflation`: if the dashboard query
 * cannot be computed (e.g. a database that has not run migration 0012 yet),
 * the page still renders its normal empty state — «داده‌ای برای تحلیل نیست» —
 * instead of a blank screen. It contains NO fabricated figures: every growth
 * value is `null` and every count is zero.
 */

import { INFLATION_COMPARISON_WINDOWS } from "./constants";
import type { InflationBasketWindow, InflationDashboard } from "./service";

const windows: InflationBasketWindow[] = INFLATION_COMPARISON_WINDOWS.map((w) => ({
  key: w.key,
  label: w.label,
  days: w.days,
  growthPercent: null,
  itemsWithBaseline: 0,
  itemsWithCurrent: 0,
}));

export const EMPTY_INFLATION_DASHBOARD: InflationDashboard = {
  generatedAt: new Date(0).toISOString(),
  totalItems: 0,
  totalObservations: 0,
  headline: windows.find((w) => w.key === "6m") ?? windows[0],
  windows,
  topRisers: [],
  leastRisers: [],
  items: [],
};
