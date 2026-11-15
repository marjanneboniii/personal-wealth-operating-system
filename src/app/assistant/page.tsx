import type { ReactNode } from "react";
import Link from "next/link";
import { ensureAuth, isAdminOrOwner } from "@/lib/authGuard";
import { Alert, PageHeader } from "@/components/ui/Card";
import Icon, { type IconName } from "@/components/ui/Icon";
import { JALALI_MONTHS, toJalali } from "@/lib/format";
import { getAssistantConfig } from "@/features/assistant/gemini";
import { buildFinancialSnapshot, snapshotHash, type FinancialSnapshot } from "@/features/assistant/snapshot";
import { getLatestInsight, listConversations, listMemories } from "@/features/assistant/store";
import { fmtToman, type Finding, type Severity } from "@/features/assistant/analysis";
import AssistantWorkspace, { AskButton, OpenLoopButton } from "@/components/assistant/AssistantWorkspace";
import AssistantChat from "@/components/assistant/AssistantChat";
import InsightPanel from "@/components/assistant/InsightPanel";
import CashLoopPlanner from "@/components/assistant/CashLoopPlanner";

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

const SEVERITY: Record<Severity, { tone: string; icon: IconName; label: string }> = {
  critical: { tone: "neg", icon: "alert", label: "فوری" },
  warning: { tone: "warn", icon: "alert", label: "هشدار" },
  opportunity: { tone: "pos", icon: "trend-up", label: "فرصت" },
  info: { tone: "mint", icon: "swap", label: "پیشنهاد" },
};

/** «۱٫۳ میلیارد» — the figure, without the unit (the unit is set smaller beside it). */
const short = (n: number) => fmtToman(n).replace(/ تومان$/, "");
const full = (n: number) => `${Math.round(n).toLocaleString("fa-IR")} تومان`;
const pct = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("fa-IR", { maximumFractionDigits: 1 })}٪`;

function Amount({ value, size = "md" }: { value: number; size?: "lg" | "md" | "sm" }) {
  const absShort = short(Math.abs(value));
  const spaceIdx = absShort.indexOf(" ");
  const numPart = spaceIdx === -1 ? absShort : absShort.slice(0, spaceIdx);
  const unitPart = spaceIdx === -1 ? "" : absShort.slice(spaceIdx + 1);
  const isNeg = value < 0;

  return (
    <span className={`ai-amt ai-amt-${size}${isNeg ? " is-neg-amt" : ""}`} title={full(value)}>
      <span dir="ltr" className="ltr-isolate">
        {isNeg ? "−" : ""}
        {numPart}
      </span>
      {unitPart && <span className="ai-amt-unit">{unitPart}</span>}
      <small>تومان</small>
    </span>
  );
}

function askFor(f: Finding): string {
  return `درباره‌ی این مورد توضیح بده و بگو دقیقاً چه کار کنم: «${f.title}» — ${f.detail}`;
}

function dayBadge(iso: string) {
  const { m, d } = toJalali(iso);
  return (
    <span className="ai-date" aria-hidden="true">
      <small>{JALALI_MONTHS[m - 1]}</small>
      <b>{d.toLocaleString("fa-IR")}</b>
    </span>
  );
}

function Dashboard({ s, insight }: { s: FinancialSnapshot; insight: ReactNode }) {
  const top = s.findings[0] ?? null;
  const rest = s.findings.slice(1, 7);
  const month = s.cashflow.currentMonth;
  const nw = s.netWorth;
  const monthAgo = nw.history.find((h) => h.label === "ماه گذشته") ?? nw.history[0] ?? null;
  const flowMax = Math.max(month.incomeToman, month.expenseToman, 1);
  const reach = nw.availableCashToman + nw.convertibleToman;
  const covered = reach >= s.obligations.next30Toman;
  const liqMax = Math.max(reach, s.obligations.next30Toman, 1);
  const upcoming = s.obligations.upcoming.filter((u) => u.date >= s.asOf).slice(0, 6);

  return (
    <div className="ai-dash">
      {/* ── مهم‌ترین پیشنهاد دستیار ── */}
      <section className={`ai-hero tone-${top ? SEVERITY[top.severity].tone : "pos"}`} aria-labelledby="ai-top-title">
        <span className="ai-hero-icon" aria-hidden="true">
          <Icon name={top ? SEVERITY[top.severity].icon : "check-circle"} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="ai-eyebrow" id="ai-top-title">
            <Icon name="sparkle" size={12} />
            <span>مهم‌ترین پیشنهاد دستیار</span>
            {top && <span className="ai-eyebrow-badge">{SEVERITY[top.severity].label}</span>}
          </p>
          <h2 className="ai-hero-title">{top ? top.title : "همه‌چیز مرتب است"}</h2>
          <p className="ai-hero-text">{top ? top.detail : "نقدینگی، اقساط، بودجه‌ها و روند هزینه‌ها در محدوده‌ی عادی‌اند."}</p>
          <div className="ai-hero-actions">
            {top && <AskButton question={askFor(top)} label="راهکار بده" className="btn btn-primary ai-btn" />}
            {top?.href && (
              <Link href={top.href} className="btn btn-ghost ai-btn">
                مشاهده
              </Link>
            )}
            <OpenLoopButton label="برنامه‌ریزی جریان نقدینگی" className="btn btn-soft ai-btn" />
          </div>
        </div>
      </section>

      {/* ── سه کارت خلاصه (Kashi Stat Cards) ── */}
      <div className="ai-kpis">
        <section className="ai-card ai-kpi" aria-label="ارزش خالص">
          <div className="ai-kpi-head">
            <p className="ai-kpi-label">
              <span className="ai-kpi-mark" data-tone="mint" aria-hidden="true">
                <Icon name="overview" size={15} />
              </span>
              <span>ارزش خالص دارایی</span>
            </p>
          </div>
          <Amount value={nw.netWorthToman} size="lg" />
          {monthAgo && (
            <span className={`ai-chip ${monthAgo.changeUsd > 0 ? "is-pos" : monthAgo.changeUsd < 0 ? "is-neg" : ""}`}>
              {monthAgo.changePct != null ? (
                <span dir="ltr" className="ltr-isolate">
                  {pct(monthAgo.changePct)}
                </span>
              ) : (
                "—"
              )}{" "}
              نسبت به {monthAgo.label} <small>(دلاری)</small>
            </span>
          )}
          <dl className="ai-kv">
            <div>
              <dt>کل دارایی</dt>
              <dd><Amount value={nw.totalAssetsToman} size="sm" /></dd>
            </div>
            <div>
              <dt>بدهی باقی‌مانده</dt>
              <dd><Amount value={nw.totalDebtToman} size="sm" /></dd>
            </div>
          </dl>
        </section>

        <section className="ai-card ai-kpi" aria-label="جریان نقدی این ماه">
          <div className="ai-kpi-head">
            <p className="ai-kpi-label">
              <span className="ai-kpi-mark" data-tone="flow" aria-hidden="true">
                <Icon name="cashflow" size={15} />
              </span>
              <span>
                {month.label}{" "}
                <span className="ai-muted text-[10px]">
                  · روز {month.daysElapsed.toLocaleString("fa-IR")} از {month.daysInMonth.toLocaleString("fa-IR")}
                </span>
              </span>
            </p>
          </div>
          <Amount value={month.netToman} size="lg" />
          {month.incomeToman === 0 && month.expenseToman === 0 ? (
            <span className="ai-chip">هنوز تراکنشی نیست</span>
          ) : (
            <span className={`ai-chip ${month.netToman >= 0 ? "is-pos" : "is-neg"}`}>
              {month.netToman >= 0 ? "مازاد ماه" : "کسری ماه"}
            </span>
          )}
          <div className="ai-bars">
            <div className="ai-bar-row">
              <span>درآمد</span>
              <i className="ai-bar"><b className="is-pos" style={{ width: `${(month.incomeToman / flowMax) * 100}%` }} /></i>
              <Amount value={month.incomeToman} size="sm" />
            </div>
            <div className="ai-bar-row">
              <span>هزینه</span>
              <i className="ai-bar"><b className="is-neg" style={{ width: `${(month.expenseToman / flowMax) * 100}%` }} /></i>
              <Amount value={month.expenseToman} size="sm" />
            </div>
          </div>
        </section>

        <section className="ai-card ai-kpi" aria-label="نقدینگی">
          <div className="ai-kpi-head">
            <p className="ai-kpi-label">
              <span className="ai-kpi-mark" data-tone="pos" aria-hidden="true">
                <Icon name="shield" size={15} />
              </span>
              <span>نقدینگی در دسترس</span>
            </p>
          </div>
          <Amount value={reach} size="lg" />
          <span className={`ai-chip ${covered ? "is-pos" : "is-neg"}`}>
            {covered ? "پوشش ۳۰ روز برقرار" : "کمتر از تعهدات ۳۰ روز"}
          </span>
          <i className="ai-stack" aria-hidden="true">
            <b className="is-ink" style={{ width: `${(nw.availableCashToman / liqMax) * 100}%` }} />
            <b className="is-mint" style={{ width: `${(nw.convertibleToman / liqMax) * 100}%` }} />
            {s.obligations.next30Toman > 0 && <em style={{ insetInlineStart: `${Math.min(100, (s.obligations.next30Toman / liqMax) * 100)}%` }} />}
          </i>
          <dl className="ai-kv">
            <div>
              <dt><i className="ai-dot is-ink" />تومان در بانک</dt>
              <dd><Amount value={nw.availableCashToman} size="sm" /></dd>
            </div>
            <div>
              <dt><i className="ai-dot is-mint" />تتر و صرافی</dt>
              <dd><Amount value={nw.convertibleToman} size="sm" /></dd>
            </div>
            <div>
              <dt><i className="ai-dot is-line" />تعهدات ۳۰ روز</dt>
              <dd><Amount value={s.obligations.next30Toman} size="sm" /></dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="ai-cols">
        {/* ── هشدارها و فرصت‌ها ── */}
        <section className="ai-card" aria-labelledby="ai-findings-title">
          <h3 className="ai-card-title" id="ai-findings-title">
            <span className="ai-card-title-icon" aria-hidden="true">
              <Icon name="alert" size={14} />
            </span>
            <span>هشدارها و فرصت‌ها</span>
            {rest.length > 0 && <span className="ai-card-count num">{rest.length.toLocaleString("fa-IR")}</span>}
          </h3>
          {rest.length === 0 ? (
            <p className="ai-empty-line">مورد دیگری برای توجه نیست.</p>
          ) : (
            <ul className="ai-list" role="list">
              {rest.map((f) => {
                const t = SEVERITY[f.severity];
                return (
                  <li key={f.id} className={`ai-finding tone-${t.tone}`}>
                    <span className={`ai-finding-icon tone-${t.tone}`} aria-hidden="true">
                      <Icon name={t.icon} size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="ai-finding-head">
                        <span className="ai-finding-badge">{t.label}</span>
                        <p className="ai-finding-title">{f.title}</p>
                      </div>
                      <p className="ai-finding-text">{f.detail}</p>
                    </div>
                    <AskButton question={askFor(f)} label="بپرس" className="ai-ask" />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="ai-side">
          <section className="ai-card" aria-labelledby="ai-up-title">
            <h3 className="ai-card-title" id="ai-up-title">
              <span className="ai-card-title-icon" aria-hidden="true">
                <Icon name="calendar" size={14} />
              </span>
              <span>پرداخت‌های نزدیک</span>
              {s.obligations.overdue.count > 0 && (
                <span className="ai-chip is-neg">{s.obligations.overdue.count.toLocaleString("fa-IR")} معوق</span>
              )}
              <Link href="/debts/installments" className="ai-card-link">اقساط</Link>
            </h3>
            {upcoming.length === 0 ? (
              <p className="ai-empty-line">در ۶۰ روز آینده پرداخت قطعی ثبت نشده.</p>
            ) : (
              <ul className="ai-list" role="list">
                {upcoming.map((u, i) => (
                  <li key={`${u.date}-${u.title}-${i}`} className="ai-pay">
                    {dayBadge(u.date)}
                    <div className="min-w-0 flex-1">
                      <p className="ai-finding-title truncate">{u.title}</p>
                      <p className="ai-finding-text">
                        {u.kind === "installment" ? "قسط" : u.kind === "premium" ? "حق بیمه" : "پرداخت تکراری · برآورد"}
                      </p>
                    </div>
                    <Amount value={u.toman} size="sm" />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ai-card" aria-labelledby="ai-bud-title">
            <h3 className="ai-card-title" id="ai-bud-title">
              <span className="ai-card-title-icon" aria-hidden="true">
                <Icon name="budgets" size={14} />
              </span>
              <span>بودجه‌ها</span>
              <Link href="/budgets" className="ai-card-link">همه</Link>
            </h3>
            {s.budgets.length === 0 ? (
              <p className="ai-empty-line">
                بودجه‌ی فعالی ندارید. <Link href="/budgets" className="underline">ساخت بودجه</Link>
              </p>
            ) : (
              <ul className="ai-list" role="list">
                {s.budgets.map((b) => {
                  const tone = b.status === "over" ? "neg" : b.status === "at_risk" ? "warn" : "pos";
                  return (
                    <li key={`${b.name}-${b.periodStart}`} className="ai-budget">
                      <div className="ai-budget-head">
                        <p className="ai-finding-title truncate">{b.name}</p>
                        <span className={`ai-pct tone-${tone}`}>{Math.round(b.usagePct).toLocaleString("fa-IR")}٪</span>
                      </div>
                      <i className="ai-bar"><b className={`is-${tone}`} style={{ width: `${Math.min(100, b.usagePct)}%` }} /></i>
                      <p className="ai-finding-text">
                        {short(b.spentToman)} از {short(b.limitToman)} · {b.daysLeft.toLocaleString("fa-IR")} روز مانده
                        {b.status !== "ok" && ` · با این روند ${short(b.projectedToman)}`}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      {insight}

      <p className="ai-foot">
        <span>به‌روز تا {s.asOfJalali}</span>
        <span>·</span>
        <span>دلار {short(s.usdToToman)} تومان</span>
        {s.dataQuality.unreviewedImports > 0 && (
          <>
            <span>·</span>
            <span>{s.dataQuality.unreviewedImports.toLocaleString("fa-IR")} رکورد بازبینی‌نشده</span>
          </>
        )}
      </p>
    </div>
  );
}

export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await ensureAuth();
  const isOwner = isAdminOrOwner(user);
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

  const cashLoopTabTitle = "برنامه‌ریزی جریان نقدینگی";

  return (
    <div className="space-y-4">
      <PageHeader title="دستیار هوشمند" subtitle="وضعیت مالی‌تان در یک نگاه، برنامه‌ریزی جریان نقدینگی و پاسخ هر سؤالی درباره‌ی پولتان." />
      <AssistantWorkspace
        cashLoopTabTitle={cashLoopTabTitle}
        initialTab={sp.tab === "chat" ? "chat" : sp.tab === "cash_loop" ? "cash_loop" : "dashboard"}
        dashboard={
          snapshot ? (
            <Dashboard s={snapshot} insight={insight} />
          ) : (
            <Alert tone="neg" title="خواندن داده‌های مالی ناموفق بود">
              {loadError ? "دوباره امتحان کنید؛ اگر مشکل ماند، از صفحه‌ی بینش‌ها وضعیت را ببینید." : null}
            </Alert>
          )
        }
        chat={<AssistantChat configured={config.configured} initialConversations={conversations} initialMemories={memories} isOwner={isOwner} s={snapshot} />}
        cashLoop={snapshot ? <CashLoopPlanner s={snapshot} isOwner={isOwner} /> : null}
      />
    </div>
  );
}
