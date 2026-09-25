import { asc, eq, sql } from "drizzle-orm";
import { ensureAuth } from "@/lib/authGuard";
import { db } from "@/db";
import { accounts, assets, wallets } from "@/db/schema";
import { getAccountBalances } from "@/features/ledger/queries";
import { seedIfEmpty } from "@/db/seed";
import { listEvents, listFunds, listGoals, listObligations } from "@/features/planning/service";
import { EmptyState, Metric, PageHeader, Progress, Section } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import { AddGoalButton } from "@/components/planning/AddPlanningSheet";
import {
  formatJalaliIso,
  formatPct,
  faCount,
  formatTomanPrimary,
  sumToman,
  todayIso,
} from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export const metadata = { title: "اهداف و صندوق‌ها" };

const FUND_KIND: Record<string, string> = {
  emergency: "اضطراری",
  reserve: "ذخیره",
  family_support: "خانواده",
};

const EVENT_CATEGORY: Record<string, string> = {
  trip: "سفر",
  ceremony: "مراسم",
  gift: "هدیه",
  purchase: "خرید بزرگ",
  other: "سایر",
};

/**
 * اهداف و صندوق‌ها — «چقدر نزدیکم؟» in three plain lists.
 *
 * Presentation only: the read model and `createGoalAction` /
 * `createEventAction` are untouched, so every Toman figure stays contractual.
 */
export default async function GoalsPage() {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id;
  await seedIfEmpty();
  const [goals, funds, events, obligations, accountRows, fx, balanceRows] = await Promise.all([
    listGoals(),
    listFunds(),
    listEvents(),
    listObligations(),
    db
      .select({
        id: accounts.id,
        code: accounts.code,
        name: accounts.name,
        symbol: assets.symbol,
        decimals: assets.decimals,
        logoUrl: assets.logoUrl,
        walletName: wallets.name,
        walletKind: wallets.kind,
      })
      .from(accounts)
      .leftJoin(assets, eq(assets.id, accounts.assetId))
      .leftJoin(wallets, eq(wallets.id, accounts.walletId))
      // Only this user's accounts — never another tenant's.
      .where(sql`${accounts.deletedAt} is null and ${accounts.assetId} is not null${userId ? sql` and ${accounts.userId} = ${userId}` : sql``}`)
      .orderBy(asc(accounts.code)),
    getLatestUsdIrtRate(),
    getAccountBalances(userId).catch(() => []),
  ]);
  const balances = Object.fromEntries(balanceRows.map((b) => [b.accountId, b.quantity]));

  const activeGoals = goals.filter((g) => g.status === "active");
  // targetBase / targetToman = contractual Toman (never moves with FX).
  const totalTargetToman = sumToman(activeGoals.map((g) => g.targetToman ?? g.targetBase));
  const totalSavedToman = sumToman(activeGoals.map((g) => g.savedToman ?? g.savedBase));
  const overall = Number(totalTargetToman) ? Math.min(100, (Number(totalSavedToman) / Number(totalTargetToman)) * 100) : 0;
  const savedDisp = formatTomanPrimary(totalSavedToman, fx.rate);
  const targetDisp = formatTomanPrimary(totalTargetToman, fx.rate);

  const upcoming = [
    ...events.map((e) => ({
      id: e.id,
      title: e.name,
      date: e.eventDate,
      amountToman: e.budgetToman ?? e.budgetBase,
      badge: EVENT_CATEGORY[e.category] ?? "رویداد",
      recurrence: null as string | null,
    })),
    ...obligations.map((o) => ({
      id: o.id,
      title: o.title,
      date: o.dueDate,
      amountToman: o.amountToman ?? o.amountBase,
      badge: "تعهد",
      recurrence: o.recurrence,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const addProps = {
    accounts: accountRows,
    balances,
    today: todayIso(),
    rate: fx.rate,
    rateDate: fx.effectiveDate,
    rateSource: fx.source,
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="اهداف و صندوق‌ها"
        subtitle="مبلغ تومان هدف و صندوق ثابت است؛ معادل دلاری فقط نمایشی است و با نرخ روز تغییر می‌کند."
        action={<AddGoalButton {...addProps} />}
      />

      {activeGoals.length > 0 && (
        <>
          <section className="metric-strip">
            <Metric label="اهداف فعال" value={faCount(activeGoals.length)} />
            <Metric label="رسیده" value={faCount(goals.filter((g) => g.status === "reached").length)} tone="up" />
            <Metric label="صندوق‌های اختصاصی" value={faCount(funds.length)} />
            <Metric label="رویدادهای پیش‌رو" value={faCount(events.filter((e) => e.status === "planned").length)} />
          </section>

          <section className="card expense-card">
            <header className="expense-head">
              <h2>پیشرفت مجموع اهداف فعال</h2>
              <span className="num text-[length:var(--fs-sm)] font-bold money-nowrap" dir="rtl">
                {savedDisp.primary} <span className="muted font-normal">از {targetDisp.primary}</span>
              </span>
            </header>
            <Progress value={overall} aria-label="پیشرفت مجموع اهداف فعال" />
            {(savedDisp.usdHint || targetDisp.usdHint) && (
              <p className="expense-sub num" dir="rtl">
                معادل {savedDisp.usdHint ?? "—"} از {targetDisp.usdHint ?? "—"}
              </p>
            )}
          </section>
        </>
      )}

      <Section title="اهداف مالی">
        {goals.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="goals"
              title="هنوز هدفی تعریف نشده است"
              body="یک هدف یعنی مبلغی مشخص تا تاریخی مشخص — پیشرفت آن از حساب پس‌اندازش خوانده می‌شود."
              action={<AddGoalButton {...addProps} label="تعریف اولین هدف" variant="soft" />}
            />
          </div>
        ) : (
          <ul className="card plan-list">
            {goals.map((g) => {
              const done = g.status === "reached";
              const savedD = formatTomanPrimary(g.savedToman ?? g.savedBase, fx.rate);
              const targetD = formatTomanPrimary(g.targetToman ?? g.targetBase, fx.rate);
              const remD = formatTomanPrimary(g.remainingToman ?? g.remainingBase, fx.rate);
              return (
                <li key={g.id} className="plan-row">
                  <div className="plan-row-head">
                    <span className="plan-row-title">
                      {done && (
                        <span style={{ color: "var(--positive)" }} aria-hidden="true">
                          <Icon name="check-circle" size={15} />
                        </span>
                      )}
                      <b className="truncate">{g.name}</b>
                      <span className="badge badge-neutral">
                        اولویت {g.priority === 1 ? "بالا" : g.priority === 2 ? "متوسط" : "پایین"}
                      </span>
                    </span>
                    <span className="shrink-0 text-left">
                      <span className="num block money-nowrap" dir="rtl">
                        <b className="plan-amount">{savedD.primary}</b>{" "}
                        <span className="muted text-[length:var(--fs-xs)]">از {targetD.primary}</span>
                      </span>
                      {savedD.usdHint && (
                        <span className="muted num block text-[length:var(--fs-xs)]" dir="rtl">
                          معادل {savedD.usdHint}
                        </span>
                      )}
                    </span>
                  </div>
                  <Progress value={g.progress} color={done ? "var(--positive)" : "var(--action)"} aria-label={`پیشرفت ${g.name}`} />
                  <div className="plan-row-foot">
                    <span className="num" dir="rtl">
                      {formatPct(g.progress, 0)}
                      {g.targetDate ? ` · تا ${formatJalaliIso(g.targetDate)}` : ""}
                    </span>
                    <span>{done ? "تبریک — به این هدف رسیدید" : `${remD.primary} مانده`}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Section title="صندوق‌های اختصاصی" hint="پول‌های کنارگذاشته‌شده برای منظور مشخص">
          {funds.length === 0 ? (
            <p className="card expense-empty">صندوقی تعریف نشده است.</p>
          ) : (
            <ul className="card plan-list">
              {funds.map((f) => {
                const savedD = formatTomanPrimary(f.savedToman ?? f.savedBase, fx.rate);
                const targetD = formatTomanPrimary(f.targetToman ?? f.targetBase, fx.rate);
                return (
                  <li key={f.id} className="plan-row">
                    <div className="plan-row-head">
                      <span className="plan-row-title">
                        <b className="truncate">{f.name}</b>
                        <span className="badge badge-neutral">{FUND_KIND[f.kind] ?? f.kind}</span>
                      </span>
                      <span className="num shrink-0 money-nowrap" dir="rtl">
                        <b className="plan-amount">{savedD.primary}</b>{" "}
                        <span className="muted text-[length:var(--fs-xs)]">از {targetD.primary}</span>
                      </span>
                    </div>
                    <Progress value={f.progress} color="var(--info)" aria-label={`پیشرفت ${f.name}`} />
                    {f.note && <p className="plan-row-foot">{f.note}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="رویدادها و تعهدات" hint="هزینه‌های از پیش‌دانسته آینده — مبلغ تومان ثابت">
          {upcoming.length === 0 ? (
            <p className="card expense-empty">رویداد یا تعهدی ثبت نشده است.</p>
          ) : (
            <ul className="card plan-list">
              {upcoming.map((x) => {
                const disp = formatTomanPrimary(x.amountToman, fx.rate);
                return (
                  <li key={x.id} className="plan-row">
                    <div className="plan-row-head">
                      <span className="plan-row-title">
                        <b className="truncate">{x.title}</b>
                        <span className="badge badge-neutral">{x.badge}</span>
                        {x.recurrence && x.recurrence !== "none" && (
                          <span className="badge badge-info">{x.recurrence === "monthly" ? "ماهانه" : "سالانه"}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-left">
                        <span className="num plan-amount block money-nowrap" dir="rtl">
                          {disp.primary}
                        </span>
                        {disp.usdHint && (
                          <span className="muted num block text-[length:var(--fs-xs)]" dir="rtl">
                            معادل {disp.usdHint}
                          </span>
                        )}
                      </span>
                    </div>
                    <p className="plan-row-foot num">{formatJalaliIso(x.date)}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
