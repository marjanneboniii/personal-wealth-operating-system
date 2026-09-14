/**
 * «بازار» panel — forward-only: pending horizons show their date, dollar and
 * Toman growth side by side, stale data is flagged, and an estimate is never
 * called «the real price».
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import MarketPanel from "../src/components/registry/realestate/MarketPanel";
import { compactToman, horizonLabel } from "../src/components/registry/realestate/marketFormat";
import { marketGrowth } from "../src/features/rwa/realEstate/market/forward";
import type { PropertyMarketView } from "../src/features/rwa/realEstate/market/service";

async function render(props: Parameters<typeof MarketPanel>[0]): Promise<string> {
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(createElement(MarketPanel, props), {
    onError: (e: unknown) => {
      errors.push(e);
    },
  });
  const html = await new Response(stream).text();
  assert.deepEqual(errors, []);
  return html;
}

function okView(todayIso: string): PropertyMarketView {
  const growth = marketGrowth(
    [
      { date: "2026-09-15", ppsqmToman: 90_000_000, usdRate: 100_000, ppsqmUsd: 900 },
      { date: "2026-10-15", ppsqmToman: 99_000_000, usdRate: 110_000, ppsqmUsd: 900 },
    ],
    todayIso,
  )!;
  return {
    status: "ok",
    cityLabel: "اهواز",
    neighborhoodLabel: "کیانپارس شرقی",
    propertyTypeLabel: "آپارتمان",
    areaBand: "a80-150",
    areaBandLabel: "۸۰ تا ۱۵۰ متر",
    growth,
    estimate: { toman: 99_000_000 * 120, usd: 108_000 },
    latestRange: { low: null, high: null },
    latestSampleCount: 25,
    relative: null,
    neighborhoods: [],
  };
}

test("formatting helpers", () => {
  assert.equal(compactToman(11_880_000_000), "۱۱.۹ میلیارد تومان");
  assert.equal(horizonLabel(1), "۱ ماه");
  assert.equal(horizonLabel(36), "۳ سال");
});

test("no market prices yet → explains that growth starts from the first record", async () => {
  const html = await render({ view: { status: "empty", cityLabel: "اهواز", neighborhoodLabel: "کیانپارس شرقی", propertyTypeLabel: "آپارتمان" } });
  assert.ok(html.includes("هنوز قیمتی ثبت نکرده‌اید"));
  assert.ok(html.includes("داده‌های گذشته استفاده نمی‌شوند"));
});

test("tracked market: Toman and dollar growth per horizon, future horizons pending, opt-in apply", async () => {
  const html = await render({ view: okView("2026-10-20"), onUseEstimate: () => {} });
  assert.ok(html.includes("ارزش تخمینی با آخرین قیمت بازار"));
  assert.ok(html.includes("شروع پیگیری"));
  assert.ok(html.includes("۵ سال"), "yearly horizons are listed ahead of time");
  assert.ok(html.includes("در انتظار این تاریخ"), "future horizons are pending, not estimated");
  assert.ok(html.includes("دلاری"));
  assert.ok(html.includes("استفاده در ثبت ارزش‌گذاری"));
  assert.ok(html.includes("برآورد تقریبی"));
  assert.ok(!html.includes("قیمت واقعی"));
  for (const word of ["دیوار", "آگهی", "مدیر"]) assert.ok(!html.includes(word), `no «${word}» in the market panel`);
});

test("stale market data: warning and no apply action", async () => {
  const html = await render({ view: okView("2027-01-20"), onUseEstimate: () => {} });
  assert.ok(html.includes("روز پیش ثبت شده است"));
  assert.ok(!html.includes("استفاده در ثبت ارزش‌گذاری"));
});
