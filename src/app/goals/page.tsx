import type { CSSProperties } from "react";
import { ensureAuth } from "@/lib/authGuard";
import { getAccountBalances } from "@/features/ledger/queries";
import { seedIfEmpty } from "@/db/seed";
import { listBudgets, listEvents, listFunds, listGoals } from "@/features/planning/service";
import { eventBudgetLinks } from "@/features/planning/planItems";
import { listSavingsAccounts } from "@/features/planning/savingsAccounts";
import PlanRowMenu from "@/components/planning/PlanRowMenu";
import { EmptyState, PageHeader, Progress, Section } from "@/components/ui/Card";
import Icon, { type IconName } from "@/components/ui/Icon";
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
import { toneVars } from "@/lib/toneColors";

export const dynamic = "force-dynamic";

export const metadata = { title: "اهداف و صندوق‌ها" };

const FUND_KIND: Record<string, string> = {
  emergency: "اضطراری",
  reserve: "ذخیره",
  family_support: "خانواده",
};

const FUND_LOOK: Record<string, { color: string; icon: IconName }> = {
  emergency: { color: "#e5484d", icon: "shield" },
  reserve: { color: "#00a2c7", icon: "wallet" },
  family_support: { color: "#12a594", icon: "users" },
};

const EVENT_CATEGORY: Record<string, string> = {
  trip: "سفر",
  ceremony: "مراسم",
  gift: "هدیه",
  purchase: "خرید بزرگ",
  other: "سایر",
};

const EVENT_LOOK: Record<string, { color: string; icon: IconName }> = {
  trip: { color: "#0090ff", icon: "plane" },
  ceremony: { color: "#e93d82", icon: "sparkle" },
  gift: { color: "#ca244d", icon: "gift" },
  purchase: { color: "#f76b15", icon: "bag" },
  other: { color: "#8e4ec6", icon: "calendar" },
};

const GOAL_TONES = ["#3e63dd", "#12a594", "#f76b15", "#00a2c7", "#8e4ec6", "#e93d82"];

/** اهداف و صندوق‌ها — Kashi coloured tile grids for goals, funds, and events. */
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
    // Bank accounts and stablecoins held in a wallet — nothing else saves a goal.
    listSavingsAccounts(userId),
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

      {activeGoals.length > 0 && (
        <section className="goal-hero">
          <div className="goal-hero-top">
            <div>
              <p className="goal-hero-label">پس‌انداز در مجموع اهداف فعال</p>
              <p className="num goal-hero-figure" dir="rtl">
                {toman(totalSavedToman)} <span>از {toman(totalTargetToman)}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="bgt-hero-chip">{faCount(activeGoals.length)} هدف فعال</span>
              {funds.length > 0 && <span className="bgt-hero-chip">{faCount(funds.length)} صندوق</span>}
              {events.length > 0 && <span className="bgt-hero-chip">{faCount(events.length)} رویداد</span>}
              <span className="bgt-hero-chip" data-tone="pos">{formatPct(overall, 0)} پیشرفت</span>
            </div>
          </div>
          <Progress value={overall} color="#31f2bf" aria-label="پیشرفت مجموع اهداف" />
        </section>
      )}

      <Section title="اهداف">
        {shown.length === 0 ? (
          <div className="card">
            <EmptyState icon="goals" title="هدفی ندارید" action={<AddGoalButton {...addProps} label="هدف جدید" variant="soft" />} />
          </div>
        ) : (
          <ul className="goal-grid">
            {shown.map((g, idx) => {
              const done = g.status === "reached";
              const tone = done ? "#12a594" : GOAL_TONES[idx % GOAL_TONES.length]!;
              return (
                <li key={g.id} className="goal-tile" style={toneVars(tone) as CSSProperties}>
                  <div className="goal-tile-head">
                    <span className="goal-tile-icon" aria-hidden="true">
                      <Icon name={done ? "check-circle" : "goals"} size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="goal-tile-name">{g.name}</h3>
                        {done && <span className="badge badge-pos">تکمیل شد</span>}
                      </div>
                      <p className="goal-tile-meta num" dir="rtl">
                        {formatPct(g.progress, 0)}
                        {g.targetDate ? ` · سررسید ${formatJalaliIso(g.targetDate)}` : ""}
                      </p>
                    </div>
                    <PlanRowMenu kind="goal" item={{ id: g.id, name: g.name, amount: g.targetToman, date: g.targetDate, status: g.status }} today={today} />
                  </div>

                  <div className="goal-tile-amount num money-nowrap" dir="rtl">
                    <b>{toman(g.savedToman ?? g.savedBase)}</b>
                    <span>از {toman(g.targetToman ?? g.targetBase)}</span>
                  </div>

                  <Progress value={g.progress} color={tone} aria-label={`پیشرفت ${g.name}`} />

                  <div className="goal-tile-foot">
                    <span>{done ? "هدف محقق شد" : "مانده تا هدف"}</span>
                    {!done && <span className="num font-semibold" dir="rtl">{toman(g.remainingToman ?? g.remainingBase)}</span>}
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
            <ul className="goal-grid goal-grid-single">
              {funds.map((f) => {
                const look = FUND_LOOK[f.kind] ?? { color: "#3e63dd", icon: "wallet" as const };
                return (
                  <li key={f.id} className="goal-tile" style={toneVars(look.color) as CSSProperties}>
                    <div className="goal-tile-head">
                      <span className="goal-tile-icon" aria-hidden="true">
                        <Icon name={look.icon} size={18} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h3 className="goal-tile-name">{f.name}</h3>
                          <span className="badge badge-neutral">{FUND_KIND[f.kind] ?? f.kind}</span>
                        </div>
                        <p className="goal-tile-meta num" dir="rtl">{formatPct(f.progress, 0)} تکمیل</p>
                      </div>
                      <PlanRowMenu kind="fund" item={{ id: f.id, name: f.name, amount: f.targetToman }} today={today} />
                    </div>

                    <div className="goal-tile-amount num money-nowrap" dir="rtl">
                      <b>{toman(f.savedToman ?? f.savedBase)}</b>
                      <span>از {toman(f.targetToman ?? f.targetBase)}</span>
                    </div>

                    <Progress value={f.progress} color={look.color} aria-label={`پیشرفت ${f.name}`} />
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="رویدادها">
          {events.length === 0 ? (
            <p className="card expense-empty">رویدادی ندارید.</p>
          ) : (
            <ul className="goal-grid goal-grid-single">
              {events.map((e) => {
                const amount = e.budgetToman ?? e.budgetBase;
                const link = links.get(e.id);
                const spent = link ? (spentByBudget.get(link.budgetId) ?? "0") : null;
                const pct = spent && Number(amount) ? Math.min(100, (Number(spent) / Number(amount)) * 100) : 0;
                const closed = e.status !== "planned";
                const look = EVENT_LOOK[e.category] ?? EVENT_LOOK.other!;
                const barColor = pct >= 100 ? "var(--negative)" : look.color;
                return (
                  <li key={e.id} className="goal-tile" data-muted={closed || undefined} style={toneVars(look.color) as CSSProperties}>
                    <div className="goal-tile-head">
                      <span className="goal-tile-icon" aria-hidden="true">
                        <Icon name={look.icon} size={18} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h3 className="goal-tile-name">{e.name}</h3>
                          <span className="badge badge-neutral">
                            {e.status === "done" ? "برگزار شد" : e.status === "cancelled" ? "لغو شد" : (EVENT_CATEGORY[e.category] ?? "رویداد")}
                          </span>
                        </div>
                        <p className="goal-tile-meta num">
                          {formatJalaliIso(e.eventDate)}
                          {link?.tag ? ` · #${link.tag}` : ""}
                        </p>
                      </div>
                      <PlanRowMenu kind="event" item={{ id: e.id, name: e.name, amount, date: e.eventDate, status: e.status }} today={today} />
                    </div>

                    <div className="goal-tile-amount num money-nowrap" dir="rtl">
                      {spent != null ? (
                        <>
                          <b>{toman(spent)}</b>
                          <span>از {toman(amount)}</span>
                        </>
                      ) : (
                        <b>{toman(amount)}</b>
                      )}
                    </div>

                    {spent != null && <Progress value={pct} color={barColor} aria-label={`خرج ${e.name}`} />}
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
