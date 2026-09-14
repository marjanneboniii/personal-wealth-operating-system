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

export const dynamic = "force-dynamic";

/**
 * تنظیمات — only what a person manages: their account, the exchange rate,
 * a one-tap check and backups. Accounting-grade views (raw configuration,
 * ledger counts, audit trail) are deliberately not shown here.
 */
export default async function SettingsPage() {
  await ensureAuth();
  await seedIfEmpty();
  const user = await getCurrentUser();
  const [backups, fx] = await Promise.all([
    db.select().from(backupRuns).orderBy(desc(backupRuns.createdAt)).limit(5),
    user ? refreshUserFxRateFromMarket(user.id) : Promise.resolve({ rate: "190000", lastUpdatedAt: null, source: "default" } as any),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader title="تنظیمات" />

      {user && (
        <Section title="حساب کاربری">
          <UserPanel user={sanitizeUser(user) as any} />
          {(user.role === "owner" || user.role === "admin") && <Link href="/admin" className="btn btn-ghost mt-3">مدیریت کاربران</Link>}
        </Section>
      )}

      <Section title="نرخ ارز — ارزش‌گذاری جاری">
        {user ? (
          <FxSettings currentRate={fx.rate} lastUpdatedAt={fx.lastUpdatedAt} source={fx.source} />
        ) : (
          <AuthAccessCard
            title="ورود و Auth کاربر در دسترس است"
            body="برای دیدن نرخ مرجع وارد شوید."
          />
        )}
      </Section>

      <Section title="بررسی اطلاعات">
        <div className="card space-y-3 p-4 sm:p-5">
          <p className="text-[length:var(--fs-sm)] leading-7">
            توازن حساب‌وکتاب را خودکار انجام می‌دهد. اگر عددی به نظرتان درست نیست، با یک لمس بررسی کنید.
          </p>
          <RowAction kind="integrity" label="بررسی درستی اعداد" primary />
        </div>
      </Section>

      <Section title="پشتیبان‌گیری و بازیابی">
        <div className="card p-4 sm:p-5">
          <p className="muted mb-3 text-[length:var(--fs-xs)] leading-6">
            یک نسخه از همهٔ اطلاعاتتان را دانلود و نگه دارید تا هر وقت لازم شد آن را بازگردانید.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <a className="btn btn-primary" href="/api/backup" download>
              <Icon name="download" size={16} />
              دانلود نسخهٔ پشتیبان
            </a>
          </div>
          <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <RestorePanel />
          </div>
          {backups.length > 0 && (
            <ul className="muted mt-4 space-y-1 text-[length:var(--fs-xs)]">
              {backups.map((b) => (
                <li key={b.id} className="flex gap-2">
                  <Icon name="check" size={12} className="mt-0.5 shrink-0" />
                  پشتیبان {formatDate(b.createdAt.toISOString().slice(0, 10))}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <p className="muted flex items-center gap-1.5 text-[length:var(--fs-xs)]">
        <Icon name="info" size={13} />
        پوسته روشن/تاریک از نوار بالا (موبایل) یا پایین سایدبار (دسکتاپ) تغییر می‌کند و در همین دستگاه ذخیره می‌شود.
      </p>
    </div>
  );
}
