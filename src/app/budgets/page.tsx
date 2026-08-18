import { asc, sql } from "drizzle-orm";
import { ensureAuth } from "@/lib/authGuard";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { listBudgets } from "@/features/planning/service";
import { EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import BudgetForm from "@/components/forms/BudgetForm";
import { D } from "@/domain/decimal";
import { formatDualDate, formatMoney, formatPct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BudgetsPage() {
  await ensureAuth();
  await seedIfEmpty();
  const [budgets, expenseAccounts] = await Promise.all([
    listBudgets(),
    db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(sql`${accounts.type} = 'expense' and ${accounts.deletedAt} is null`)
      .orderBy(asc(accounts.code)),
  ]);

  const activeCount = budgets.length;
  const overCount = budgets.filter((b) => b.over).length;
  const totalLimit = budgets.reduce((s, b) => s + Number(b.amountBase), 0);
  const totalSpent = budgets.reduce((s, b) => s + Number(b.spentBase), 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="بودجه‌ها"
        subtitle="آیا در چارچوب بودجه هستم؟ — مصرف واقعی هر بخش، مستقیم از دفترکل خوانده می‌شود."
      />

      {activeCount > 0 && (
        <section className="rise grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-4" style={{ borderColor: "var(--border)" }}>
          <Metric label="بودجه فعال" value={String(activeCount)} />
          <Metric label="سقف مجموع" value={formatMoney(totalLimit)} />
          <Metric label="مصرف مجموع" value={formatMoney(totalSpent)} tone={totalSpent > totalLimit ? "down" : "neutral"} />
          <Metric label="خارج از چارچوب" value={String(overCount)} tone={overCount ? "down" : "up"} />
        </section>
      )}

      <Section title="وضعیت بودجه‌ها">
        {budgets.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="budgets"
              title="هنوز بودجه‌ای تعریف نشده است"
              body="بودجه یعنی سقف هزینه برای یک دسته در یک بازه — با تعریف اولیه، مصرف واقعی به‌طور خودکار با آن سنجیده می‌شود."
            />
          </div>
        ) : (
          <ul className="space-y-2.5">
            {budgets.map((b) => {
              const over = b.over || b.usage >= 100;
              const almost = !over && b.usage >= 80;
              const color = over ? "var(--negative)" : almost ? "var(--warning)" : "var(--positive)";
              return (
                <li key={b.id} className="card p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <p className="text-[14px] font-semibold">{b.name}</p>
                      {b.accountName && <span className="badge badge-neutral">{b.accountName}</span>}
                      {over && <span className="badge badge-neg">خارج از چارچوب</span>}
                      {almost && <span className="badge badge-warn">نزدیک به سقف</span>}
                    </div>
                    <p className="num text-[13px]" dir="rtl">
                      <b className="text-[15px]" style={{ color }}>
                        {formatMoney(b.spentBase)}
                      </b>{" "}
                      <span className="muted">از {formatMoney(b.amountBase)}</span>
                    </p>
                  </div>
                  <div className="meter mt-3">
                    <i style={{ width: `${Math.min(100, b.usage)}%`, background: color }} />
                  </div>
                  <div className="muted mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="num">
                      {formatDualDate(b.periodStart)} ← {formatDualDate(b.periodEnd)}
                    </span>
                    <span className="num" dir="rtl" style={{ color: over ? "var(--negative)" : "var(--positive)" }}>
                      {over
                        ? `${formatMoney(D(b.remainingBase).abs().toString())} بیشتر از سقف`
                        : `${formatMoney(b.remainingBase)} مانده · ${formatPct(b.usage, 0)} مصرف شده`}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="تعریف بودجه جدید">
        <details className="card group overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 marker:hidden [&::-webkit-details-marker]:hidden">
            <span className="text-[13.5px] font-semibold">بودجه برای یک دسته هزینه</span>
            <span className="muted transition-transform group-open:rotate-180">
              <Icon name="chevronDown" size={15} />
            </span>
          </summary>
          <div className="border-t p-4" style={{ borderColor: "var(--border)" }}>
            <BudgetForm accounts={expenseAccounts} />
          </div>
        </details>
      </Section>
    </div>
  );
}
