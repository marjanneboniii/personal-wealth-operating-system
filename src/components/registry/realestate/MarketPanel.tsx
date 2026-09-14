"use client";

import type { PropertyMarketView } from "@/features/rwa/realEstate/market/service";
import { Hint } from "./shared";
import { compactToman, compactUsd, faInt, horizonLabel, jalaliDate, signedPct } from "./marketFormat";

/**
 * «بازار» — forward-only: from the first recorded market price of this
 * property's segment, how the market moved after 1 month, 3 months, 6 months,
 * 1 year, 2 years, … in Toman AND in dollars (each observation's own frozen
 * rate). Future horizons are shown as pending; nothing is estimated backwards.
 */
export default function MarketPanel({
  view,
  onUseEstimate,
}: {
  view: PropertyMarketView | undefined;
  /** Pre-fills the valuation form — nothing is recorded until the user confirms. */
  onUseEstimate?: (toman: string) => void;
}) {
  if (!view || view.status === "empty") {
    return (
      <div className="market-empty">
        <p className="market-empty-title">برای بازار این ملک هنوز قیمتی ثبت نکرده‌اید</p>
        <p className="muted">
          از اولین ثبت قیمت بازار
          {view?.neighborhoodLabel ? ` برای «${view.neighborhoodLabel}»` : ""}، رشد تومانی و دلاری پس از ۱ ماه، ۳ ماه، ۶ ماه
          و هر سال بعد از آن محاسبه می‌شود. داده‌های گذشته استفاده نمی‌شوند.
        </p>
      </div>
    );
  }

  const g = view.growth;
  const r = view.relative;

  return (
    <div className="market-panel">
      <div className="market-hero">
        <div className="min-w-0">
          <p className="market-eyebrow">{view.estimate ? "ارزش تخمینی با آخرین قیمت بازار" : "قیمت مرجع هر متر"}</p>
          <p className="market-hero-value num" dir="rtl">
            {view.estimate ? compactToman(view.estimate.toman) : compactToman(g.latest.ppsqmToman)}
          </p>
          <p className="market-hero-sub">
            {view.estimate ? (
              <>
                ≈ {compactUsd(view.estimate.usd)} با نرخ دلار {jalaliDate(g.latest.date)}
              </>
            ) : (
              "برای برآورد ارزش کل، متراژ ملک را ثبت کنید."
            )}
          </p>
        </div>
        <div className="market-badges">
          <span className="market-chip">هر متر {compactToman(g.latest.ppsqmToman)}</span>
          <span className="market-chip">آخرین ثبت {jalaliDate(g.latest.date)}</span>
          <span className="market-chip">شروع پیگیری {jalaliDate(g.baseline.date)}</span>
          {view.latestSampleCount && <span className="market-chip">{faInt(view.latestSampleCount)} نمونه</span>}
        </div>
      </div>

      {g.stale && (
        <Hint tone="warn">آخرین قیمت بازار {faInt(g.daysSinceLatest)} روز پیش ثبت شده است؛ برآورد ممکن است به‌روز نباشد.</Hint>
      )}

      <p className="market-segment">
        بازار مشابه: {view.propertyTypeLabel ?? "همین نوع"} · {view.neighborhoodLabel ?? "همین محله"} · {view.areaBandLabel}
      </p>

      <div className="overflow-x-auto">
        <table className="table">
          <caption className="market-caption">رشد بازار مشابه از شروع پیگیری ({jalaliDate(g.baseline.date)})</caption>
          <thead>
            <tr>
              <th scope="col">بازه</th>
              <th scope="col" className="td-num">تاریخ</th>
              <th scope="col" className="td-num">تومانی</th>
              <th scope="col" className="td-num">دلاری</th>
            </tr>
          </thead>
          <tbody>
            {g.horizons.map((h) => (
              <tr key={h.months}>
                <td>{horizonLabel(h.months)}</td>
                <td className="td-num">{jalaliDate(h.status === "available" ? h.to.date : h.targetDate)}</td>
                {h.status === "available" ? (
                  <>
                    <td className="td-num num">{signedPct(h.tomanPct)}</td>
                    <td className="td-num num">{signedPct(h.usdPct)}</td>
                  </>
                ) : (
                  <td colSpan={2} className="td-num muted">
                    {h.status === "pending" ? "در انتظار این تاریخ" : "ثبتی نزدیک این تاریخ نیست"}
                  </td>
                )}
              </tr>
            ))}
            {g.sinceStart && (
              <tr className="market-own-row">
                <td>از شروع پیگیری</td>
                <td className="td-num">{jalaliDate(g.sinceStart.to.date)}</td>
                <td className="td-num num">{signedPct(g.sinceStart.tomanPct)}</td>
                <td className="td-num num">{signedPct(g.sinceStart.usdPct)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {r && (
        <dl className="metric-strip market-metrics">
          <div>
            <dt>ملک شما (همان بازه)</dt>
            <dd className="num">{signedPct(r.propertyTomanPct)}</dd>
            <dd className="market-dd-sub">دلاری {signedPct(r.propertyUsdPct)}</dd>
          </div>
          <div>
            <dt>بازار مشابه</dt>
            <dd className="num">{signedPct(r.marketTomanPct)}</dd>
            <dd className="market-dd-sub">دلاری {signedPct(r.marketUsdPct)}</dd>
          </div>
          <div>
            <dt>اختلاف با بازار</dt>
            <dd className="num">{signedPct(r.tomanPts)}</dd>
            <dd className="market-dd-sub">دلاری {signedPct(r.usdPts)}</dd>
          </div>
        </dl>
      )}

      {g.points.length >= 2 && <Trend points={g.points} />}

      {view.neighborhoods.length > 1 && (
        <div className="market-hoods">
          <div className="overflow-x-auto">
            <table className="table">
              <caption className="market-caption">بازارهای شما در {view.cityLabel ?? "همین شهر"} — همین نوع و متراژ</caption>
              <thead>
                <tr>
                  <th scope="col">محله</th>
                  <th scope="col" className="td-num">هر متر</th>
                  <th scope="col" className="td-num">از شروع (تومانی)</th>
                  <th scope="col" className="td-num">از شروع (دلاری)</th>
                </tr>
              </thead>
              <tbody>
                {view.neighborhoods.map((row) => (
                  <tr key={row.neighborhoodId} className={row.isOwn ? "market-own-row" : undefined}>
                    <td>
                      {row.label}
                      {row.isOwn && <span className="muted"> · ملک شما</span>}
                    </td>
                    <td className="td-num">{compactToman(row.latestPpsqmToman)}</td>
                    <td className="td-num num">{signedPct(row.sinceStartTomanPct)}</td>
                    <td className="td-num num">{signedPct(row.sinceStartUsdPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted market-note">قیمت بالاتر به معنی رشد بیشتر یا انتخاب بهتر نیست؛ این جدول فقط اطلاعاتی است.</p>
        </div>
      )}

      <div className="market-footer">
        {view.estimate && !g.stale && onUseEstimate && (
          <button type="button" className="btn btn-soft" onClick={() => onUseEstimate(String(view.estimate!.toman))}>
            استفاده در ثبت ارزش‌گذاری
          </button>
        )}
        <p className="muted market-note">این برآورد تقریبی است و تا تأیید شما در ارزش خالص ثبت نمی‌شود.</p>
      </div>
    </div>
  );
}

/** Price per m² over time — one series, thin line, native tooltip per point; exact figures are in the table above. */
function Trend({ points }: { points: { date: string; ppsqmToman: number }[] }) {
  const W = 320;
  const H = 64;
  const pad = 6;
  const values = points.map((p) => p.ppsqmToman);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const first = Date.parse(points[0].date);
  const range = Date.parse(points[points.length - 1].date) - first || 1;
  const xy = points.map((p) => ({
    x: pad + ((Date.parse(p.date) - first) / range) * (W - 2 * pad),
    y: H - pad - ((p.ppsqmToman - min) / span) * (H - 2 * pad),
    p,
  }));
  return (
    <figure className="market-trend">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="روند قیمت هر متر بازار مشابه" preserveAspectRatio="none">
        <polyline points={xy.map((d) => `${d.x},${d.y}`).join(" ")} fill="none" stroke="var(--action)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {xy.map((d) => (
          <circle key={d.p.date} cx={d.x} cy={d.y} r={4} fill="var(--action)" stroke="var(--surface)" strokeWidth={2}>
            <title>{`${jalaliDate(d.p.date)}: ${compactToman(d.p.ppsqmToman)} هر متر`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="market-trend-axis">
        <span>{jalaliDate(points[0].date)}</span>
        <span>روند قیمت هر متر</span>
        <span>{jalaliDate(points[points.length - 1].date)}</span>
      </figcaption>
    </figure>
  );
}
