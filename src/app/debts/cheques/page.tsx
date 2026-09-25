import Link from "next/link";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { ensureAuth } from "@/lib/authGuard";
import { db } from "@/db";
import { accounts, assets, wallets } from "@/db/schema";
import { getAccountBalances } from "@/features/ledger/queries";
import { CHEQUE_STATUS_LABEL, listCheques, type ChequeRow } from "@/features/cheques/service";
import { upcomingInstallments } from "@/features/planning/service";
import { EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
import DisclosurePanel from "@/components/ui/DisclosurePanel";
import Icon from "@/components/ui/Icon";
import ModuleTabs, { DEBT_TABS } from "@/components/ui/ModuleTabs";
import ChequeForm from "@/components/debts/ChequeForm";
import ChequeRowActions from "@/components/debts/ChequeRowActions";
import { D, Decimal } from "@/domain/decimal";
import { faCount, formatDaysUntil, formatJalaliIso, formatMoney, todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "دفتر چک" };

const STATUS_BADGE: Record<ChequeRow["status"], string> = {
  pending: "badge badge-brand",
  cleared: "badge badge-pos",
  bounced: "badge badge-neg",
  cancelled: "badge badge-neutral",
};

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The transaction form, pre-filled to record this cheque as cleared. */
function clearHref(c: ChequeRow) {
  const q = new URLSearchParams({ chequeId: c.id });
  if (c.direction === "issued" && c.installmentId && c.debtId) {
    q.set("type", "debt_repayment");
    q.set("debtId", c.debtId);
    q.set("installmentId", c.installmentId);
  } else {
    q.set("type", c.direction === "issued" ? "expense" : "income");
  }
  return `/new?${q.toString()}`;
}

function ChequeList({ rows, today }: { rows: ChequeRow[]; today: string }) {
  return (
    <ul className="card plan-list">
      {rows.map((c) => {
        const issued = c.direction === "issued";
        const days = daysBetween(today, c.dueDate);
        const live = c.status === "pending";
        const meta = [
          `سررسید ${formatJalaliIso(c.dueDate)}${live ? ` · ${formatDaysUntil(days)}` : ""}`,
          c.accountName,
          c.installmentSeq != null && c.debtTitle ? `قسط ${faCount(c.installmentSeq)} «${c.debtTitle}»` : null,
          c.bankName,
          c.sayadId ? `صیادی ${faCount(c.sayadId)}` : null,
          c.status === "cleared" && c.clearedDate ? `پاس شد ${formatJalaliIso(c.clearedDate)}` : null,
        ].filter(Boolean);
        return (
          <li key={c.id} className="plan-queue-row flex-wrap">
            <span
              className="plan-icon"
              style={{ background: issued ? "var(--negative-soft)" : "var(--positive-soft)", color: issued ? "var(--negative)" : "var(--positive)" }}
              aria-hidden="true"
            >
              <Icon name={issued ? "arrow-up" : "arrow-down"} size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <b className="flex items-center gap-2 text-[length:var(--fs-sm)]">
                <span className="min-w-0 break-words">
                  {issued ? "در وجه" : "از"} {c.counterparty}
                </span>
                <span className={`${STATUS_BADGE[c.status]} shrink-0`}>{CHEQUE_STATUS_LABEL[c.status]}</span>
              </b>
              <span className="expense-sub block" style={live && days < 0 ? { color: "var(--negative)" } : undefined}>
                {meta.join(" · ")}
              </span>
              {c.note && <span className="expense-sub block">{c.note}</span>}
            </span>
            {/* Beside the name on wide screens; under it on a phone, so the name is never cut. */}
            <span className="num plan-amount money-nowrap shrink-0 max-sm:w-full max-sm:ps-11" dir="rtl" style={{ color: issued ? undefined : "var(--positive)" }}>
              {formatMoney(D(c.amountToman).toFixed(0), "IRT")}
            </span>
            <ChequeRowActions id={c.id} status={c.status} clearHref={clearHref(c)} />
          </li>
        );
      })}
    </ul>
  );
}

export default async function ChequesPage() {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id;
  const today = todayIso();

  if (!userId) {
    return (
      <div className="space-y-5">
        <PageHeader title="دفتر چک" />
        <div className="card">
          <EmptyState icon="lock" title="برای دفتر چک وارد شوید" body="چک‌ها برای هر کاربر جداگانه نگه‌داری می‌شوند." />
        </div>
      </div>
    );
  }

  const [rows, moneyAccounts, insts, balanceRows] = await Promise.all([
    listCheques(userId),
    // Cheques are Toman: the user's own Toman / Rial accounts.
    db
      .select({ id: accounts.id, name: accounts.name, symbol: assets.symbol, walletName: wallets.name, walletKind: wallets.kind })
      .from(accounts)
      .innerJoin(assets, eq(assets.id, accounts.assetId))
      .leftJoin(wallets, eq(wallets.id, accounts.walletId))
      .where(and(eq(accounts.userId, userId), eq(accounts.type, "asset"), isNull(accounts.deletedAt), inArray(assets.symbol, ["IRT", "IRR"])))
      .orderBy(asc(accounts.code)),
    upcomingInstallments(60, userId),
    getAccountBalances(userId).catch(() => []),
  ]);
  const balances = Object.fromEntries(balanceRows.map((b) => [b.accountId, b.quantity]));

  const linked = new Set(rows.filter((r) => r.status === "pending" && r.installmentId).map((r) => r.installmentId));
  const installmentOptions = insts
    .filter((i) => i.direction === "payable" && !linked.has(i.id))
    .map((i) => ({
      id: i.id,
      label: `قسط ${faCount(i.seq)} «${i.debtTitle}» — ${formatJalaliIso(i.dueDate)}`,
      amountToman: i.dueToman,
      dueDate: i.dueDate,
    }));

  const open = rows.filter((r) => r.status === "pending" || r.status === "bounced");
  const closed = rows.filter((r) => r.status === "cleared" || r.status === "cancelled");
  const pendingOf = (dir: "issued" | "received") =>
    Decimal.sum(rows.filter((r) => r.status === "pending" && r.direction === dir).map((r) => r.amountToman));
  const in30 = rows.filter((r) => r.status === "pending" && daysBetween(today, r.dueDate) <= 30);
  const net30 = Decimal.sum(in30.map((r) => (r.direction === "received" ? D(r.amountToman) : D(r.amountToman).neg())));
  const bounced = rows.filter((r) => r.status === "bounced").length;

  return (
    <div className="space-y-7">
      <div>
        <PageHeader
          title="دفتر چک"
          action={
            <Link href="#new" className="btn btn-primary">
              <Icon name="plus" size={16} />
              ثبت چک
            </Link>
          }
        />
        <ModuleTabs tabs={DEBT_TABS} active="/debts/cheques" label="بخش‌های تعهدات" />
      </div>

      <section className="metric-strip">
        <Metric label="چک‌های صادره در جریان" value={formatMoney(pendingOf("issued").toFixed(0), "IRT")} tone="neutral" />
        <Metric label="چک‌های دریافتی در جریان" value={formatMoney(pendingOf("received").toFixed(0), "IRT")} tone="neutral" />
        <Metric
          label="خالص ۳۰ روز آینده"
          value={formatMoney(net30.abs().toFixed(0), "IRT")}
          tone={net30.isNegative() ? "down" : net30.isZero() ? "neutral" : "up"}
          hint={in30.length ? `${faCount(in30.length)} چک · ${net30.isNegative() ? "خروج" : "ورود"} خالص` : "چکی در ۳۰ روز آینده نیست"}
        />
        <Metric label="چک برگشتی" value={faCount(bounced)} tone={bounced > 0 ? "down" : "neutral"} />
      </section>

      <DisclosurePanel anchor="new" label="ثبت چک" defaultOpen={rows.length === 0}>
        <ChequeForm accounts={moneyAccounts} balances={balances} installments={installmentOptions} today={today} />
      </DisclosurePanel>

      <Section title="در جریان و برگشتی" hint={open.length ? `${faCount(open.length)} چک` : undefined}>
        {open.length === 0 ? (
          <div className="card">
            <EmptyState icon="note" title="چک در جریانی ندارید" body="چک‌هایی را که نوشته‌اید یا گرفته‌اید ثبت کنید تا سررسیدشان یادآوری و در پیش‌بینی نقدینگی لحاظ شود." />
          </div>
        ) : (
          <ChequeList rows={open} today={today} />
        )}
      </Section>

      {closed.length > 0 && (
        <Section title="تعیین تکلیف‌شده" hint="پاس‌شده، باطل یا عودت‌داده‌شده">
          <ChequeList rows={closed} today={today} />
        </Section>
      )}

      <p className="expense-sub flex items-center gap-1.5">
        <Icon name="info" size={13} />
        چک در جریان فقط برنامه است. «ثبت پاس شدن» فرم ثبت تراکنش را با مبلغ و حساب چک باز می‌کند و فقط همان وقت در موجودی حساب اثر می‌گذارد.
      </p>
    </div>
  );
}
