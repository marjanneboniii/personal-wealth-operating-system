import { asc, eq, sql } from "drizzle-orm";
import { ensureAuth } from "@/lib/authGuard";
import { db } from "@/db";
import { assetClasses, assets, currencies } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import {
  getMarketPrices,
  getMarketSnapshots,
  listPriceSources,
} from "@/features/marketData/service";
import { Card, PageHeader, Section } from "@/components/ui/Card";
import MarketPriceForm from "@/components/forms/MarketPriceForm";
import FxSettings from "@/components/settings/FxSettings";
import AuthAccessCard from "@/components/auth/AuthAccessCard";
import { formatMoney, getDualDate } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
import { getUserFxRate } from "@/features/fx/userRate";
import { D } from "@/domain/decimal";

export const dynamic = "force-dynamic";

export default async function MarketDataPage() {
  const authUser = await ensureAuth();
  await seedIfEmpty();

  const [assetRows, curRows, sources, latestQuotes, snapshotHistory, fxSnap, userFx] = await Promise.all([

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
    authUser ? getUserFxRate(authUser.id) : Promise.resolve(null),
  ]);

  const rate = fxSnap.rate;

  return (
    <div className="space-y-6">
      <PageHeader
        title="قیمت‌های بازار"
        subtitle="آخرین قیمت‌ها چیست؟ — ورودی ارزش‌گذاری؛ هرگز سند دفترکل یا مانده‌ای را تغییر نمی‌دهند."
      />

      <p className="muted rise flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-4 text-[11.5px]" style={{ borderColor: "var(--border)" }}>
        <span>نرخ مرجع: <strong dir="ltr" className="num">{formatMoney(rate, "IRT")}</strong> ≈ $1</span>
        <span className="opacity-40">·</span>
        <span>تاریخ: <span className="num">{fxSnap.effectiveDate}</span></span>
        <span className="opacity-40">·</span>
        <span>منبع: {fxSnap.source}</span>
      </p>

      <Section title="ثبت دستی نرخ ارز" hint="نرخ دلار به تومان برای ارزش‌گذاری جاری؛ تراکنش‌های تاریخی و دفترکل منجمد می‌مانند.">
        {authUser && userFx ? (
          <FxSettings
            currentRate={userFx.rate}
            lastUpdatedAt={userFx.lastUpdatedAt}
            nextUpdateAt={userFx.nextUpdateAt}
            canUpdate={userFx.canUpdate}
          />
        ) : (
          <AuthAccessCard
            googleClientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID}
            title="برای ثبت نرخ شخصی وارد شوید"
            body="ورود کاربر و ورود با Google از همین‌جا در دسترس است. پس از ورود، کادر ثبت دستی نرخ ارز فعال می‌شود و نرخ هر کاربر جداگانه نگهداری خواهد شد."
          />
        )}
      </Section>

      {/* Manual Price Entry Form */}
      <Card title="ثبت قیمت جدید">
        <MarketPriceForm assets={assetRows} currencies={curRows} sources={sources} today={new Date().toISOString().slice(0,10)} />
        
      </Card>

      {/* Latest Market Quotes Table — dual price */}
      <Card title="آخرین قیمت‌ها">
        <div className="overflow-x-auto">
          <table className="table">
            <thead className="muted">
              <tr className="border-b" style={{ borderColor: "var(--border)" }}>
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
                  <tr key={q.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2.5">
                      <span className="font-bold">{q.symbol}</span>
                      <span className="muted mr-2 text-[10px]">{q.assetName}</span>
                    </td>
                    <td className="num py-2.5 font-bold" dir="ltr">
                      {formatMoney(usd, "USD")}
                    </td>
                    <td className="num py-2.5 font-bold" dir="rtl" style={{ color:"var(--brand)" }}>
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
        
      </Card>

      {/* Historical Market Snapshots Table — dual */}
      <Card title="تاریخچه قیمت‌ها">
        <div className="overflow-x-auto">
          <table className="table">
            <thead className="muted">
              <tr className="border-b" style={{ borderColor: "var(--border)" }}>
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
                  <tr key={s.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2.5" dir="rtl">{dual.jalali}</td>
                    <td className="num py-2.5" dir="ltr">{dual.gregorian}</td>
                    <td className="font-bold py-2.5">{s.symbol}</td>
                    <td className="num py-2.5" dir="ltr">{formatMoney(s.price, "USD")}</td>
                    <td className="num py-2.5" dir="rtl" style={{ color:"var(--brand)" }}>{irt !== "—" ? formatMoney(irt, "IRT") : "—"}</td>
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
