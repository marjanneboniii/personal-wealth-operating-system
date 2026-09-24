import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { backupRuns } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { PageHeader, Section } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import RowAction from "@/components/RowAction";
import RestorePanel from "@/components/RestorePanel";
import { formatDate } from "@/lib/format";
import { getCurrentUser, sanitizeUser } from "@/lib/auth";
import { ensureAuth } from "@/lib/authGuard";
import { refreshUserFxRateFromMarket } from "@/features/fx/userRate";
import FxSettings from "@/components/settings/FxSettings";
import UserPanel from "@/components/settings/UserPanel";
import AuthAccessCard from "@/components/auth/AuthAccessCard";
import DisplaySettings from "@/components/settings/DisplaySettings";
import AppVersion from "@/components/settings/AppVersion";

export const dynamic = "force-dynamic";

export const metadata = { title: "تنظیمات" };

/**
 * تنظیمات — only what a person manages: their account, the exchange rate, a
 * one-tap check and backups. Accounting-grade views (raw configuration, ledger
 * counts, audit trail) are deliberately not shown here, and neither is the
 * pro-mode switch: by owner decision the app never offers it.
 */
export default async function SettingsPage() {
  await ensureAuth({ allowIncompleteSetup: true });
  await seedIfEmpty();
  const user = await getCurrentUser();
  const [backups, fx] = await Promise.all([
    db.select().from(backupRuns).orderBy(desc(backupRuns.createdAt)).limit(5),
    user ? refreshUserFxRateFromMarket(user.id) : Promise.resolve({ rate: "190000", lastUpdatedAt: null, source: "default" } as any),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader title="تنظیمات" subtitle="حساب کاربری، زبان نمایش، نرخ مرجع و نسخهٔ پشتیبان." />

      {user && (
        <Section title="حساب کاربری">
          <UserPanel user={sanitizeUser(user) as any} />
          {(user.role === "owner" || user.role === "admin") && (
            <Link href="/admin" className="btn btn-ghost mt-2.5 !min-h-9 !px-3.5 !py-1.5 text-[length:var(--fs-xs)]">
              <Icon name="users" size={14} />
              مدیریت کاربران
            </Link>
          )}
        </Section>
      )}

      <Section title="نرخ مرجع" hint="همهٔ ارقام تومانی با این نرخ محاسبه می‌شوند">
        {user ? (
          <FxSettings currentRate={fx.rate} lastUpdatedAt={fx.lastUpdatedAt} source={fx.source} />
        ) : (
          <AuthAccessCard title="ورود و Auth کاربر در دسترس است" body="برای دیدن نرخ مرجع وارد شوید." />
        )}
      </Section>

      <Section title="نمایش" hint="فقط روی همین دستگاه ذخیره می‌شود">
        <DisplaySettings />
      </Section>

      <Section title="بررسی اطلاعات">
        <div className="card expense-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-0">
              <b className="block text-[length:var(--fs-sm)]">توازن حساب‌وکتاب</b>
              <span className="expense-sub block">اگر عددی به نظرتان درست نیست، با یک لمس بررسی کنید.</span>
            </span>
            <RowAction kind="integrity" label="بررسی درستی اعداد" primary />
          </div>
        </div>
      </Section>

      <Section title="پشتیبان‌گیری و بازیابی">
        <div className="card expense-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-0">
              <b className="block text-[length:var(--fs-sm)]">نسخهٔ پشتیبان</b>
              <span className="expense-sub block">یک نسخه از همهٔ اطلاعاتتان را دانلود و نگه دارید.</span>
            </span>
            <a className="btn btn-primary !min-h-9 shrink-0 !px-3.5 !py-1.5 text-[length:var(--fs-xs)]" href="/api/backup" download>
              <Icon name="download" size={14} />
              دانلود
            </a>
          </div>

          <RestorePanel />

          {backups.length > 0 && (
            <ul className="expense-sub space-y-1">
              {backups.map((b) => (
                <li key={b.id} className="flex items-center gap-1.5">
                  <Icon name="check" size={12} className="shrink-0" />
                  پشتیبان {formatDate(b.createdAt.toISOString().slice(0, 10))}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <AppVersion />
    </div>
  );
}
