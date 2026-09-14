import Link from "next/link";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { realEstateProperties, userSetupState, users, vehicleAssets } from "@/db/schema";
import { PageHeader } from "@/components/ui/Card";
import { ensureAuth, isAdminOrOwner } from "@/lib/authGuard";
import { createAdminClient } from "@/lib/supabase/admin";
import { faCount } from "@/lib/format";
import { manageUserAction } from "./actions";

export const dynamic = "force-dynamic";

const PER_PAGE = 50;

const ROLE_LABELS: Record<string, string> = { owner: "مالک سیستم", admin: "مدیر", user: "کاربر" };

/**
 * PRIVACY: the admin sees account status and activity only — counts of
 * registered items, never balances, amounts, plates or any other financial
 * detail of a user.
 */
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const actor = await ensureAuth();
  if (!isAdminOrOwner(actor)) return <div className="card p-6">دسترسی به مدیریت کاربران مجاز نیست.</div>;
  const page = Math.min(10_000, Math.max(1, Number((await searchParams).page) || 1));
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
  if (error) throw new Error("خواندن کاربران Supabase ناموفق بود.");
  const ids = data.users.map((u) => u.id);

  const [profiles, propertyCounts, vehicleCounts, setupRows, [summary]] = await Promise.all([
    ids.length ? db.select().from(users).where(inArray(users.id, ids)) : Promise.resolve([]),
    ids.length
      ? db
          .select({ userId: realEstateProperties.userId, n: sql<number>`count(*)::int` })
          .from(realEstateProperties)
          .where(inArray(realEstateProperties.userId, ids))
          .groupBy(realEstateProperties.userId)
      : Promise.resolve([]),
    ids.length
      ? db
          .select({ userId: vehicleAssets.userId, n: sql<number>`count(*)::int` })
          .from(vehicleAssets)
          .where(inArray(vehicleAssets.userId, ids))
          .groupBy(vehicleAssets.userId)
      : Promise.resolve([]),
    ids.length
      ? db
          .select({ userId: userSetupState.userId, completed: userSetupState.completed, step: userSetupState.currentStep })
          .from(userSetupState)
          .where(inArray(userSetupState.userId, ids))
      : Promise.resolve([]),
    db.execute(sql`
      select
        (select count(*)::int from users where deleted_at is null) as profiles,
        (select count(*)::int from users where role in ('owner', 'admin') and deleted_at is null) as admins,
        (select count(distinct user_id)::int from user_setup_state where completed) as setup_completed,
        (select count(*)::int from real_estate_properties) as properties,
        (select count(*)::int from vehicle_assets) as vehicles
    `).then((r) => (r as { rows: Array<Record<string, number>> }).rows),
  ]);

  const byId = new Map(profiles.map((p) => [p.id, p]));
  const propertiesByUser = new Map(propertyCounts.map((r) => [r.userId, Number(r.n)]));
  const vehiclesByUser = new Map(vehicleCounts.map((r) => [r.userId, Number(r.n)]));
  const setupByUser = new Map<string | null, { completed: boolean; step: number }>();
  for (const row of setupRows) {
    const prev = setupByUser.get(row.userId);
    if (!prev || row.completed) setupByUser.set(row.userId, { completed: row.completed, step: row.step });
  }

  const totalUsers = Number((data as { total?: number }).total ?? summary?.profiles ?? 0);
  const hasNext = Boolean((data as { nextPage?: number | null }).nextPage) || data.users.length === PER_PAGE;
  const weekAgo = new Date().getTime() - 7 * 24 * 60 * 60 * 1000;
  const activeThisPage = data.users.filter((u) => u.last_sign_in_at && new Date(u.last_sign_in_at).getTime() > weekAgo).length;

  const stats = [
    { label: "کل کاربران", value: totalUsers },
    { label: "راه‌اندازی تکمیل‌شده", value: Number(summary?.setup_completed ?? 0) },
    { label: "فعال در ۷ روز اخیر (این صفحه)", value: activeThisPage },
    { label: "مدیران", value: Number(summary?.admins ?? 0) },
    { label: "املاک ثبت‌شده", value: Number(summary?.properties ?? 0) },
    { label: "خودروهای ثبت‌شده", value: Number(summary?.vehicles ?? 0) },
  ];

  return <div className="space-y-6">
    <PageHeader title="مدیریت کاربران" subtitle="وضعیت حساب‌ها بدون نمایش مبالغ یا اطلاعات مالی کاربران · هر تغییر در گزارش حسابرسی ثبت می‌شود" />
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {stats.map((s) => <div key={s.label} className="card p-3">
        <div className="muted text-[length:var(--fs-xs)]">{s.label}</div>
        <div className="num mt-1 text-[length:var(--fs-lg)] font-bold">{faCount(s.value)}</div>
      </div>)}
    </div>
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[980px] text-right text-[length:var(--fs-xs)]">
        <thead><tr className="border-b">
          <th scope="col" className="p-3">کاربر</th>
          <th scope="col" className="p-3">نقش</th>
          <th scope="col" className="p-3">عضویت</th>
          <th scope="col" className="p-3">آخرین ورود</th>
          <th scope="col" className="p-3">راه‌اندازی اولیه</th>
          <th scope="col" className="p-3">ملک / خودرو</th>
          <th scope="col" className="p-3">وضعیت</th>
          <th scope="col" className="p-3">عملیات</th>
        </tr></thead>
        <tbody>{data.users.map((authUser) => {
          const profile = byId.get(authUser.id);
          const suspended = Boolean(authUser.banned_until && new Date(authUser.banned_until) > new Date());
          const setup = setupByUser.get(authUser.id);
          return <tr key={authUser.id} className="border-b" style={{ borderColor: "var(--border)" }}>
            <td className="p-3"><div>{profile?.name || "کاربر"}</div><div className="muted" dir="ltr">{authUser.email || authUser.id}</div></td>
            <td className="p-3">{ROLE_LABELS[profile?.role ?? "user"] ?? profile?.role}</td>
            <td className="p-3 num">{authUser.created_at ? new Date(authUser.created_at).toLocaleDateString("fa-IR") : "—"}</td>
            <td className="p-3 num">{authUser.last_sign_in_at ? new Date(authUser.last_sign_in_at).toLocaleString("fa-IR") : "—"}</td>
            <td className="p-3">{setup?.completed ? "تکمیل‌شده" : setup ? `مرحلهٔ ${faCount(setup.step)}` : "شروع‌نشده"}</td>
            <td className="p-3 num">{faCount(propertiesByUser.get(authUser.id) ?? 0)} / {faCount(vehiclesByUser.get(authUser.id) ?? 0)}</td>
            <td className="p-3">{suspended ? "تعلیق" : !profile ? "بدون پروفایل" : authUser.email_confirmed_at ? "فعال" : "تأییدنشده"}</td>
            <td className="p-3"><div className="flex flex-wrap gap-2">
              {authUser.id !== actor.id && profile && profile.role !== "owner" && <>
                <form action={manageUserAction}><input type="hidden" name="userId" value={authUser.id}/><input type="hidden" name="action" value={suspended ? "restore" : "suspend"}/><button className="btn btn-ghost !min-h-8 text-[length:var(--fs-xs)]">{suspended ? "رفع تعلیق" : "تعلیق"}</button></form>
                {actor.role === "owner" && <form action={manageUserAction}><input type="hidden" name="userId" value={authUser.id}/><input type="hidden" name="action" value={profile.role === "admin" ? "make-user" : "make-admin"}/><button className="btn btn-ghost !min-h-8 text-[length:var(--fs-xs)]">{profile.role === "admin" ? "کاربر عادی" : "مدیر"}</button></form>}
              </>}
            </div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <div className="flex items-center justify-between">
      {page > 1 ? <Link className="btn btn-ghost" href={`/admin?page=${page - 1}`}>قبلی</Link> : <span />}
      <span className="muted">صفحه {faCount(page)}</span>
      {hasNext ? <Link className="btn btn-ghost" href={`/admin?page=${page + 1}`}>بعدی</Link> : <span />}
    </div>
  </div>;
}
