import { asc, sql } from "drizzle-orm";
import { ensureAuth } from "@/lib/authGuard";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { listBudgets } from "@/features/planning/service";
import { listTags } from "@/features/tags/service";
import { EmptyState, PageHeader } from "@/components/ui/Card";
import BudgetsView from "@/components/planning/BudgetsView";
import { AddBudgetButton } from "@/components/planning/AddPlanningSheet";
import { todayIso } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export const metadata = { title: "بودجه‌ها" };

/**
 * بودجه‌ها — «آیا در چارچوب بودجه هستم؟»: monthly category ceilings, and
 * event / project budgets (عقد، عروسی، تعویض ماشین…) with their lines.
 *
 * Every ceiling is contractual Toman and never moves with FX.
 */
export default async function BudgetsPage() {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id;
  await seedIfEmpty();
  const [budgets, expenseAccounts, fx, tagCounts] = await Promise.all([
    listBudgets(),
    db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(sql`${accounts.type} = 'expense' and ${accounts.deletedAt} is null`)
      .orderBy(asc(accounts.code)),
    getLatestUsdIrtRate(),
    listTags(userId).catch(() => []),
  ]);
  const tags = tagCounts.map((t) => t.tag);

  const addButton = (
    <AddBudgetButton
      accounts={expenseAccounts}
      tags={tags}
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
        action={addButton}
      />

      {budgets.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="budgets"
            title="هنوز بودجه‌ای تعریف نشده است"
            body="برای هزینه‌های ماهانه سقف بگذارید، یا برای یک رویداد مثل عقد، عروسی، سفر یا تعویض ماشین بودجه با ریز اقلام (حلقه، لباس، تالار…) بسازید. خرج واقعی خودکار با آن سنجیده می‌شود."
            action={
              <AddBudgetButton
                accounts={expenseAccounts}
                tags={tags}
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
        <BudgetsView budgets={budgets} today={todayIso()} />
      )}
    </div>
  );
}
