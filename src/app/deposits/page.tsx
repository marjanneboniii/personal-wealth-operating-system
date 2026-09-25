import Link from "next/link";
import { and, asc, eq, isNull } from "drizzle-orm";
import { ensureAuth } from "@/lib/authGuard";
import { db } from "@/db";
import { accounts, assets, wallets } from "@/db/schema";
import { getAccountBalances } from "@/features/ledger/queries";
import { listDeposits, type DepositRow } from "@/features/deposits/service";
import { EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
import DisclosurePanel from "@/components/ui/DisclosurePanel";
import Icon from "@/components/ui/Icon";
import ModuleTabs, { MONEY_TABS } from "@/components/ui/ModuleTabs";
import DepositForm from "@/components/deposits/DepositForm";
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
    <ul className="card plan-list">
      {rows.map((d) => {
        const active = d.status === "active";
        const toMaturity = d.maturityDate ? daysBetween(today, d.maturityDate) : null;
        const meta = [
          d.institution,
          `${formatPct(D(d.annualRate).toFixed(2), 2)} سالانه`,
          d.maturityDate ? `سررسید ${formatJalaliIso(d.maturityDate)}${active && toMaturity != null ? ` · ${formatDaysUntil(toMaturity)}` : ""}` : "بدون سررسید",
          active && d.nextPayoutDate ? `سود بعدی ${formatJalaliIso(d.nextPayoutDate)}` : null,
          d.payoutAccountName && d.payoutAccountId !== d.accountId ? `واریز سود به ${d.payoutAccountName}` : d.accountName,
        ].filter(Boolean);
        return (
          <li key={d.id} className="plan-queue-row flex-wrap">
            <span className="plan-icon" style={{ background: "var(--info-soft)", color: "var(--info)" }} aria-hidden="true">
              <Icon name="coins" size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <b className="flex items-center gap-2 text-[length:var(--fs-sm)]">
                <span className="min-w-0 break-words">{d.title}</span>
                <span className={`badge ${active ? "badge-brand" : "badge-neutral"} shrink-0`}>
                  {active ? (d.kind === "fund" ? "صندوق" : "سپرده") : "بسته‌شده"}
                </span>
              </b>
              <span className="expense-sub block" style={active && toMaturity != null && toMaturity < 0 ? { color: "var(--negative)" } : undefined}>
                {meta.join(" · ")}
              </span>
            </span>
            {/* Beside the title on wide screens; under it on a phone, so the name is never cut. */}
            <span className="flex shrink-0 flex-col items-end max-sm:w-full max-sm:items-start max-sm:ps-11">
              <span className="num plan-amount money-nowrap" dir="rtl">
                {formatMoney(D(d.principalToman).toFixed(0), "IRT")}
              </span>
              <span className="num text-[length:var(--fs-xs)]" dir="rtl" style={{ color: "var(--positive)" }}>
                + {formatMoney(d.monthlyInterestToman, "IRT")} در ماه
              </span>
            </span>
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
      .where(and(eq(accounts.userId, userId), eq(accounts.type, "asset"), isNull(accounts.deletedAt)))
      .orderBy(asc(accounts.code)),
    getAccountBalances(userId).catch(() => []),
  ]);
  const accountOptions = accountRows.map((a) => ({ ...a, toman: ["IRT", "IRR"].includes((a.symbol ?? "").toUpperCase()) }));
  const balances = Object.fromEntries(balanceRows.map((b) => [b.accountId, b.quantity]));

  const active = rows.filter((r) => r.status === "active");
  const closed = rows.filter((r) => r.status === "closed");
  const principal = Decimal.sum(active.map((r) => r.principalToman));
  const monthly = Decimal.sum(active.map((r) => r.monthlyInterestToman));
  const weightedRate = principal.gt(0) ? Decimal.sum(active.map((r) => D(r.principalToman).mul(r.annualRate))).div(principal) : null;
  const soon = active.filter((r) => r.maturityDate && daysBetween(today, r.maturityDate) <= 30);

  return (
    <div className="space-y-7">
      <div>
        <PageHeader
          title="سپرده‌ها"
          action={
            <Link href="#new" className="btn btn-primary">
              <Icon name="plus" size={16} />
              ثبت سپرده
            </Link>
          }
        />
        <ModuleTabs tabs={MONEY_TABS} active="/deposits" label="بخش‌های پول" />
      </div>

      <section className="metric-strip">
        <Metric label="اصل سپرده‌های فعال" value={formatMoney(principal.toFixed(0), "IRT")} tone="neutral" />
        <Metric label="سود ماهانه" value={formatMoney(monthly.toFixed(0), "IRT")} tone={monthly.gt(0) ? "up" : "neutral"} hint="تخمین: اصل × نرخ ÷ ۱۲" />
        <Metric label="میانگین نرخ سالانه" value={weightedRate ? formatPct(weightedRate.toFixed(2), 2) : "—"} tone="neutral" hint="وزنی بر اساس مبلغ" />
        <Metric label="سررسید ۳۰ روز آینده" value={faCount(soon.length)} tone={soon.length ? "down" : "neutral"} />
      </section>

      <DisclosurePanel anchor="new" label="ثبت سپرده" defaultOpen={rows.length === 0}>
        <DepositForm accounts={accountOptions} balances={balances} today={today} />
      </DisclosurePanel>

      <Section title="سپرده‌های فعال" hint={active.length ? `${faCount(active.length)} مورد` : undefined}>
        {active.length === 0 ? (
          <div className="card">
            <EmptyState icon="coins" title="سپرده‌ی فعالی ندارید" body="سپرده‌ی بانکی یا صندوقی که سود ماهانه می‌دهد را ثبت کنید تا سودش هر ماه یادآوری و در پیش‌بینی نقدینگی لحاظ شود." />
          </div>
        ) : (
          <DepositList rows={active} today={today} />
        )}
      </Section>

      {closed.length > 0 && (
        <Section title="بسته‌شده">
          <DepositList rows={closed} today={today} />
        </Section>
      )}

      <p className="expense-sub flex items-center gap-1.5">
        <Icon name="info" size={13} />
        ثبت سپرده چیزی از موجودی حساب‌ها کم یا زیاد نمی‌کند: اصل پول در حساب خودش است و سود هر ماه فقط با «ثبت سود این ماه» ثبت می‌شود.
      </p>
    </div>
  );
}
