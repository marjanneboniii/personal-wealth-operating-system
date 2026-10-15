import { asc, eq, sql } from "drizzle-orm";
import { ensureAuth } from "@/lib/authGuard";
import { db } from "@/db";
import { accounts, assets, wallets } from "@/db/schema";
import { getAccountBalances } from "@/features/ledger/queries";
import { seedIfEmpty } from "@/db/seed";
import { listBudgets, listEvents, listFunds, listGoals } from "@/features/planning/service";
import { eventBudgetLinks } from "@/features/planning/planItems";
import PlanRowMenu from "@/components/planning/PlanRowMenu";
import { EmptyState, PageHeader, Progress, Section } from "@/components/ui/Card";
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

/** اهداف و صندوق‌ها — three plain lists; «⋯» on a row edits, closes or deletes it. */
export default async function GoalsPage() {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id;
  await seedIfEmpty();
  const [goals, funds, events, budgetRows, links, accountRows, fx, balanceRows] = await Promise.all([
    listGoals(),
    listFunds(),
    listEvents(),
    listBudgets().catch(() => []),
    eventBudgetLinks(userId ?? null),
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
  const today = todayIso();
  const spentByBudget = new Map(budgetRows.map((b) => [b.id, b.spentToman]));

  const shown = goals.filter((g) => g.status !== "archived");
  const activeGoals = goals.filter((g) => g.status === "active");
  // targetBase / targetToman = contractual Toman (never moves with FX).
  const totalTargetToman = sumToman(activeGoals.map((g) => g.targetToman ?? g.targetBase));
  const totalSavedToman = sumToman(activeGoals.map((g) => g.savedToman ?? g.savedBase));
  const overall = Number(totalTargetToman) ? Math.min(100, (Number(totalSavedToman) / Number(totalTargetToman)) * 100) : 0;
  const toman = (v: string) => formatTomanPrimary(v, fx.rate).primary;

  const addProps = {
    accounts: accountRows,
    balances,
    today,
    rate: fx.rate,
    rateDate: fx.effectiveDate,
    rateSource: fx.source,
  };

  return (
    <div className="space-y-5">
      <PageHeader title="اهداف و صندوق‌ها" action={<AddGoalButton {...addProps} />} />

      {activeGoals.length > 1 && (
        <section className="card expense-card">
          <header className="expense-head">
            <h2>مجموع اهداف</h2>
            <span className="num text-[length:var(--fs-sm)] font-bold money-nowrap" dir="rtl">
              {toman(totalSavedToman)} <span className="muted font-normal">از {toman(totalTargetToman)}</span>
            </span>
          </header>
          <Progress value={overall} aria-label="پیشرفت مجموع اهداف" />
        </section>
      )}

      <Section title="اهداف">
        {shown.length === 0 ? (
          <div className="card">
            <EmptyState icon="goals" title="هدفی ندارید" action={<AddGoalButton {...addProps} label="هدف جدید" variant="soft" />} />
          </div>
        ) : (
          <ul className="card plan-list">
            {shown.map((g) => {
              const done = g.status === "reached";
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
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="num money-nowrap" dir="rtl">
                        <b className="plan-amount">{toman(g.savedToman ?? g.savedBase)}</b>{" "}
                        <span className="muted text-[length:var(--fs-xs)]">از {toman(g.targetToman ?? g.targetBase)}</span>
                      </span>
                      <PlanRowMenu kind="goal" item={{ id: g.id, name: g.name, amount: g.targetToman, date: g.targetDate, status: g.status }} today={today} />
                    </span>
                  </div>
                  <Progress value={g.progress} color={done ? "var(--positive)" : "var(--action)"} aria-label={`پیشرفت ${g.name}`} />
                  <div className="plan-row-foot">
                    <span className="num" dir="rtl">
                      {formatPct(g.progress, 0)}
                      {g.targetDate ? ` · ${formatJalaliIso(g.targetDate)}` : ""}
                    </span>
                    {!done && <span className="num">{toman(g.remainingToman ?? g.remainingBase)} مانده</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Section title="صندوق‌ها">
          {funds.length === 0 ? (
            <p className="card expense-empty">صندوقی ندارید.</p>
          ) : (
            <ul className="card plan-list">
              {funds.map((f) => (
                <li key={f.id} className="plan-row">
                  <div className="plan-row-head">
                    <span className="plan-row-title">
                      <b className="truncate">{f.name}</b>
                      <span className="badge badge-neutral">{FUND_KIND[f.kind] ?? f.kind}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="num money-nowrap" dir="rtl">
                        <b className="plan-amount">{toman(f.savedToman ?? f.savedBase)}</b>{" "}
                        <span className="muted text-[length:var(--fs-xs)]">از {toman(f.targetToman ?? f.targetBase)}</span>
                      </span>
                      <PlanRowMenu kind="fund" item={{ id: f.id, name: f.name, amount: f.targetToman }} today={today} />
                    </span>
                  </div>
                  <Progress value={f.progress} color="var(--info)" aria-label={`پیشرفت ${f.name}`} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="رویدادها">
          {events.length === 0 ? (
            <p className="card expense-empty">رویدادی ندارید.</p>
          ) : (
            <ul className="card plan-list">
              {events.map((e) => {
                const amount = e.budgetToman ?? e.budgetBase;
                const link = links.get(e.id);
                const spent = link ? (spentByBudget.get(link.budgetId) ?? "0") : null;
                const pct = spent && Number(amount) ? Math.min(100, (Number(spent) / Number(amount)) * 100) : 0;
                const closed = e.status !== "planned";
                return (
                  <li key={e.id} className="plan-row" data-muted={closed || undefined}>
                    <div className="plan-row-head">
                      <span className="plan-row-title">
                        <b className="truncate">{e.name}</b>
                        <span className="badge badge-neutral">
                          {e.status === "done" ? "برگزار شد" : e.status === "cancelled" ? "لغو شد" : (EVENT_CATEGORY[e.category] ?? "رویداد")}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <span className="num money-nowrap" dir="rtl">
                          {spent != null && <b className="plan-amount">{toman(spent)} </b>}
                          <span className={spent != null ? "muted text-[length:var(--fs-xs)]" : "plan-amount"}>
                            {spent != null ? "از " : ""}
                            {toman(amount)}
                          </span>
                        </span>
                        <PlanRowMenu kind="event" item={{ id: e.id, name: e.name, amount, date: e.eventDate, status: e.status }} today={today} />
                      </span>
                    </div>
                    {spent != null && <Progress value={pct} color={pct >= 100 ? "var(--negative)" : "var(--warning)"} aria-label={`خرج ${e.name}`} />}
                    <div className="plan-row-foot">
                      <span className="num">{formatJalaliIso(e.eventDate)}</span>
                      {link?.tag && <span className="num" dir="ltr">#{link.tag}</span>}
                    </div>
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
