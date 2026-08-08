import { seedIfEmpty } from "@/db/seed";
import { ensureAuth } from "@/lib/authGuard";
import { getAccountBalances, getRealizedPnl } from "@/features/ledger/queries";
import { getPortfolioValuation } from "@/features/portfolio/service";
import { EmptyState, Metric, PageHeader, Section, SectionLink } from "@/components/ui/Card";
import HoldingsTable from "@/components/assets/HoldingsTable";
import { D, Decimal } from "@/domain/decimal";
import { formatMoney, formatQty } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CryptoPage() {
  await ensureAuth();
  await seedIfEmpty();

  const [valuation, balances, pnl, fx] = await Promise.all([
    getPortfolioValuation(),
    getAccountBalances(),
    getRealizedPnl(),
    getLatestUsdIrtRate(),
  ]);

  const toIrt = (usd: string | number) => (fx.rate ? formatMoney(D(usd).mul(fx.rate).toFixed(0), "IRT") : null);

  const crypto = valuation.assetValuations.filter((a) => a.className === "رمزارز");
  const stable = valuation.assetValuations.filter((a) => a.className === "استیبل‌کوین");
  const cryptoSymbols = new Set([...crypto, ...stable].map((a) => a.symbol));

  const cryptoValue = Decimal.sum(crypto.map((a) => a.currentValue));
  const stableValue = Decimal.sum(stable.map((a) => a.currentValue));
  const cryptoCost = Decimal.sum(crypto.map((a) => a.costBasis));
  const cryptoPnl = cryptoValue.sub(cryptoCost);
  const realized = Decimal.sum(pnl.bySymbol.filter((p) => cryptoSymbols.has(p.symbol)).map((p) => p.pnl));

  // Where does crypto live? — custody breakdown from account balances
  const custody = new Map<string, number>();
  for (const b of balances) {
    if (b.type !== "asset" || !b.symbol || !cryptoSymbols.has(b.symbol)) continue;
    const v = Math.abs(Number(b.baseValue));
    if (v < 0.000001) continue;
    custody.set(b.walletName ?? "نامشخص", (custody.get(b.walletName ?? "نامشخص") ?? 0) + v);
  }
  const custodyTotal = [...custody.values()].reduce((s, v) => s + v, 0) || 1;

  return (
    <div className="space-y-8">
      <PageHeader
        title="رمزارزها"
        subtitle="وضعیت دارایی‌های دیجیتال من چیست؟ — ارزش‌گذاری، محل نگهداری و سود تحقق‌یافته."
        action={<SectionLink href="/market-data" label="به‌روزرسانی قیمت‌ها" />}
      />

      {crypto.length === 0 && stable.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="crypto"
            title="هیچ رمزارزی در سبد شما نیست"
            body="با ثبت خرید رمزارز یا انتقال به کیف‌پول خود، این صفحه زنده می‌شود."
            action={
              <Link href="/new?type=buy" className="btn btn-primary">
                ثبت خرید رمزارز
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <section className="rise grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-4" style={{ borderColor: "var(--border)" }}>
            <Metric
              label="ارزش رمزارزها"
              value={formatMoney(cryptoValue.toString())}
              hint={toIrt(cryptoValue.toString()) ?? undefined}
            />
            <Metric label="استیبل‌کوین‌ها" value={formatMoney(stableValue.toString())} hint={stable.map((s) => s.symbol).join(" · ") || undefined} />
            <Metric
              label="سود/زیان تحقق‌نیافته"
              value={`${cryptoPnl.gte(0) ? "+" : "−"}${formatMoney(cryptoPnl.abs().toString())}`}
              tone={cryptoPnl.gte(0) ? "up" : "down"}
              hint={`بهای تمام‌شده ${formatMoney(cryptoCost.toString())}`}
            />
            <Metric
              label="سود تحقق‌یافته"
              value={`${realized.gte(0) ? "+" : "−"}${formatMoney(realized.abs().toString())}`}
              tone={realized.gte(0) ? "up" : "down"}
              hint="فروش‌های انجام‌شده (FIFO)"
            />
          </section>

          <Section title="دارایی‌های دیجیتال شما" hint="قیمت از لایه Market Data — مانده از دفترکل">
            <HoldingsTable rows={[...crypto, ...stable]} toIrt={toIrt} />
          </Section>

          {custody.size > 0 && (
            <Section title="دارایی دیجیتال شما کجا نگهداری می‌شود؟" hint="توزیع نگهداری بر اساس کیف‌پول و صرافی">
              <ul className="space-y-3">
                {[...custody.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([wallet, value]) => {
                    const share = (value / custodyTotal) * 100;
                    return (
                      <li key={wallet}>
                        <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
                          <span className="font-medium">{wallet}</span>
                          <span className="flex shrink-0 items-baseline gap-2">
                            <span className="num muted text-[10.5px]" dir="ltr">
                              {share.toFixed(1)}٪
                            </span>
                            <span className="num font-bold" dir="ltr">
                              {formatMoney(value)}
                            </span>
                          </span>
                        </div>
                        <div className="meter">
                          <i style={{ width: `${Math.min(100, share)}%`, background: "var(--brand)" }} />
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </Section>
          )}

          <p className="muted text-[10.5px]">
            مانده‌ها همیشه از دفترکل مشتق می‌شوند؛ قیمت‌ها هرگز سند حسابداری ایجاد نمی‌کنند. مانده حساب‌ها:{" "}
            {balances
              .filter((b) => b.type === "asset" && b.symbol && cryptoSymbols.has(b.symbol) && Math.abs(Number(b.quantity)) > 0.000001)
              .map((b) => (
                <span key={b.accountId} className="num mx-1" dir="ltr">
                  {formatQty(b.quantity, b.assetDecimals)} {b.symbol}
                </span>
              ))}
          </p>
        </>
      )}
    </div>
  );
}
