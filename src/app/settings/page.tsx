import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { backupRuns, settings } from "@/db/schema";
import { desc } from "drizzle-orm";
import { seedIfEmpty } from "@/db/seed";
import { Metric, PageHeader, Section, SectionLink } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import RowAction from "@/components/RowAction";
import RestorePanel from "@/components/RestorePanel";
import { faCount, formatDate } from "@/lib/format";
import { getCurrentUser } from "@/lib/auth";
import { ensureAuth } from "@/lib/authGuard";
import { getUserFxRate } from "@/features/fx/userRate";
import { getUserProMode } from "@/features/preferences/service";
import FxSettings from "@/components/settings/FxSettings";
import ProModeToggle from "@/components/settings/ProModeToggle";
import UserPanel from "@/components/settings/UserPanel";
import AuthAccessCard from "@/components/auth/AuthAccessCard";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  base_currency: "ارز پایه محاسبات",
  digit_style: "سبک ارقام",
  theme: "پوسته پیش‌فرض",
  irt_rate: "نرخ تبدیل دلار به تومان (قدیمی — اکنون کاربرمحور)",
};

export default async function SettingsPage() {
  await ensureAuth();
  await seedIfEmpty();
  const user = await getCurrentUser();
  const uid = user?.id ?? null;
  const [config, backups, counts, fx, proMode] = await Promise.all([
    db.select().from(settings).where(sql`${settings.deletedAt} is null`),
    db.select().from(backupRuns).orderBy(desc(backupRuns.createdAt)).limit(5),
    db.execute(sql`
      select
        (select count(*) from journal_entries je where ${uid ? sql`je.user_id = ${uid}` : sql`1=1`}) as entries,
        (select count(*) from postings p join journal_entries je on je.id = p.entry_id where ${uid ? sql`je.user_id = ${uid}` : sql`1=1`}) as postings,
        (select count(*) from accounts a where a.deleted_at is null and ${uid ? sql`(a.user_id = ${uid} or a.user_id is null)` : sql`1=1`}) as accounts,
        (select count(*) from assets) as assets
    `),
    user ? getUserFxRate(user.id) : Promise.resolve({ rate: "190000", lastUpdatedAt: null, nextUpdateAt: null, canUpdate: false } as any),
    getUserProMode(uid),
  ]);
  const c = counts.rows[0] as Record<string, string>;

  return (
    <div className="space-y-8">
      <PageHeader title="تنظیمات" />

      {user && (
        <>
          <Section title="حساب کاربری">
            <UserPanel user={user as any} />
          </Section>
        </>
      )}

      <Section title="نمایش و حالت حرفه‌ای" hint="سراسری — روی همه صفحات اعمال می‌شود">
        {user ? (
          <ProModeToggle initialPro={proMode} />
        ) : (
          <div className="card p-4 text-[12.5px] leading-5">
            برای انتخاب بین <b>نمای ساده</b> (پیش‌فرض) و <b>حالت حرفه‌ای</b> (نمایش کد معین، بدهکار/بستانکار
            و جزئیات دفتر کل)، ابتدا وارد حساب خود شوید. این تنظیم به‌صورت اختصاصی برای هر کاربر ذخیره می‌شود.
          </div>
        )}
      </Section>

      <Section title="نرخ ارز — ارزش‌گذاری جاری">
        {user ? (
          <FxSettings
            currentRate={fx.rate}
            lastUpdatedAt={fx.lastUpdatedAt}
            nextUpdateAt={fx.nextUpdateAt}
            canUpdate={fx.canUpdate}
          />
        ) : (
          <AuthAccessCard
            googleClientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID}
            title="ورود و Auth کاربر در دسترس است"
            body="برای فعال‌کردن ثبت دستی نرخ ارز و جداسازی داده‌ها، از همین‌جا وارد شوید یا حساب بسازید. ورود با Google نیز در همین کارت نمایش داده می‌شود."
          />
        )}
      </Section>

      <Section title="پیکربندی">
        <div className="card overflow-hidden">
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {config.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-[13px]">{LABELS[s.key] ?? s.key}</span>
                <span className="num chip" dir="ltr">
                  {s.value}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="muted mt-2 flex items-center gap-1.5 text-[11px]">
          <Icon name="info" size={13} />
          پوسته روشن/تاریک از نوار بالا (موبایل) یا پایین سایدبار (دسکتاپ) تغییر می‌کند و در همین دستگاه ذخیره می‌شود.
        </p>
      </Section>

      <Section title="سلامت داده" action={<SectionLink href="/audit" label="حسابرسی کامل" />}>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Metric label="تراکنش‌ها" value={faCount(c.entries)} />
          <Metric label="ردیف‌های مالی" value={faCount(c.postings)} />
          <Metric label="حساب‌ها" value={faCount(c.accounts)} />
          <Metric label="دارایی‌ها" value={faCount(c.assets)} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <RowAction kind="integrity" label="بررسی تراز همه اسناد" primary />
          <RowAction kind="snapshot" label="ثبت اسنپ‌شات" />
          <Link href="/audit" className="btn btn-ghost !min-h-9 !px-3 !py-1.5 text-[12px]">
            <Icon name="audit" size={15} />
            گزارش یکپارچگی کامل
          </Link>
        </div>
      </Section>

      {/* Accounting-grade views: available, but deliberately out of the
          everyday navigation path (§38). Nothing here is editable. */}
      <Section title="پیشرفته" hint="نمای حسابداری دقیق — فقط خواندنی">
        <div className="card overflow-hidden">
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            <li>
              <Link href="/financial-records" className="flex items-center gap-3 px-4 py-3.5" style={{ touchAction: "manipulation" }}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
                  <Icon name="ledger" size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">سوابق مالی</span>
                  <span className="muted block text-[11px]">جزئیات کامل هر تراکنش و مسیر پول</span>
                </span>
                <Icon name="chevronLeft" size={16} className="shrink-0 opacity-50" />
              </Link>
            </li>
            <li>
              <Link href="/audit" className="flex items-center gap-3 px-4 py-3.5" style={{ touchAction: "manipulation" }}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
                  <Icon name="audit" size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">حسابرسی</span>
                  <span className="muted block text-[11px]">تاریخچه تغییرات: چه کسی، چه چیزی را، کِی تغییر داد</span>
                </span>
                <Icon name="chevronLeft" size={16} className="shrink-0 opacity-50" />
              </Link>
            </li>
          </ul>
        </div>
        <p className="muted mt-2 flex items-center gap-1.5 text-[11px]">
          <Icon name="info" size={13} />
          «سوابق مالی» اثر مالی رویدادهاست و «حسابرسی» تاریخچه تغییرات — این دو یکی نیستند.
        </p>
      </Section>

      <Section title="پشتیبان‌گیری و بازیابی">
        <div className="card p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <a className="btn btn-primary" href="/api/backup" download>
              <Icon name="download" size={16} />
              دانلود پشتیبان کامل
            </a>
          </div>
          <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <RestorePanel />
          </div>
          {backups.length > 0 && (
            <ul className="muted mt-4 space-y-1 text-[10.5px]">
              {backups.map((b) => (
                <li key={b.id} className="flex gap-2">
                  <Icon name="check" size={12} className="mt-0.5 shrink-0" />
                  پشتیبان {formatDate(b.createdAt.toISOString().slice(0, 10))} — {b.rowCount} سطر
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

    </div>
  );
}
