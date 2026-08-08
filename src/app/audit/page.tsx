import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { runIntegrityChecks, summarize, type CheckStatus } from "@/features/integrity/service";
import { EmptyState, PageHeader, Section } from "@/components/ui/Card";
import Icon, { type IconName } from "@/components/ui/Icon";
import { formatJalaliIso } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_UI: Record<CheckStatus, { icon: IconName; color: string; bg: string; label: string }> = {
  pass: { icon: "check-circle", color: "var(--positive)", bg: "var(--positive-soft)", label: "سالم" },
  warn: { icon: "alert", color: "var(--warning)", bg: "var(--warning-soft)", label: "هشدار" },
  fail: { icon: "xcircle", color: "var(--negative)", bg: "var(--negative-soft)", label: "خطا" },
};

const ACTION_LABELS: Record<string, string> = {
  post_entry: "ثبت سند",
  reverse_entry: "سند معکوس",
};

export default async function AuditPage() {
  await seedIfEmpty();
  const [checks, auditRows] = await Promise.all([
    runIntegrityChecks(),
    db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(15),
  ]);

  const summary = summarize(checks);
  const allOk = checks.every((c) => c.status === "pass");
  const fails = checks.filter((c) => c.status === "fail").length;
  const warnings = checks.filter((c) => c.status === "warn").length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="حسابرسی و یکپارچگی"
        subtitle="آیا می‌توانم به این اعداد اعتماد کنم؟ — هفت آزمون مستقیم روی دیتابیس، در لحظه اجرا می‌شوند."
      />

      {/* ═══ FINANCIAL INTEGRITY banner ═══ */}
      <section
        className="rise rounded-[var(--r-lg)] border p-5"
        style={{
          borderColor: allOk ? "color-mix(in oklab, var(--positive) 30%, transparent)" : fails ? "color-mix(in oklab, var(--negative) 30%, transparent)" : "color-mix(in oklab, var(--warning) 30%, transparent)",
          background: allOk ? "var(--positive-soft)" : fails ? "var(--negative-soft)" : "var(--warning-soft)",
        }}
        role="status"
        aria-live="polite"
      >
        <p className="text-[10.5px] font-semibold tracking-wide" style={{ color: "var(--text-2)" }}>
          یکپارچگی مالی
        </p>
        <div className="mt-2 flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full"
            style={{ background: "var(--surface)", color: allOk ? "var(--positive)" : fails ? "var(--negative)" : "var(--warning)" }}
          >
            <Icon name={allOk ? "check-circle" : fails ? "xcircle" : "alert"} size={22} />
          </span>
          <div>
            <p className="text-[16px] font-bold tracking-tight">
              {allOk ? "به این اعداد می‌توانید اعتماد کنید" : fails ? `${fails} مشکل جدی نیاز به اقدام دارد` : "قابل اعتماد، با چند نکته"}
            </p>
            <p className="sub text-[12px]">
              {allOk
                ? "هر هفت آزمون در همین لحظه موفق بود. مانده‌ها از یک دفترکل تراز مشتق شده‌اند."
                : `${checks.filter((c) => c.status === "pass").length} آزمون موفق · ${warnings} هشدار · ${fails} خطا`}
            </p>
          </div>
        </div>
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {summary.map((s) => (
            <li
              key={s.id}
              className="badge"
              style={{
                background: s.ok ? "var(--surface)" : "color-mix(in oklab, var(--surface) 60%, transparent)",
                color: s.ok ? "var(--positive)" : "var(--warning)",
                border: "1px solid var(--border)",
              }}
            >
              <Icon name={s.ok ? "check" : "alert"} size={11} />
              {s.label}
            </li>
          ))}
        </ul>
      </section>

      {/* ═══ Checks ═══ */}
      <Section title="آزمون‌ها" hint="برای هر آزمون: چه چیزی بررسی می‌شود، نتیجه چیست، و اگر مشکلی باشد چه باید کرد">
        <ul className="space-y-2.5">
          {checks.map((c) => {
            const ui = STATUS_UI[c.status];
            return (
              <li key={c.id} className="card p-4 sm:p-5">
                <div className="flex items-start gap-3.5">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: ui.bg, color: ui.color }}>
                    <Icon name={ui.icon} size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[14px] font-semibold tracking-tight">{c.title}</h3>
                      <span className="badge" style={{ background: ui.bg, color: ui.color }}>
                        {c.severityLabel}
                      </span>
                      {c.affected > 0 && <span className="badge badge-neutral num">{c.affected} رکورد</span>}
                    </div>
                    <p className="sub mt-1 text-[12px] leading-5">{c.description}</p>
                    <p className="mt-2 text-[12.5px] font-medium" style={{ color: ui.color }}>
                      {c.outcome}
                    </p>
                    {c.samples.length > 0 && (
                      <details className="mt-2">
                        <summary className="muted cursor-pointer text-[11px] underline underline-offset-2">
                          مشاهده {c.samples.length} رکورد متاثر
                        </summary>
                        <ul className="sub mt-1.5 space-y-1 text-[11.5px]">
                          {c.samples.map((s, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="muted">·</span>
                              {s}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <div className="muted mt-2 flex flex-wrap items-center gap-x-3 text-[10px]">
                      <span>
                        اجرا: <span className="num">{formatJalaliIso(c.ranAt.slice(0, 10))}</span> · هم‌اکنون
                      </span>
                    </div>
                  </div>
                  {c.action && (
                    <Link href={c.action.href} className="btn btn-soft !min-h-9 shrink-0 !px-3.5 !py-1.5 text-[12px]">
                      {c.action.label}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      {/* ═══ Audit trail ═══ */}
      <Section title="ردپای حسابرسی" hint="هر نوشتن در سیستم — چه کسی، چه چیزی، چه زمانی" action={<Link href="/settings" className="chip">پشتیبان‌گیری</Link>}>
        {auditRows.length === 0 ? (
          <EmptyState icon="audit" title="هنوز رویدادی ثبت نشده است" body="هر ثبت یا اصلاح در دفترکل، اینجا ردپای ماندگار می‌گذارد." />
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>زمان</th>
                  <th>رویداد</th>
                  <th>موجودیت</th>
                  <th>شناسه</th>
                </tr>
              </thead>
              <tbody>
                {auditRows.map((a) => (
                  <tr key={a.id}>
                    <td className="num whitespace-nowrap" dir="ltr">
                      {a.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="font-medium">{ACTION_LABELS[a.action] ?? a.action}</td>
                    <td className="muted">{a.entityType === "journal_entry" ? "سند روزنامه" : a.entityType}</td>
                    <td className="num muted" dir="ltr">
                      {a.entityId ? "#" + a.entityId.replace(/-/g, "").slice(0, 8).toUpperCase() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
