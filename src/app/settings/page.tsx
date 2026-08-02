import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, backupRuns, settings } from "@/db/schema";
import { desc } from "drizzle-orm";
import { seedIfEmpty } from "@/db/seed";
import { Card, PageHeader } from "@/components/ui/Card";
import RowAction from "@/components/RowAction";
import RestorePanel from "@/components/RestorePanel";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  base_currency: "ارز پایه محاسبات",
  digit_style: "سبک ارقام",
  theme: "پوسته پیش‌فرض",
  irt_rate: "نرخ تبدیل دلار به تومان",
};

export default async function SettingsPage() {
  await seedIfEmpty();
  const [config, audits, backups, counts] = await Promise.all([
    db.select().from(settings).where(sql`${settings.deletedAt} is null`),
    db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(12),
    db.select().from(backupRuns).orderBy(desc(backupRuns.createdAt)).limit(5),
    db.execute(sql`
      select
        (select count(*) from journal_entries) as entries,
        (select count(*) from postings) as postings,
        (select count(*) from accounts) as accounts,
        (select count(*) from assets) as assets
    `),
  ]);
  const c = counts.rows[0] as Record<string, string>;

  return (
    <div className="space-y-4">
      <PageHeader title="تنظیمات، پشتیبان و امنیت" subtitle="داده‌ها کاملاً محلی هستند و هیچ اطلاعاتی به بیرون ارسال نمی‌شود." />

      <Card title="پیکربندی">
        <ul className="divide-y text-xs" style={{ borderColor: "var(--line)" }}>
          {config.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2.5">
              <span>{LABELS[s.key] ?? s.key}</span>
              <span className="num chip" dir="ltr">{s.value}</span>
            </li>
          ))}
        </ul>
        <p className="muted mt-3 text-[11px]">
          پوسته روشن/تاریک از نوار بالای صفحه قابل تغییر است و در همین دستگاه ذخیره می‌شود.
        </p>
      </Card>

      <Card title="سلامت داده">
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          {[
            ["اسناد", c.entries],
            ["ردیف‌های دفترکل", c.postings],
            ["حساب‌ها", c.accounts],
            ["دارایی‌ها", c.assets],
          ].map(([label, value]) => (
            <div key={label} className="soft rounded-2xl p-3">
              <div className="muted text-[10px]">{label}</div>
              <div className="num text-base font-bold" dir="ltr">{value}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <RowAction kind="integrity" label="بررسی تراز همه اسناد" primary />
          <RowAction kind="snapshot" label="ثبت عکس لحظه‌ای" />
        </div>
      </Card>

      <Card title="پشتیبان‌گیری و بازیابی">
        <div className="flex flex-wrap items-center gap-3">
          <a className="btn btn-primary" href="/api/backup" download>
            دانلود پشتیبان کامل (JSON)
          </a>
          <span className="muted text-[11px]">
            توصیه: خروجی روزانه + <span className="num" dir="ltr">pg_dump</span> شبانه و آزمون بازیابی ماهانه.
          </span>
        </div>
        <div className="mt-4">
          <RestorePanel />
        </div>
        <ul className="muted mt-4 space-y-1 text-[10px]">
          {backups.map((b) => (
            <li key={b.id}>
              پشتیبان {formatDate(b.createdAt.toISOString().slice(0, 10))} — {b.rowCount} سطر
            </li>
          ))}
        </ul>
      </Card>

      <Card title="گزارش حسابرسی (Audit Log)">
        <ul className="divide-y text-[11px]" style={{ borderColor: "var(--line)" }}>
          {audits.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2">
              <span>
                {a.action === "post_entry" ? "ثبت سند" : a.action === "reverse_entry" ? "ابطال سند" : a.action}
                <span className="muted mr-2">{a.entityType}</span>
              </span>
              <span className="muted num" dir="ltr">
                {new Date(a.createdAt).toISOString().slice(0, 16).replace("T", " ")}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
