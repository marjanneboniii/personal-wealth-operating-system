/**
 * Property Market Intelligence — forward-only market price tracking, per user.
 *
 * Write side: a user records the reference price per m² of a neighborhood +
 * property type + size band for a date (today or at most 31 days ago). The USD
 * rate of that date is frozen on the row.
 *
 * Read side: per property, the user's own series for its segment → growth from
 * tracking start over 1m/3m/6m/1y/2y/…, estimated value, and the property's
 * change against the market over the same window.
 *
 * Every query is scoped to the owning user. NEVER writes the ledger, prices,
 * lots, transactions or valuation snapshots.
 */
import { and, asc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { cities, marketPriceSnapshots, neighborhoods, propertyTypes } from "@/db/schema";
import { D } from "@/domain/decimal";
import { recordAuditEvent } from "@/lib/audit";
import { todayIso } from "@/lib/format";
import { resolveUsdRateForDateToFreeze, tomanToUsd } from "@/features/rwa/vehicle/fx";
import {
  MAX_BACKDATE_DAYS,
  areaBandLabel,
  areaBandOf,
  daysBetween,
  isAreaBand,
  marketGrowth,
  relativeToMarket,
  type MarketGrowth,
  type MarketPoint,
  type PropertyPoint,
  type RelativeToMarket,
} from "./forward";

/** Tenant filter: a user sees only their rows; legacy single-tenant mode sees owner-less rows. */
function ownedBy(userId: string | null | undefined): SQL {
  return userId ? eq(marketPriceSnapshots.userId, userId) : isNull(marketPriceSnapshots.userId);
}

/* ─────────────────────────── write side ─────────────────────────── */

export type RecordMarketPriceInput = {
  userId?: string | null;
  cityId: string;
  neighborhoodId: string;
  propertyTypeId: string;
  areaBand?: string;
  observedOn: string;
  pricePerSqmToman: string;
  lowPpsqmToman?: string | null;
  highPpsqmToman?: string | null;
  sampleCount?: number | null;
  note?: string | null;
};

export async function recordMarketPrice(
  input: RecordMarketPriceInput,
  opts: { todayIso?: string } = {},
): Promise<{ id: string; pricePerSqmUsd: string; usdRate: string; usdRateDate: string }> {
  const today = opts.todayIso ?? todayIso();
  const observedOn = (input.observedOn || "").slice(0, 10);
  const areaBand = input.areaBand || "all";
  const userId = input.userId ?? null;

  if (!observedOn) throw new Error("تاریخ قیمت الزامی است.");
  if (observedOn > today) throw new Error("قیمت بازار برای تاریخ آینده ثبت نمی‌شود.");
  if (daysBetween(observedOn, today) > MAX_BACKDATE_DAYS) {
    throw new Error(`قیمت بازار فقط برای امروز تا ${MAX_BACKDATE_DAYS} روز قبل ثبت می‌شود؛ داده‌های گذشته وارد سیستم نمی‌شوند.`);
  }
  if (!isAreaBand(areaBand)) throw new Error("بازهٔ متراژ نامعتبر است.");

  const price = D(input.pricePerSqmToman || "0");
  if (price.lte(0)) throw new Error("قیمت هر متر باید بزرگ‌تر از صفر باشد.");
  const low = input.lowPpsqmToman ? D(input.lowPpsqmToman) : null;
  const high = input.highPpsqmToman ? D(input.highPpsqmToman) : null;
  if ((low && low.gt(price)) || (high && high.lt(price)) || (low && high && low.gt(high))) {
    throw new Error("بازهٔ قیمت باید قیمت مرجع را در بر بگیرد (کمترین ≤ مرجع ≤ بیشترین).");
  }
  if (input.sampleCount !== null && input.sampleCount !== undefined && (!Number.isInteger(input.sampleCount) || input.sampleCount < 1)) {
    throw new Error("تعداد نمونه باید عدد صحیح مثبت باشد.");
  }

  const [hood] = await db
    .select({ id: neighborhoods.id })
    .from(neighborhoods)
    .where(and(eq(neighborhoods.id, input.neighborhoodId), eq(neighborhoods.cityId, input.cityId)))
    .limit(1);
  if (!hood) throw new Error("محله متعلق به شهر انتخاب‌شده نیست.");
  const [type] = await db.select({ id: propertyTypes.id }).from(propertyTypes).where(eq(propertyTypes.id, input.propertyTypeId)).limit(1);
  if (!type) throw new Error("نوع ملک یافت نشد.");

  const [duplicate] = await db
    .select({ id: marketPriceSnapshots.id })
    .from(marketPriceSnapshots)
    .where(
      and(
        ownedBy(userId),
        eq(marketPriceSnapshots.neighborhoodId, input.neighborhoodId),
        eq(marketPriceSnapshots.propertyTypeId, input.propertyTypeId),
        eq(marketPriceSnapshots.areaBand, areaBand),
        eq(marketPriceSnapshots.observedOn, observedOn),
      ),
    )
    .limit(1);
  if (duplicate) throw new Error("برای این محله، نوع ملک و متراژ در این تاریخ قبلاً قیمت ثبت کرده‌اید.");

  const fx = await resolveUsdRateForDateToFreeze(observedOn, userId);
  if (D(fx.rate).lte(0)) throw new Error("نرخ دلار این تاریخ در دسترس نیست.");
  const pricePerSqmUsd = tomanToUsd(price.toFixed(0), fx.rate);

  const [row] = await db
    .insert(marketPriceSnapshots)
    .values({
      userId,
      cityId: input.cityId,
      neighborhoodId: input.neighborhoodId,
      propertyTypeId: input.propertyTypeId,
      areaBand,
      observedOn,
      pricePerSqmToman: price.toFixed(0),
      lowPpsqmToman: low ? low.toFixed(0) : null,
      highPpsqmToman: high ? high.toFixed(0) : null,
      sampleCount: input.sampleCount ?? null,
      usdRate: D(fx.rate).toString(),
      usdRateSource: fx.source,
      usdRateDate: fx.effectiveDate,
      pricePerSqmUsd,
      note: input.note || null,
    })
    .returning({ id: marketPriceSnapshots.id });

  await recordAuditEvent({
    action: "RECORD_MARKET_PRICE",
    entityType: "market_price_snapshot",
    entityId: row.id,
    userId,
    result: "SUCCESS",
    payload: { neighborhoodId: input.neighborhoodId, propertyTypeId: input.propertyTypeId, areaBand, observedOn, pricePerSqmToman: price.toFixed(0), usdRate: fx.rate },
  });

  return { id: row.id, pricePerSqmUsd, usdRate: D(fx.rate).toString(), usdRateDate: fx.effectiveDate };
}

/** Deletes one of the user's own entries; another user's id simply does not exist for them. */
export async function deleteMarketPrice(id: string, userId?: string | null): Promise<void> {
  const deleted = await db
    .delete(marketPriceSnapshots)
    .where(and(eq(marketPriceSnapshots.id, id), ownedBy(userId)))
    .returning({ id: marketPriceSnapshots.id });
  if (!deleted.length) throw new Error("ثبت قیمت یافت نشد.");
  await recordAuditEvent({ action: "DELETE_MARKET_PRICE", entityType: "market_price_snapshot", entityId: id, userId: userId ?? null, result: "SUCCESS" });
}

/* ─────────────────────────── tracked segments ─────────────────────────── */

export type MarketSegmentSummary = {
  key: string;
  neighborhoodId: string;
  propertyTypeId: string;
  cityLabel: string;
  neighborhoodLabel: string;
  propertyTypeLabel: string;
  areaBand: string;
  areaBandLabel: string;
  entries: number;
  firstDate: string;
  latestId: string;
  latestDate: string;
  latestPpsqmToman: string;
  daysSinceLatest: number;
};

/** The user's tracked segments (latest first). Fail-soft: [] before the migration. */
export async function listMarketSegments(userId?: string | null, opts: { todayIso?: string } = {}): Promise<MarketSegmentSummary[]> {
  const today = opts.todayIso ?? todayIso();
  try {
    const rows = await db
      .select({
        id: marketPriceSnapshots.id,
        neighborhoodId: marketPriceSnapshots.neighborhoodId,
        propertyTypeId: marketPriceSnapshots.propertyTypeId,
        areaBand: marketPriceSnapshots.areaBand,
        observedOn: marketPriceSnapshots.observedOn,
        pricePerSqmToman: marketPriceSnapshots.pricePerSqmToman,
        cityLabel: cities.nameFa,
        neighborhoodLabel: neighborhoods.nameFa,
        propertyTypeLabel: propertyTypes.nameFa,
      })
      .from(marketPriceSnapshots)
      .innerJoin(cities, eq(cities.id, marketPriceSnapshots.cityId))
      .innerJoin(neighborhoods, eq(neighborhoods.id, marketPriceSnapshots.neighborhoodId))
      .innerJoin(propertyTypes, eq(propertyTypes.id, marketPriceSnapshots.propertyTypeId))
      .where(ownedBy(userId))
      .orderBy(asc(marketPriceSnapshots.observedOn));

    const bySegment = new Map<string, MarketSegmentSummary>();
    for (const r of rows) {
      const key = `${r.neighborhoodId}|${r.propertyTypeId}|${r.areaBand}`;
      const date = String(r.observedOn).slice(0, 10);
      const existing = bySegment.get(key);
      bySegment.set(key, {
        key,
        neighborhoodId: r.neighborhoodId,
        propertyTypeId: r.propertyTypeId,
        cityLabel: r.cityLabel,
        neighborhoodLabel: r.neighborhoodLabel,
        propertyTypeLabel: r.propertyTypeLabel,
        areaBand: r.areaBand,
        areaBandLabel: areaBandLabel(r.areaBand),
        entries: (existing?.entries ?? 0) + 1,
        firstDate: existing?.firstDate ?? date,
        latestId: r.id,
        latestDate: date,
        latestPpsqmToman: D(r.pricePerSqmToman).toFixed(0),
        daysSinceLatest: Math.max(0, daysBetween(date, today)),
      });
    }
    return [...bySegment.values()].sort((a, b) => (a.latestDate < b.latestDate ? 1 : -1));
  } catch (err) {
    console.warn("[market] segments unavailable:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

/* ─────────────────────────── property read model ─────────────────────────── */

export type MarketNeighborhoodRow = {
  neighborhoodId: string;
  label: string;
  latestPpsqmToman: number;
  latestDate: string;
  sinceStartTomanPct: number | null;
  sinceStartUsdPct: number | null;
  isOwn: boolean;
};

export type PropertyMarketView =
  | {
      status: "empty";
      cityLabel: string | null;
      neighborhoodLabel: string | null;
      propertyTypeLabel: string | null;
    }
  | {
      status: "ok";
      cityLabel: string | null;
      neighborhoodLabel: string | null;
      propertyTypeLabel: string | null;
      areaBand: string;
      areaBandLabel: string;
      growth: MarketGrowth;
      /** latest price/m² × property size; USD at the rate frozen on that observation */
      estimate: { toman: number; usd: number } | null;
      latestRange: { low: number | null; high: number | null };
      latestSampleCount: number | null;
      relative: RelativeToMarket | null;
      /** the user's own tracked neighborhoods of the same city + type + size band */
      neighborhoods: MarketNeighborhoodRow[];
    };

export type MarketPropertyInput = {
  id: string;
  cityId: string | null;
  cityNameFa: string | null;
  neighborhoodId: string | null;
  neighborhoodNameFa: string | null;
  propertyTypeId: string | null;
  propertyTypeNameFa: string | null;
  sizeSqm: string | null;
  purchasePoint: { date: string; valueToman: string; valueUsd: string } | null;
  snapshots: { snapshotDate: string; currentValueToman: string; currentValueUsd: string }[];
};

type Row = typeof marketPriceSnapshots.$inferSelect;

function pointOf(r: Row): MarketPoint {
  return {
    date: String(r.observedOn).slice(0, 10),
    ppsqmToman: Number(r.pricePerSqmToman),
    usdRate: Number(r.usdRate),
    ppsqmUsd: Number(r.pricePerSqmUsd),
  };
}

function propertyPointsOf(p: MarketPropertyInput): PropertyPoint[] {
  const points = p.snapshots.map((s) => ({
    date: String(s.snapshotDate).slice(0, 10),
    valueToman: Number(s.currentValueToman),
    valueUsd: Number(s.currentValueUsd),
  }));
  if (p.purchasePoint) {
    points.push({ date: p.purchasePoint.date, valueToman: Number(p.purchasePoint.valueToman), valueUsd: Number(p.purchasePoint.valueUsd) });
  }
  return points;
}

/** Market view per property id, from the user's own entries. Fail-soft: an unmigrated database yields {}. */
export async function getPropertyMarketViews(
  properties: MarketPropertyInput[],
  opts: { userId?: string | null; todayIso?: string } = {},
): Promise<Record<string, PropertyMarketView>> {
  if (!properties.length) return {};
  try {
    return await loadViews(properties, opts.userId ?? null, opts.todayIso ?? todayIso());
  } catch (err) {
    console.warn("[market] market view unavailable:", err instanceof Error ? err.message : String(err));
    return {};
  }
}

async function loadViews(properties: MarketPropertyInput[], userId: string | null, today: string): Promise<Record<string, PropertyMarketView>> {
  const cityIds = [...new Set(properties.map((p) => p.cityId).filter((v): v is string => !!v))];
  const typeIds = [...new Set(properties.map((p) => p.propertyTypeId).filter((v): v is string => !!v))];
  const rows =
    cityIds.length && typeIds.length
      ? await db
          .select()
          .from(marketPriceSnapshots)
          .where(and(ownedBy(userId), inArray(marketPriceSnapshots.cityId, cityIds), inArray(marketPriceSnapshots.propertyTypeId, typeIds)))
      : [];
  const hoodLabels = new Map(
    (cityIds.length
      ? await db.select({ id: neighborhoods.id, nameFa: neighborhoods.nameFa }).from(neighborhoods).where(inArray(neighborhoods.cityId, cityIds))
      : []
    ).map((h) => [h.id, h.nameFa]),
  );

  const out: Record<string, PropertyMarketView> = {};
  for (const p of properties) {
    const labels = { cityLabel: p.cityNameFa, neighborhoodLabel: p.neighborhoodNameFa, propertyTypeLabel: p.propertyTypeNameFa };
    if (!p.cityId || !p.neighborhoodId || !p.propertyTypeId) {
      out[p.id] = { status: "empty", ...labels };
      continue;
    }
    const size = p.sizeSqm ? Number(p.sizeSqm) : null;
    const ownBand = areaBandOf(size);
    const own = rows.filter((r) => r.neighborhoodId === p.neighborhoodId && r.propertyTypeId === p.propertyTypeId);
    const band = ownBand && own.some((r) => r.areaBand === ownBand) ? ownBand : "all";
    const series = own.filter((r) => r.areaBand === band);
    const growth = marketGrowth(series.map(pointOf), today);
    if (!growth) {
      out[p.id] = { status: "empty", ...labels };
      continue;
    }

    const latestRow = series.find((r) => String(r.observedOn).slice(0, 10) === growth.latest.date)!;
    const estimateToman = size && size > 0 ? Math.round(growth.latest.ppsqmToman * size) : null;

    const byHood = new Map<string, MarketPoint[]>();
    for (const r of rows) {
      if (r.cityId !== p.cityId || r.propertyTypeId !== p.propertyTypeId || r.areaBand !== band) continue;
      byHood.set(r.neighborhoodId, [...(byHood.get(r.neighborhoodId) ?? []), pointOf(r)]);
    }
    const neighborhoodsRows: MarketNeighborhoodRow[] = [...byHood.entries()]
      .map(([neighborhoodId, pts]) => {
        const g = marketGrowth(pts, today)!;
        return {
          neighborhoodId,
          label: hoodLabels.get(neighborhoodId) ?? "—",
          latestPpsqmToman: g.latest.ppsqmToman,
          latestDate: g.latest.date,
          sinceStartTomanPct: g.sinceStart?.tomanPct ?? null,
          sinceStartUsdPct: g.sinceStart?.usdPct ?? null,
          isOwn: neighborhoodId === p.neighborhoodId,
        };
      })
      .sort((a, b) => Number(b.isOwn) - Number(a.isOwn) || a.label.localeCompare(b.label, "fa"));

    out[p.id] = {
      status: "ok",
      ...labels,
      areaBand: band,
      areaBandLabel: areaBandLabel(band),
      growth,
      estimate: estimateToman ? { toman: estimateToman, usd: Math.round(estimateToman / growth.latest.usdRate) } : null,
      latestRange: {
        low: latestRow.lowPpsqmToman ? Number(latestRow.lowPpsqmToman) : null,
        high: latestRow.highPpsqmToman ? Number(latestRow.highPpsqmToman) : null,
      },
      latestSampleCount: latestRow.sampleCount,
      relative: relativeToMarket(propertyPointsOf(p), growth.sinceStart),
      neighborhoods: neighborhoodsRows,
    };
  }
  return out;
}
