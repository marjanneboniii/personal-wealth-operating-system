import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assetClasses, assets, currencies } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import {
  getMarketPrices,
  getMarketSnapshots,
  listPriceSources,
} from "@/features/marketData/service";
import { Card, PageHeader } from "@/components/ui/Card";
import MarketPriceForm from "@/components/forms/MarketPriceForm";
import { formatMoney, getDualDate } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
import { D } from "@/domain/decimal";

export const dynamic = "force-dynamic";

export default async function MarketDataPage() {
  await seedIfEmpty();

  const [assetRows, curRows, sources, latestQuotes, snapshotHistory, fxSnap] = await Promise.all([
    db
      .select({
        id: assets.id,
        symbol: assets.symbol,
        name: assets.name,
        className: assetClasses.name,
        color: assetClasses.color,
      })
      .from(assets)
      .innerJoin(assetClasses, eq(assetClasses.id, assets.classId))
      .where(sql`${assets.deletedAt} is null`)
      .orderBy(asc(assets.symbol)),
    db.select().from(currencies).where(sql`${currencies.deletedAt} is null`),
    listPriceSources(),
    getMarketPrices(),
    getMarketSnapshots(),
    getLatestUsdIrtRate(),
  ]);

  const rate = fxSnap.rate;

  return (
    <div className="space-y-6">
      <PageHeader
        title="مدیریت قیمت‌های بازار (Market Data Layer)"
        subtitle="قیمت‌های بازار ورودی‌های ارزش‌گذاری بیرونی هستند و هرگز اسناد دفترکل، مانده‌ها یا بسته‌های FIFO را تغییر نمی‌دهند. قیمت تومان از رابطه «قیمت دلاری × آخرین نرخ دلار» فقط نمایشی محاسبه می‌شود."
      />

      <div className="soft rounded-2xl p-3 text-[11px] flex flex-wrap items-center justify-between gap-2">
        <span>نرخ دلار مرجع: <strong dir="ltr" className="num">{formatMoney(rate, "IRT")}</strong> ≈ $1</span>
        <span className="muted">تاریخ نرخ: <span dir="auto" className="num">{fxSnap.effectiveDate}</span> · منبع: {fxSnap.source} · قیمت تومان = قیمت دلاری × نرخ (فقط نمایشی)</span>
      </div>

      {/* Manual Price Entry Form */}
      <Card title="ثبت قیمت جدید بازار (Manual Price Snapshot)">
        <MarketPriceForm assets={assetRows} currencies={curRows} sources={sources} today={new Date().toISOString().slice(0,10)} />
        <p className="muted text-[11px] mt-2">فرم ثبت قیمت از موتور مشترک تاریخ و نمایش مبلغ دوگانه استفاده می‌کند — هیچ تغییری در دفترکل ایجاد نمی‌کند.</p>
      </Card>

      {/* Latest Market Quotes Table — dual price */}
      <Card title="آخرین قیمت‌های ثبت‌شده — نمایش دوگانه (USD / IRT)">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="muted">
              <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                <th className="py-2 font-normal">دارایی</th>
                <th className="py-2 font-normal">قیمت بازار (USD)</th>
                <th className="py-2 font-normal">قیمت معادل (IRT)</th>
                <th className="py-2 font-normal">ارز قیمت</th>
                <th className="py-2 font-normal">سورس</th>
                <th className="py-2 font-normal">زمان بروزرسانی (شمسی / میلادی)</th>
              </tr>
            </thead>
            <tbody>
              {latestQuotes.map((q) => {
                const usd = D(q.price).toString();
                const irt = rate ? D(usd).mul(rate).toFixed(0) : "—";
                const dual = getDualDate(new Date(q.priceTimestamp).toISOString().slice(0,10));
                return (
                  <tr key={q.id} className="border-b last:border-0" style={{ borderColor: "var(--line)" }}>
                    <td className="py-2.5">
                      <span className="font-bold">{q.symbol}</span>
                      <span className="muted mr-2 text-[10px]">{q.assetName}</span>
                    </td>
                    <td className="num py-2.5 font-bold" dir="ltr">
                      {formatMoney(usd, "USD")}
                    </td>
                    <td className="num py-2.5 font-bold" dir="rtl" style={{ color:"var(--accent)" }}>
                      {irt !== "—" ? formatMoney(irt, "IRT") : "—"}
                    </td>
                    <td className="py-2.5"><span className="chip">{q.currencyCode ?? "USD"}</span></td>
                    <td className="py-2.5"><span className="chip">{q.sourceName ?? "MANUAL"}</span></td>
                    <td className="py-2.5 text-[10px]">
                      <div dir="rtl">{dual.jalali}</div>
                      <div dir="ltr" className="num muted">{dual.gregorian}</div>
                    </td>
                  </tr>
                );
              })}
              {!latestQuotes.length && (
                <tr>
                  <td colSpan={6} className="muted py-6 text-center text-xs">
                    هنوز قیمتی ثبت نشده است.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="muted text-[10px] mt-2">قیمت IRT = قیمت دلاری × آخرین نرخ دلار (نمایش فقط، هیچ داده حسابی تغییر نمی‌کند)</p>
      </Card>

      {/* Historical Market Snapshots Table — dual */}
      <Card title="تاریخچه اسنپ‌شات‌های قیمت — نمایش دوگانه">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="muted">
              <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                <th className="py-2 font-normal">تاریخ شمسی</th>
                <th className="py-2 font-normal">تاریخ میلادی</th>
                <th className="py-2 font-normal">دارایی</th>
                <th className="py-2 font-normal">قیمت (USD)</th>
                <th className="py-2 font-normal">قیمت (IRT)</th>
                <th className="py-2 font-normal">سورس</th>
              </tr>
            </thead>
            <tbody>
              {snapshotHistory.map((s) => {
                const dual = getDualDate(s.snapshotDate);
                const irt = rate ? D(s.price).mul(rate).toFixed(0) : "—";
                return (
                  <tr key={s.id} className="border-b last:border-0" style={{ borderColor: "var(--line)" }}>
                    <td className="py-2.5" dir="rtl">{dual.jalali}</td>
                    <td className="num py-2.5" dir="ltr">{dual.gregorian}</td>
                    <td className="font-bold py-2.5">{s.symbol}</td>
                    <td className="num py-2.5" dir="ltr">{formatMoney(s.price, "USD")}</td>
                    <td className="num py-2.5" dir="rtl" style={{ color:"var(--accent)" }}>{irt !== "—" ? formatMoney(irt, "IRT") : "—"}</td>
                    <td className="py-2.5"><span className="chip">{s.sourceName ?? "MANUAL"}</span></td>
                  </tr>
                );
              })}
              {!snapshotHistory.length && (
                <tr>
                  <td colSpan={6} className="muted py-6 text-center text-xs">
                    اسنپ‌شات تاریخی وجود ندارد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
