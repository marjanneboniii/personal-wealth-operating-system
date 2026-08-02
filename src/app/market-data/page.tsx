import { asc, desc, eq, sql } from "drizzle-orm";
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
import { formatMoney, formatShortDate, todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MarketDataPage() {
  await seedIfEmpty();

  const [assetRows, curRows, sources, latestQuotes, snapshotHistory] = await Promise.all([
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
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="مدیریت قیمت‌های بازار (Market Data Layer)"
        subtitle="قیمت‌های بازار ورودی‌های ارزش‌گذاری بیرونی هستند و هرگز اسناد دفترکل، مانده‌ها یا بسته‌های FIFO را تغییر نمی‌دهند."
      />

      {/* Manual Price Entry Form */}
      <Card title="ثبت قیمت جدید بازار (Manual Price Snapshot)">
        <MarketPriceForm assets={assetRows} currencies={curRows} sources={sources} today={todayIso()} />
      </Card>

      {/* Latest Market Quotes Table */}
      <Card title="آخرین قیمت‌های ثبت‌شده در بازار">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="muted">
              <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                <th className="py-2 font-normal">دارایی</th>
                <th className="py-2 font-normal">قیمت بازار</th>
                <th className="py-2 font-normal">ارز قیمت</th>
                <th className="py-2 font-normal">سورس قیمت</th>
                <th className="py-2 font-normal">زمان بروزرسانی</th>
              </tr>
            </thead>
            <tbody>
              {latestQuotes.map((q) => (
                <tr key={q.id} className="border-b last:border-0" style={{ borderColor: "var(--line)" }}>
                  <td className="py-2.5">
                    <span className="font-bold">{q.symbol}</span>
                    <span className="muted mr-2 text-[10px]">{q.assetName}</span>
                  </td>
                  <td className="num py-2.5 font-bold" dir="ltr">
                    {formatMoney(q.price, q.currencyCode ?? "USD")}
                  </td>
                  <td className="py-2.5"><span className="chip">{q.currencyCode ?? "USD"}</span></td>
                  <td className="py-2.5"><span className="chip">{q.sourceName ?? "MANUAL"}</span></td>
                  <td className="num muted py-2.5 text-[10px]" dir="ltr">
                    {new Date(q.priceTimestamp).toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                </tr>
              ))}
              {!latestQuotes.length && (
                <tr>
                  <td colSpan={5} className="muted py-6 text-center text-xs">
                    هنوز قیمتی ثبت نشده است.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Historical Market Snapshots Table */}
      <Card title="تاریخچه اسنپ‌شات‌های قیمت (Historical Price Snapshots)">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="muted">
              <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                <th className="py-2 font-normal">تاریخ اسنپ‌شات</th>
                <th className="py-2 font-normal">دارایی</th>
                <th className="py-2 font-normal">قیمت اسنپ‌شات</th>
                <th className="py-2 font-normal">ارز</th>
                <th className="py-2 font-normal">سورس</th>
              </tr>
            </thead>
            <tbody>
              {snapshotHistory.map((s) => (
                <tr key={s.id} className="border-b last:border-0" style={{ borderColor: "var(--line)" }}>
                  <td className="num py-2.5" dir="ltr">{formatShortDate(s.snapshotDate)}</td>
                  <td className="font-bold py-2.5">{s.symbol}</td>
                  <td className="num py-2.5" dir="ltr">{formatMoney(s.price, s.currencyCode ?? "USD")}</td>
                  <td className="py-2.5"><span className="chip">{s.currencyCode ?? "USD"}</span></td>
                  <td className="py-2.5"><span className="chip">{s.sourceName ?? "MANUAL"}</span></td>
                </tr>
              ))}
              {!snapshotHistory.length && (
                <tr>
                  <td colSpan={5} className="muted py-6 text-center text-xs">
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
