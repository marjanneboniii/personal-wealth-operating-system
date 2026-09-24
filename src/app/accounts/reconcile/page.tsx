import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureAuth } from "@/lib/authGuard";
import { listReconciliation, type AccountReconciliation } from "@/features/reconcile/service";
import { EmptyState, PageHeader } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import { listSmsConnections } from "@/features/bankImport/sms";
import ModuleTabs, { MONEY_TABS } from "@/components/ui/ModuleTabs";
import ReconcileRow, { type ReconcileRowView } from "@/components/accounts/ReconcileRow";
import { D } from "@/domain/decimal";
import { faCount, formatJalaliIso, formatMoney, todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "تطبیق با بانک" };

const money = (value: string, symbol: string) => {
  const s = symbol.toUpperCase();
  if (s === "IRT") return formatMoney(D(value).toFixed(0), "IRT");
  if (s === "IRR") return formatMoney(D(value).div(10).toFixed(0), "IRT");
  return formatMoney(D(value).toString(), s);
};

function view(r: AccountReconciliation, today: string): ReconcileRowView {
  const s = r.symbol.toUpperCase();
  const toman = s === "IRT";
  const diff = r.difference ? D(r.difference) : null;
  const abs = diff ? diff.abs().toString() : null;
  // bank < books → something left the account that the books do not know about.
  const missingType = diff?.isNegative() ? "expense" : "income";
  const hint = diff ? (diff.isNegative() ? "احتمالاً یک خرید یا کارمزد ثبت نشده." : "احتمالاً یک واریز یا سود ثبت نشده.") : null;
  const missingHref =
    r.state === "mismatch" && toman && abs && r.checkpoint
      ? `/new?${new URLSearchParams({
          type: missingType,
          accountId: r.accountId,
          irtAmount: D(abs).toFixed(0),
          entryDate: r.checkpoint.asOf,
        }).toString()}`
      : null;
  return {
    accountId: r.accountId,
    name: r.name,
    state: r.state,
    stale: r.stale,
    ledgerNowLabel: money(r.ledgerNow, s),
    bankLabel: r.checkpoint ? money(r.checkpoint.balance, s) : null,
    bankMeta: r.checkpoint ? `${r.checkpoint.source === "sms" ? "پیامک" : "دستی"} ${formatJalaliIso(r.checkpoint.asOf)}` : null,
    differenceLabel: diff && r.state === "mismatch" ? `${diff.isNegative() ? "−" : "+"}${money(abs!, s)}` : null,
    hint,
    checkpointId: r.checkpoint && !r.checkpoint.resolutionEntryId ? r.checkpoint.id : null,
    missingHref,
    unit: toman || s === "IRR" ? "toman" : s === "USDT" ? "usdt" : "usd",
    today,
  };
}

export default async function ReconcilePage() {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id ?? null;
  const today = todayIso();
  const [list, pendingSms, smsLinked] = userId
    ? await Promise.all([
        listReconciliation(userId, today),
        db
          .execute(sql`select count(*)::int as n from bank_sms_inbox where user_id = ${userId}::uuid and status in ('pending','processing')`)
          .then((r) => Number((r.rows[0] as { n?: number })?.n ?? 0))
          .catch(() => 0),
        listSmsConnections(userId)
          .then((c) => c.length > 0)
          .catch(() => false),
      ])
    : [[], 0, false];

  const mismatched = list.filter((r) => r.state === "mismatch");
  const matched = list.filter((r) => r.state === "matched");
  const unchecked = list.filter((r) => r.state === "unchecked");
  // Differences first — that is what the page is for.
  const ordered = [...mismatched, ...unchecked, ...matched];

  return (
    <div className="space-y-6">
      <div>
        <PageHeader title="تطبیق با بانک" subtitle="موجودی توازن را با بانک مقایسه کنید." />
        <ModuleTabs tabs={MONEY_TABS} active="/accounts" label="بخش‌های پول" />
      </div>

      {/* The easy way first: a bank SMS carries «مانده», and every one is compared by itself. */}
      {!smsLinked ? (
        <Link href="/transactions/import#sms-iphone" className="recon-sms">
          <span className="recon-sms-icon" aria-hidden="true">
            <Icon name="phone" size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[length:var(--fs-sm)]">تطبیق خودکار با پیامک</b>
            <span className="muted block text-[length:var(--fs-xs)] leading-5">مانده‌ی هر پیامک بانک، خودش مقایسه می‌شود.</span>
          </span>
          <span className="btn btn-primary !min-h-9 shrink-0 !px-3 text-[length:var(--fs-xs)]">اتصال</span>
        </Link>
      ) : pendingSms > 0 ? (
        <Link href="/transactions/import#sms-inbox" className="recon-sms">
          <span className="recon-sms-icon" aria-hidden="true">
            <Icon name="bell" size={18} />
          </span>
          <b className="min-w-0 flex-1 text-[length:var(--fs-sm)]">{faCount(pendingSms)} پیامک منتظر تأیید</b>
          <Icon name="chevronLeft" size={16} />
        </Link>
      ) : null}

      {ordered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="accounts"
            title="حساب پولی برای تطبیق ندارید"
            action={
              <Link href="/accounts#new-account" className="btn btn-soft">
                افزودن حساب
              </Link>
            }
          />
        </div>
      ) : (
        <section>
          <p className="recon-summary" aria-label="وضعیت حساب‌ها">
            {mismatched.length > 0 && <span className="is-warn">{faCount(mismatched.length)} اختلاف</span>}
            {matched.length > 0 && <span className="is-ok">{faCount(matched.length)} یکی</span>}
            {unchecked.length > 0 && <span>{faCount(unchecked.length)} تطبیق‌نشده</span>}
          </p>
          <ul className="card list-card" role="list">
            {ordered.map((r) => (
              <ReconcileRow key={r.accountId} row={view(r, today)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
