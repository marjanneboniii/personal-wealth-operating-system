import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { ensureAuth } from "@/lib/authGuard";
import { db } from "@/db";
import { accounts, assets, institutions, networks, wallets } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { listMoneyAccountCurrencies } from "@/features/accounts/service";
import { getAccountBalances } from "@/features/ledger/queries";
import { repairOrphanedRealEstate } from "@/features/rwa/realEstate/service";
import { EmptyState, Metric, PageHeader, Section, SectionLink } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import AssetLogo from "@/components/ui/AssetLogo";
import { resolveAssetLogoDetailed } from "@/features/branding/assetLogo";
import MoneyAccountForm from "@/components/forms/MoneyAccountForm";
import { ACCOUNT_TYPE_LABELS, type AccountType } from "@/domain/accounting";
import { D, Decimal } from "@/domain/decimal";
import { faCount, formatMoney, toIrtMoney, toFaDigits } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
import { getUserProMode } from "@/features/preferences/service";
import AccountListItem from "@/components/accounts/AccountListItem";

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
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id ?? null;
  const pro = await getUserProMode(userId);
  await seedIfEmpty();
  await repairOrphanedRealEstate();
  const currencyRows = await listMoneyAccountCurrencies();
  const [balances, walletRows, fx] = await Promise.all([
    getAccountBalances(userId ?? undefined),
    db
      .select({
        id: wallets.id,
        name: wallets.name,
        kind: wallets.kind,
        institution: institutions.name,
        network: networks.name,
        accountId: accounts.id,
      })
      .from(wallets)
      .leftJoin(institutions, eq(institutions.id, wallets.institutionId))
      .leftJoin(networks, eq(networks.id, wallets.networkId))
      .leftJoin(accounts, and(eq(accounts.walletId, wallets.id), sql`${accounts.deletedAt} is null`))
      .where(
        and(
          sql`${wallets.deletedAt} is null`,
          userId ? eq(wallets.userId, userId) : sql`1=1`,
        ),
      )
      .orderBy(asc(wallets.name)),
    getLatestUsdIrtRate(),
  ]);

  const toIrt = (usd: string | number) => toIrtMoney(D(usd).abs().toString(), fx.rate);

  /**
   * Asset display metadata (stored logo + CoinGecko identity), read separately
   * so the ledger balance query stays untouched. Presentation only: these
   * columns never take part in posting, FIFO or valuation.
   */
  const assetIds = [...new Set(balances.map((b) => b.assetId).filter((id): id is string => !!id))];
  const assetMetaRows = assetIds.length
    ? await db
        .select({
          id: assets.id,
          logoUrl: assets.logoUrl,
          coingeckoId: assets.coingeckoId,
        })
        .from(assets)
        .where(inArray(assets.id, assetIds))
    : [];
  const assetMeta = new Map(assetMetaRows.map((row) => [row.id, row]));

  // CURRENCY ISOLATION: Balance is canonical in its own currency, Valuation is derived.
  // IRT Balance = quantity (Toman) canonical
  // USDT Balance = quantity (USDT) canonical, Toman Valuation = qty * rate
  // USD Balance = quantity (USD) canonical, Toman Valuation = qty * rate
  const canonicalBalance = (b: (typeof balances)[number]) => {
    if (b.symbol === "IRT") return formatMoney(D(b.quantity).abs().toFixed(0), "IRT");
    if (b.symbol === "IRR") return formatMoney(D(b.quantity).abs().div(10).toFixed(0), "IRT");
    if (b.symbol === "USDT") return formatMoney(D(b.quantity).abs().toString(), "USDT");
    if (b.symbol === "USD") return formatMoney(D(b.quantity).abs().toString(), "USD");
    // Fallback for other assets: quantity in its own symbol
    return formatMoney(D(b.quantity).abs().toString(), b.symbol ?? "USD");
  };

  const valuationToman = (b: (typeof balances)[number]) => {
    if (b.symbol === "IRT" || b.symbol === "IRR") return null; // IRT balance IS Toman, no separate valuation needed for primary
    if (b.symbol === "USDT" || b.symbol === "USD") {
      // Toman valuation = canonical qty * current rate
      return toIrt(D(b.quantity).abs().toString()) ?? formatMoney(D(b.baseValue).abs().toString(), "IRT");
    }
    return toIrt(b.baseValue) ?? null;
  };

  const moneyAccountsRaw = balances.filter(
    (b) => b.type === "asset" && (!!b.walletName || !D(b.quantity).isZero()),
  );
  const moneyById = new Map<string, (typeof moneyAccountsRaw)[number]>();
  for (const row of moneyAccountsRaw) {
    const prev = moneyById.get(row.accountId);
    if (!prev) {
      moneyById.set(row.accountId, row);
      continue;
    }
    const preferIrt = row.symbol === "IRT" || row.symbol === "IRR";
    const prevIrt = prev.symbol === "IRT" || prev.symbol === "IRR";
    moneyById.set(row.accountId, preferIrt && !prevIrt ? row : prev);
  }
  const moneyAccounts = [...moneyById.values()];
  const liabilityAccounts = balances.filter((b) => b.type === "liability" && !D(b.baseValue).isZero());
  const totalCash = moneyAccounts.reduce((s, b) => s.add(b.baseValue), Decimal.zero());
  const controlSum = balances.reduce((s, b) => s.add(b.baseValue), Decimal.zero());

  const walletIdByAccount = new Map(
    walletRows.filter((w) => w.accountId).map((w) => [w.accountId as string, w.id]),
  );
  const byWallet = new Map<string, typeof moneyAccounts>();
  for (const b of moneyAccounts) {
    const key = walletIdByAccount.get(b.accountId) ?? `account:${b.accountId}`;
    byWallet.set(key, [...(byWallet.get(key) ?? []), b]);
  }

  return (
    <div className="space-y-8">
      <PageHeader title="حساب‌ها" />

      <section className="rise grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-3" style={{ borderColor: "var(--border)" }}>
        <Metric label="ارزش پایه حساب‌های پول" value={toIrt(totalCash.toString()) ?? formatMoney(totalCash.toString())} hint={fx.rate ? formatMoney(totalCash.toString()) : undefined} />
        <Metric label="حساب‌های فعال" value={faCount(moneyAccounts.length + liabilityAccounts.length)} hint={`${faCount(byWallet.size)} کیف‌پول / نهاد`} />
        <Metric
          label="جمع کنترلی دفتر"
          value={formatMoney(controlSum.toFixed(2))}
          tone={controlSum.abs().lt("0.000001") ? "neutral" : "down"}
          hint={controlSum.abs().lt("0.000001") ? "صفر — اصل دوطرفه رعایت شده" : "باید صفر باشد — نیاز به بررسی"}
        />
      </section>

      <Section>
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
            {[...byWallet.entries()].map(([walletKey, rows]) => {
              const walletTotal = rows.reduce((s, b) => s.add(b.baseValue), Decimal.zero());
              const walletMeta = walletRows.find((w) => w.id === walletKey);
              const walletName = walletMeta?.name ?? rows[0]?.walletName ?? rows[0]?.name ?? "بدون کیف‌پول";
              const irtOnly = rows.every((r) => r.symbol === "IRT" || r.symbol === "IRR");
              const walletPrimary = irtOnly
                ? formatMoney(
                    rows.reduce((s, r) => s.add(r.symbol === "IRR" ? D(r.quantity).abs().div(10) : D(r.quantity).abs()), Decimal.zero()).toFixed(0),
                    "IRT",
                  )
                : toIrt(walletTotal.toString()) ?? formatMoney(walletTotal.toString());
              // Brand mark for the wallet/institution header — display only.
              const walletLogo = resolveAssetLogoDetailed({
                assetType: walletMeta?.kind === "exchange" ? "company" : "bank",
                brandName: walletMeta?.institution ?? walletName,
                name: walletName,
              });
              return (
                <div key={walletKey} className="card overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3" style={{ background: "var(--sunken)" }}>
                    <div className="flex items-center gap-2.5">
                      {walletLogo.source === "persianlabs" ? (
                        <AssetLogo
                          assetType={walletMeta?.kind === "exchange" ? "company" : "bank"}
                          brandName={walletMeta?.institution ?? walletName}
                          name={walletName}
                          size={32}
                          radius={16}
                        />
                      ) : (
                        <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: "var(--surface)", color: "var(--brand)" }}>
                          <Icon name="wallet" size={15} />
                        </span>
                      )}
                      <div>
                        <p className="text-[12px] sm:text-[13px] font-semibold">{walletName}</p>
                        <p className="muted text-[10px]">
                          {walletMeta ? WALLET_KIND[walletMeta.kind] ?? walletMeta.kind : "حساب"}
                          {walletMeta?.institution ? ` · ${walletMeta.institution}` : walletMeta?.network ? ` · ${walletMeta.network}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="text-left">
                      <p className="num text-[12px] sm:text-[12px] sm:text-[13px] font-bold money-nowrap money-nowrap" dir="rtl">
                        {walletPrimary}
                      </p>
                      {!irtOnly && toIrt(walletTotal.toString()) && <p className="muted num text-[10.5px]" style={{ color: "var(--text-2)" }}>≈ {formatMoney(walletTotal.toString())}</p>}
                    </div>
                  </div>
                  <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                    {rows.map((b) => {
                      // Money is formatted on the SERVER with the existing
                      // helpers; only plain strings cross into the client
                      // component (functions are not serialisable — that was
                      // the crash this page used to hit).
                      const meta = b.assetId ? assetMeta.get(b.assetId) : undefined;
                      return (
                        <AccountListItem
                          key={b.accountId}
                          accountId={b.accountId}
                          name={b.name}
                          symbol={b.symbol}
                          quantity={b.quantity}
                          assetDecimals={b.assetDecimals}
                          balanceLabel={canonicalBalance(b)}
                          valuationLabel={valuationToman(b)}
                          baseValueLabel={formatMoney(D(b.baseValue).abs().toString())}
                          walletName={b.walletName}
                          logoUrl={meta?.logoUrl ?? null}
                          assetClassName={b.className}
                          coingeckoId={meta?.coingeckoId ?? null}
                        />
                      );
                    })}
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
                    {pro && (
                      <p className="muted num text-[10px]" dir="ltr">
                        {toFaDigits(b.code)}
                      </p>
                    )}
                  </div>
                  <div className="text-left">
                    <p className="num text-[12px] sm:text-[13px] font-bold money-nowrap" dir="rtl" style={{ color: "var(--negative)" }}>
                      {toIrt(D(b.baseValue).abs().toString()) ?? formatMoney(D(b.baseValue).abs().toString())}
                    </p>
                    {toIrt(D(b.baseValue).abs().toString()) && (
                      <p className="muted num text-[9.5px]" dir="rtl">
                        ≈ {formatMoney(D(b.baseValue).abs().toString())}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      )}

      <Section title="دفتر حساب‌ها">
        <details className="card group overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 marker:hidden [&::-webkit-details-marker]:hidden">
            <span className="text-[12px] sm:text-[13px] font-semibold">نمودار کامل حساب‌ها (Chart of Accounts)</span>
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
                            {pro && <span className="muted num ml-1.5">{toFaDigits(b.code)}</span>}
                            {b.name}
                          </span>
                          <span className="num" dir="rtl">
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

      <Section title="معرفی حساب یا کیف‌پول جدید">
        <details className="card group overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 marker:hidden [&::-webkit-details-marker]:hidden">
            <span className="text-[12px] sm:text-[13px] font-semibold">افزودن حساب جدید</span>
            <span className="muted transition-transform group-open:rotate-180">
              <Icon name="chevronDown" size={15} />
            </span>
          </summary>
          <div className="border-t p-4" style={{ borderColor: "var(--border)" }}>
            <MoneyAccountForm currencies={currencyRows} usdIrtRate={fx.rate} />
          </div>
        </details>
      </Section>
    </div>
  );
}
