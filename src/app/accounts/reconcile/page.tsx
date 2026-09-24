import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureAuth } from "@/lib/authGuard";
import { listReconciliation, type AccountReconciliation } from "@/features/reconcile/service";
import { Alert, EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
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
  const hint = diff
    ? diff.isNegative()
      ? "بانک کمتر از توازن نشان می‌دهد؛ احتمالاً یک برداشت، خرید یا کارمزد ثبت نشده است."
      : "بانک بیشتر از توازن نشان می‌دهد؛ احتمالاً یک واریز یا سود بانکی ثبت نشده است."
    : null;
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
    bankMeta: r.checkpoint ? `${r.checkpoint.source === "sms" ? "پیامک" : "ثبت دستی"} ${formatJalaliIso(r.checkpoint.asOf)}` : null,
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
  const [list, pendingSms] = userId
    ? await Promise.all([
        listReconciliation(userId, today),
        db
          .execute(sql`select count(*)::int as n from bank_sms_inbox where user_id = ${userId}::uuid and status in ('pending','processing')`)
          .then((r) => Number((r.rows[0] as { n?: number })?.n ?? 0))
          .catch(() => 0),
      ])
    : [[], 0];

  const mismatched = list.filter((r) => r.state === "mismatch");
  const matched = list.filter((r) => r.state === "matched");
  const unchecked = list.filter((r) => r.state === "unchecked");
  // Differences first — that is what the page is for.
  const ordered = [...mismatched, ...unchecked, ...matched];

  return (
    <div className="space-y-7">
      <div>
        <PageHeader
          title="تطبیق با بانک"
          subtitle="موجودی هر حساب را با عددی که بانک نشان می‌دهد مقایسه کنید. پیامک‌های بانکی دارای «مانده» خودکار مقایسه می‌شوند."
        />
        <ModuleTabs tabs={MONEY_TABS} active="/accounts" label="بخش‌های پول" />
      </div>

      {pendingSms > 0 && mismatched.length > 0 && (
        <Alert
          tone="info"
          icon="info"
          title={`${faCount(pendingSms)} پیامک بانکی هنوز ثبت نشده است`}
          action={
            <Link href="/transactions/import" className="btn btn-soft !px-3.5 text-[length:var(--fs-xs)]">
              بازبینی
            </Link>
          }
        >
          بخشی از اختلاف‌ها ممکن است با ثبت همین پیامک‌ها برطرف شود.
        </Alert>
      )}

      <section className="metric-strip">
        <Metric label="یکی با بانک" value={faCount(matched.length)} />
        <Metric label="اختلاف دارد" value={faCount(mismatched.length)} />
        <Metric label="تطبیق نشده" value={faCount(unchecked.length)} />
      </section>

      <Section title="حساب‌ها">
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
          <ul className="card list-card" role="list">
            {ordered.map((r) => (
              <ReconcileRow key={r.accountId} row={view(r, today)} />
            ))}
          </ul>
        )}
        <p className="muted mt-3 text-[length:var(--fs-xs)]">
          موجودی توازن تا پایان همان روز با عدد بانک مقایسه می‌شود. با ثبت تراکنش جاافتاده، اختلاف خودبه‌خود برطرف می‌شود. «اصلاح موجودی» فقط وقتی است که منشأ اختلاف را نمی‌دانید؛ این سند هزینه یا درآمد حساب نمی‌شود.
        </p>
      </Section>
    </div>
  );
}
