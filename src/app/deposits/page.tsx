import { displayAccountName } from "@/lib/assetDisplay";
import { isTomanBankAccount } from "@/features/accounts/classification";
import Link from "next/link";
import { and, asc, eq, isNull } from "drizzle-orm";
import { ensureAuth } from "@/lib/authGuard";
import { db } from "@/db";
import { accounts, assets, wallets } from "@/db/schema";
import { getAccountBalances } from "@/features/ledger/queries";
import { listDeposits, type DepositRow } from "@/features/deposits/service";
import { EmptyState, PageHeader, Progress, Section } from "@/components/ui/Card";
import MoneyHeader from "@/components/money/MoneyHeader";
import StatCard from "@/components/money/StatCard";
import FormattedMoney from "@/components/ui/FormattedMoney";
import DepositComposer from "@/components/deposits/DepositComposer";
import Icon from "@/components/ui/Icon";
import DepositRowActions from "@/components/deposits/DepositRowActions";
import { D, Decimal } from "@/domain/decimal";
import { faCount, formatDaysUntil, formatJalaliIso, formatMoney, formatPct, todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "سپرده‌ها" };

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function DepositList({ rows, today }: { rows: DepositRow[]; today: string }) {
  return (
    <ul className="mny-deposits">
      {rows.map((d) => {
        const active = d.status === "active";
        const toMaturity = d.maturityDate ? daysBetween(today, d.maturityDate) : null;
        // How far along the term is — from the start date to maturity.
        const term = d.maturityDate ? daysBetween(d.startDate, d.maturityDate) : null;
        const elapsed = term && term > 0 ? Math.max(0, Math.min(100, (daysBetween(d.startDate, today) / term) * 100)) : null;
        return (
          <li key={d.id} className="card mny-deposit" data-status={d.status}>
            <div className="mny-deposit-head">
              <span className="mny-stat-icon" aria-hidden="true">
                <Icon name="coins" size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="mny-deposit-title">
                  <span className="min-w-0 break-words">{d.title}</span>
                  <span className={`badge ${active ? "badge-brand" : "badge-neutral"} shrink-0`}>
                    {active ? (d.kind === "fund" ? "صندوق" : "سپرده") : "بسته‌شده"}
                  </span>
                </p>
                <p className="mny-deposit-sub">{displayAccountName(d.institution || d.accountName || "—")}</p>
              </div>
            </div>
            <div className="mny-deposit-figures">
              <p className="mny-deposit-principal" dir="rtl">
                <FormattedMoney value={formatMoney(D(d.principalToman).toFixed(0), "IRT")} />
              </p>
              <span className="mny-delta" data-tone="up">
                + <span className="num money-nowrap" dir="rtl">{formatMoney(d.monthlyInterestToman, "IRT")}</span> در ماه
              </span>
            </div>
            {active && elapsed != null && toMaturity != null && (
              <div className="mny-deposit-term">
                <Progress value={elapsed} color={toMaturity < 0 ? "var(--negative)" : "var(--positive)"} aria-label="گذشت مدت سپرده تا سررسید" />
                <p>
                  <span>سررسید {formatJalaliIso(d.maturityDate!)}</span>
                  <span style={toMaturity < 0 ? { color: "var(--negative)" } : undefined}>{formatDaysUntil(toMaturity)}</span>
                </p>
              </div>
            )}
            <dl className="mny-deposit-facts">
              <div>
                <dt>نرخ سالانه</dt>
                <dd className="num">{formatPct(D(d.annualRate).toFixed(2), 2)}</dd>
              </div>
              {!(active && elapsed != null) && (
                <div>
                  <dt>سررسید</dt>
                  <dd>{d.maturityDate ? formatJalaliIso(d.maturityDate) : "بدون سررسید"}</dd>
                </div>
              )}
              <div>
                <dt>سود بعدی</dt>
                <dd>{active && d.nextPayoutDate ? formatJalaliIso(d.nextPayoutDate) : "—"}</dd>
              </div>
              <div>
                <dt>حساب دریافت سود</dt>
                <dd>{displayAccountName(d.payoutAccountName || d.accountName || "—")}</dd>
              </div>
            </dl>
            <DepositRowActions id={d.id} active={active} nextPlanId={d.nextPlanId} />
          </li>
        );
      })}
    </ul>
  );
}

export default async function DepositsPage() {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id;
  const today = todayIso();

  if (!userId) {
    return (
      <div className="space-y-5">
        <PageHeader title="سپرده‌ها" />
        <div className="card">
          <EmptyState icon="lock" title="برای سپرده‌ها وارد شوید" body="سپرده‌ها برای هر کاربر جداگانه نگه‌داری می‌شوند." />
        </div>
      </div>
    );
  }

  const [rows, accountRows, balanceRows] = await Promise.all([
    listDeposits(userId),
    db
      .select({ id: accounts.id, name: accounts.name, symbol: assets.symbol, decimals: assets.decimals, walletName: wallets.name, walletKind: wallets.kind })
      .from(accounts)
      .innerJoin(assets, eq(assets.id, accounts.assetId))
      .leftJoin(wallets, eq(wallets.id, accounts.walletId))
      .where(and(eq(accounts.userId, userId), eq(accounts.type, "asset"), eq(accounts.isActive, true), isNull(assets.deletedAt), isNull(accounts.deletedAt)))
      .orderBy(asc(accounts.code)),
    getAccountBalances(userId).catch(() => []),
  ]);
  const accountOptions = accountRows.filter(isTomanBankAccount).map((a) => ({ ...a, toman: ["IRT", "IRR"].includes((a.symbol ?? "").toUpperCase()) }));
  const balances = Object.fromEntries(balanceRows.map((b) => [b.accountId, b.quantity]));

  const active = rows.filter((r) => r.status === "active");
  const closed = rows.filter((r) => r.status === "closed");
  const principal = Decimal.sum(active.map((r) => r.principalToman));
  const monthly = Decimal.sum(active.map((r) => r.monthlyInterestToman));
  const weightedRate = principal.gt(0) ? Decimal.sum(active.map((r) => D(r.principalToman).mul(r.annualRate))).div(principal) : null;
  const soon = active.filter((r) => r.maturityDate && daysBetween(today, r.maturityDate) <= 30);

  return (
    <div className="finance-page deposits-page mny-page">
      <MoneyHeader
        title="سپرده‌ها"
        active="/deposits"
        actions={<DepositComposer accounts={accountOptions} balances={balances} today={today} listenToHash />}
      />

      {active.length > 0 ? (
        <>
          <section className="mny-stats" style={{ ["--mny-cols" as string]: 5 }} aria-label="خلاصه سپرده‌ها">
            <StatCard
              tone="ink"
              className="mny-stat-lead"
              icon="coins"
              label="اصل سپرده‌های فعال"
              period={`${faCount(active.length)} سپرده`}
              value={<FormattedMoney value={formatMoney(principal.toFixed(0), "IRT")} />}
            />
            <StatCard
              tone="positive"
              icon="trend-up"
              label="سود ماهانه"
              period="اصل × نرخ ÷ ۱۲"
              value={<FormattedMoney value={formatMoney(monthly.toFixed(0), "IRT")} />}
            />
            <StatCard
              icon="pie"
              label="میانگین نرخ سالانه"
              period="وزنی بر اساس مبلغ"
              value={weightedRate ? formatPct(weightedRate.toFixed(2), 2) : "—"}
            />
            <StatCard
              tone={soon.length ? "negative" : "plain"}
              icon="calendar"
              label="سررسید نزدیک"
              period="گذشته یا تا ۳۰ روز آینده"
              value={faCount(soon.length)}
            />
          </section>

          <Section title="سپرده‌های فعال" hint={`${faCount(active.length)} مورد`}>
            <DepositList rows={active} today={today} />
          </Section>
        </>
      ) : (
        // Nothing to total yet: no row of «۰» cards, one clear way in.
        <div className="card">
          <EmptyState
            icon="coins"
            title="سپرده‌ی فعالی ندارید"
            body="سپرده‌ی بانکی یا صندوقی که سود ماهانه می‌دهد را ثبت کنید تا سودش هر ماه یادآوری و در پیش‌بینی نقدینگی لحاظ شود."
            action={<DepositComposer accounts={accountOptions} balances={balances} today={today} className="btn btn-soft" />}
          />
        </div>
      )}

      {closed.length > 0 && (
        <details className="deposit-archive">
          <summary>سپرده‌های بسته‌شده · {faCount(closed.length)} مورد</summary>
          <Section title="بسته‌شده">
            <DepositList rows={closed} today={today} />
          </Section>
        </details>
      )}

      <p className="expense-sub flex items-center gap-1.5">
        <Icon name="info" size={13} />
        ثبت سپرده چیزی از موجودی حساب‌ها کم یا زیاد نمی‌کند: اصل پول در حساب خودش است و سود هر ماه فقط با «ثبت سود این ماه» ثبت می‌شود.
      </p>
    </div>
  );
}
