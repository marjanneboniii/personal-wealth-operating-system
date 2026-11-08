import type { ReactNode } from "react";
import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { Alert, Metric, PageHeader, Progress, Section } from "@/components/ui/Card";
import Icon, { type IconName } from "@/components/ui/Icon";
import { formatMoney, formatPct, formatShortDate, formatSignedMoney, faCount } from "@/lib/format";
import { getAssistantConfig } from "@/features/assistant/gemini";
import { buildFinancialSnapshot, snapshotHash, type FinancialSnapshot } from "@/features/assistant/snapshot";
import { getLatestInsight, listConversations, listMemories } from "@/features/assistant/store";
import type { Finding, Severity } from "@/features/assistant/analysis";
import AssistantWorkspace, { AskButton } from "@/components/assistant/AssistantWorkspace";
import AssistantChat from "@/components/assistant/AssistantChat";
import InsightPanel from "@/components/assistant/InsightPanel";

export const dynamic = "force-dynamic";
// The «تحلیل هوشمند» server action runs here and may fall back across models.
export const maxDuration = 60;
export const metadata = { title: "دستیار هوشمند" };

/**
 * دستیار هوشمند — a dashboard of the user's finances with the single most
 * important suggestion, and a chat with a Gemini-backed analyst.
 *
 * READ MODEL: every figure on the dashboard comes from the deterministic
 * snapshot (features/assistant/snapshot.ts → the app's own read services).
 * The model is never on the page-render path: the dashboard works, and shows
 * its findings, with no Gemini key at all.
 */

const SEVERITY: Record<Severity, { c: string; bg: string; icon: IconName; label: string }> = {
  critical: { c: "var(--negative)", bg: "var(--negative-soft)", icon: "alert", label: "فوری" },
  warning: { c: "var(--warning)", bg: "var(--warning-soft)", icon: "alert", label: "هشدار" },
  opportunity: { c: "var(--positive)", bg: "var(--positive-soft)", icon: "trend-up", label: "فرصت" },
  info: { c: "var(--info)", bg: "var(--info-soft)", icon: "info", label: "نکته" },
};

const toman = (n: number) => formatMoney(String(Math.round(n)), "IRT");
const signedToman = (n: number) => formatSignedMoney(String(Math.round(n)), "IRT");

function askFor(f: Finding): string {
  return `درباره‌ی این مورد توضیح بده و بگو دقیقاً چه کار کنم: «${f.title}» — ${f.detail}`;
}

function Dashboard({ s, insight }: { s: FinancialSnapshot; insight: ReactNode }) {
  const top = s.findings[0] ?? null;
  const month = s.cashflow.currentMonth;
  const accountsTotal = s.accounts.reduce((sum, a) => sum + a.balanceToman, 0);
  const monthAgo = s.netWorth.history.find((h) => h.label === "ماه گذشته") ?? s.netWorth.history[0] ?? null;
  const prevMonth = s.cashflow.months.at(-2);

  return (
    <div className="space-y-5">
      {/* ── مهم‌ترین پیشنهاد دستیار ── */}
      <section className="card ai-top" aria-labelledby="ai-top-title">
        <span className="ai-top-icon" style={top ? { background: SEVERITY[top.severity].bg, color: SEVERITY[top.severity].c } : undefined} aria-hidden="true">
          <Icon name={top ? SEVERITY[top.severity].icon : "check-circle"} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="muted text-[length:var(--fs-xs)] font-medium" id="ai-top-title">مهم‌ترین پیشنهاد دستیار</p>
          {top ? (
            <>
              <b className="mt-0.5 block text-[length:var(--fs-md)]">{top.title}</b>
              <p className="sub mt-1 text-[length:var(--fs-sm)] leading-6">{top.detail}</p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <AskButton question={askFor(top)} label="راهکار بده" />
                {top.href && (
                  <Link href={top.href} className="btn btn-ghost !min-h-8 !px-3 !py-1 text-[length:var(--fs-xs)]">
                    مشاهده
                  </Link>
                )}
              </div>
            </>
          ) : (
            <>
              <b className="mt-0.5 block text-[length:var(--fs-md)]">مشکل یا فرصت فوری‌ای دیده نشد</b>
              <p className="sub mt-1 text-[length:var(--fs-sm)] leading-6">نقدینگی، اقساط، بودجه‌ها و روند هزینه‌ها در محدوده‌ی عادی‌اند.</p>
            </>
          )}
        </div>
      </section>

      {/* ── خلاصه‌ی وضعیت ── */}
      <section className="metric-strip ai-metrics" aria-label="خلاصه‌ی وضعیت مالی">
        <Metric label="ارزش کل دارایی‌ها" value={toman(s.netWorth.totalAssetsToman)} />
        <Metric label="موجودی حساب‌ها" value={toman(accountsTotal)} hint={`نقد در دسترس ${toman(s.netWorth.availableCashToman)}`} />
        <Metric label="بدهی‌های باقی‌مانده" value={toman(s.netWorth.totalDebtToman)} tone={s.netWorth.totalDebtToman > 0 ? "down" : "neutral"} hint={s.netWorth.receivablesToman > 0 ? `مطالبات ${toman(s.netWorth.receivablesToman)}` : undefined} />
        <Metric
          label="ارزش خالص دارایی"
          value={toman(s.netWorth.netWorthToman)}
          hint={monthAgo ? `${monthAgo.label}: ${monthAgo.changePct != null ? formatPct(monthAgo.changePct.toFixed(1), 1) : "—"} (دلاری)` : "تاریخچه‌ای ثبت نشده"}
          tone={monthAgo ? (monthAgo.changeUsd > 0 ? "up" : monthAgo.changeUsd < 0 ? "down" : "neutral") : "neutral"}
        />
        <Metric label={`درآمد ${month.label}`} value={toman(month.incomeToman)} hint={prevMonth ? `ماه قبل ${toman(prevMonth.incomeToman)}` : undefined} />
        <Metric label={`هزینه ${month.label}`} value={toman(month.expenseToman)} hint={`${faCount(month.daysElapsed)} از ${faCount(month.daysInMonth)} روز ماه`} />
        <Metric label="جریان نقدینگی خالص" value={signedToman(month.netToman)} tone={month.netToman > 0 ? "up" : month.netToman < 0 ? "down" : "neutral"} hint="درآمد منهای هزینه‌ی همین ماه" />
        <Metric label="تعهدات ۳۰ روز آینده" value={toman(s.obligations.next30Toman)} tone={s.obligations.next30Toman > s.netWorth.availableCashToman ? "down" : "neutral"} hint={s.obligations.overdue.count ? `${faCount(s.obligations.overdue.count)} قسط معوق` : "اقساط، بیمه و پرداخت‌های تکراری"} />
      </section>

      {/* ── هشدارها و فرصت‌ها ── */}
      {s.findings.length > 1 && (
        <Section id="ai-findings" title="هشدارها و فرصت‌ها">
          <ul className="card plan-list">
            {s.findings.slice(1, 9).map((f) => {
              const t = SEVERITY[f.severity];
              return (
                <li key={f.id} className="plan-queue-row">
                  <span className="plan-icon" style={{ background: t.bg, color: t.c }} aria-hidden="true">
                    <Icon name={t.icon} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block text-[length:var(--fs-sm)]">
                      <span className="ai-sev" style={{ color: t.c }}>{t.label}</span> {f.title}
                    </b>
                    <span className="expense-sub line-clamp-3 block">{f.detail}</span>
                  </span>
                  <AskButton question={askFor(f)} label="بپرس" />
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {insight}

      {/* ── بودجه‌ها ── */}
      <Section id="ai-budgets" title="بودجه‌ها">
        {s.budgets.length === 0 ? (
          <p className="muted text-[length:var(--fs-sm)]">
            بودجه‌ی فعالی برای این دوره ندارید. <Link href="/budgets" className="underline">ساخت بودجه</Link>
          </p>
        ) : (
          <ul className="card list-card" role="list">
            {s.budgets.map((b) => {
              const color = b.status === "over" ? "var(--negative)" : b.status === "at_risk" ? "var(--warning)" : "var(--positive)";
              return (
                <li key={`${b.name}-${b.periodStart}`} className="ai-budget">
                  <div className="flex items-baseline justify-between gap-2">
                    <b className="truncate text-[length:var(--fs-sm)]">{b.name}</b>
                    <span className="text-[length:var(--fs-xs)]" style={{ color }}>{formatPct(b.usagePct.toFixed(0), 0)}</span>
                  </div>
                  <Progress value={Math.min(100, b.usagePct)} color={color} aria-label={`مصرف بودجه‌ی ${b.name}`} />
                  <p className="muted text-[length:var(--fs-xs)] leading-5">
                    {toman(b.spentToman)} از {toman(b.limitToman)} · {faCount(b.daysLeft)} روز مانده
                    {b.status !== "ok" && ` · با همین روند ${toman(b.projectedToman)}`}
                    {b.exhaustDate && ` · پر شدن سقف حدود ${formatShortDate(b.exhaustDate)}`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* ── پرداخت‌های نزدیک ── */}
      <Section id="ai-upcoming" title="اقساط و پرداخت‌های نزدیک">
        {s.obligations.upcoming.length === 0 && s.obligations.overdue.count === 0 ? (
          <p className="muted text-[length:var(--fs-sm)]">در ۶۰ روز آینده پرداخت قطعی ثبت‌شده‌ای ندارید.</p>
        ) : (
          <ul className="card list-card" role="list">
            {s.obligations.overdue.count > 0 && (
              <li className="list-row">
                <span className="flow-icon" style={{ background: "var(--negative-soft)", color: "var(--negative)" }} aria-hidden="true">
                  <Icon name="clock" size={15} />
                </span>
                <span className="min-w-0 flex-1 text-[length:var(--fs-sm)]">{faCount(s.obligations.overdue.count)} قسط سررسیدگذشته</span>
                <b className="text-[length:var(--fs-sm)]">{toman(s.obligations.overdue.toman)}</b>
              </li>
            )}
            {s.obligations.upcoming.slice(0, 10).map((u, i) => (
              <li key={`${u.date}-${u.title}-${i}`} className="list-row" style={{ borderTop: "1px solid var(--border)" }}>
                <span className="flow-icon" style={{ background: "var(--action-soft)" }} aria-hidden="true">
                  <Icon name={u.kind === "installment" ? "installments" : u.kind === "premium" ? "shield" : "receipt"} size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[length:var(--fs-sm)]">{u.title}</span>
                  <span className="muted text-[length:var(--fs-xs)]">
                    {formatShortDate(u.date)} · {u.kind === "installment" ? "قسط" : u.kind === "premium" ? "حق بیمه" : "پرداخت تکراری (برآورد)"}
                  </span>
                </span>
                <b className="text-[length:var(--fs-sm)]">{toman(u.toman)}</b>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── تغییر ارزش خالص ── */}
      {s.netWorth.history.length > 0 && (
        <Section id="ai-networth" title="تغییر ارزش خالص (به دلار)">
          <div className="metric-strip">
            {s.netWorth.history.map((h) => (
              <Metric
                key={h.label}
                label={`نسبت به ${h.label}`}
                value={h.changePct != null ? formatPct(h.changePct.toFixed(1), 1) : "—"}
                tone={h.changeUsd > 0 ? "up" : h.changeUsd < 0 ? "down" : "neutral"}
                hint={formatSignedMoney(String(h.changeUsd), "USD")}
              />
            ))}
          </div>
          <p className="muted mt-2 text-[length:var(--fs-xs)] leading-5">
            مقایسه بر پایه‌ی عکس‌های ثبت‌شده‌ی ثروت (به دلار) است؛ افزایش ارزش دارایی لزوماً سود تحقق‌یافته یا درآمد نیست.
          </p>
        </Section>
      )}

      <p className="muted text-[length:var(--fs-micro)] leading-4">
        به‌روز تا {s.asOfJalali} · نرخ دلار {toman(s.usdToToman)} · {faCount(s.dataQuality.transactionsLast30)} هزینه در ۳۰ روز اخیر
        {s.dataQuality.unreviewedImports > 0 && ` · ${faCount(s.dataQuality.unreviewedImports)} رکورد بازبینی‌نشده`}
      </p>
    </div>
  );
}

export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await ensureAuth();
  const sp = await searchParams;
  const config = getAssistantConfig();

  let snapshot: FinancialSnapshot | null = null;
  let loadError = false;
  try {
    snapshot = await buildFinancialSnapshot(user.id, { fresh: true });
  } catch (e) {
    loadError = true;
    console.error("[assistant] snapshot failed:", e instanceof Error ? e.message : e);
  }
  const [conversations, memories, latest] = await Promise.all([
    listConversations(user.id).catch(() => []),
    listMemories(user.id).catch(() => []),
    getLatestInsight(user.id).catch(() => null),
  ]);
  const stale = Boolean(latest && snapshot && latest.hash !== snapshotHash(snapshot));
  const insight = <InsightPanel configured={config.configured} initial={latest ? { content: latest.content, createdAt: latest.createdAt } : null} stale={stale} />;

  return (
    <div className="space-y-4">
      <PageHeader title="دستیار هوشمند" subtitle="تحلیلگر مالی شخصی شما: وضعیت پول، بودجه، اقساط، بدهی و دارایی را می‌خواند، مشکل‌ها را پیدا می‌کند و راهکار می‌دهد." />
      {!config.configured && (
        <Alert tone="warn" title="گفتگو با دستیار هنوز فعال نیست">
          کلید Gemini روی سرور تنظیم نشده است. متغیر محیطی <code dir="ltr">GEMINI_API_KEY</code> را در تنظیمات میزبان (مثلاً Vercel → Settings → Environment Variables) اضافه و دوباره deploy کنید. داشبورد و هشدارهای این صفحه بدون آن هم کار می‌کنند.
        </Alert>
      )}
      <AssistantWorkspace
        initialTab={sp.tab === "chat" ? "chat" : "dashboard"}
        dashboard={
          snapshot ? (
            <Dashboard s={snapshot} insight={insight} />
          ) : (
            <Alert tone="neg" title="خواندن داده‌های مالی ناموفق بود">
              {loadError ? "دوباره امتحان کنید؛ اگر مشکل ماند، از صفحه‌ی بینش‌ها وضعیت را ببینید." : null}
            </Alert>
          )
        }
        chat={<AssistantChat configured={config.configured} initialConversations={conversations} initialMemories={memories} />}
      />
    </div>
  );
}
