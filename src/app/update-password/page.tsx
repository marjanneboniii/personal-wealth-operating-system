import { updatePasswordAction } from "@/lib/auth-actions";
import { ensureAuth } from "@/lib/authGuard";

// This route depends on the request's Supabase session.  Without an explicit
// dynamic boundary Next.js attempts to prerender it during `next build`, where
// there is no request cookie and no authenticated database context.
export const dynamic = "force-dynamic";

export default async function UpdatePasswordPage() {
  await ensureAuth();
  return <div className="mx-auto max-w-md py-12">
    <div className="card space-y-4 p-6">
      <h1 className="type-page-title">تنظیم رمز عبور جدید</h1>
      <form action={updatePasswordAction} className="space-y-3">
        <input className="field" name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" placeholder="رمز جدید" />
        <input className="field" name="confirmPassword" type="password" required minLength={8} maxLength={128} autoComplete="new-password" placeholder="تکرار رمز جدید" />
        <button className="btn btn-primary w-full" type="submit">ذخیره رمز جدید</button>
      </form>
    </div>
  </div>;
}
