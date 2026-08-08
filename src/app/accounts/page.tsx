import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { institutions, networks, wallets } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { getAccountBalances } from "@/features/ledger/queries";
import { EmptyState, Metric, PageHeader, Section, SectionLink } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import WalletForm from "@/components/forms/WalletForm";
import { ACCOUNT_TYPE_LABELS, type AccountType } from "@/domain/accounting";
import { D, Decimal } from "@/domain/decimal";
import { formatMoney, formatQty } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

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
  const [balances, walletRows, fx] = await Promise.all([
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
    getLatestUsdIrtRate(),
  ]);

  const toIrt = (usd: string | number) => (fx.rate ? formatMoney(D(usd).mul(fx.rate).abs().toFixed(0), "IRT") : null);

  const moneyAccounts = balances.filter((b) => b.type === "asset" && !D(b.quantity).isZero());
  const liabilityAccounts = balances.filter((b) => b.type === "liability" && !D(b.baseValue).isZero());
  const totalCash = moneyAccounts.reduce((s, b) => s.add(b.baseValue), Decimal.zero());
  const controlSum = balances.reduce((s, b) => s.add(b.baseValue), Decimal.zero());

  // Group money accounts by wallet
  const byWallet = new Map<string, typeof moneyAccounts>();
  for (const b of moneyAccounts) {
    const key = b.walletName ?? "بدون کیف‌پول";
    byWallet.set(key, [...(byWallet.get(key) ?? []), b]);
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="حساب‌ها"
        subtitle="پول من در کدام حساب‌ها است؟ — همه مانده‌ها لحظه‌ای و مشتق از دفترکل هستند، نه ستون ذخیره‌شده."
        action={<SectionLink href="/market-data" label="قیمت‌های بازار" />}
      />

      <section className="rise grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-3" style={{ borderColor: "var(--border)" }}>
        <Metric label="ارزش پایه حساب‌های پول" value={formatMoney(totalCash.toString())} hint={toIrt(totalCash.toString()) ?? undefined} />
        <Metric label="حساب‌های فعال" value={String(moneyAccounts.length + liabilityAccounts.length)} hint={`${byWallet.size} کیف‌پول / نهاد`} />
        <Metric
          label="جمع کنترلی دفتر"
          value={formatMoney(controlSum.toFixed(2))}
          tone={controlSum.abs().lt("0.000001") ? "up" : "down"}
          hint={controlSum.abs().lt("0.000001") ? "صفر — اصل دوطرفه رعایت شده" : "باید صفر باشد — نیاز به بررسی"}
        />
      </section>

      <Section title="پول شما کجاست؟" hint="گروه‌بندی بر اساس کیف‌پول، بانک و صرافی">
        {byWallet.size === 0 ? (
          <div className="card">
            <EmptyState
              icon="accounts"
              title="هنوز حساب فعالی نیست"
              body="با راه‌اندازی اولیه یا ثبت موجودی، حساب‌ها و مانده‌هایشان اینجا نمایش داده می‌شوند."
            />
          </div>
        ) : (
          <div className="space-y-2.5">
            {[...byWallet.entries()].map(([wallet, rows]) => {
              const walletTotal = rows.reduce((s, b) => s.add(b.baseValue), Decimal.zero());
              const walletMeta = walletRows.find((w) => w.name === wallet);
              return (
                <div key={wallet} className="card overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3" style={{ background: "var(--sunken)" }}>
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: "var(--surface)", color: "var(--brand)" }}>
                        <Icon name="wallet" size={15} />
                      </span>
                      <div>
                        <p className="text-[13.5px] font-semibold">{wallet}</p>
                        <p className="muted text-[10px]">
                          {walletMeta ? WALLET_KIND[walletMeta.kind] ?? walletMeta.kind : "حساب"}
                          {walletMeta?.institution ? ` · ${walletMeta.institution}` : walletMeta?.network ? ` · ${walletMeta.network}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="text-left">
                      <p className="num text-[14px] font-bold" dir="ltr">
                        {formatMoney(walletTotal.toString())}
                      </p>
                      {toIrt(walletTotal.toString()) && <p className="muted num text-[9.5px]">≈ {toIrt(walletTotal.toString())}</p>}
                    </div>
                  </div>
                  <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                    {rows.map((b) => (
                      <li key={b.accountId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-[12.5px] font-medium">{b.name}</p>
                          <p className="muted num text-[10px]" dir="ltr">
                            {b.code} · {formatQty(b.quantity, b.assetDecimals)} {b.symbol ?? ""}
                          </p>
                        </div>
                        <div className="shrink-0 text-left">
                          <p className="num text-[12.5px] font-bold" dir="ltr">
                            {formatMoney(b.baseValue)}
                          </p>
                          {toIrt(b.baseValue) && <p className="muted num text-[9.5px]">≈ {toIrt(b.baseValue)}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {liabilityAccounts.length > 0 && (
        <Section title="حساب‌های بدهی" action={<SectionLink href="/debts" label="مدیریت بدهی‌ها" />}>
          <div className="card overflow-hidden">
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {liabilityAccounts.map((b) => (
                <li key={b.accountId} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="text-[12.5px] font-medium">{b.name}</p>
                    <p className="muted num text-[10px]" dir="ltr">
                      {b.code}
                    </p>
                  </div>
                  <p className="num text-[13px] font-bold" dir="ltr" style={{ color: "var(--negative)" }}>
                    {formatMoney(D(b.baseValue).abs().toString())}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      )}

      {/* Chart of accounts — accounting reference, collapsed */}
      <Section title="دفتر حساب‌ها" hint="مراجع حسابداری — سود/زیان و سرمایه">
        <details className="card group overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 marker:hidden [&::-webkit-details-marker]:hidden">
            <span className="text-[13.5px] font-semibold">نمودار کامل حساب‌ها (Chart of Accounts)</span>
            <span className="muted transition-transform group-open:rotate-180">
              <Icon name="chevronDown" size={15} />
            </span>
          </summary>
          <div className="border-t p-4" style={{ borderColor: "var(--border)" }}>
            <div className="grid gap-6 sm:grid-cols-2">
              {(["income", "expense", "equity", "liability"] as AccountType[])
                .map((t) => ({ t, rows: balances.filter((b) => b.type === t && !D(b.baseValue).isZero()) }))
                .filter((g) => g.rows.length > 0)
                .map((g) => (
                  <div key={g.t}>
                    <p className="muted mb-2 text-[11px] font-semibold">{ACCOUNT_TYPE_LABELS[g.t]}</p>
                    <ul className="space-y-1.5">
                      {g.rows.map((b) => (
                        <li key={b.accountId} className="flex items-center justify-between text-[12px]">
                          <span>
                            <span className="muted num ml-1.5">{b.code}</span>
                            {b.name}
                          </span>
                          <span className="num" dir="ltr">
                            {formatMoney(D(b.baseValue).abs().toString())}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </div>
        </details>
      </Section>

      {/* Add wallet */}
      <Section title="معرفی حساب یا کیف‌پول جدید">
        <details className="card group overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 marker:hidden [&::-webkit-details-marker]:hidden">
            <span className="text-[13.5px] font-semibold">افزودن حساب جدید</span>
            <span className="muted transition-transform group-open:rotate-180">
              <Icon name="chevronDown" size={15} />
            </span>
          </summary>
          <div className="border-t p-4" style={{ borderColor: "var(--border)" }}>
            <WalletForm />
          </div>
        </details>
      </Section>
    </div>
  );
}
