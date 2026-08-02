import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assetClasses, assets, institutions, networks, prices, wallets } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { getAccountBalances } from "@/features/ledger/queries";
import { Card, Money, PageHeader } from "@/components/ui/Card";
import PriceForm from "@/components/forms/PriceForm";
import { ACCOUNT_TYPE_LABELS, type AccountType } from "@/domain/accounting";
import { D } from "@/domain/decimal";
import { formatMoney, formatQty } from "@/lib/format";

export const dynamic = "force-dynamic";

const WALLET_KIND: Record<string, string> = {
  bank: "بانک",
  exchange: "صرافی",
  hot: "کیف داغ",
  cold: "کیف سرد",
  cash: "نقد",
  fund: "صندوق/کارگزاری",
};

export default async function AccountsPage() {
  await seedIfEmpty();
  const [balances, walletRows, assetRows, insts, nets] = await Promise.all([
    getAccountBalances(),
    db
      .select({
        id: wallets.id,
        name: wallets.name,
        kind: wallets.kind,
        institution: institutions.name,
        network: networks.name,
      })
      .from(wallets)
      .leftJoin(institutions, eq(institutions.id, wallets.institutionId))
      .leftJoin(networks, eq(networks.id, wallets.networkId))
      .where(sql`${wallets.deletedAt} is null`)
      .orderBy(asc(wallets.name)),
    db
      .select({
        id: assets.id,
        symbol: assets.symbol,
        name: assets.name,
        className: assetClasses.name,
        color: assetClasses.color,
        decimals: assets.decimals,
      })
      .from(assets)
      .innerJoin(assetClasses, eq(assetClasses.id, assets.classId))
      .where(sql`${assets.deletedAt} is null`)
      .orderBy(asc(assets.symbol)),
    db.select().from(institutions).where(sql`${institutions.deletedAt} is null`),
    db.select().from(networks).where(sql`${networks.deletedAt} is null`),
  ]);

  const latest = await db
    .select({ assetId: prices.assetId, price: prices.priceBase, asOf: prices.asOf })
    .from(prices)
    .orderBy(desc(prices.asOf));
  const priceOf = new Map<string, string>();
  for (const p of latest) if (!priceOf.has(p.assetId)) priceOf.set(p.assetId, p.price);

  const byType = (t: AccountType) => balances.filter((b) => b.type === t);

  return (
    <div className="space-y-4">
      <PageHeader title="حساب‌ها و مرجع‌ها" subtitle="درخت حساب‌ها، کیف‌پول‌ها، بانک‌ها، صرافی‌ها، شبکه‌ها و دارایی‌ها." />

      <Card title="به‌روزرسانی قیمت دارایی">
        <PriceForm
          assets={assetRows.map((a) => ({ id: a.id, symbol: a.symbol, name: a.name, price: priceOf.get(a.id) ?? null }))}
        />
      </Card>

      {(["asset", "liability", "equity", "income", "expense"] as AccountType[]).map((t) => (
        <Card key={t} title={`حساب‌های ${ACCOUNT_TYPE_LABELS[t]}`}>
          <ul className="divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {byType(t).map((b) => (
              <li key={b.accountId} className="flex items-center justify-between py-2.5">
                <div>
                  <div>{b.name}</div>
                  <div className="muted text-[10px]">
                    {b.code} {b.symbol ? `· ${b.symbol}` : ""} {b.walletName ? `· ${b.walletName}` : ""}
                  </div>
                </div>
                <div className="text-left">
                  <Money value={b.baseValue} tone />
                  {b.symbol && (
                    <div className="muted num text-[10px]" dir="ltr">
                      {formatQty(b.quantity, b.assetDecimals)} {b.symbol}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="کیف‌پول‌ها، بانک‌ها و صرافی‌ها">
          <ul className="divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {walletRows.map((w) => (
              <li key={w.id} className="flex items-center justify-between py-2.5">
                <span>{w.name}</span>
                <span className="muted text-[10px]">
                  <span className="chip ml-2">{WALLET_KIND[w.kind] ?? w.kind}</span>
                  {w.institution ?? w.network ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="دارایی‌ها (Asset Master)">
          <ul className="divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {assetRows.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2.5">
                <span className="flex items-center gap-2">
                  <i className="h-2.5 w-2.5 rounded-full" style={{ background: a.color }} />
                  {a.symbol} <span className="muted text-[10px]">{a.name}</span>
                </span>
                <span className="num muted text-[10px]" dir="ltr">
                  {priceOf.has(a.id) ? formatMoney(priceOf.get(a.id)!) : "بدون قیمت"} · {a.className}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="نهادهای مالی">
          <ul className="divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {insts.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2">
                <span>{i.name}</span>
                <span className="chip">{i.kind === "bank" ? "بانک" : i.kind === "exchange" ? "صرافی" : "کارگزاری"}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="شبکه‌ها">
          <ul className="divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {nets.map((n) => (
              <li key={n.id} className="flex items-center justify-between py-2">
                <span>{n.name}</span>
                <span className="muted num text-[10px]" dir="ltr">{n.code}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="جمع کنترلی">
        <p className="muted text-[11px]">
          مجموع ارزش پایه همه حساب‌ها باید صفر باشد (اصل دوطرفه):{" "}
          <span className="num" dir="ltr">
            {formatMoney(balances.reduce((s, b) => s.add(b.baseValue), D("0")).toFixed(6))}
          </span>
        </p>
      </Card>
    </div>
  );
}
