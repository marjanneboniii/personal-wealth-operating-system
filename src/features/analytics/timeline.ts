import { WealthTimelinePoint } from "./types";

export type PortfolioSnapshotRecord = {
  snapshotDate: string;
  totalPortfolioValue: string;
};

/**
 * Generates historical wealth timeline points from portfolio_snapshots
 */
export function generateWealthTimeline(snapshots: PortfolioSnapshotRecord[]): WealthTimelinePoint[] {
  const sorted = [...snapshots].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  return sorted.map((s) => ({
    date: s.snapshotDate,
    portfolioValue: s.totalPortfolioValue,
  }));
}
