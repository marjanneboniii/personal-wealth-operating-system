/**
 * Monthly market-price reminders — PURE. A property needs attention when its
 * market has no price yet, or its latest price is older than a month.
 */
import { areaBandOf, daysBetween } from "./forward";

export const MARKET_REMINDER_DAYS = 30;

export type ReminderProperty = {
  id: string;
  label: string;
  neighborhoodId: string | null;
  propertyTypeId: string | null;
  sizeSqm: string | null;
};

export type ReminderSegment = {
  neighborhoodId: string;
  propertyTypeId: string;
  areaBand: string;
  latestDate: string;
};

export type MarketReminder =
  | { propertyId: string; label: string; status: "missing" }
  | { propertyId: string; label: string; status: "due"; daysSinceLatest: number };

export function marketReminders(properties: ReminderProperty[], segments: ReminderSegment[], todayIso: string): MarketReminder[] {
  const out: MarketReminder[] = [];
  for (const p of properties) {
    if (!p.neighborhoodId || !p.propertyTypeId) continue;
    const own = segments.filter((s) => s.neighborhoodId === p.neighborhoodId && s.propertyTypeId === p.propertyTypeId);
    const band = areaBandOf(p.sizeSqm ? Number(p.sizeSqm) : null);
    // Same choice as the market view: the property's own size band when tracked, else «all».
    const segment = (band && own.find((s) => s.areaBand === band)) || own.find((s) => s.areaBand === "all");
    if (!segment) {
      out.push({ propertyId: p.id, label: p.label, status: "missing" });
      continue;
    }
    const days = Math.max(0, daysBetween(segment.latestDate, todayIso));
    if (days >= MARKET_REMINDER_DAYS) out.push({ propertyId: p.id, label: p.label, status: "due", daysSinceLatest: days });
  }
  return out;
}
