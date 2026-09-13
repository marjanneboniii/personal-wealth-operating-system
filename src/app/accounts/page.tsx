import { and, asc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { db } from "@/db";
import { accounts, assets, institutions, networks, wallets } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { listMoneyAccountCurrencies } from "@/features/accounts/service";
import { getAccountBalances } from "@/features/ledger/queries";
import { classifyAccountFamily, isLiquidAccount } from "@/features/accounts/classification";
import { Alert, EmptyState, Metric, PageHeader, Section, SectionLink } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import AssetLogo from "@/components/ui/AssetLogo";
import DisclosurePanel from "@/components/ui/DisclosurePanel";
import ModuleTabs, { MONEY_TABS } from "@/components/ui/ModuleTabs";
import { resolveAssetLogoDetailed } from "@/features/branding/assetLogo";
import MoneyAccountForm from "@/components/forms/MoneyAccountForm";
import { ACCOUNT_TYPE_LABELS, type AccountType } from "@/domain/accounting";
import { D, Decimal } from "@/domain/decimal";
import { faCount, formatMoney, formatPct, toIrtMoney, toFaDigits } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
import { getUserProMode } from "@/features/preferences/service";
import AccountListItem from "@/components/accounts/AccountListItem";
import { walletLogoFor } from "@/features/setup/holdingWallets";

export const dynamic = "force-dynamic";

export const metadata = { title: "حساب‌ها" };

/**
 * Wallet-kind labels. Custody jargon is gone from the UI: a software (hot)
 * wallet is simply «کیف پول».
 */
const WALLET_KIND: Record<string, string> = {
  bank: "بانک",
  exchange: "صرافی",
  hot: "کیف پول",
  cold: "کیف سرد",
  cash: "نقد",
  fund: "صندوق/کارگزاری",
};

/**
 * Strips a dangling separator from a display name («بانک سامان ·» → «بانک سامان»),
 * which would otherwise render as a stray dot pinned to the title.
 */
function cleanDisplayName(value: string): string {
  return value.replace(/[\s·•\-—–|,]+$/g, "").replace(/^[\s·•\-—–|,]+/g, "").trim();
}

/**
 * Subtitle under a wallet title. A bank's own name already carries «بانک», so
 * the kind label is dropped when the title contains it, and the institution is
 * dropped when the title already names it. If nothing is left, no subtitle.
 */
function walletSubtitleOf(wallet: { name: string | null; kind: string | null; institution: string | null; network: string | null } | undefined) {
  if (!wallet) return null;
  const kindLabel = WALLET_KIND[wallet.kind ?? ""] ?? wallet.kind ?? "";
  const title = wallet.name ?? "";
  const detail = wallet.institution ?? wallet.network ?? "";
  const detailAddsAnything = !!detail && detail !== title && !title.includes(detail);
  const kindAddsAnything = !!kindLabel && !title.includes(kindLabel) && kindLabel !== detail;
  const parts = [kindAddsAnything ? kindLabel : null, detailAddsAnything ? detail : null]
    .map((part) => (part ?? "").replace(/^[\s·•\-—–|,]+|[\s·•\-—–|,]+$/g, "").trim())
    .filter((part) => part.length > 0);
  return parts.length ? parts.join(" · ") : null;
}

export default async function AccountsPage() {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id ?? null;
  const pro = await getUserProMode(userId);
  await seedIfEmpty();
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
      .where(and(sql`${wallets.deletedAt} is null`, userId ? eq(wallets.userId, userId) : sql`1=1`))
      .orderBy(asc(wallets.name)),
    getLatestUsdIrtRate(),
  ]);

  type Balance = (typeof balances)[number];

  /**
   * USD → Toman display helper. NO absolute value: a short (overdrawn) account
   * must READ as short (audit F-06).
   */
  const toIrt = (usd: string | number) => toIrtMoney(D(usd).toString(), fx.rate);

  /** Asset display metadata (logo + CoinGecko identity) — presentation only. */
  const assetIds = [...new Set(balances.map((b) => b.assetId).filter((id): id is string => !!id))];
  const assetMetaRows = assetIds.length
    ? await db
        .select({ id: assets.id, logoUrl: assets.logoUrl, coingeckoId: assets.coingeckoId })
        .from(assets)
        .where(inArray(assets.id, assetIds))
    : [];
  const assetMeta = new Map(assetMetaRows.map((row) => [row.id, row]));

  const isIrt = (b: Balance) => b.symbol === "IRT" || b.symbol === "IRR";

  // CURRENCY ISOLATION: a balance is canonical in its own currency; its Toman
  // valuation is derived. IRT = quantity (Toman); USDT/USD = quantity × rate.
  const canonicalBalance = (b: Balance) => {
    const q = D(b.quantity);
    if (b.symbol === "IRT") return formatMoney(q.toFixed(0), "IRT");
    if (b.symbol === "IRR") return formatMoney(q.div(10).toFixed(0), "IRT");
    if (b.symbol === "USDT") return formatMoney(q.toString(), "USDT");
    if (b.symbol === "USD") return formatMoney(q.toString(), "USD");
    return formatMoney(q.toString(), b.symbol ?? "USD");
  };

  const valuationToman = (b: Balance) => {
    if (isIrt(b)) return null; // an IRT balance IS Toman
    if (b.symbol === "USDT" || b.symbol === "USD") {
      return toIrt(D(b.quantity).toString()) ?? formatMoney(D(b.baseValue).toString(), "IRT");
    }
    return toIrt(b.baseValue) ?? null;
  };

  /**
   * Toman value of one account, on EXACTLY the basis its row displays.
   *
   * The page total used to be Σ(USD base value) × today's rate, while every
   * Toman account row shows its canonical Toman quantity — so the headline
   * disagreed with the sum of the rows beneath it whenever the two drifted.
   * Totals are now summed from these per-row figures instead.
   */
  const rate = fx.rate && D(fx.rate).gt(0) ? D(fx.rate) : null;
  const tomanOf = (b: Balance): Decimal | null => {
    if (b.symbol === "IRT") return D(b.quantity);
    if (b.symbol === "IRR") return D(b.quantity).div(10);
    if (!rate) return null;
    return (b.symbol === "USDT" || b.symbol === "USD" ? D(b.quantity) : D(b.baseValue)).mul(rate);
  };
  const tomanTotal = (list: Balance[]): Decimal | null => {
    let sum = Decimal.zero();
    for (const b of list) {
      const t = tomanOf(b);
      if (!t) return null;
      sum = sum.add(t);
    }
    return sum;
  };
  const usdTotal = (list: Balance[]) => list.reduce((s, b) => s.add(b.baseValue), Decimal.zero());

  /**
   * MONEY MODULE SCOPE (audit F-11). LIQUID accounts only — bank, cash box,
   * fund and stablecoin wallets. Investment positions belong to «دارایی‌ها».
   */
  const isInvestmentRow = (b: Balance) => b.type === "asset" && classifyAccountFamily(b) === "investment";
  const moneyAccountsRaw = balances.filter(
    (b) => b.type === "asset" && isLiquidAccount(b) && (!!b.walletName || !D(b.quantity).isZero()),
  );
  const investmentAccounts = balances.filter(isInvestmentRow);
  const moneyById = new Map<string, Balance>();
  for (const row of moneyAccountsRaw) {
    const prev = moneyById.get(row.accountId);
    if (!prev) {
      moneyById.set(row.accountId, row);
      continue;
    }
    moneyById.set(row.accountId, isIrt(row) && !isIrt(prev) ? row : prev);
  }
  const moneyAccounts = [...moneyById.values()];
  const liabilityAccounts = balances.filter((b) => b.type === "liability" && !D(b.baseValue).isZero());
  const controlSum = balances.reduce((s, b) => s.add(b.baseValue), Decimal.zero());
  const ledgerBalanced = controlSum.abs().lt("0.000001");

  const totalToman = tomanTotal(moneyAccounts);
  const totalUsd = usdTotal(moneyAccounts);
  const irtAccounts = moneyAccounts.filter(isIrt);
  const fxAccounts = moneyAccounts.filter((b) => !isIrt(b));
  const irtToman = tomanTotal(irtAccounts) ?? Decimal.zero();
  const fxToman = tomanTotal(fxAccounts);
  const shareOfTotal = (part: Decimal | null) =>
    totalToman && part && totalToman.gt(0) ? `${formatPct(part.div(totalToman).mul(100).toFixed(0), 0)} از کل` : undefined;

  const walletIdByAccount = new Map(walletRows.filter((w) => w.accountId).map((w) => [w.accountId as string, w.id]));
  const byWallet = new Map<string, Balance[]>();
  for (const b of moneyAccounts) {
    const key = walletIdByAccount.get(b.accountId) ?? `account:${b.accountId}`;
    byWallet.set(key, [...(byWallet.get(key) ?? []), b]);
  }

  const walletViews = [...byWallet.entries()]
    .map(([key, rows]) => {
      const meta = walletRows.find((w) => w.id === key);
      // Older setups stored a coin as «کیف پول تتر» with no real wallet. A coin
      // is not a wallet, so such a row reads as the coin itself.
      const legacyCoinWallet = !meta && rows.length === 1 && rows[0]?.assetName && rows[0]?.name === `کیف پول ${rows[0].assetName}`;
      const name =
        cleanDisplayName(legacyCoinWallet ? rows[0].assetName! : (meta?.name ?? rows[0]?.walletName ?? rows[0]?.name ?? "بدون کیف پول")) ||
        "بدون کیف پول";
      return {
        key,
        meta,
        name,
        rows,
        toman: tomanTotal(rows),
        usd: usdTotal(rows),
        subtitle: meta
          ? [
              // A wallet holding one coin names that coin — «Trust Wallet» alone
              // would not say it holds USDC rather than USDT.
              rows.length === 1 && rows[0]?.assetName && !isIrt(rows[0]) ? rows[0].assetName : null,
              walletSubtitleOf({ name, kind: meta.kind, institution: meta.institution ?? null, network: meta.network ?? null }),
            ]
              .filter(Boolean)
              .join(" · ") || null
          : null,
      };
    })
    // Largest balance first — the list reads as «where is most of my money».
    .sort((a, b) => Number((rate ? (b.toman ?? b.usd) : b.usd).sub(rate ? (a.toman ?? a.usd) : a.usd).toString()));

  return (
    <div className="space-y-7">
      <div>
        <PageHeader
          title="حساب‌ها"
          action={
            <Link href="#new-account" className="btn btn-primary">
              <Icon name="plus" size={16} />
              افزودن حساب
            </Link>
          }
        />
        <ModuleTabs tabs={MONEY_TABS} active="/accounts" label="بخش‌های پول" />
      </div>

      {!ledgerBalanced && (
        <Alert
          tone="warn"
          title="ناترازی در سوابق مالی"
          action={
            <Link href="/financial-records" className="btn btn-soft !px-3.5 text-[length:var(--fs-xs)]">
              بررسی
            </Link>
          }
        >
          جمع کنترلی باید صفر باشد:{" "}
          <span className="num" dir="rtl">
            {formatMoney(controlSum.toFixed(2))}
          </span>
        </Alert>
      )}

      <section className="metric-strip">
        <Metric
          label="موجودی کل"
          value={totalToman ? formatMoney(totalToman.toFixed(0), "IRT") : formatMoney(totalUsd.toString())}
          hint={totalToman ? `≈ ${formatMoney(totalUsd.toString())}` : undefined}
        />
        <Metric label="تومانی" value={formatMoney(irtToman.toFixed(0), "IRT")} hint={shareOfTotal(irtToman)} />
        {fxAccounts.length > 0 && (
          <Metric
            label="ارزی"
            value={fxToman ? formatMoney(fxToman.toFixed(0), "IRT") : formatMoney(usdTotal(fxAccounts).toString())}
            hint={fxToman ? `≈ ${formatMoney(usdTotal(fxAccounts).toString())}` : undefined}
          />
        )}
        <Metric label="حساب‌ها" value={faCount(moneyAccounts.length)} hint={`${faCount(byWallet.size)} کیف و بانک`} />
      </section>

      <Section title="کیف‌ها و بانک‌ها">
        {walletViews.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="accounts"
              title="هنوز حساب نقدی ندارید"
              body={
                investmentAccounts.length > 0
                  ? `${faCount(investmentAccounts.length)} حساب سرمایه‌گذاری شما در «دارایی‌ها» است.`
                  : undefined
              }
              action={
                <Link href="#new-account" className="btn btn-soft">
                  افزودن حساب
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="card list-card" role="list">
            {walletViews.map((w) => {
              const single = w.rows.length === 1;
              const first = w.rows[0];
              const firstMeta = first.assetId ? assetMeta.get(first.assetId) : undefined;
              const logoType = w.meta?.kind === "exchange" ? "company" : "bank";
              const brandName = w.meta?.institution ?? w.name;
              // A known crypto wallet (بیت‌پین، لجر، متامسک…) shows its own local logo.
              const walletLogo = w.meta ? walletLogoFor(w.meta.name) : null;
              const useWalletMark =
                !!walletLogo || resolveAssetLogoDetailed({ assetType: logoType, brandName, name: w.name }).source === "persianlabs";
              // A single stablecoin wallet keeps both marks (e.g. Nobitex + Tether).
              const showAssetBadge = single && useWalletMark && !isIrt(first) && (!!firstMeta?.logoUrl || !!firstMeta?.coingeckoId);

              let primary: string;
              let secondary: string | null;
              if (single) {
                const valuation = valuationToman(first);
                primary = valuation ?? canonicalBalance(first);
                secondary = valuation
                  ? canonicalBalance(first)
                  : toIrt(D(first.baseValue).toString())
                    ? `≈ ${formatMoney(D(first.baseValue).toString())}`
                    : null;
              } else {
                primary = w.toman ? formatMoney(w.toman.toFixed(0), "IRT") : formatMoney(w.usd.toString());
                secondary = w.toman && !w.rows.every(isIrt) ? `≈ ${formatMoney(w.usd.toString())}` : null;
              }

              return (
                <li key={w.key}>
                  <div className="list-row">
                    {useWalletMark ? (
                      <span className="acct-icon flex shrink-0 items-center">
                        <AssetLogo
                          assetType={logoType}
                          brandName={brandName}
                          name={w.name}
                          userLogoUrl={walletLogo ?? undefined}
                          size={34}
                          radius={17}
                        />
                        {showAssetBadge && (
                          <span className="wallet-badge">
                            <AssetLogo
                              symbol={first.symbol}
                              name={first.name ?? w.name}
                              logoUrl={firstMeta?.logoUrl ?? null}
                              assetClassName={first.className}
                              coingeckoId={firstMeta?.coingeckoId ?? null}
                              size={18}
                              radius={9}
                            />
                          </span>
                        )}
                      </span>
                    ) : single && (firstMeta?.logoUrl || firstMeta?.coingeckoId || first.symbol) ? (
                      <span className="acct-icon flex shrink-0">
                        <AssetLogo
                          symbol={first.symbol}
                          name={first.name ?? w.name}
                          logoUrl={firstMeta?.logoUrl ?? null}
                          assetClassName={first.className}
                          coingeckoId={firstMeta?.coingeckoId ?? null}
                          size={34}
                          radius={17}
                        />
                      </span>
                    ) : (
                      <span className="flow-icon" aria-hidden="true">
                        <Icon name="wallet" size={15} />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="acct-title text-[length:var(--fs-sm)] font-semibold">{w.name}</p>
                      {w.subtitle && <p className="acct-subtitle muted text-[length:var(--fs-xs)]">{w.subtitle}</p>}
                    </div>
                    <div className="acct-amount shrink-0 text-left">
                      <p className="num money-nowrap text-[length:var(--fs-sm)] font-semibold" dir="rtl">
                        {primary}
                      </p>
                      {secondary && (
                        <p className="acct-secondary muted num money-nowrap text-[length:var(--fs-xs)]" dir="rtl">
                          {secondary}
                        </p>
                      )}
                    </div>
                  </div>
                  {!single && (
                    <ul className="wallet-sub">
                      {w.rows.map((b) => {
                        // Money is formatted on the SERVER; only strings cross
                        // into the client component.
                        const meta = b.assetId ? assetMeta.get(b.assetId) : undefined;
                        return (
                          <AccountListItem
                            key={b.accountId}
                            accountId={b.accountId}
                            // Inside its wallet «تتر - بیت‌پین» reads as «تتر».
                            name={b.name?.endsWith(` - ${w.name}`) ? b.name.slice(0, -` - ${w.name}`.length) : b.name}
                            symbol={b.symbol}
                            quantity={b.quantity}
                            assetDecimals={b.assetDecimals}
                            balanceLabel={canonicalBalance(b)}
                            valuationLabel={valuationToman(b)}
                            baseValueLabel={formatMoney(D(b.baseValue).toString())}
                            walletName={b.walletName}
                            logoUrl={meta?.logoUrl ?? null}
                            assetClassName={b.className}
                            coingeckoId={meta?.coingeckoId ?? null}
                          />
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {liabilityAccounts.length > 0 && (
        <Section title="حساب‌های بدهی" action={<SectionLink href="/debts" label="تعهدات" />}>
          <ul className="card list-card" role="list">
            {liabilityAccounts.map((b) => {
              // Outstanding debt = −baseValue (a liability is stored as a
              // credit). Flipping the sign is meaningful; abs() would render an
              // over-paid liability as a debt of the same size.
              const owed = D(b.baseValue).neg().toString();
              const owedToman = toIrt(owed);
              return (
                <li key={b.accountId} className="list-row">
                  <span className="flow-icon" aria-hidden="true">
                    <Icon name="debts" size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[length:var(--fs-sm)] font-medium">{b.name}</p>
                    {pro && (
                      <p className="muted num text-[length:var(--fs-xs)]" dir="ltr">
                        {toFaDigits(b.code)}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-left">
                    <p className="num money-nowrap text-[length:var(--fs-sm)] font-semibold" dir="rtl">
                      {owedToman ?? formatMoney(owed)}
                    </p>
                    {owedToman && (
                      <p className="muted num money-nowrap text-[length:var(--fs-xs)]" dir="rtl">
                        ≈ {formatMoney(owed)}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {/* The chart of accounts is ledger-grade detail — PRO mode only. */}
      {pro && (
        <Section title="نمودار حساب‌ها">
          <details className="card list-card group">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 marker:hidden [&::-webkit-details-marker]:hidden">
              <span className="text-[length:var(--fs-sm)] font-semibold">درآمد، هزینه، سرمایه و بدهی</span>
              <span className="muted transition-transform group-open:rotate-180">
                <Icon name="chevronDown" size={15} />
              </span>
            </summary>
            <div className="grid gap-6 p-4 sm:grid-cols-2">
              {(["income", "expense", "equity", "liability"] as AccountType[])
                .map((t) => ({ t, rows: balances.filter((b) => b.type === t && !D(b.baseValue).isZero()) }))
                .filter((g) => g.rows.length > 0)
                .map((g) => (
                  <div key={g.t}>
                    <p className="muted mb-2 text-[length:var(--fs-xs)] font-semibold">{ACCOUNT_TYPE_LABELS[g.t]}</p>
                    <ul className="space-y-1.5">
                      {g.rows.map((b) => (
                        <li key={b.accountId} className="flex items-center justify-between gap-3 text-[length:var(--fs-xs)]">
                          <span className="min-w-0 truncate">
                            <span className="muted num ml-1.5">{toFaDigits(b.code)}</span>
                            {b.name}
                          </span>
                          <span className="num shrink-0" dir="rtl">
                            {/* normal-side display: credit accounts are stored
                                negative, so they are flipped, never abs()'d */}
                            {formatMoney(
                              (g.t === "income" || g.t === "equity" || g.t === "liability" ? D(b.baseValue).neg() : D(b.baseValue)).toString(),
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </details>
        </Section>
      )}

      <DisclosurePanel anchor="new-account" label="افزودن حساب یا کیف پول">
        <MoneyAccountForm currencies={currencyRows} usdIrtRate={fx.rate} />
      </DisclosurePanel>
    </div>
  );
}
