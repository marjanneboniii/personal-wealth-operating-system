import { and, asc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { db } from "@/db";
import { accounts, assets, institutions, networks, wallets } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { listMoneyAccountCurrencies } from "@/features/accounts/service";
import { getAccountBalances } from "@/features/ledger/queries";
import { classifyAccountFamily, isLiquidAccount } from "@/features/accounts/classification";
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

/**
 * Wallet-kind chips. Custody jargon is gone from the UI: a software (hot)
 * wallet is simply «کیف پول» — whether the keys sit on a device or with an
 * exchange is an implementation detail the user never has to decode to read
 * their own balances.
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
 * Subtitle under a wallet/bank card title.
 *
 * A bank's own name already carries the word «بانک» («بانک پاسارگاد»,
 * «بانک سامان — سپرده», «بانک تجارت - قرض الحسنه»), so prefixing the
 * `bank` kind label produced «بانک · بانک پاسارگاد» — the same word twice in
 * a row, once in the title and once directly under it. When the kind label is
 * already part of the title it is dropped and only the institution/network that
 * still adds information is kept; if nothing is left, there is no subtitle.
 */
/**
 * Strips a dangling separator from a display name.
 *
 * Wallet/institution names arrive from seeds and user input as «بانک سامان —
 * سپرده», «بانک تجارت - قرض الحسنه» and sometimes with the qualifier deleted
 * but its separator left behind («بانک سامان ·»). Rendered as-is that orphan
 * glyph looks like a stray dot pinned to the account title.
 */
function cleanDisplayName(value: string): string {
  return value.replace(/[\s·•\-—–|,]+$/g, "").replace(/^[\s·•\-—–|,]+/g, "").trim();
}

function walletSubtitleOf(wallet: { name: string | null; kind: string | null; institution: string | null; network: string | null } | undefined) {
  if (!wallet) return null;
  const kindLabel = WALLET_KIND[wallet.kind ?? ""] ?? wallet.kind ?? "";
  const title = wallet.name ?? "";
  const detail = wallet.institution ?? wallet.network ?? "";
  // Never repeat the institution either: «بانک سامان — سپرده» IS «بانک سامان».
  const detailAddsAnything = !!detail && detail !== title && !title.includes(detail);
  const kindAddsAnything = !!kindLabel && !title.includes(kindLabel) && kindLabel !== detail;
  const parts = [kindAddsAnything ? kindLabel : null, detailAddsAnything ? detail : null]
    // A part that is only punctuation/whitespace (a stray «·», «—», «-» left in
    // an institution or wallet name) must not survive: joined with the
    // separator it renders as a lone dot hanging next to the account title.
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
      .where(
        and(
          sql`${wallets.deletedAt} is null`,
          userId ? eq(wallets.userId, userId) : sql`1=1`,
        ),
      )
      .orderBy(asc(wallets.name)),
    getLatestUsdIrtRate(),
  ]);

  /**
   * USD → Toman display helper. NO absolute value: a wallet that is short
   * (overdrawn, or an asset account with a residual debit after a fee-bearing
   * full exit) must READ as short. Masking the sign here is what let a broken
   * balance look like a healthy balance (audit F-06).
   */
  const toIrt = (usd: string | number) => toIrtMoney(D(usd).toString(), fx.rate);

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
    const q = D(b.quantity);
    if (b.symbol === "IRT") return formatMoney(q.toFixed(0), "IRT");
    if (b.symbol === "IRR") return formatMoney(q.div(10).toFixed(0), "IRT");
    if (b.symbol === "USDT") return formatMoney(q.toString(), "USDT");
    if (b.symbol === "USD") return formatMoney(q.toString(), "USD");
    // Fallback for other assets: quantity in its own symbol
    return formatMoney(q.toString(), b.symbol ?? "USD");
  };

  const valuationToman = (b: (typeof balances)[number]) => {
    if (b.symbol === "IRT" || b.symbol === "IRR") return null; // IRT balance IS Toman, no separate valuation needed for primary
    if (b.symbol === "USDT" || b.symbol === "USD") {
      // Toman valuation = canonical qty * current rate (sign preserved)
      return toIrt(D(b.quantity).toString()) ?? formatMoney(D(b.baseValue).toString(), "IRT");
    }
    return toIrt(b.baseValue) ?? null;
  };

  /**
   * MONEY MODULE SCOPE (audit F-11). This page renders LIQUID accounts only:
   * bank / cash box / fund plus stablecoin (USDT, USDC, …) hot & cold wallets —
   * the places money rests. Investment positions (volatile crypto, equities,
   * funds, gold, commodities, real estate, vehicles) belong to the Assets
   * module, which values them (market price, P&L, lots) instead of listing them
   * as balances. The two modules therefore never show the same thing twice.
   */
  const isInvestmentRow = (b: (typeof balances)[number]) =>
    b.type === "asset" && classifyAccountFamily(b) === "investment";
  const moneyAccountsRaw = balances.filter(
    (b) =>
      b.type === "asset" &&
      isLiquidAccount(b) &&
      (!!b.walletName || !D(b.quantity).isZero()),
  );
  const investmentAccounts = balances.filter(isInvestmentRow);
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
      <PageHeader
        title="حساب‌های نقد"
        subtitle="بانک، صندوق و کیف‌پول‌های استیبل‌کوین — همان‌جا که پول نگه‌داشته می‌شود. دارایی‌های سرمایه‌گذاری (رمزارز نوسانی، سهام، طلا، ملک و خودرو) در بخش دارایی‌ها ارزش‌گذاری می‌شوند."
        action={
          <Link
            href="/assets"
            className="inline-flex items-center gap-1 text-[11.5px] font-medium sm:text-[12px]"
            style={{ color: "var(--brand)" }}
          >
            دارایی‌ها و سرمایه‌گذاری
            <Icon name="chevronLeft" size={14} />
          </Link>
        }
      />

      <section className="rise grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-3" style={{ borderColor: "var(--border)" }}>
        <Metric label="ارزش پایه حساب‌های نقد" value={toIrt(totalCash.toString()) ?? formatMoney(totalCash.toString())} hint={fx.rate ? formatMoney(totalCash.toString()) : undefined} />
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
              title="هنوز حساب نقدی فعال نیست"
              body={
                investmentAccounts.length > 0
                  ? `${faCount(investmentAccounts.length)} حساب سرمایه‌گذاری دارید؛ آن‌ها در بخش دارایی‌ها ارزش‌گذاری می‌شوند. برای پول نقد، یک حساب بانکی یا کیف‌پول استیبل‌کوین اضافه کنید.`
                  : "با راه‌اندازی اولیه یا ثبت موجودی، حساب‌های نقد و مانده‌هایشان اینجا نمایش داده می‌شوند."
              }
            />
          </div>
        ) : (
          <div className="space-y-2.5">
            {[...byWallet.entries()].map(([walletKey, rows]) => {
              const walletTotal = rows.reduce((s, b) => s.add(b.baseValue), Decimal.zero());
              const walletMeta = walletRows.find((w) => w.id === walletKey);
              const walletName = cleanDisplayName(
                walletMeta?.name ?? rows[0]?.walletName ?? rows[0]?.name ?? "بدون کیف‌پول",
              ) || "بدون کیف‌پول";
              const irtOnly = rows.every((r) => r.symbol === "IRT" || r.symbol === "IRR");
              const walletPrimary = irtOnly
                ? formatMoney(
                    rows.reduce((s, r) => s.add(r.symbol === "IRR" ? D(r.quantity).div(10) : D(r.quantity)), Decimal.zero()).toFixed(0),
                    "IRT",
                  )
                : toIrt(walletTotal.toString()) ?? formatMoney(walletTotal.toString());
              // Brand mark for the wallet/institution header — display only.
              const walletLogo = resolveAssetLogoDetailed({
                assetType: walletMeta?.kind === "exchange" ? "company" : "bank",
                brandName: walletMeta?.institution ?? walletName,
                name: walletName,
              });
              const walletSubtitle = walletMeta
                ? walletSubtitleOf({
                    name: walletName,
                    kind: walletMeta.kind,
                    institution: walletMeta.institution ?? null,
                    network: walletMeta.network ?? null,
                  })
                : null;
              // ── Single-account wallets: one summary card, no duplicate sub-row.
              // Amounts reuse the exact same helpers (canonicalBalance /
              // valuationToman) — only the redundant header+row split and the
              // «حساب» / «مانده…» labels are gone.
              if (rows.length === 1) {
                const b = rows[0];
                const singleValuation = valuationToman(b);
                const singlePrimary = singleValuation ?? canonicalBalance(b);
                const singleExact = singleValuation ? canonicalBalance(b) : null;
                const singleApprox =
                  !singleValuation && toIrt(D(b.baseValue).toString())
                    ? formatMoney(D(b.baseValue).toString())
                    : null;
                // Single summary keeps both marks when both are informative
                // (e.g. Nobitex wallet + Tether asset) so merging the two
                // rows never loses artwork. Pure flex, no absolute overlay.
                const singleMeta = b.assetId ? assetMeta.get(b.assetId) : undefined;
                const useWalletMark = walletLogo.source === "persianlabs";
                const showAssetBadge =
                  useWalletMark &&
                  b.symbol !== "IRT" &&
                  b.symbol !== "IRR" &&
                  (!!singleMeta?.logoUrl || !!singleMeta?.coingeckoId);
                return (
                  <div key={walletKey} className="acct-card card overflow-hidden">
                    <div className="acct-head flex items-center justify-between gap-3 px-4 py-3.5">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        {useWalletMark ? (
                          <span className="acct-icon flex shrink-0 items-center self-center">
                            <AssetLogo
                              assetType={walletMeta?.kind === "exchange" ? "company" : "bank"}
                              brandName={walletMeta?.institution ?? walletName}
                              name={walletName}
                              size={32}
                              radius={16}
                            />
                            {showAssetBadge && (
                              <span style={{ marginInlineStart: -10, alignSelf: "flex-end", border: "2px solid var(--surface)", borderRadius: 999 }}>
                                <AssetLogo
                                  symbol={b.symbol}
                                  name={b.name ?? walletName}
                                  logoUrl={singleMeta?.logoUrl ?? null}
                                  assetClassName={b.className}
                                  coingeckoId={singleMeta?.coingeckoId ?? null}
                                  size={20}
                                  radius={10}
                                />
                              </span>
                            )}
                          </span>
                        ) : singleMeta?.logoUrl || singleMeta?.coingeckoId || b.symbol ? (
                          <span className="acct-icon flex shrink-0 self-center">
                            <AssetLogo
                              symbol={b.symbol}
                              name={b.name ?? walletName}
                              logoUrl={singleMeta?.logoUrl ?? null}
                              assetClassName={b.className}
                              coingeckoId={singleMeta?.coingeckoId ?? null}
                              size={32}
                              radius={16}
                            />
                          </span>
                        ) : (
                          <span
                            className="acct-icon flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-full"
                            style={{ background: "var(--surface)", color: "var(--brand)", border: "1px solid var(--border)" }}
                          >
                            <Icon name="wallet" size={15} />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="acct-title text-[12.5px] font-semibold sm:text-[13px]">{walletName}</p>
                          {walletSubtitle && <p className="acct-subtitle muted mt-0.5 text-[10.5px] leading-5">{walletSubtitle}</p>}
                        </div>
                      </div>
                      <div className="acct-amount max-w-[48%] shrink-0 text-left">
                        <p className="num money-nowrap text-[12px] font-bold leading-6 sm:text-[13px]" dir="rtl">
                          {singlePrimary}
                        </p>
                        {singleExact && (
                          <p className="acct-secondary muted num money-nowrap mt-0.5 text-[10.5px] leading-5" dir="rtl">
                            {singleExact}
                          </p>
                        )}
                        {!singleExact && singleApprox && (
                          <p className="acct-secondary muted num money-nowrap mt-0.5 text-[10.5px] leading-5" dir="rtl">
                            ≈ {singleApprox}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <div key={walletKey} className="acct-card card overflow-hidden">
                  <div className="acct-head flex items-center justify-between gap-3 px-4 py-3.5" style={{ background: "var(--sunken)" }}>
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      {walletLogo.source === "persianlabs" ? (
                        <span className="acct-icon flex shrink-0 self-center">
                          <AssetLogo
                            assetType={walletMeta?.kind === "exchange" ? "company" : "bank"}
                            brandName={walletMeta?.institution ?? walletName}
                            name={walletName}
                            size={32}
                            radius={16}
                          />
                        </span>
                      ) : (
                        <span
                          className="acct-icon flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-full"
                          style={{ background: "var(--surface)", color: "var(--brand)" }}
                        >
                          <Icon name="wallet" size={15} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="acct-title text-[12px] font-semibold sm:text-[13px]">{walletName}</p>
                        {walletSubtitle && <p className="acct-subtitle muted mt-0.5 text-[10px] leading-5">{walletSubtitle}</p>}
                      </div>
                    </div>
                    <div className="acct-amount max-w-[46%] shrink-0 text-left">
                      <p className="num money-nowrap text-[12px] font-bold leading-6 sm:text-[13px]" dir="rtl">
                        {walletPrimary}
                      </p>
                      {!irtOnly && toIrt(walletTotal.toString()) && <p className="acct-secondary muted num money-nowrap mt-0.5 text-[10.5px] leading-5" dir="rtl">≈ {formatMoney(walletTotal.toString())}</p>}
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
                          baseValueLabel={formatMoney(D(b.baseValue).toString())}
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
                    {/* Outstanding debt = −baseValue (a liability is a credit,
                        hence stored negative). Flipping the sign is meaningful;
                        an absolute value would silently render an over-paid
                        (debit) liability as a debt of the same size. */}
                    <p className="num text-[12px] sm:text-[13px] font-bold money-nowrap" dir="rtl" style={{ color: "var(--negative)" }}>
                      {toIrt(D(b.baseValue).neg().toString()) ?? formatMoney(D(b.baseValue).neg().toString())}
                    </p>
                    {toIrt(D(b.baseValue).neg().toString()) && (
                      <p className="muted num text-[9.5px]" dir="rtl">
                        ≈ {formatMoney(D(b.baseValue).neg().toString())}
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
                            {/* normal-side display: credit accounts are stored
                                negative, so they are flipped, never abs()'d */}
                            {formatMoney(
                              (g.t === "income" || g.t === "equity" || g.t === "liability"
                                ? D(b.baseValue).neg()
                                : D(b.baseValue)
                              ).toString(),
                            )}
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
