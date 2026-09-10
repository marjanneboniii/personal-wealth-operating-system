import Link from "next/link";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { PageHeader } from "@/components/ui/Card";
import { ensureAuth, isAdminOrOwner } from "@/lib/authGuard";
import { createAdminClient } from "@/lib/supabase/admin";
import { manageUserAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const actor = await ensureAuth();
  if (!isAdminOrOwner(actor)) return <div className="card p-6">دسترسی به مدیریت کاربران مجاز نیست.</div>;
  const page = Math.min(10_000, Math.max(1, Number((await searchParams).page) || 1));
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 50 });
  if (error) throw new Error("خواندن کاربران Supabase ناموفق بود.");
  const ids = data.users.map((u) => u.id);
  const profiles = ids.length ? await db.select().from(users).where(inArray(users.id, ids)) : [];
  const byId = new Map(profiles.map((p) => [p.id, p]));

  return <div className="space-y-6">
    <PageHeader title="مدیریت کاربران" subtitle="دسترسی محدود، صفحه‌بندی‌شده و ثبت‌شده در گزارش حسابرسی" />
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[760px] text-right text-[12px]">
        <thead><tr className="border-b"><th scope="col" className="p-3">کاربر</th><th scope="col" className="p-3">نقش</th><th scope="col" className="p-3">آخرین ورود</th><th scope="col" className="p-3">وضعیت</th><th scope="col" className="p-3">عملیات</th></tr></thead>
        <tbody>{data.users.map((authUser) => {
          const profile = byId.get(authUser.id);
          const suspended = Boolean(authUser.banned_until && new Date(authUser.banned_until) > new Date());
          return <tr key={authUser.id} className="border-b" style={{ borderColor: "var(--border)" }}>
            <td className="p-3"><div>{profile?.name || "کاربر"}</div><div className="muted" dir="ltr">{authUser.email || authUser.id}</div></td>
            <td className="p-3">{profile?.role || "user"}</td>
            <td className="p-3 num">{authUser.last_sign_in_at ? new Date(authUser.last_sign_in_at).toLocaleString("fa-IR") : "—"}</td>
            <td className="p-3">{suspended ? "تعلیق" : authUser.email_confirmed_at ? "فعال" : "تأییدنشده"}</td>
            <td className="p-3"><div className="flex flex-wrap gap-2">
              {authUser.id !== actor.id && profile?.role !== "owner" && <>
                <form action={manageUserAction}><input type="hidden" name="userId" value={authUser.id}/><input type="hidden" name="action" value={suspended ? "restore" : "suspend"}/><button className="btn btn-ghost !min-h-8 text-[11px]">{suspended ? "رفع تعلیق" : "تعلیق"}</button></form>
                {actor.role === "owner" && profile?.role !== "owner" && <form action={manageUserAction}><input type="hidden" name="userId" value={authUser.id}/><input type="hidden" name="action" value={profile?.role === "admin" ? "make-user" : "make-admin"}/><button className="btn btn-ghost !min-h-8 text-[11px]">{profile?.role === "admin" ? "کاربر عادی" : "مدیر"}</button></form>}
              </>}
            </div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <div className="flex justify-between"><Link className="btn btn-ghost" href={`/admin?page=${Math.max(1, page - 1)}`}>قبلی</Link><span className="muted">صفحه {page}</span><Link className="btn btn-ghost" href={`/admin?page=${page + 1}`}>بعدی</Link></div>
  </div>;
}
