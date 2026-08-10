import Link from "next/link";
import GoogleAuthButton from "@/components/auth/GoogleAuthButton";

export default function AuthAccessCard({
  googleClientId,
  title = "حساب کاربری و ورود",
  body = "برای ثبت نرخ شخصی، حفظ مالکیت داده‌ها و استفاده از ورود Google، ابتدا وارد شوید یا حساب بسازید.",
}: {
  googleClientId?: string;
  title?: string;
  body?: string;
}) {
  return (
    <div className="card space-y-3 p-4 sm:p-5">
      <div>
        <h3 className="text-[14px] font-bold">{title}</h3>
        <p className="muted mt-1 text-[11.5px] leading-5">{body}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/login" className="btn btn-primary !min-h-10 !px-4 text-[12px]">
          ورود
        </Link>
        <Link href="/register" className="btn btn-ghost !min-h-10 !px-4 text-[12px]">
          ساخت حساب
        </Link>
      </div>
      <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
        <GoogleAuthButton clientId={googleClientId} label="ورود با Google" />
      </div>
    </div>
  );
}
