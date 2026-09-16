import { asc, sql } from "drizzle-orm";
import { ensureAuth } from "@/lib/authGuard";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { listBudgets } from "@/features/planning/service";
import { EmptyState, Metric, PageHeader } from "@/components/ui/Card";
import { AddBudgetButton } from "@/components/planning/AddPlanningSheet";
import { D } from "@/domain/decimal";
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

export const metadata = { title: "بودجه‌ها" };

/**
 * بودجه‌ها — «آیا در چارچوب بودجه هستم؟» in one list.
 *
 * Presentation only: the read model (`listBudgets`) and `createBudgetAction`
 * are untouched, so the contractual Toman ceiling still never moves with FX.
 */
export default async function BudgetsPage() {
  await ensureAuth();
  await seedIfEmpty();
  const [budgets, expenseAccounts, fx] = await Promise.all([
    listBudgets(),
    db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(sql`${accounts.type} = 'expense' and ${accounts.deletedAt} is null`)
      .orderBy(asc(accounts.code)),
    getLatestUsdIrtRate(),
  ]);

  const overCount = budgets.filter((b) => b.over).length;
  // amountBase / amountToman = contractual Toman ceiling (never moves with FX).
  const totalLimitToman = sumToman(budgets.map((b) => b.amountToman ?? b.amountBase));
  const totalSpentToman = sumToman(budgets.map((b) => b.spentToman ?? b.spentBase));
  const limitDisp = formatTomanPrimary(totalLimitToman, fx.rate);
  const spentDisp = formatTomanPrimary(totalSpentToman, fx.rate);

  const addButton = (
    <AddBudgetButton
      accounts={expenseAccounts}
      today={todayIso()}
      rate={fx.rate}
      rateDate={fx.effectiveDate}
      rateSource={fx.source}
    />
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="بودجه‌ها"
        subtitle="سقف هزینه هر دسته در یک بازه. مبلغ تومان ثابت است؛ معادل دلاری فقط نمایشی است."
        action={addButton}
      />

      {budgets.length > 0 && (
        <section className="metric-strip">
          <Metric label="بودجه فعال" value={faCount(budgets.length)} />
          <Metric label="سقف مجموع" value={limitDisp.primary} hint={limitDisp.usdHint ? `معادل ${limitDisp.usdHint}` : undefined} />
          <Metric
            label="مصرف مجموع"
            value={spentDisp.primary}
            tone={Number(totalSpentToman) > Number(totalLimitToman) ? "down" : "neutral"}
            hint={spentDisp.usdHint ? `معادل ${spentDisp.usdHint}` : undefined}
          />
          <Metric label="خارج از چارچوب" value={faCount(overCount)} tone={overCount ? "down" : "neutral"} />
        </section>
      )}

      {budgets.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="budgets"
            title="هنوز بودجه‌ای تعریف نشده است"
            body="بودجه یعنی سقف هزینه برای یک دسته در یک بازه — با تعریف اولیه، مصرف واقعی به‌طور خودکار با آن سنجیده می‌شود."
            action={
              <AddBudgetButton
                accounts={expenseAccounts}
                today={todayIso()}
                rate={fx.rate}
                rateDate={fx.effectiveDate}
                rateSource={fx.source}
                label="تعریف اولین بودجه"
                variant="soft"
              />
            }
          />
        </div>
      ) : (
        <ul className="card plan-list">
          {budgets.map((b) => {
            const over = b.over || b.usage >= 100;
            const almost = !over && b.usage >= 80;
            const color = over ? "var(--negative)" : almost ? "var(--warning)" : "var(--positive)";
            const spentD = formatTomanPrimary(b.spentToman ?? b.spentBase, fx.rate);
            const limitD = formatTomanPrimary(b.amountToman ?? b.amountBase, fx.rate);
            const remRaw = b.remainingToman ?? b.remainingBase;
            const overBy = formatTomanPrimary(D(remRaw).abs().toFixed(0), fx.rate);
            return (
              <li key={b.id} className="plan-row">
                <div className="plan-row-head">
                  <span className="plan-row-title">
                    <b className="truncate">{b.name}</b>
                    {over && <span className="badge badge-neg">خارج از چارچوب</span>}
                    {almost && <span className="badge badge-warn">نزدیک به سقف</span>}
                  </span>
                  <span className="shrink-0 text-left">
                    <span className="num block money-nowrap" dir="rtl">
                      <b className="plan-amount" style={{ color }}>
                        {spentD.primary}
                      </b>{" "}
                      <span className="muted text-[length:var(--fs-xs)]">از {limitD.primary}</span>
                    </span>
                    {spentD.usdHint && (
                      <span className="muted num block text-[length:var(--fs-xs)]" dir="rtl">
                        معادل {spentD.usdHint}
                      </span>
                    )}
                  </span>
                </div>
                <div className="meter" aria-hidden="true">
                  <i style={{ width: `${Math.min(100, b.usage)}%`, background: color }} />
                </div>
                <div className="plan-row-foot">
                  <span className="num">
                    {formatJalaliIso(b.periodStart)} ← {formatJalaliIso(b.periodEnd)}
                  </span>
                  <span className="num" dir="rtl" style={{ color: over ? "var(--negative)" : "var(--positive)" }}>
                    {over
                      ? `${overBy.primary} بیشتر از سقف`
                      : `${formatTomanPrimary(remRaw, fx.rate).primary} مانده · ${formatPct(b.usage, 0)} مصرف`}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
